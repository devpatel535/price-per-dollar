import { describe, expect, it } from 'vitest';
import { buildGroups, titleSimilarity, tokenizeTitle } from '../src/core/group.ts';
import { normalizeItem } from '../src/core/normalize.ts';
import { parseQuantity } from '../src/core/quantity.ts';
import type { NormalizedItem, ProductItem } from '../src/core/types.ts';

let counter = 0;

function make(title: string, amount: number): NormalizedItem {
  counter += 1;
  const item: ProductItem = {
    id: `item-${counter}`,
    title,
    price: { amount, currency: 'USD', raw: `$${amount}` },
    quantity: parseQuantity(title, { system: 'US' }),
    source: 'heuristic',
  };
  const normalized = normalizeItem(item);
  if (!normalized) throw new Error(`no size parsed from: ${title}`);
  return normalized;
}

describe('tokenizeTitle', () => {
  it('keeps identifying words and drops packaging noise', () => {
    expect(tokenizeTitle('Kirkland Signature Extra Virgin Olive Oil, 2 x 1 L')).toEqual(
      ['kirkland', 'signature', 'virgin', 'olive', 'oil'],
    );
  });

  it('folds plurals so almond and almonds match', () => {
    expect(tokenizeTitle('Roasted Almonds')).toEqual(tokenizeTitle('Roasted Almond'));
  });
});

describe('titleSimilarity', () => {
  it('scores the same product highly across phrasings', () => {
    expect(titleSimilarity(
      'Kirkland Extra Virgin Olive Oil 2 L',
      'Extra Virgin Olive Oil, Kirkland, 1 L',
    )).toBeGreaterThan(0.6);
  });

  it('scores unrelated products low', () => {
    expect(titleSimilarity('Extra Virgin Olive Oil 1 L', 'Bounty Paper Towels 12 Rolls'))
      .toBeLessThan(0.3);
  });
});

describe('buildGroups — smart mode', () => {
  it('never ranks unrelated products against each other', () => {
    const groups = buildGroups([
      make('Extra Virgin Olive Oil 1 L', 12.99),
      make('Extra Virgin Olive Oil 3 L', 29.99),
      make('Whole Milk 1 gal', 4.29),
    ]);
    const oil = groups.find((g) => g.label.toLowerCase().includes('olive'));
    expect(oil?.members).toHaveLength(2);
    expect(groups.every((g) => !(g.members.some((m) => m.item.title.includes('Olive'))
      && g.members.some((m) => m.item.title.includes('Milk'))))).toBe(true);
  });

  it('picks the cheapest per base unit as the winner, not the cheapest sticker', () => {
    const groups = buildGroups([
      make('Extra Virgin Olive Oil 250 ml', 4.99),
      make('Extra Virgin Olive Oil 1 L', 12.99),
      make('Extra Virgin Olive Oil 3 L', 29.99),
    ]);
    expect(groups).toHaveLength(1);
    const group = groups[0]!;
    expect(group.best.item.title).toContain('3 L');
    expect(group.worst?.item.title).toContain('250 ml');
    // Cheapest sticker price is the 250 ml bottle, which is the worst value.
    expect(group.members[0]!.pricePerBase).toBeLessThan(group.members[1]!.pricePerBase);
  });

  it('quotes olive oil per 100 mL rather than per millilitre', () => {
    const groups = buildGroups([
      make('Extra Virgin Olive Oil 1 L', 12.99),
      make('Extra Virgin Olive Oil 3 L', 29.99),
    ]);
    expect(groups[0]!.display.label).toBe('100 mL');
  });

  it('ranks toilet paper in sheets when a pack states its yield', () => {
    const groups = buildGroups([
      make('Bath Tissue, 30 Rolls, 425 Sheets per Roll', 27.99),
      make('Bath Tissue, 12 Rolls, 300 Sheets per Roll', 13.49),
    ]);
    expect(groups).toHaveLength(1);
    const group = groups[0]!;
    expect(group.display.label).toBe('sheet');
    expect(group.best.item.title).toContain('30 Rolls');
    expect(group.best.base).toBe(12750);
  });

  it('separates count nouns that are not the same thing', () => {
    const groups = buildGroups([
      make('Paper Towels 12 Rolls', 18.99),
      make('Paper Towels 6 Rolls', 10.99),
      make('Paper Towel Sheets 1000 Sheets', 14.99),
    ]);
    const rollGroup = groups.find((g) => g.display.label === 'roll');
    const sheetGroup = groups.find((g) => g.display.label === 'sheet');
    expect(rollGroup?.members).toHaveLength(2);
    expect(sheetGroup?.members).toHaveLength(1);
  });

  it('does not compare mass against volume', () => {
    const groups = buildGroups([
      make('Greek Yogurt 900 g', 5.99),
      make('Greek Yogurt Drink 750 ml', 4.49),
    ]);
    expect(groups).toHaveLength(2);
  });
});

describe('buildGroups — page mode', () => {
  it('ranks everything sharing a basis in one leaderboard', () => {
    const groups = buildGroups([
      make('Extra Virgin Olive Oil 1 L', 12.99),
      make('Whole Milk 1 gal', 4.29),
      make('Sunflower Oil 2 L', 7.99),
    ], { mode: 'page' });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.members).toHaveLength(3);
    expect(groups[0]!.best.item.title).toContain('Milk');
  });
});
