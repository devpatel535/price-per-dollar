import { describe, expect, it } from 'vitest';
import { findMoney, parseAmountString, parseMoney } from '../src/core/money.ts';

describe('parseAmountString', () => {
  it('reads plain decimals', () => {
    expect(parseAmountString('12.34')).toBe(12.34);
    expect(parseAmountString('99')).toBe(99);
    expect(parseAmountString('0.49')).toBe(0.49);
  });

  it('reads grouped US numbers', () => {
    expect(parseAmountString('1,234.56')).toBe(1234.56);
    expect(parseAmountString('1,234,567.89')).toBe(1234567.89);
    expect(parseAmountString('1,000')).toBe(1000);
  });

  it('reads comma-decimal numbers', () => {
    expect(parseAmountString('12,34', 'EUR')).toBe(12.34);
    expect(parseAmountString('1.234,56', 'EUR')).toBe(1234.56);
    expect(parseAmountString('1.000', 'EUR')).toBe(1000);
  });

  it('reads space-grouped numbers', () => {
    expect(parseAmountString('1 234,56', 'EUR')).toBe(1234.56);
    expect(parseAmountString('1 234,56', 'EUR')).toBe(1234.56);
  });

  it('treats a lone dot with three digits as a decimal outside comma-decimal locales', () => {
    expect(parseAmountString('1.000', 'USD')).toBe(1);
  });

  it('rejects non-numeric input', () => {
    expect(parseAmountString('abc')).toBeNull();
    expect(parseAmountString('')).toBeNull();
  });
});

describe('findMoney', () => {
  it('does not clip ungrouped four-digit prices', () => {
    expect(parseMoney('$1234.56')).toMatchObject({ amount: 1234.56, currency: 'USD' });
  });

  it('reads prefixed symbols', () => {
    expect(parseMoney('$12.34')).toMatchObject({ amount: 12.34, currency: 'USD' });
    expect(parseMoney('£9.99')).toMatchObject({ amount: 9.99, currency: 'GBP' });
    expect(parseMoney('C$14.50')).toMatchObject({ amount: 14.5, currency: 'CAD' });
    expect(parseMoney('US$ 1,234.56')).toMatchObject({ amount: 1234.56, currency: 'USD' });
    expect(parseMoney('₹1,299')).toMatchObject({ amount: 1299, currency: 'INR' });
  });

  it('reads suffixed symbols and codes', () => {
    expect(parseMoney('12,34 €')).toMatchObject({ amount: 12.34, currency: 'EUR' });
    expect(parseMoney('1.234,56 EUR')).toMatchObject({ amount: 1234.56, currency: 'EUR' });
    expect(parseMoney('42¢')).toMatchObject({ amount: 0.42, currency: 'USD' });
  });

  it('honours a currency hint for ambiguous symbols', () => {
    expect(parseMoney('$12.34', { currency: 'CAD' })).toMatchObject({ currency: 'CAD' });
    expect(parseMoney('¥1200', { currency: 'CNY' })).toMatchObject({ amount: 1200, currency: 'CNY' });
  });

  it('finds every price in a card blob, in order', () => {
    const found = findMoney('Was $14.99 Now $9.99 ($0.42/oz)');
    expect(found.map((m) => m.amount)).toEqual([14.99, 9.99, 0.42]);
  });

  it('handles a price range', () => {
    const found = findMoney('$9.99 - $19.99');
    expect(found.map((m) => m.amount)).toEqual([9.99, 19.99]);
  });

  it('returns nothing for text without prices', () => {
    expect(findMoney('Pack of 24 rolls')).toHaveLength(0);
  });
});
