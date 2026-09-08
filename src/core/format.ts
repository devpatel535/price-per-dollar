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

/**
 * Format a measurement for reading.
 *
 * Precision scales with magnitude, because two decimals on 5758.69 mL is noise
 * while two decimals on 38.52 mL is the answer. Large numbers get digit
 * grouping so `12750 sheets` reads as `12,750`.
 */
export function formatMeasure(value: number, maxPlaces?: number): string {
  const magnitude = Math.abs(value);
  const places = maxPlaces ?? (magnitude >= 1000 ? 0 : magnitude >= 100 ? 1 : 2);
  const rounded = round(value, places);
  try {
    return new Intl.NumberFormat(undefined, {
      maximumFractionDigits: places,
      minimumFractionDigits: 0,
    }).format(rounded);
  } catch {
    return String(Number(rounded.toFixed(places)));
  }
}

/** A measurement as a bare number, safe to put in a numeric input. */
export function measureToInputValue(value: number, places = 4): string {
  return String(round(value, places));
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
