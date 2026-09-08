import type { Money } from './types.ts';
import { ZERO_DECIMAL_CURRENCIES, escapeRegExp } from './units.ts';

/**
 * Price parsing.
 *
 * Retail pages write money in every shape imaginable: `$12.34`, `12,34 €`,
 * `US$ 1,234.56`, `1.234,56 EUR`, `42¢`. The two hard parts are working out
 * which currency a bare symbol means, and which of `.` and `,` is the decimal
 * point. Both are decided here so nothing downstream has to guess.
 */

/** Symbols that appear before the number, longest spelling first. */
const PREFIX_SYMBOLS: Array<[string, string]> = [
  ['US$', 'USD'], ['CA$', 'CAD'], ['AU$', 'AUD'], ['NZ$', 'NZD'], ['HK$', 'HKD'],
  ['NT$', 'TWD'], ['Mex$', 'MXN'], ['MX$', 'MXN'], ['R$', 'BRL'], ['C$', 'CAD'],
  ['A$', 'AUD'], ['S$', 'SGD'], ['RM', 'MYR'], ['Rs.', 'INR'], ['Rs', 'INR'],
  ['CHF', 'CHF'], ['zł', 'PLN'], ['Kč', 'CZK'], ['₨', 'PKR'],
  ['$', 'USD'], ['€', 'EUR'], ['£', 'GBP'], ['¥', 'JPY'], ['₹', 'INR'],
  ['₩', 'KRW'], ['₽', 'RUB'], ['₺', 'TRY'], ['₪', 'ILS'], ['₱', 'PHP'],
  ['฿', 'THB'], ['₫', 'VND'], ['₴', 'UAH'], ['₦', 'NGN'], ['﷼', 'SAR'],
];

/** Symbols that appear after the number. */
const SUFFIX_SYMBOLS: Array<[string, string]> = [
  ['zł', 'PLN'], ['Kč', 'CZK'], ['CHF', 'CHF'], ['kr', 'XXX'],
  ['€', 'EUR'], ['£', 'GBP'], ['¥', 'JPY'], ['₽', 'RUB'], ['₺', 'TRY'],
  ['₩', 'KRW'], ['₫', 'VND'], ['$', 'USD'],
];

const ISO_CODES = [
  'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'JPY', 'CNY', 'INR', 'KRW', 'SGD',
  'HKD', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'BGN', 'TRY',
  'ILS', 'AED', 'SAR', 'ZAR', 'BRL', 'MXN', 'ARS', 'CLP', 'COP', 'PEN', 'PHP',
  'THB', 'VND', 'IDR', 'MYR', 'TWD', 'RUB', 'UAH', 'NGN', 'PKR',
];

/** Currencies conventionally written `1.234,56`. */
const COMMA_DECIMAL_CURRENCIES = new Set([
  'EUR', 'BRL', 'ARS', 'COP', 'CLP', 'IDR', 'VND', 'RUB', 'TRY', 'PLN', 'CZK',
  'SEK', 'NOK', 'DKK', 'UAH', 'HUF', 'RON', 'BGN', 'ISK',
]);

/** Space characters retailers use as thousands separators. */
const SPACE_SEPARATORS = /[\s   ']/g;

const PREFIX_ALT = PREFIX_SYMBOLS.map(([s]) => escapeRegExp(s)).join('|');
const SUFFIX_ALT = SUFFIX_SYMBOLS.map(([s]) => escapeRegExp(s)).join('|');
const ISO_ALT = ISO_CODES.join('|');

/**
 * A number with optional grouping, e.g. `1 234,56` or `1,234.56` or `99`.
 *
 * The grouped alternative is tried first and requires whole groups of three, so
 * an ungrouped `1234.56` falls through to `\d+` intact instead of being clipped
 * to its first three digits. Which separator is the decimal point is decided
 * later, by `parseAmountString`.
 */
const NUMBER_PATTERN = String.raw`(?:\d{1,3}(?:[\s  ',.]\d{3})+|\d+)(?:[.,]\d{1,3})?`;

const MONEY_PATTERN = new RegExp(
  // prefixed: $12.34, US$ 1,234.56
  String.raw`(?<pre>${PREFIX_ALT})\s*(?<preNum>${NUMBER_PATTERN})(?:\s*(?<preCode>${ISO_ALT})\b)?` +
  // suffixed: 12,34 €  /  1 234,56 EUR  /  42¢
  String.raw`|(?<sufNum>${NUMBER_PATTERN})\s*(?<suf>${SUFFIX_ALT}|${ISO_ALT}\b|¢|c\b)`,
  'gu',
);

export interface MoneyMatch extends Money {
  /** Index into the source string where the match started. */
  index: number;
  /** Length of the matched substring. */
  length: number;
}

export interface MoneyParseHints {
  /** Currency to assume when a symbol is ambiguous (`$`, `kr`, `¥`). */
  currency?: string | undefined;
}

/**
 * Decide which of `.` and `,` is the decimal separator, then read the number.
 *
 * The rules, in order of confidence:
 *  1. Both separators present — the rightmost one is the decimal point.
 *  2. One separator, appearing more than once — it is a thousands separator.
 *  3. One separator followed by exactly three digits — ambiguous. `1,000` is
 *     a thousand; `1.000` is a thousand only where the currency writes decimals
 *     with a comma, and one unit otherwise.
 *  4. Anything else — it is the decimal point.
 */
export function parseAmountString(input: string, currency = 'USD'): number | null {
  const cleaned = input.replace(SPACE_SEPARATORS, '');
  if (!/^\d[\d.,]*$/.test(cleaned)) return null;

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  const commaCount = (cleaned.match(/,/g) ?? []).length;
  const dotCount = (cleaned.match(/\./g) ?? []).length;

  let decimalSep: string | null = null;
  if (lastComma >= 0 && lastDot >= 0) {
    decimalSep = lastComma > lastDot ? ',' : '.';
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? ',' : '.';
    const count = lastComma >= 0 ? commaCount : dotCount;
    const tail = cleaned.slice((lastComma >= 0 ? lastComma : lastDot) + 1);
    if (count > 1) {
      decimalSep = null; // repeated separator can only be grouping
    } else if (tail.length === 3) {
      const commaDecimalLocale = COMMA_DECIMAL_CURRENCIES.has(currency.toUpperCase());
      // `1,000` is grouping everywhere; `1.000` is grouping only in comma-decimal locales.
      decimalSep = sep === ',' ? null : commaDecimalLocale ? null : '.';
    } else if (tail.length === 0 || tail.length > 3) {
      decimalSep = null;
    } else {
      decimalSep = sep;
    }
  }

  let normalised: string;
  if (decimalSep === null) {
    normalised = cleaned.replace(/[.,]/g, '');
  } else {
    const other = decimalSep === ',' ? '.' : ',';
    normalised = cleaned.split(other).join('').replace(decimalSep, '.');
  }

  const value = Number.parseFloat(normalised);
  if (!Number.isFinite(value)) return null;
  return value;
}

function currencyForPrefix(symbol: string, hints: MoneyParseHints): string {
  const found = PREFIX_SYMBOLS.find(([s]) => s === symbol);
  const base = found ? found[1] : 'XXX';
  // A bare `$` or `¥` means whatever the page says it means.
  if ((symbol === '$' || symbol === '¥') && hints.currency) return hints.currency.toUpperCase();
  return base;
}

function currencyForSuffix(symbol: string, hints: MoneyParseHints): string {
  if (ISO_CODES.includes(symbol)) return symbol;
  if (symbol === '¢' || symbol === 'c') return hints.currency?.toUpperCase() ?? 'USD';
  const found = SUFFIX_SYMBOLS.find(([s]) => s === symbol);
  const base = found ? found[1] : 'XXX';
  if ((base === 'XXX' || symbol === '$' || symbol === '¥') && hints.currency) {
    return hints.currency.toUpperCase();
  }
  return base;
}

/** Every price-looking substring in `text`, in document order. */
export function findMoney(text: string, hints: MoneyParseHints = {}): MoneyMatch[] {
  if (!text) return [];
  const out: MoneyMatch[] = [];
  MONEY_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MONEY_PATTERN.exec(text)) !== null) {
    const g = match.groups ?? {};
    let currency: string;
    let numeric: string | undefined;
    let isCents = false;

    if (g['preNum'] !== undefined) {
      numeric = g['preNum'];
      currency = g['preCode'] ? g['preCode'] : currencyForPrefix(g['pre'] ?? '', hints);
    } else {
      numeric = g['sufNum'];
      const suffix = g['suf'] ?? '';
      isCents = suffix === '¢' || suffix === 'c';
      currency = currencyForSuffix(suffix, hints);
    }
    if (numeric === undefined) continue;

    let amount = parseAmountString(numeric, currency);
    if (amount === null) continue;
    if (isCents) amount /= 100;
    if (!Number.isFinite(amount) || amount < 0) continue;

    out.push({
      amount,
      currency,
      raw: match[0].trim(),
      index: match.index,
      length: match[0].length,
    });
  }
  return out;
}

/** The first price in `text`, or null. */
export function parseMoney(text: string, hints: MoneyParseHints = {}): Money | null {
  const [first] = findMoney(text, hints);
  if (!first) return null;
  return { amount: first.amount, currency: first.currency, raw: first.raw };
}

/** Decimal places a currency is normally quoted to. */
export function currencyDecimals(currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 0 : 2;
}
