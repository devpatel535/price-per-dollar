import type {
  GroupingMode, MeasurementSystem, ProductItem, ScanSummary, ScannedItem,
} from '../core/types.ts';
import type { ExtractContext, RawItem } from './types.ts';
import { extractStructured } from './structured.ts';
import { extractWithAdapter } from './adapters/index.ts';
import { extractHeuristic } from './heuristic.ts';
import { parseQuantity } from '../core/quantity.ts';
import { inferMeasurementSystem } from '../core/units.ts';
import { normalizeItem } from '../core/normalize.ts';
import { buildGroups } from '../core/group.ts';

/**
 * The scan cascade.
 *
 * All three extractors run, and their findings are merged rather than being
 * used first-wins: structured data usually has the best title and size, while
 * only the DOM tiers know which element to pin a badge to. Merging keeps the
 * best of each.
 */

/** Currency a country's storefront quotes in, used before any price is read. */
const TLD_CURRENCY: Array<[RegExp, string]> = [
  [/\.co\.uk$|\.uk$/, 'GBP'],
  [/\.ca$/, 'CAD'],
  [/\.com\.au$|\.au$/, 'AUD'],
  [/\.co\.nz$/, 'NZD'],
  [/\.co\.jp$|\.jp$/, 'JPY'],
  [/\.in$/, 'INR'],
  [/\.com\.mx$/, 'MXN'],
  [/\.com\.br$|\.br$/, 'BRL'],
  [/\.de$|\.fr$|\.es$|\.it$|\.nl$|\.ie$|\.be$|\.at$|\.fi$|\.pt$/, 'EUR'],
  [/\.pl$/, 'PLN'], [/\.se$/, 'SEK'], [/\.no$/, 'NOK'], [/\.dk$/, 'DKK'],
  [/\.ch$/, 'CHF'], [/\.cn$/, 'CNY'], [/\.kr$/, 'KRW'], [/\.sg$/, 'SGD'],
];

/** Best guess at the page's currency before any product has been parsed. */
export function guessPageCurrency(doc: Document, hostname: string): string | undefined {
  const meta = doc.querySelector<HTMLMetaElement>(
    'meta[property="og:price:currency"], meta[property="product:price:currency"], meta[itemprop="priceCurrency"]',
  );
  const declared = meta?.content?.trim();
  if (declared && /^[A-Za-z]{3}$/.test(declared)) return declared.toUpperCase();

  const microdata = doc.querySelector('[itemprop="priceCurrency"]');
  const microValue = (microdata?.getAttribute('content') ?? microdata?.textContent ?? '').trim();
  if (/^[A-Za-z]{3}$/.test(microValue)) return microValue.toUpperCase();

  const host = hostname.toLowerCase();
  for (const [pattern, currency] of TLD_CURRENCY) {
    if (pattern.test(host)) return currency;
  }
  return undefined;
}

/** Stable-ish identifier so badges survive a rescan of an unchanged page. */
function hashId(parts: string[]): string {
  const input = parts.join('|');
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `ppd-${(hash >>> 0).toString(36)}`;
}

function normaliseTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Merge `incoming` into `existing`, keeping the better source's fields. */
function mergeRaw(existing: RawItem, incoming: RawItem): RawItem {
  const [better, worse] = existing.precedence >= incoming.precedence
    ? [existing, incoming]
    : [incoming, existing];
  return {
    ...better,
    element: better.element ?? worse.element,
    anchor: better.anchor ?? worse.anchor,
    quantity: better.quantity ?? worse.quantity,
    url: better.url ?? worse.url,
    imageUrl: better.imageUrl ?? worse.imageUrl,
    sizeText: better.sizeText ?? worse.sizeText,
    siteUnitPrice: better.siteUnitPrice ?? worse.siteUnitPrice,
    priceIsRange: better.priceIsRange ?? worse.priceIsRange,
  };
}

/**
 * Fold the three tiers into one list.
 *
 * Items are keyed by their card element where one exists. Structured-data items
 * have no element, so they are matched to a DOM item by price and title and
 * lend it their better metadata; anything left over is kept on its own.
 */
export function mergeExtractions(groups: RawItem[][]): RawItem[] {
  const byElement = new Map<HTMLElement, RawItem>();
  const detached: RawItem[] = [];

  for (const list of groups) {
    for (const item of list) {
      if (!item.element) {
        detached.push(item);
        continue;
      }
      const existing = byElement.get(item.element);
      byElement.set(item.element, existing ? mergeRaw(existing, item) : item);
    }
  }

  const unmatched: RawItem[] = [];
  for (const item of detached) {
    const title = normaliseTitle(item.title);
    let matched: HTMLElement | null = null;

    if (title) {
      for (const [element, candidate] of byElement) {
        if (Math.abs(candidate.price.amount - item.price.amount) > 0.011) continue;
        const other = normaliseTitle(candidate.title);
        if (!other) continue;
        if (other.includes(title) || title.includes(other)) {
          matched = element;
          break;
        }
      }
    }

    if (matched) {
      const existing = byElement.get(matched);
      if (existing) {
        byElement.set(matched, mergeRaw(existing, { ...item, element: matched, anchor: existing.anchor }));
      }
    } else {
      unmatched.push(item);
    }
  }

  // Structured data with nothing on the page to pin it to is still worth
  // reporting — a product-detail page often gives us the item this way alone.
  const seen = new Set<string>();
  const extras: RawItem[] = [];
  for (const item of unmatched) {
    const key = `${normaliseTitle(item.title)}|${item.price.amount}`;
    if (seen.has(key)) continue;
    seen.add(key);
    extras.push(item);
  }

  return [...byElement.values(), ...extras];
}

export interface ScanOptions {
  mode?: GroupingMode;
  similarityThreshold?: number;
  system?: MeasurementSystem;
  currencyHint?: string;
}

export interface ScanResult {
  /** Items that still know which element they came from. */
  scanned: ScannedItem[];
  summary: ScanSummary;
}

/** Run the full cascade over a document and produce ranked groups. */
export function scanDocument(doc: Document, options: ScanOptions = {}): ScanResult {
  const hostname = doc.location?.hostname ?? '';
  const currencyHint = options.currencyHint ?? guessPageCurrency(doc, hostname);
  const system = options.system ?? inferMeasurementSystem({
    currency: currencyHint,
    hostname,
    locale: doc.documentElement?.lang ?? undefined,
  });

  const context: ExtractContext = { document: doc, hostname, system, currencyHint };

  const raw = mergeExtractions([
    extractStructured(context),
    extractWithAdapter(context),
    extractHeuristic(context),
  ]);

  const usedIds = new Map<string, number>();
  const items: ProductItem[] = [];
  const scanned: ScannedItem[] = [];

  for (const entry of raw) {
    if (!entry.title || entry.price.amount <= 0) continue;
    const baseId = hashId([normaliseTitle(entry.title), String(entry.price.amount), entry.url ?? '']);
    const seen = usedIds.get(baseId) ?? 0;
    usedIds.set(baseId, seen + 1);
    const id = seen === 0 ? baseId : `${baseId}-${seen}`;

    const quantity = entry.quantity
      ?? parseQuantity(entry.sizeText ?? entry.title, { system });

    const item: ProductItem = {
      id,
      title: entry.title,
      price: entry.price,
      quantity,
      source: entry.source,
      ...(entry.adapter ? { adapter: entry.adapter } : {}),
      ...(entry.url ? { url: entry.url } : {}),
      ...(entry.imageUrl ? { imageUrl: entry.imageUrl } : {}),
      ...(entry.siteUnitPrice ? { siteUnitPrice: entry.siteUnitPrice } : {}),
      ...(entry.priceIsRange ? { priceIsRange: true } : {}),
    };
    items.push(item);
    if (entry.element) {
      scanned.push({ ...item, element: entry.element, anchor: entry.anchor ?? entry.element });
    }
  }

  const normalized = items
    .map((item) => normalizeItem(item))
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const groups = buildGroups(normalized, {
    mode: options.mode ?? 'smart',
    ...(options.similarityThreshold !== undefined
      ? { similarityThreshold: options.similarityThreshold }
      : {}),
  });

  // The page's currency is whichever one most of its prices are quoted in.
  const tally = new Map<string, number>();
  for (const item of items) tally.set(item.price.currency, (tally.get(item.price.currency) ?? 0) + 1);
  const currency = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    ?? currencyHint ?? 'USD';

  return {
    scanned,
    summary: {
      url: doc.location?.href ?? '',
      hostname,
      scannedAt: Date.now(),
      items,
      unsizedCount: items.length - normalized.length,
      groups,
      currency,
      measurementSystem: system,
      mode: options.mode ?? 'smart',
    },
  };
}
