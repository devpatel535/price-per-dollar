import { currencyDecimals } from './money.ts';

/**
 * Presentation helpers.
 *
 * Every figure the user sees is rounded here and only here. Internally the
 * pipeline keeps full precision, so a table can never contradict itself by
 * rounding the same value two different ways.
 */

/** Round half-away-from-zero to `places`, avoiding binary-float surprises. */
export function round(value: number, places = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** places;
  const scaled = value * factor;
  // `1.005 * 100` is 100.49999999999999, so nudge by one ulp before rounding.
  const corrected = Math.round(scaled + (scaled >= 0 ? 1 : -1) * Number.EPSILON * Math.abs(scaled));
  return corrected / factor;
}

export function round2(value: number): number {
  return round(value, 2);
}

/** `12.5` -> `"12.50"`. Always exactly `places` decimals. */
export function toFixed(value: number, places = 2): string {
  return round(value, places).toFixed(places);
}

let currencyFormatterCache = new Map<string, Intl.NumberFormat>();

export function formatCurrency(amount: number, currency = 'USD', locale?: string): string {
  const decimals = currencyDecimals(currency);
  const key = `${locale ?? 'default'}|${currency}|${decimals}`;
  let formatter = currencyFormatterCache.get(key);
  if (!formatter) {
    try {
      formatter = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
    } catch {
      // Unknown or malformed currency code — fall back to a plain code prefix.
      return `${currency} ${toFixed(amount, decimals)}`;
    }
    currencyFormatterCache.set(key, formatter);
  }
  return formatter.format(round(amount, decimals));
}

/** Reset memoised formatters. Only needed by tests. */
export function resetFormatterCache(): void {
  currencyFormatterCache = new Map();
}

/** Trim trailing zeros from a measurement: `500.00` -> `500`, `1.50` -> `1.5`. */
export function formatMeasure(value: number, maxPlaces = 2): string {
  const rounded = round(value, maxPlaces);
  if (Number.isInteger(rounded)) return String(rounded);
  return String(Number(rounded.toFixed(maxPlaces)));
}

/** `1.6` -> `"1.60x"`. */
export function formatMultiplier(value: number): string {
  return `${toFixed(value, 2)}x`;
}

/** `37.5` -> `"37.50%"`. */
export function formatPercent(value: number): string {
  return `${toFixed(value, 2)}%`;
}

/** Naive English pluralisation, adequate for count nouns. */
export function pluralise(noun: string, count: number): string {
  if (Math.abs(count) === 1) return noun;
  if (/(s|x|z|ch|sh)$/.test(noun)) return `${noun}es`;
  if (/[^aeiou]y$/.test(noun)) return `${noun.slice(0, -1)}ies`;
  return `${noun}s`;
}
