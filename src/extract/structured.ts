import type { Money, Quantity, UnitDef } from '../core/types.ts';
import type { ExtractContext, RawItem } from './types.ts';
import { PRECEDENCE } from './types.ts';
import { parseAmountString, parseMoney } from '../core/money.ts';
import { parseQuantity } from '../core/quantity.ts';
import { resolveUnit, toBase } from '../core/units.ts';

/**
 * Structured-data extraction.
 *
 * When a retailer publishes schema.org Product markup there is nothing to
 * guess: the price, currency and often the size are stated outright. This tier
 * runs first and outranks everything else.
 */

/** UN/CEFACT codes schema.org uses in `QuantitativeValue.unitCode`. */
const UNIT_CODES: Record<string, string> = {
  MGM: 'mg', GRM: 'g', KGM: 'kg', ONZ: 'oz', LBR: 'lb',
  MLT: 'ml', CLT: 'cl', DLT: 'dl', LTR: 'l', FOZ: 'fl oz',
  GLL: 'gal', QT: 'qt', PT: 'pt',
  MMT: 'mm', CMT: 'cm', MTR: 'm', INH: 'in', FOT: 'ft', YRD: 'yd',
  MTK: 'm2', FTK: 'ft2',
  C62: 'ct', H87: 'ct', EA: 'ct', NMP: 'ct',
};

type Json = Record<string, unknown>;

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function typesOf(node: Json): string[] {
  return asArray(node['@type']).map((t) => String(t).toLowerCase());
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

/** Walk a parsed JSON-LD blob, yielding every object that looks like a Product. */
function collectProducts(node: unknown, out: Json[], depth = 0): void {
  if (depth > 12 || node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) collectProducts(child, out, depth + 1);
    return;
  }
  const record = node as Json;
  if (typesOf(record).some((t) => t === 'product' || t === 'productmodel' || t === 'individualproduct')) {
    out.push(record);
  }
  for (const value of Object.values(record)) {
    if (value && typeof value === 'object') collectProducts(value, out, depth + 1);
  }
}

interface OfferReading {
  price: string;
  currency?: string | undefined;
  isRange: boolean;
}

function readOffer(node: Json): OfferReading | null {
  for (const offer of asArray(node['offers'])) {
    if (!offer || typeof offer !== 'object') continue;
    const record = offer as Json;
    const nested = readOffer(record);
    if (nested) return nested;
    const price = firstString(record['price'], record['lowPrice']);
    if (!price) continue;
    return {
      price,
      currency: firstString(record['priceCurrency']),
      isRange: record['price'] === undefined && record['lowPrice'] !== undefined,
    };
  }
  const direct = firstString(node['price'], node['lowPrice']);
  if (direct) {
    return {
      price: direct,
      currency: firstString(node['priceCurrency']),
      isRange: node['price'] === undefined && node['lowPrice'] !== undefined,
    };
  }
  return null;
}

/**
 * Read a price out of structured markup.
 *
 * Schema.org quotes prices as bare numbers with the currency in a sibling
 * field — `"13.49"` and `"USD"` — so symbol detection alone finds nothing.
 * A symbol is honoured when present and the declared currency is used otherwise.
 */
function readPriceValue(raw: string, currency: string | undefined): Money | null {
  const withSymbol = parseMoney(raw, { currency });
  if (withSymbol && withSymbol.amount > 0) {
    return { ...withSymbol, currency: (currency ?? withSymbol.currency).toUpperCase() };
  }
  const numeric = raw.replace(/[^\d.,]/g, '').trim();
  if (!numeric) return null;
  const amount = parseAmountString(numeric, currency ?? 'USD');
  if (amount === null || amount <= 0) return null;
  return { amount, currency: (currency ?? 'USD').toUpperCase(), raw: raw.trim() };
}

/** Read a `QuantitativeValue` into a real quantity, when it carries a usable unit. */
function readQuantitativeValue(value: unknown, system: ExtractContext['system']): Quantity | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Json;
  const raw = firstString(record['value']);
  if (!raw) return null;
  const amount = Number.parseFloat(raw.replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const code = firstString(record['unitCode']);
  const text = firstString(record['unitText']);
  let unit: UnitDef | null = null;
  if (code) unit = resolveUnit(UNIT_CODES[code.toUpperCase()] ?? code, system);
  if (!unit && text) unit = resolveUnit(text, system);
  if (!unit) return null;

  const base = toBase(amount, unit);
  return {
    value: amount,
    unit,
    dimension: unit.dimension,
    base,
    packCount: 1,
    basePerItem: base,
    raw: `${amount} ${unit.label}`,
    confidence: 0.95,
    ...(unit.dimension === 'count' ? { countNoun: 'ct' } : {}),
  };
}

/** The size a Product node states, from whichever property carries it. */
function readSize(node: Json, system: ExtractContext['system']): { quantity: Quantity | null; sizeText?: string } {
  for (const key of ['weight', 'size', 'volume', 'height', 'depth']) {
    const quantity = readQuantitativeValue(node[key], system);
    if (quantity) return { quantity };
  }
  const sizeText = firstString(node['size'], node['name'], node['description']);
  return { quantity: null, ...(sizeText ? { sizeText } : {}) };
}

function parseJsonLd(context: ExtractContext): RawItem[] {
  const out: RawItem[] = [];
  const scripts = context.document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]');
  for (const script of Array.from(scripts)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(script.textContent ?? '');
    } catch {
      continue; // Malformed blobs are common and never worth failing the scan over.
    }
    const products: Json[] = [];
    collectProducts(parsed, products);

    for (const product of products) {
      const title = firstString(product['name']);
      const offer = readOffer(product);
      if (!title || !offer) continue;
      const currency = offer.currency ?? context.currencyHint;
      const price = readPriceValue(offer.price, currency);
      if (!price) continue;

      const { quantity, sizeText } = readSize(product, context.system);
      out.push({
        title,
        price,
        quantity: quantity ?? parseQuantity(sizeText ?? title, { system: context.system }),
        ...(sizeText ? { sizeText } : {}),
        url: firstString(product['url'], (product['offers'] as Json | undefined)?.['url']),
        imageUrl: firstString(asArray(product['image'])[0]),
        source: 'structured',
        element: null,
        anchor: null,
        priceIsRange: offer.isRange,
        precedence: PRECEDENCE.structured,
      });
    }
  }
  return out;
}

function textOf(element: Element | null): string {
  if (!element) return '';
  const content = element.getAttribute('content');
  if (content) return content.trim();
  return (element.textContent ?? '').trim();
}

function parseMicrodata(context: ExtractContext): RawItem[] {
  const out: RawItem[] = [];
  const scopes = context.document.querySelectorAll<HTMLElement>('[itemtype*="schema.org/Product" i]');
  for (const scope of Array.from(scopes)) {
    const title = textOf(scope.querySelector('[itemprop="name"]'));
    const priceEl = scope.querySelector<HTMLElement>('[itemprop="price"], [itemprop="lowPrice"]');
    if (!title || !priceEl) continue;
    const currency = textOf(scope.querySelector('[itemprop="priceCurrency"]')) || context.currencyHint;
    const price = readPriceValue(textOf(priceEl), currency);
    if (!price) continue;

    out.push({
      title,
      price,
      quantity: parseQuantity(title, { system: context.system }),
      source: 'structured',
      element: scope,
      anchor: priceEl,
      precedence: PRECEDENCE.structured,
    });
  }
  return out;
}

function parseMetaTags(context: ExtractContext): RawItem[] {
  const doc = context.document;
  const meta = (name: string): string =>
    textOf(doc.querySelector(`meta[property="${name}"], meta[name="${name}"]`));

  const amount = meta('og:price:amount') || meta('product:price:amount');
  if (!amount) return [];
  const currency = meta('og:price:currency') || meta('product:price:currency') || context.currencyHint;
  const price = readPriceValue(amount, currency);
  if (!price) return [];

  const title = meta('og:title') || doc.title || '';
  if (!title) return [];

  return [{
    title: title.trim(),
    price,
    quantity: parseQuantity(title, { system: context.system }),
    ...(meta('og:image') ? { imageUrl: meta('og:image') } : {}),
    source: 'structured',
    element: null,
    anchor: null,
    precedence: PRECEDENCE.structured - 5,
  }];
}

/** Read every product the page describes in machine-readable markup. */
export function extractStructured(context: ExtractContext): RawItem[] {
  return [...parseJsonLd(context), ...parseMicrodata(context), ...parseMetaTags(context)];
}
