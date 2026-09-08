import { describe, expect, it } from 'vitest';
import { parseQuantity, preprocessSizeText, singulariseCountNoun } from '../src/core/quantity.ts';

const q = (text: string, system: 'US' | 'IMPERIAL' = 'US') => parseQuantity(text, { system });

describe('preprocessSizeText', () => {
  it('expands unicode and written fractions', () => {
    expect(preprocessSizeText('1½ lb')).toBe('1.5 lb');
    expect(preprocessSizeText('1 1/2 lb')).toBe('1.5 lb');
    expect(preprocessSizeText('1/2 gal')).toBe('0.5 gal');
  });

  it('leaves ratios that are not sizes alone', () => {
    expect(preprocessSizeText('50/50 blend')).toBe('50/50 blend');
  });

  it('folds abbreviation dots without eating decimals', () => {
    expect(preprocessSizeText('16.9 fl. oz.')).toBe('16.9 fl oz');
  });

  it('resolves number grouping', () => {
    expect(preprocessSizeText('1,000 ct')).toBe('1000 ct');
    expect(preprocessSizeText('0,5 l')).toBe('0.5 l');
  });
});

describe('singulariseCountNoun', () => {
  it('collapses generic nouns to ct', () => {
    expect(singulariseCountNoun('packs')).toBe('ct');
    expect(singulariseCountNoun('Count')).toBe('ct');
    expect(singulariseCountNoun('pieces')).toBe('ct');
  });

  it('keeps specific nouns distinct', () => {
    expect(singulariseCountNoun('rolls')).toBe('roll');
    expect(singulariseCountNoun('sheets')).toBe('sheet');
    expect(singulariseCountNoun('boxes')).toBe('box');
    expect(singulariseCountNoun('batteries')).toBe('battery');
  });
});

describe('parseQuantity — measurable sizes', () => {
  it('reads a plain size', () => {
    expect(q('Organic Olive Oil 500 ml')).toMatchObject({ base: 500, dimension: 'volume', packCount: 1 });
    expect(q('Basmati Rice, 3 lb bag')).toMatchObject({ dimension: 'mass', packCount: 1 });
    expect(q('Basmati Rice, 3 lb bag')!.base).toBeCloseTo(1360.777, 3);
  });

  it('prefers fluid ounces over mass ounces when the label says fluid', () => {
    expect(q('Soda 12 fl oz')).toMatchObject({ dimension: 'volume' });
    expect(q('Almonds 12 oz')).toMatchObject({ dimension: 'mass' });
  });

  it('reads imperial fluid ounces when the page is imperial', () => {
    expect(q('Squash 16 fl oz', 'IMPERIAL')!.base).toBeCloseTo(454.609, 3);
    expect(q('Squash 16 fl oz', 'US')!.base).toBeCloseTo(473.176, 3);
  });

  it('folds compound sizes', () => {
    expect(q('Turkey Breast 2 lb 4 oz')!.base).toBeCloseTo(1020.5828, 3);
  });

  it('ignores a parenthetical restatement of the same size', () => {
    expect(q('Peanut Butter 1.5 lb (680 g)')!.base).toBeCloseTo(680.389, 3);
    expect(q('Sea Salt 500 g / 17.6 oz')!.base).toBeCloseTo(500, 3);
  });
});

describe('parseQuantity — packs', () => {
  it('reads an explicit multiplier', () => {
    const parsed = q('Sparkling Water 24 x 12 fl oz');
    expect(parsed).toMatchObject({ packCount: 24, dimension: 'volume' });
    expect(parsed!.base).toBeCloseTo(24 * 12 * 29.5735295625, 3);
  });

  it('reads a reversed multiplier', () => {
    const parsed = q('Mineral Water 500 ml x 6');
    expect(parsed).toMatchObject({ packCount: 6, dimension: 'volume' });
    expect(parsed!.base).toBeCloseTo(3000, 6);
  });

  it('multiplies a unit size by a pack count', () => {
    const parsed = q('Coca-Cola, 12 fl oz Cans, 24 Pack');
    expect(parsed).toMatchObject({ packCount: 24, dimension: 'volume' });
    expect(parsed!.base).toBeCloseTo(24 * 12 * 29.5735295625, 3);
  });

  it('reads "pack of N"', () => {
    const parsed = q('Protein Bars, Pack of 6, 60 g each');
    expect(parsed).toMatchObject({ packCount: 6, dimension: 'mass' });
    expect(parsed!.base).toBeCloseTo(360, 6);
  });

  it('counts the things themselves when no size is printed', () => {
    expect(q('Charmin Ultra Soft, 24 Family Mega Rolls')).toMatchObject({
      dimension: 'count', countNoun: 'roll', value: 24, packCount: 24,
    });
    expect(q('AA Batteries, 48-count')).toMatchObject({ dimension: 'count', countNoun: 'ct', value: 48 });
  });

  it('uses a stated per-container yield as the finest basis', () => {
    const parsed = q('Bath Tissue, 30 Rolls, 425 Sheets per Roll');
    expect(parsed).toMatchObject({ dimension: 'count', countNoun: 'sheet', packCount: 30 });
    expect(parsed!.base).toBe(12750);
    expect(parsed!.alternates?.[0]).toMatchObject({ countNoun: 'roll', base: 30 });
  });
});

describe('parseQuantity — traps', () => {
  it('does not multiply by a usage yield', () => {
    const parsed = q('Tide Liquid Detergent, 154 fl oz (96 loads)');
    expect(parsed).toMatchObject({ packCount: 1, dimension: 'volume' });
    expect(parsed!.base).toBeCloseTo(154 * 29.5735295625, 3);
  });

  it('does not read digits out of a price', () => {
    const parsed = q('Olive Oil $12.99 500 ml');
    expect(parsed!.base).toBe(500);
  });

  it('does not read a unit price as a size', () => {
    expect(q('Rice $0.42/oz')).toBeNull();
  });

  it('does not match a unit hiding inside a word', () => {
    // `g` lives inside `goldfish` and `crackers` is not a count noun, so the
    // honest answer is that this label states no size at all.
    expect(q('12 goldfish crackers')).toBeNull();
    expect(q('Pack of 3 lemon scented')).toMatchObject({ dimension: 'count', value: 3 });
  });

  it('returns null when there is nothing to read', () => {
    expect(q('Wireless Mouse')).toBeNull();
    expect(q('')).toBeNull();
  });
});
