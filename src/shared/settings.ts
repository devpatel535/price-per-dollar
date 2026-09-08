import type { GroupingMode } from '../core/types.ts';

export interface Settings {
  /** Draw unit-price badges on product cards. */
  showBadges: boolean;
  /** Outline the best-value card in each group. */
  highlightBest: boolean;
  /** Show the floating summary pill. */
  showSummary: boolean;
  /** `smart` compares like with like; `page` ranks everything sharing a basis. */
  mode: GroupingMode;
  /** 0..1 — how alike two titles must be to share a group. */
  similarityThreshold: number;
  /** `auto` reads the system from the page's currency and domain. */
  measurementSystem: 'auto' | 'US' | 'IMPERIAL';
  /** Hosts the user has switched the extension off for. */
  disabledHosts: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  showBadges: true,
  highlightBest: true,
  showSummary: true,
  mode: 'smart',
  similarityThreshold: 0.4,
  measurementSystem: 'auto',
  disabledHosts: [],
};

const STORAGE_KEY = 'settings';

function area(): chrome.storage.StorageArea {
  return chrome.storage?.sync ?? chrome.storage.local;
}

function coerce(raw: unknown): Settings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
  const value = raw as Partial<Settings>;
  const threshold = Number(value.similarityThreshold);
  return {
    showBadges: value.showBadges ?? DEFAULT_SETTINGS.showBadges,
    highlightBest: value.highlightBest ?? DEFAULT_SETTINGS.highlightBest,
    showSummary: value.showSummary ?? DEFAULT_SETTINGS.showSummary,
    mode: value.mode === 'page' ? 'page' : 'smart',
    similarityThreshold: Number.isFinite(threshold) && threshold > 0 && threshold <= 1
      ? threshold
      : DEFAULT_SETTINGS.similarityThreshold,
    measurementSystem: value.measurementSystem === 'US' || value.measurementSystem === 'IMPERIAL'
      ? value.measurementSystem
      : 'auto',
    disabledHosts: Array.isArray(value.disabledHosts)
      ? value.disabledHosts.filter((host): host is string => typeof host === 'string')
      : [],
  };
}

export async function loadSettings(): Promise<Settings> {
  try {
    const stored = await area().get(STORAGE_KEY);
    return coerce(stored[STORAGE_KEY]);
  } catch {
    // Storage can be unavailable in a restricted context; defaults still work.
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = coerce({ ...(await loadSettings()), ...patch });
  await area().set({ [STORAGE_KEY]: next });
  return next;
}

export function isHostDisabled(settings: Settings, hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  return settings.disabledHosts.some((entry) => entry.toLowerCase().replace(/^www\./, '') === host);
}
