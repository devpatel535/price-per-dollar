import type { ValueAnalysis } from '../core/compare.ts';
import {
  formatCurrency, formatMeasure, formatMultiplier, formatPercent, pluralise, toFixed,
} from '../core/format.ts';
import { buildTable, el } from './dom.ts';

/**
 * The three-section value report, as DOM.
 *
 * Shared by the on-page panel and the popup so both always show the same
 * figures in the same order as the copied Markdown report.
 */
export function buildAnalysisBody(analysis: ValueAnalysis): DocumentFragment {
  const { bulk, single, display, dollarForDollar: dfd, purchasingPower: pp } = analysis;
  const money = (value: number) => formatCurrency(value, analysis.currency);
  const noun = display?.dimension === 'count' ? display.label : 'item';
  const measured = !!display && display.dimension !== 'count';
  const fragment = document.createDocumentFragment();

  // --- Section 1: unit pricing ---
  fragment.appendChild(el('h3', undefined, 'Unit pricing comparison'));
  const priceHeaders = ['Option', 'Quantity', 'Total', `Per ${noun}`];
  if (measured) priceHeaders.push(`Per ${display!.label}`);

  const priceRows = [bulk, single].map((summary) => {
    const quantity = measured && summary.baseTotal != null
      ? `${formatMeasure(summary.baseTotal)} ${display!.baseLabel}`
      : `${formatMeasure(summary.unitsInPack)} ${pluralise(noun, summary.unitsInPack)}`;
    const row = [summary.label, quantity, money(summary.totalPrice), money(summary.unitCost)];
    if (measured) row.push(summary.costPerDisplay == null ? '—' : money(summary.costPerDisplay));
    return row;
  });
  fragment.appendChild(buildTable(priceHeaders, priceRows));

  // --- Section 2: dollar-for-dollar ---
  fragment.appendChild(el('h3', undefined, 'Dollar-for-dollar value'));
  const dollarHeaders = ['Method', `${pluralise(noun, 2)} per ${money(1)}`];
  if (measured) dollarHeaders.push(`${display!.baseLabel} per ${money(1)}`);

  const dollarRows = [
    [
      bulk.label,
      toFixed(dfd.unitsPerCurrencyBulk),
      ...(measured ? [dfd.basePerCurrencyBulk == null ? '—' : toFixed(dfd.basePerCurrencyBulk)] : []),
    ],
    [
      single.label,
      toFixed(dfd.unitsPerCurrencySingle),
      ...(measured ? [dfd.basePerCurrencySingle == null ? '—' : toFixed(dfd.basePerCurrencySingle)] : []),
    ],
  ];
  fragment.appendChild(buildTable(dollarHeaders, dollarRows));

  const spend = el('p', 'prose');
  if (analysis.unitsComparable) {
    spend.textContent =
      `${money(bulk.totalPrice)} spent on singles at ${money(single.unitCost)} each buys `
      + `${toFixed(dfd.singlesForBulkSpend)} ${pluralise(noun, dfd.singlesForBulkSpend)} `
      + `(${dfd.singlesForBulkSpendWhole} whole ${pluralise(noun, dfd.singlesForBulkSpendWhole)}), `
      + `against ${formatMeasure(bulk.unitsInPack)} ${pluralise(noun, bulk.unitsInPack)} in the pack.`;
  } else if (display && dfd.baseForBulkSpendAtSingleRate !== null && bulk.baseTotal !== null) {
    // Different individual units, so counting items would compare bottles
    // against cans. The measure is the honest common ground.
    spend.textContent =
      `${money(bulk.totalPrice)} buys ${formatMeasure(bulk.baseTotal)} ${display.baseLabel} this way, `
      + `but only ${formatMeasure(dfd.baseForBulkSpendAtSingleRate)} ${display.baseLabel} at the other rate.`;
  }
  if (spend.textContent) fragment.appendChild(spend);

  // --- Section 3: purchasing power yield ---
  fragment.appendChild(el('h3', undefined, 'Purchasing power yield'));
  const list = el('ul');
  const headline: Array<[string, string]> = [
    ['Purchasing power multiplier', formatMultiplier(pp.multiplier)],
    ['Value gained for the same money', `${formatPercent(pp.percentGain)} more product`],
    ['Discount off the single rate', formatPercent(pp.percentSavedPerUnit)],
  ];

  const perItem: Array<[string, string]> = [
    [`Saving per ${noun}`, money(pp.savingsPerUnit)],
    ['Total saved across the pack', money(pp.totalSavingsAcrossPack)],
    [`Extra ${pluralise(noun, 2)} for the same spend`, toFixed(pp.extraUnitsForSameSpend)],
  ];

  const perMeasure: Array<[string, string]> = [];
  if (display && !analysis.unitsComparable) {
    if (pp.savingPerDisplayUnit !== null) {
      perMeasure.push([`Saving per ${display.label}`, money(pp.savingPerDisplayUnit)]);
    }
    if (pp.totalSavingsAtSingleRate !== null && bulk.baseTotal !== null) {
      perMeasure.push([
        `Total saved on ${formatMeasure(bulk.baseTotal)} ${display.baseLabel}`,
        money(pp.totalSavingsAtSingleRate),
      ]);
    }
    if (pp.extraBaseForSameSpend !== null) {
      perMeasure.push([
        `Extra ${display.baseLabel} for the same spend`,
        formatMeasure(pp.extraBaseForSameSpend),
      ]);
    }
  }

  const bullets: Array<[string, string]> = pp.bulkIsBetter
    ? [...headline, ...(analysis.unitsComparable ? perItem : perMeasure)]
    : [
        ['Purchasing power multiplier', formatMultiplier(pp.multiplier)],
        ['Verdict', 'the larger option offers no advantage at these prices'],
      ];

  for (const [label, value] of bullets) {
    const li = el('li');
    li.append(`${label}: `, el('b', undefined, value));
    list.appendChild(li);
  }
  fragment.appendChild(list);

  for (const warning of analysis.warnings) {
    fragment.appendChild(el('div', 'note', warning));
  }

  fragment.appendChild(el('p', 'disclaimer',
    'Regular shelf pricing only. Manufacturer coupons, seasonal flyers and loyalty tier discounts are excluded.'));

  return fragment;
}
