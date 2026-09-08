import { describe, expect, it } from 'vitest';
import { formatMeasure, measureToInputValue, round, toFixed } from '../src/core/format.ts';

describe('round', () => {
  it('rounds half away from zero despite binary floats', () => {
    expect(round(1.005, 2)).toBe(1.01);
    expect(round(2.675, 2)).toBe(2.68);
    expect(round(-1.005, 2)).toBe(-1.01);
  });

  it('survives non-finite input', () => {
    expect(round(Number.NaN)).toBe(0);
    expect(round(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('toFixed', () => {
  it('always emits exactly two decimals', () => {
    expect(toFixed(12.5)).toBe('12.50');
    expect(toFixed(0)).toBe('0.00');
  });
});

describe('formatMeasure', () => {
  it('scales precision with magnitude', () => {
    // Two decimals on 5758.69 mL is noise; on 38.52 mL it is the answer.
    expect(formatMeasure(38.523)).toBe('38.52');
    expect(formatMeasure(480.29)).toBe('480.3');
    expect(formatMeasure(5758.69)).toBe('5,759');
  });

  it('groups large numbers', () => {
    expect(formatMeasure(12750)).toBe('12,750');
  });

  it('drops trailing zeros', () => {
    expect(formatMeasure(500)).toBe('500');
    expect(formatMeasure(1.5)).toBe('1.5');
  });

  it('honours an explicit precision', () => {
    expect(formatMeasure(1.23456, 3)).toBe('1.235');
  });
});

describe('measureToInputValue', () => {
  it('emits a bare number a numeric input will accept', () => {
    // Digit grouping would make `<input type="number">` reject the value.
    expect(measureToInputValue(1500)).toBe('1500');
    expect(measureToInputValue(29.5735295625)).toBe('29.5735');
  });
});
