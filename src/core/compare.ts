import type { Dimension, DisplayBase, NormalizedItem } from './types.ts';
import { chooseDisplayBase } from './normalize.ts';
import {
  formatCurrency, formatMeasure, formatMultiplier, formatPercent, pluralise, round, toFixed,
} from './format.ts';

/**
 * Dollar-for-dollar value analysis.
 *
 * Given two ways to buy the same thing, this works out the true unit cost of
 * each, what a single unit of currency actually buys under each, and how much
 * purchasing power the bulk option yields. Everything is computed at full
 * precision; rounding happens only in the renderers at the bottom of the file.
 */

export interface ComparisonOption {
  /** Display name, e.g. `24-can case`. */
  label: string;
  /** Bulk Total Price / Single Item Price. */
  totalPrice: number;
  /** Number of Units in Case. `1` for a single-item purchase. */
  unitsInPack: number;
  /** Total measurable size of the whole package, in base units. */
  baseTotal?: number | null;
  dimension?: Dimension | null;
  countNoun?: string | null;
}

export interface OptionSummary {
  label: string;
  totalPrice: number;
  unitsInPack: number;
  /** Cost of one individual item. */
  unitCost: number;
  baseTotal: number | null;
  /** Size of one individual item, in base units. */
  basePerUnit: number | null;
  /** Cost of one base unit (per g / mL / m). */
  costPerBase: number | null;
  /** Cost per display quantum, e.g. per 100 g. */
  costPerDisplay: number | null;
  /** Individual items obtained per one unit of currency. */
  unitsPerCurrency: number;
  /** Base units obtained per one unit of currency. */
  basePerCurrency: number | null;
  isBulk: boolean;
}

/** Which figure the value verdict is founded on. */
export type ComparisonBasis = 'measure' | 'unit';

export interface ValueAnalysis {
  currency: string;
  display: DisplayBase | null;
  basis: ComparisonBasis;
  /**
   * Whether the two options contain the same individual unit.
   *
   * A 1.5 L bottle against a 330 ml can compares honestly per litre and
   * nonsensically per item — the "saving per item" of such a pair is negative
   * even when the pack is much better value. When this is false the report
   * talks in measure instead, rather than printing both and contradicting itself.
   */
  unitsComparable: boolean;
  bulk: OptionSummary;
  single: OptionSummary;
  dollarForDollar: {
    /** Always one unit of currency — the "$1.00" the analysis is anchored to. */
    reference: number;
    /** Singles buyable for exactly the bulk total spend. */
    singlesForBulkSpend: number;
    /** The same figure truncated to whole items, since you cannot buy 0.4 of one. */
    singlesForBulkSpendWhole: number;
    unitsPerCurrencyBulk: number;
    unitsPerCurrencySingle: number;
    basePerCurrencyBulk: number | null;
    basePerCurrencySingle: number | null;
    /** Measure the bulk spend would buy at the smaller option's rate. */
    baseForBulkSpendAtSingleRate: number | null;
  };
  purchasingPower: {
    /** Single unit cost ÷ bulk unit cost — how many times further a dollar goes. */
    multiplier: number;
    /** `(multiplier - 1) x 100` — extra value gained, which exceeds the discount. */
    percentGain: number;
    /** `(1 - bulk/single) x 100` — the discount off the single-item rate. */
    percentSavedPerUnit: number;
    savingsPerUnit: number;
    totalSavingsAcrossPack: number;
    /** Items gained for the same spend by buying the case instead of singles. */
    extraUnitsForSameSpend: number;
    /** Saving per display quantum, e.g. per 100 mL. Null without measures. */
    savingPerDisplayUnit: number | null;
    /** Saved by buying the pack rather than the same measure at the single rate. */
    totalSavingsAtSingleRate: number | null;
    /** Extra measure obtained for the bulk spend by taking the better rate. */
    extraBaseForSameSpend: number | null;
    bulkIsBetter: boolean;
  };
  /** Things a careful analyst would flag about this particular comparison. */
  warnings: string[];
}

export type AnalysisResult =
  | { ok: true; analysis: ValueAnalysis }
  | { ok: false; errors: string[] };

function validate(option: ComparisonOption, role: string): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(option.totalPrice) || option.totalPrice <= 0) {
    errors.push(`${role}: total price must be greater than zero.`);
  }
  if (!Number.isFinite(option.unitsInPack) || option.unitsInPack <= 0) {
    errors.push(`${role}: number of units must be greater than zero.`);
  }
  if (option.baseTotal != null && (!Number.isFinite(option.baseTotal) || option.baseTotal <= 0)) {
    errors.push(`${role}: total size must be greater than zero.`);
  }
  return errors;
}

function summarise(
  option: ComparisonOption,
  isBulk: boolean,
  display: DisplayBase | null,
): OptionSummary {
  const baseTotal = option.baseTotal ?? null;
  const costPerBase = baseTotal ? option.totalPrice / baseTotal : null;
  return {
    label: option.label,
    totalPrice: option.totalPrice,
    unitsInPack: option.unitsInPack,
    unitCost: option.totalPrice / option.unitsInPack,
    baseTotal,
    basePerUnit: baseTotal ? baseTotal / option.unitsInPack : null,
    costPerBase,
    costPerDisplay: costPerBase !== null && display ? costPerBase * display.factor : null,
    unitsPerCurrency: option.unitsInPack / option.totalPrice,
    basePerCurrency: baseTotal ? baseTotal / option.totalPrice : null,
    isBulk,
  };
}

/** The option offering more of the product is the bulk one. */
function orderOptions(
  a: ComparisonOption,
  b: ComparisonOption,
): [ComparisonOption, ComparisonOption] {
  if (a.baseTotal != null && b.baseTotal != null && a.baseTotal !== b.baseTotal) {
    return a.baseTotal > b.baseTotal ? [a, b] : [b, a];
  }
  if (a.unitsInPack !== b.unitsInPack) {
    return a.unitsInPack > b.unitsInPack ? [a, b] : [b, a];
  }
  return a.totalPrice >= b.totalPrice ? [a, b] : [b, a];
}

/**
 * Compare a bulk purchase against a single-item purchase.
 *
 * When both options state a measurable size the verdict is founded on cost per
 * base unit, because a 12 fl oz can and a 20 fl oz bottle are not the same
 * "unit" no matter what the shelf label implies. The per-item figures are still
 * reported, and a warning is raised whenever the two disagree about what a unit is.
 */
export function analyseValue(
  optionA: ComparisonOption,
  optionB: ComparisonOption,
  currency = 'USD',
): AnalysisResult {
  const errors = [...validate(optionA, optionA.label || 'Option A'), ...validate(optionB, optionB.label || 'Option B')];
  if (errors.length) return { ok: false, errors };

  const [bulkOption, singleOption] = orderOptions(optionA, optionB);

  const dimension = bulkOption.dimension ?? singleOption.dimension ?? null;
  const bothMeasured = bulkOption.baseTotal != null && singleOption.baseTotal != null;
  const basis: ComparisonBasis = bothMeasured ? 'measure' : 'unit';

  let display: DisplayBase | null = null;
  if (dimension && bothMeasured) {
    const perBase = [
      bulkOption.totalPrice / (bulkOption.baseTotal as number),
      singleOption.totalPrice / (singleOption.baseTotal as number),
    ];
    display = chooseDisplayBase(dimension, perBase, bulkOption.countNoun ?? singleOption.countNoun ?? 'ct');
  }

  const bulk = summarise(bulkOption, true, display);
  const single = summarise(singleOption, false, display);

  const bulkRate = basis === 'measure' ? (bulk.costPerBase as number) : bulk.unitCost;
  const singleRate = basis === 'measure' ? (single.costPerBase as number) : single.unitCost;

  const multiplier = bulkRate > 0 ? singleRate / bulkRate : 0;
  const percentGain = (multiplier - 1) * 100;
  const percentSavedPerUnit = singleRate > 0 ? (1 - bulkRate / singleRate) * 100 : 0;

  const singlesForBulkSpend = bulk.totalPrice / single.unitCost;

  const unitSizeRatio = bulk.basePerUnit && single.basePerUnit
    ? bulk.basePerUnit / single.basePerUnit
    : null;
  const unitsComparable = basis === 'unit'
    ? true
    : unitSizeRatio !== null && unitSizeRatio >= 0.95 && unitSizeRatio <= 1.05;

  const measured = bothMeasured && display !== null;
  const savingPerDisplayUnit = measured && display ? (singleRate - bulkRate) * display.factor : null;
  const totalSavingsAtSingleRate = measured
    ? (bulk.baseTotal as number) * singleRate - bulk.totalPrice
    : null;
  const baseForBulkSpendAtSingleRate = measured && singleRate > 0
    ? bulk.totalPrice / singleRate
    : null;
  const extraBaseForSameSpend = measured && baseForBulkSpendAtSingleRate !== null
    ? (bulk.baseTotal as number) - baseForBulkSpendAtSingleRate
    : null;

  const warnings: string[] = [];
  if (!bothMeasured) {
    warnings.push(
      'Only one option states a measurable size, so the comparison falls back to cost per item. Confirm both options describe the same individual unit.',
    );
  } else if (!unitsComparable && bulk.basePerUnit && single.basePerUnit) {
    warnings.push(
      `The two options do not contain the same individual unit (${formatMeasure(bulk.basePerUnit)} vs ${formatMeasure(single.basePerUnit)} per item), so per-item cost is not like-for-like. The per-${display?.label ?? 'unit'} figures are the honest comparison.`,
    );
  }
  if (multiplier <= 1) {
    warnings.push('The bulk option is not cheaper per unit here. Buying singles costs the same or less.');
  }

  return {
    ok: true,
    analysis: {
      currency,
      display,
      basis,
      unitsComparable,
      bulk,
      single,
      dollarForDollar: {
        reference: 1,
        singlesForBulkSpend,
        singlesForBulkSpendWhole: Math.floor(singlesForBulkSpend),
        unitsPerCurrencyBulk: bulk.unitsPerCurrency,
        unitsPerCurrencySingle: single.unitsPerCurrency,
        basePerCurrencyBulk: bulk.basePerCurrency,
        basePerCurrencySingle: single.basePerCurrency,
        baseForBulkSpendAtSingleRate,
      },
      purchasingPower: {
        multiplier,
        percentGain,
        percentSavedPerUnit,
        savingsPerUnit: single.unitCost - bulk.unitCost,
        totalSavingsAcrossPack: bulk.unitsInPack * single.unitCost - bulk.totalPrice,
        extraUnitsForSameSpend: bulk.unitsInPack - singlesForBulkSpend,
        savingPerDisplayUnit,
        totalSavingsAtSingleRate,
        extraBaseForSameSpend,
        bulkIsBetter: multiplier > 1,
      },
      warnings,
    },
  };
}

/**
 * Turn a ranked scan result into a comparison option.
 *
 * `base` is taken from the normalized entry rather than the raw quantity,
 * because grouping may have re-expressed the item under a shared basis — a
 * pack read as rolls can end up ranked in sheets.
 */
export function toComparisonOption(entry: NormalizedItem): ComparisonOption {
  const quantity = entry.item.quantity;
  const units = quantity && quantity.packCount > 0 ? quantity.packCount : 1;
  return {
    label: entry.item.title,
    totalPrice: entry.item.price.amount,
    unitsInPack: units,
    baseTotal: entry.base,
    dimension: entry.dimension,
    countNoun: quantity?.countNoun ?? null,
  };
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

function unitNoun(analysis: ValueAnalysis): string {
  const noun = analysis.display?.dimension === 'count' ? analysis.display.label : 'item';
  return noun;
}

function describeVolume(summary: OptionSummary, analysis: ValueAnalysis): string {
  const noun = unitNoun(analysis);
  const units = `${formatMeasure(summary.unitsInPack)} ${pluralise(noun, summary.unitsInPack)}`;
  if (summary.baseTotal == null || !analysis.display || analysis.display.dimension === 'count') {
    return units;
  }
  // Spelling out `24 × 354.88 mL` is useful for a case and noise for one can.
  const per = summary.basePerUnit == null || summary.unitsInPack <= 1
    ? ''
    : ` (${formatMeasure(summary.unitsInPack)} × ${formatMeasure(summary.basePerUnit)} ${analysis.display.baseLabel})`;
  return `${formatMeasure(summary.baseTotal)} ${analysis.display.baseLabel}${per}`;
}

/**
 * Render the analysis as the three-section report: unit pricing table,
 * dollar-for-dollar value, and purchasing power yield.
 */
export function renderAnalysisMarkdown(analysis: ValueAnalysis): string {
  const { currency, bulk, single, display, dollarForDollar: dfd, purchasingPower: pp } = analysis;
  const money = (value: number) => formatCurrency(value, currency);
  const noun = unitNoun(analysis);
  const perLabel = display && display.dimension !== 'count' ? `Cost per ${display.label}` : null;

  const lines: string[] = [];

  lines.push('## Unit Pricing Comparison Table');
  lines.push('');
  const header = ['Option', 'Total Volume / Quantity', 'Total Cost', `Unit Cost (per ${noun})`];
  if (perLabel) header.push(perLabel);
  lines.push(`| ${header.join(' | ')} |`);
  lines.push(`| ${header.map(() => '---').join(' | ')} |`);

  for (const summary of [bulk, single]) {
    const role = summary.isBulk
      ? 'bulk'
      : summary.unitsInPack > 1 ? 'smaller pack' : 'single';
    const row = [
      `**${summary.label}** (${role})`,
      describeVolume(summary, analysis),
      money(summary.totalPrice),
      money(summary.unitCost),
    ];
    if (perLabel) row.push(summary.costPerDisplay == null ? '—' : money(summary.costPerDisplay));
    lines.push(`| ${row.join(' | ')} |`);
  }

  lines.push('');
  lines.push('## Dollar-for-Dollar Value Analysis');
  lines.push('');
  if (analysis.unitsComparable) {
    lines.push(
      `Spending the bulk total of **${money(bulk.totalPrice)}** on single items at ${money(single.unitCost)} each buys ` +
      `**${toFixed(dfd.singlesForBulkSpend)} ${pluralise(noun, dfd.singlesForBulkSpend)}** ` +
      `(**${dfd.singlesForBulkSpendWhole} whole ${pluralise(noun, dfd.singlesForBulkSpendWhole)}** in practice), ` +
      `against **${formatMeasure(bulk.unitsInPack)} ${pluralise(noun, bulk.unitsInPack)}** in the case.`,
    );
  } else if (display && dfd.baseForBulkSpendAtSingleRate !== null && bulk.baseTotal !== null) {
    // The two options hold different individual units, so counting items would
    // compare bottles against cans. The measure is the honest common ground.
    lines.push(
      `**${money(bulk.totalPrice)}** buys **${formatMeasure(bulk.baseTotal)} ${display.baseLabel}** as the ` +
      `${bulk.label}, but only **${formatMeasure(dfd.baseForBulkSpendAtSingleRate)} ${display.baseLabel}** ` +
      `at the ${single.label} rate.`,
    );
  }
  lines.push('');
  lines.push(`What ${money(1)} buys:`);
  lines.push('');
  lines.push(`| Method | ${pluralise(noun, 2)} per ${money(1)}${display && display.dimension !== 'count' ? ` | ${display.baseLabel} per ${money(1)}` : ''} |`);
  lines.push(`| --- | ---${display && display.dimension !== 'count' ? ' | ---' : ''} |`);
  const bulkCells = [`**${bulk.label}**`, toFixed(dfd.unitsPerCurrencyBulk)];
  const singleCells = [`**${single.label}**`, toFixed(dfd.unitsPerCurrencySingle)];
  if (display && display.dimension !== 'count') {
    bulkCells.push(dfd.basePerCurrencyBulk == null ? '—' : toFixed(dfd.basePerCurrencyBulk));
    singleCells.push(dfd.basePerCurrencySingle == null ? '—' : toFixed(dfd.basePerCurrencySingle));
  }
  lines.push(`| ${bulkCells.join(' | ')} |`);
  lines.push(`| ${singleCells.join(' | ')} |`);

  lines.push('');
  lines.push('## Purchasing Power Yield');
  lines.push('');
  if (pp.bulkIsBetter) {
    lines.push(`- **Purchasing power multiplier:** ${formatMultiplier(pp.multiplier)} — every dollar spent on the case goes ${formatMultiplier(pp.multiplier)} as far as the same dollar spent on singles.`);
    lines.push(`- **Value gained:** ${formatPercent(pp.percentGain)} more product for the same money.`);
    lines.push(`- **Discount off the single-item rate:** ${formatPercent(pp.percentSavedPerUnit)}.`);
    if (analysis.unitsComparable) {
      lines.push(`- **Saving per ${noun}:** ${money(pp.savingsPerUnit)}.`);
      lines.push(`- **Total saved across the ${formatMeasure(bulk.unitsInPack)}-${noun} case:** ${money(pp.totalSavingsAcrossPack)}.`);
      lines.push(`- **Extra ${pluralise(noun, 2)} for the same spend:** ${toFixed(pp.extraUnitsForSameSpend)}.`);
    } else if (display) {
      if (pp.savingPerDisplayUnit !== null) lines.push(`- **Saving per ${display.label}:** ${money(pp.savingPerDisplayUnit)}.`);
      if (pp.totalSavingsAtSingleRate !== null && bulk.baseTotal !== null) {
        lines.push(`- **Total saved on ${formatMeasure(bulk.baseTotal)} ${display.baseLabel}:** ${money(pp.totalSavingsAtSingleRate)}.`);
      }
      if (pp.extraBaseForSameSpend !== null) {
        lines.push(`- **Extra ${display.baseLabel} for the same spend:** ${formatMeasure(pp.extraBaseForSameSpend)}.`);
      }
    }
  } else {
    lines.push(`- **Purchasing power multiplier:** ${formatMultiplier(pp.multiplier)} — the case offers no advantage at these prices.`);
    lines.push(`- **Value lost by buying bulk:** ${formatPercent(Math.abs(pp.percentGain))}.`);
  }

  if (analysis.warnings.length) {
    lines.push('');
    lines.push('> **Analyst notes**');
    for (const warning of analysis.warnings) lines.push(`> - ${warning}`);
  }

  lines.push('');
  lines.push(
    '_Based on regular shelf pricing only. Manufacturer coupons, seasonal flyers and loyalty tier discounts are excluded._',
  );

  return lines.join('\n');
}

/** Compact one-line verdict for badges and list rows. */
export function renderVerdict(analysis: ValueAnalysis): string {
  const { purchasingPower: pp } = analysis;
  if (!pp.bulkIsBetter) return 'No bulk advantage';
  return `${formatMultiplier(pp.multiplier)} more product per ${formatCurrency(1, analysis.currency)}`;
}

export { round };
