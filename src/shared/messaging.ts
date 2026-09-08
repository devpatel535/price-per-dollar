import type { ScanSummary } from '../core/types.ts';
import type { Settings } from './settings.ts';

/** Messages the popup and background send to a page's content script. */
export type ToContentMessage =
  | { type: 'PPD_SCAN'; settings?: Partial<Settings> }
  | { type: 'PPD_GET_STATE' }
  | { type: 'PPD_APPLY_SETTINGS'; settings: Settings }
  | { type: 'PPD_FOCUS_ITEM'; itemId: string }
  | { type: 'PPD_TEARDOWN' };

/** Messages a content script sends back to the extension. */
export type FromContentMessage =
  | { type: 'PPD_SCAN_RESULT'; summary: ScanSummary };

export type ScanResponse =
  | { ok: true; summary: ScanSummary }
  | { ok: false; error: string };

export const CONTENT_SCRIPT_FILE = 'content/index.js';
export const DYNAMIC_SCRIPT_ID = 'ppd-auto';

/** Send a message to a tab, resolving to null instead of throwing when no content script is listening. */
export async function sendToTab<T>(tabId: number, message: ToContentMessage): Promise<T | null> {
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as T;
  } catch {
    return null;
  }
}

/** Pages Chrome refuses to let any extension touch, whatever it asks for. */
const RESTRICTED = [
  /^chrome:\/\//i,
  /^chrome-extension:\/\//i,
  /^edge:\/\//i,
  /^about:/i,
  /^devtools:\/\//i,
  /^view-source:/i,
  /^https:\/\/chrome\.google\.com\/webstore/i,
  /^https:\/\/chromewebstore\.google\.com/i,
];

export function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) return false;
  return RESTRICTED.some((pattern) => pattern.test(url));
}

/**
 * Whether a content script could run here.
 *
 * A missing URL is not a "no": Chrome redacts `tab.url` until the extension is
 * invoked, so callers must treat unknown as "try it and see" rather than
 * refusing outright.
 */
export function isInjectableUrl(url: string | undefined): boolean {
  if (!url) return false;
  if (isRestrictedUrl(url)) return false;
  return /^https?:\/\//i.test(url);
}
