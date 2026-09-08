import type { ScanSummary } from '../core/types.ts';
import type { ScanResponse, ToContentMessage } from '../shared/messaging.ts';
import { isHostDisabled, loadSettings, type Settings } from '../shared/settings.ts';
import { scanDocument } from '../extract/scan.ts';
import { createBadgeController, type BadgeController } from './badges.ts';

/**
 * Content script entry point.
 *
 * Injected two ways — on demand when the toolbar icon is used, and
 * automatically on sites the user has granted permanently — so the first thing
 * it does is check whether a previous copy is already running and, if so, hand
 * that copy the work instead of installing a second overlay.
 */

interface PpdRuntime {
  rescan(): void;
  teardown(): void;
}

const RUNTIME_KEY = '__pricePerDollarRuntime';
const RESCAN_DEBOUNCE_MS = 600;
const MIN_SCAN_INTERVAL_MS = 1200;
const LOCATION_POLL_MS = 1500;

type RuntimeHolder = Record<string, PpdRuntime | undefined>;

function install(): PpdRuntime {
  let controller: BadgeController | null = null;
  let settings: Settings | null = null;
  let lastSummary: ScanSummary | null = null;
  let lastScanAt = 0;
  let debounceTimer: number | null = null;
  let locationTimer: number | null = null;
  let lastHref = location.href;
  let observer: MutationObserver | null = null;
  let torndown = false;

  function ensureController(): BadgeController {
    controller ??= createBadgeController();
    return controller;
  }

  async function scan(): Promise<ScanSummary | null> {
    if (torndown) return null;
    lastScanAt = Date.now();
    settings = await loadSettings();

    if (isHostDisabled(settings, location.hostname)) {
      controller?.clear();
      lastSummary = null;
      return null;
    }

    let result;
    try {
      result = scanDocument(document, {
        mode: settings.mode,
        similarityThreshold: settings.similarityThreshold,
        ...(settings.measurementSystem === 'auto' ? {} : { system: settings.measurementSystem }),
      });
    } catch (error) {
      console.warn('[Price Per Dollar] scan failed', error);
      return null;
    }

    lastSummary = result.summary;
    ensureController().render(result.summary, result.scanned, settings);

    try {
      void chrome.runtime.sendMessage({ type: 'PPD_SCAN_RESULT', summary: result.summary });
    } catch {
      // The extension was reloaded underneath this page; the overlay still works.
    }
    return result.summary;
  }

  /** Coalesce the storm of mutations an infinite-scroll grid produces. */
  function scheduleRescan(): void {
    if (torndown || debounceTimer !== null) return;
    const sinceLast = Date.now() - lastScanAt;
    const delay = Math.max(RESCAN_DEBOUNCE_MS, MIN_SCAN_INTERVAL_MS - sinceLast);
    debounceTimer = window.setTimeout(() => {
      debounceTimer = null;
      void scan();
    }, delay);
  }

  function startObserving(): void {
    if (!document.body) return;
    observer = new MutationObserver((records) => {
      // Ignore mutations that only touch our own overlay.
      const relevant = records.some((record) => {
        const target = record.target as HTMLElement | null;
        return !target?.closest?.('[data-ppd-overlay]');
      });
      if (relevant) scheduleRescan();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Single-page storefronts swap the whole grid without a navigation event.
    locationTimer = window.setInterval(() => {
      if (location.href === lastHref) return;
      lastHref = location.href;
      scheduleRescan();
    }, LOCATION_POLL_MS);
  }

  function teardown(): void {
    torndown = true;
    observer?.disconnect();
    observer = null;
    if (debounceTimer !== null) window.clearTimeout(debounceTimer);
    if (locationTimer !== null) window.clearInterval(locationTimer);
    controller?.destroy();
    controller = null;
    delete (window as unknown as RuntimeHolder)[RUNTIME_KEY];
  }

  chrome.runtime.onMessage.addListener((
    message: ToContentMessage,
    _sender,
    sendResponse: (response: ScanResponse | { ok: true }) => void,
  ) => {
    switch (message?.type) {
      case 'PPD_SCAN':
        void scan().then((summary) => {
          sendResponse(summary
            ? { ok: true, summary }
            : { ok: false, error: 'Price Per Dollar is switched off for this site.' });
        });
        return true;

      case 'PPD_GET_STATE':
        sendResponse(lastSummary
          ? { ok: true, summary: lastSummary }
          : { ok: false, error: 'No scan yet.' });
        return true;

      case 'PPD_APPLY_SETTINGS':
        settings = message.settings;
        void scan().then((summary) => {
          sendResponse(summary ? { ok: true, summary } : { ok: false, error: 'Disabled for this site.' });
        });
        return true;

      case 'PPD_FOCUS_ITEM':
        controller?.focus(message.itemId);
        sendResponse({ ok: true });
        return false;

      case 'PPD_TEARDOWN':
        teardown();
        sendResponse({ ok: true });
        return false;

      default:
        return false;
    }
  });

  startObserving();
  void scan();

  return { rescan: () => void scan(), teardown };
}

const holder = window as unknown as RuntimeHolder;
const existing = holder[RUNTIME_KEY];
if (existing) {
  // A second injection of the same page: rescan rather than stacking overlays.
  existing.rescan();
} else {
  holder[RUNTIME_KEY] = install();
}
