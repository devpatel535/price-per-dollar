import type { FromContentMessage } from '../shared/messaging.ts';
import { CONTENT_SCRIPT_FILE, DYNAMIC_SCRIPT_ID } from '../shared/messaging.ts';
import { DEFAULT_SETTINGS, loadSettings } from '../shared/settings.ts';

/**
 * Background service worker.
 *
 * It holds no page data of its own beyond the last scan per tab, and it never
 * talks to the network. Its real job is keeping the auto-run content-script
 * registration in step with the host permissions the user has actually granted.
 */

const SESSION_PREFIX = 'scan:';

/**
 * Re-register the auto-run content script for exactly the origins the user has
 * granted. Anywhere else, the extension only runs when the toolbar icon is used.
 */
async function syncRegisteredScripts(): Promise<void> {
  let origins: string[] = [];
  try {
    const granted = await chrome.permissions.getAll();
    origins = (granted.origins ?? []).filter((origin) => /^https?:/i.test(origin));
  } catch {
    origins = [];
  }

  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [DYNAMIC_SCRIPT_ID] });
    if (existing.length > 0) {
      await chrome.scripting.unregisterContentScripts({ ids: [DYNAMIC_SCRIPT_ID] });
    }
  } catch {
    // Nothing registered yet, which is the state we want to move on from.
  }

  if (origins.length === 0) return;

  try {
    await chrome.scripting.registerContentScripts([{
      id: DYNAMIC_SCRIPT_ID,
      js: [CONTENT_SCRIPT_FILE],
      matches: origins,
      runAt: 'document_idle',
      allFrames: false,
    }]);
  } catch (error) {
    console.warn('[Price Per Dollar] could not register auto-run script', error);
  }
}

async function setBadge(tabId: number, count: number): Promise<void> {
  try {
    await chrome.action.setBadgeText({ tabId, text: count > 0 ? String(count) : '' });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#0f766e' });
  } catch {
    // The tab may have gone away between the scan and this call.
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void (async () => {
    const settings = await loadSettings();
    await chrome.storage.sync.set({ settings: { ...DEFAULT_SETTINGS, ...settings } });
    await syncRegisteredScripts();
  })();
});

chrome.runtime.onStartup.addListener(() => {
  void syncRegisteredScripts();
});

chrome.permissions.onAdded.addListener(() => {
  void syncRegisteredScripts();
});

chrome.permissions.onRemoved.addListener(() => {
  void syncRegisteredScripts();
});

chrome.runtime.onMessage.addListener((message: FromContentMessage, sender) => {
  if (message?.type !== 'PPD_SCAN_RESULT') return undefined;
  const tabId = sender.tab?.id;
  if (typeof tabId !== 'number') return undefined;

  void (async () => {
    const rankable = message.summary.items.length - message.summary.unsizedCount;
    await setBadge(tabId, rankable);
    try {
      await chrome.storage.session.set({ [`${SESSION_PREFIX}${tabId}`]: message.summary });
    } catch {
      // Session storage is best-effort; the popup can always ask for a rescan.
    }
  })();
  return undefined;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void chrome.storage.session.remove(`${SESSION_PREFIX}${tabId}`).catch(() => undefined);
});
