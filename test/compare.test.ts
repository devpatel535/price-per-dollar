import { describe, expect, it } from 'vitest';
import { analyseValue, renderAnalysisMarkdown } from '../src/core/compare.ts';

const FL_OZ = 29.5735295625;

/** The canonical warehouse-club case: a 24-pack against a single can. */
const bulkCase = {
  label: '24-can case',
  totalPrice: 18.99,
  unitsInPack: 24,
  baseTotal: 24 * 12 * FL_OZ,
  dimension: 'volume' as const,
};
const singleCan = {
  label: 'Single can',
  totalPrice: 1.79,
  unitsInPack: 1,
  baseTotal: 12 * FL_OZ,
  dimension: 'volume' as const,
};

describe('analyseValue', () => {
  it('rejects impossible inputs instead of dividing by zero', () => {
    expect(analyseValue({ ...bulkCase, unitsInPack: 0 }, singleCan)).toMatchObject({ ok: false });
    expect(analyseValue({ ...bulkCase, totalPrice: 0 }, singleCan)).toMatchObject({ ok: false });
    const failure = analyseValue({ ...bulkCase, unitsInPack: -3 }, singleCan);
    expect(failure.ok).toBe(false);
    if (!failure.ok) expect(failure.errors[0]).toContain('greater than zero');
  });

  it('identifies which option is the bulk one regardless of argument order', () => {
    const forward = analyseValue(bulkCase, singleCan);
    const reversed = analyseValue(singleCan, bulkCase);
    expect(forward.ok && forward.analysis.bulk.label).toBe('24-can case');
    expect(reversed.ok && reversed.analysis.bulk.label).toBe('24-can case');
  });

  it('computes the unit pricing table', () => {
    const result = analyseValue(bulkCase, singleCan);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { bulk, single, display } = result.analysis;

    expect(bulk.unitCost).toBeCloseTo(0.79125, 5);
    expect(single.unitCost).toBeCloseTo(1.79, 5);
    expect(display).toMatchObject({ factor: 100, label: '100 mL' });
    expect(bulk.costPerDisplay).toBeCloseTo(0.2229612, 6);
    expect(single.costPerDisplay).toBeCloseTo(0.5043930, 6);
  });

  it('computes the dollar-for-dollar section', () => {
    const result = analyseValue(bulkCase, singleCan);
    if (!result.ok) throw new Error('expected success');
    const { dollarForDollar: dfd } = result.analysis;

    expect(dfd.singlesForBulkSpend).toBeCloseTo(10.6089, 4);
    expect(dfd.singlesForBulkSpendWhole).toBe(10);
    expect(dfd.unitsPerCurrencyBulk).toBeCloseTo(1.26382, 5);
    expect(dfd.unitsPerCurrencySingle).toBeCloseTo(0.558659, 5);
    expect(dfd.basePerCurrencyBulk).toBeCloseTo(448.5085, 3);
  });

  it('computes the purchasing power yield', () => {
    const result = analyseValue(bulkCase, singleCan);
    if (!result.ok) throw new Error('expected success');
    const { purchasingPower: pp } = result.analysis;

    expect(pp.multiplier).toBeCloseTo(2.26224, 5);
    expect(pp.percentGain).toBeCloseTo(126.224, 3);
    expect(pp.percentSavedPerUnit).toBeCloseTo(55.796089, 5);
    expect(pp.savingsPerUnit).toBeCloseTo(0.99875, 5);
    expect(pp.totalSavingsAcrossPack).toBeCloseTo(24 * 1.79 - 18.99, 5);
    expect(pp.extraUnitsForSameSpend).toBeCloseTo(13.3911, 4);
    expect(pp.bulkIsBetter).toBe(true);
  });

  it('separates value gained from discount off the single rate', () => {
    // Half the unit cost is a 50% discount but a 2x purchasing-power multiplier;
    // conflating the two is the most common error in this kind of comparison.
    const result = analyseValue(
      { label: 'Case', totalPrice: 10, unitsInPack: 10 },
      { label: 'Single', totalPrice: 2, unitsInPack: 1 },
    );
    if (!result.ok) throw new Error('expected success');
    expect(result.analysis.purchasingPower.multiplier).toBeCloseTo(2, 6);
    expect(result.analysis.purchasingPower.percentGain).toBeCloseTo(100, 6);
    expect(result.analysis.purchasingPower.percentSavedPerUnit).toBeCloseTo(50, 6);
  });

  it('warns when the two options do not contain the same individual unit', () => {
    const result = analyseValue(bulkCase, {
      label: 'Single 20 oz bottle',
      totalPrice: 2.49,
      unitsInPack: 1,
      baseTotal: 20 * FL_OZ,
      dimension: 'volume' as const,
    });
    if (!result.ok) throw new Error('expected success');
    expect(result.analysis.warnings.join(' ')).toContain('not contain the same individual unit');
    expect(result.analysis.basis).toBe('measure');
  });

  it('flags a bulk option that is not actually cheaper', () => {
    const result = analyseValue(
      { label: 'Case', totalPrice: 30, unitsInPack: 10 },
      { label: 'Single', totalPrice: 2.5, unitsInPack: 1 },
    );
    if (!result.ok) throw new Error('expected success');
    expect(result.analysis.purchasingPower.bulkIsBetter).toBe(false);
    expect(result.analysis.warnings.join(' ')).toContain('not cheaper per unit');
  });

  it('falls back to per-item cost when only one side states a size', () => {
    const result = analyseValue(bulkCase, { label: 'Single', totalPrice: 1.79, unitsInPack: 1 });
    if (!result.ok) throw new Error('expected success');
    expect(result.analysis.basis).toBe('unit');
    expect(result.analysis.warnings.join(' ')).toContain('falls back to cost per item');
  });
});

describe('renderAnalysisMarkdown', () => {
  it('emits the three requested sections with two-decimal figures', () => {
    const result = analyseValue(bulkCase, singleCan);
    if (!result.ok) throw new Error('expected success');
    const md = renderAnalysisMarkdown(result.analysis);

    expect(md).toContain('## Unit Pricing Comparison Table');
    expect(md).toContain('## Dollar-for-Dollar Value Analysis');
    expect(md).toContain('## Purchasing Power Yield');
    expect(md).toContain('$0.79');
    expect(md).toContain('$0.22');
    expect(md).toContain('2.26x');
    expect(md).toContain('126.22%');
    expect(md).toContain('Manufacturer coupons');
  });

  it('never prints a degenerate $0.00 unit price', () => {
    // A per-gram price of $0.0009 would round to $0.00, so the display base
    // must climb the ladder to keep two decimals meaningful.
    // 4c per kilo: per-gram and per-100g would both round away to $0.00, so
    // the ladder has to climb all the way to a kilogram.
    const result = analyseValue(
      { label: 'Pallet', totalPrice: 40, unitsInPack: 1, baseTotal: 1_000_000, dimension: 'mass' },
      { label: 'Sack', totalPrice: 9, unitsInPack: 1, baseTotal: 100_000, dimension: 'mass' },
    );
    if (!result.ok) throw new Error('expected success');
    expect(result.analysis.display?.label).toBe('kg');
    expect(renderAnalysisMarkdown(result.analysis)).not.toMatch(/\$0\.00/);

    // A mid-range price settles on the 100 g rung instead.
    const midRange = analyseValue(
      { label: 'Sack', totalPrice: 18, unitsInPack: 1, baseTotal: 20_000, dimension: 'mass' },
      { label: 'Bag', totalPrice: 3.5, unitsInPack: 1, baseTotal: 1000, dimension: 'mass' },
    );
    if (!midRange.ok) throw new Error('expected success');
    expect(midRange.analysis.display?.label).toBe('100 g');
    expect(renderAnalysisMarkdown(midRange.analysis)).not.toMatch(/\$0\.00/);
  });
});
