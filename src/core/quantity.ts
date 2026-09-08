import type { MeasurementSystem, Quantity, QuantityView, UnitDef } from './types.ts';
import { COUNT_NOUNS, UNIT_ALIAS_PATTERN, normaliseAlias, resolveUnit, toBase } from './units.ts';
import { findMoney } from './money.ts';

/**
 * Size parsing.
 *
 * This is the part of the extension that decides whether a comparison is honest,
 * so it is deliberately conservative: it would rather return `null` than invent
 * a size. The pipeline is preprocess → collect candidate matches → reconcile.
 */

/**
 * Count nouns that carry no information about what the thing actually is.
 * Two products counted in these are freely comparable; two products counted in
 * *different specific* nouns (rolls vs sheets) are not.
 */
const GENERIC_COUNT_NOUNS = new Set([
  'ct', 'count', 'cnt', 'pack', 'pk', 'pkg', 'package', 'piece', 'pc', 'unit',
  'each', 'ea', 'item', 'case', 'bundle', 'set',
]);

const IRREGULAR_SINGULARS: Record<string, string> = {
  boxes: 'box', pouches: 'pouch', batteries: 'battery', gummies: 'gummy',
  leaves: 'leaf', loaves: 'loaf', knives: 'knife', feet: 'foot',
};

/** Reduce a count noun to its singular form, keeping the specific word. */
export function singulariseNoun(raw: string): string {
  const word = normaliseAlias(raw).replace(/\s+/g, '-');
  const direct = IRREGULAR_SINGULARS[word];
  if (direct) return direct;
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/** As `singulariseNoun`, but collapsing nouns that identify nothing to `ct`. */
export function singulariseCountNoun(raw: string): string {
  const singular = singulariseNoun(raw);
  return GENERIC_COUNT_NOUNS.has(singular) ? 'ct' : singular;
}

/**
 * Count nouns whose stated measure describes one of the things, not the box.
 *
 * `40 bottles, 16.9 fl oz` means each bottle holds 16.9 fl oz, so the sizes
 * multiply. `48 pieces, 600 g` means the box weighs 600 g, so they do not.
 * The noun is the only thing distinguishing those two sentences.
 */
const PER_UNIT_COUNT_NOUNS = new Set([
  'bottle', 'can', 'jar', 'box', 'carton', 'pouch', 'tub', 'tube', 'bag',
  'packet', 'sachet', 'canister', 'cup', 'tray', 'pack', 'pk', 'pkg',
  'package', 'case', 'sleeve', 'k-cup', 'kcup', 'cartridge',
]);

/** An explicit statement that a size is per item rather than for the package. */
const PER_ITEM_SIGNAL = /\b(each|apiece)\b/;

const UNICODE_FRACTIONS: Record<string, string> = {
  '½': '.5', '⅓': '.3333333333', '⅔': '.6666666667', '¼': '.25', '¾': '.75',
  '⅕': '.2', '⅖': '.4', '⅗': '.6', '⅘': '.8', '⅙': '.1666666667',
  '⅚': '.8333333333', '⅛': '.125', '⅜': '.375', '⅝': '.625', '⅞': '.875',
};

const FRACTION_DENOMINATORS = new Set([2, 3, 4, 5, 6, 8, 10, 12, 16]);

/**
 * Normalise the messy surface forms retailers use so a single set of patterns
 * can read them: lowercase, unicode fractions expanded, `×` folded to `x`,
 * abbreviation dots removed, and number grouping resolved.
 */
export function preprocessSizeText(input: string): string {
  // Vulgar fractions are expanded before NFKC, which would otherwise decompose
  // `½` into `1⁄2` and hide it from the lookup table.
  let text = input.toLowerCase();
  text = text.replace(/(\d)\s*([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])/g, (_m, d: string, f: string) => `${d}${UNICODE_FRACTIONS[f] ?? ''}`);
  text = text.replace(/([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])/g, (_m, f: string) => `0${UNICODE_FRACTIONS[f] ?? ''}`);
  text = text.normalize('NFKC').replace(/\u2044/g, '/');

  text = text.replace(/[×✕✖⨯*]/g, 'x');
  text = text.replace(/[–—−]/g, '-');
  text = text.replace(/[   ]/g, ' ');

  // `1 1/2 lb` -> `1.5 lb`, `1/2 gal` -> `0.5 gal`. Only for plausible
  // cooking-style denominators, so `24/7` and `50/50` are left alone.
  text = text.replace(/(?<![\w.])(\d+)\s+(\d+)\s*\/\s*(\d+)(?![\d.])/g, (m, w: string, n: string, d: string) => {
    const den = Number(d);
    if (!FRACTION_DENOMINATORS.has(den)) return m;
    return String(Number(w) + Number(n) / den);
  });
  text = text.replace(/(?<![\w.\/])(\d+)\s*\/\s*(\d+)(?![\d.\/])/g, (m, n: string, d: string) => {
    const den = Number(d);
    if (!FRACTION_DENOMINATORS.has(den)) return m;
    return String(Number(n) / den);
  });

  // `fl. oz.` -> `fl oz `, without touching decimal points.
  text = text.replace(/([a-z])\.(?![\d])/g, '$1 ');

  // `1,000 ct` is a thousand; `0,5 l` is a half litre.
  text = text.replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
  text = text.replace(/(\d),(\d{1,2})(?![\d])/g, '$1.$2');

  return text.replace(/\s+/g, ' ').trim();
}

/** Blank out price substrings so their digits cannot be mistaken for sizes. */
export function stripPrices(text: string): string {
  const matches = findMoney(text);
  if (matches.length === 0) return text;
  let out = text;
  for (const m of [...matches].sort((a, b) => b.index - a.index)) {
    out = `${out.slice(0, m.index)}${' '.repeat(m.length)}${out.slice(m.index + m.length)}`;
  }
  return out;
}

const NUM = String.raw`\d+(?:\.\d+)?`;

const RE_MULTIPLIER = new RegExp(
  String.raw`(?<![\w.])(${NUM})\s*x\s*(${NUM})\s*-?\s*(${UNIT_ALIAS_PATTERN})(?![a-z])`,
  'g',
);
const RE_MULTIPLIER_REVERSED = new RegExp(
  String.raw`(?<![\w.])(${NUM})\s*-?\s*(${UNIT_ALIAS_PATTERN})\s*x\s*(${NUM})(?![\w.])`,
  'g',
);
const RE_PER_CONTAINER = new RegExp(
  String.raw`(?<![\w.])(${NUM})\s*(${UNIT_ALIAS_PATTERN})\s*(?:per|\/|in\s+each|a)\s+(${UNIT_ALIAS_PATTERN})(?![a-z])`,
  'g',
);
const RE_PACK_OF = new RegExp(
  String.raw`\b(?:pack|packs|case|cases|box|set|bundle|carton|pk|multipack)\s+of\s+(${NUM})(?![\w.])`,
  'g',
);
const RE_MEASURE = new RegExp(
  String.raw`(?<![\w.])(${NUM})\s*-?\s*(${UNIT_ALIAS_PATTERN})(?![a-z])`,
  'g',
);

const COUNT_NOUN_PATTERN = [...COUNT_NOUNS]
  .sort((a, b) => b.length - a.length || a.localeCompare(b))
  .map((noun) => noun.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');

/**
 * `24 Family Mega Rolls` — the count noun is separated from its number by
 * marketing adjectives. Commas and digits break the run, so this cannot leap
 * across `12 fl oz cans, 24 pack` to pair the wrong number with the wrong noun.
 */
const RE_LOOSE_COUNT = new RegExp(
  String.raw`(?<![\w.])(${NUM})\s+(?:[a-z][a-z'-]*\s+){1,3}(${COUNT_NOUN_PATTERN})(?![a-z])`,
  'g',
);

interface MeasureMatch {
  value: number;
  unit: UnitDef;
  countNoun?: string;
  /** The count noun as written, before generic nouns collapse to `ct`. */
  rawNoun?: string;
  index: number;
  end: number;
  raw: string;
  inParens: boolean;
}

function makeMeasure(
  value: number,
  aliasText: string,
  index: number,
  end: number,
  raw: string,
  text: string,
  system: MeasurementSystem,
): MeasureMatch | null {
  const unit = resolveUnit(aliasText, system);
  if (!unit || !Number.isFinite(value) || value <= 0) return null;
  return {
    value,
    unit,
    ...(unit.dimension === 'count'
      ? { countNoun: singulariseCountNoun(aliasText), rawNoun: singulariseNoun(aliasText) }
      : {}),
    index,
    end,
    raw,
    inParens: isInsideParens(text, index),
  };
}

function isInsideParens(text: string, index: number): boolean {
  const before = text.slice(0, index);
  const open = (before.match(/\(/g) ?? []).length;
  const close = (before.match(/\)/g) ?? []).length;
  return open > close;
}

function collectMeasures(text: string, system: MeasurementSystem): MeasureMatch[] {
  const out: MeasureMatch[] = [];
  RE_MEASURE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_MEASURE.exec(text)) !== null) {
    const measure = makeMeasure(
      Number(m[1]), m[2] ?? '', m.index, m.index + m[0].length, m[0].trim(), text, system,
    );
    if (measure) out.push(measure);
  }
  RE_PACK_OF.lastIndex = 0;
  while ((m = RE_PACK_OF.exec(text)) !== null) {
    const measure = makeMeasure(
      Number(m[1]), 'ct', m.index, m.index + m[0].length, m[0].trim(), text, system,
    );
    if (measure) out.push(measure);
  }

  // Loose count nouns only fill gaps: a number already claimed by a strict
  // measure keeps that reading, so `12 fl oz cans` stays twelve fluid ounces.
  RE_LOOSE_COUNT.lastIndex = 0;
  while ((m = RE_LOOSE_COUNT.exec(text)) !== null) {
    const start = m.index;
    if (out.some((existing) => start >= existing.index && start < existing.end)) continue;
    const measure = makeMeasure(
      Number(m[1]), m[2] ?? '', start, start + m[0].length, m[0].trim(), text, system,
    );
    if (measure) out.push(measure);
  }

  return out.sort((a, b) => a.index - b.index);
}

/** Drop measures that merely restate an earlier one in different units. */
function dedupeRestatements(measures: MeasureMatch[]): MeasureMatch[] {
  const kept: MeasureMatch[] = [];
  for (const measure of measures) {
    const base = toBase(measure.value, measure.unit);
    const duplicate = kept.some((other) => {
      if (other.unit.dimension !== measure.unit.dimension) return false;
      if (other.countNoun !== measure.countNoun) return false;
      const otherBase = toBase(other.value, other.unit);
      if (otherBase === 0) return false;
      return Math.abs(otherBase - base) / otherBase < 0.06;
    });
    if (!duplicate) kept.push(measure);
  }
  return kept;
}

/**
 * Fold `2 lb 4 oz` into a single mass. Only adjacent, same-dimension, strictly
 * descending measures qualify, which is how compound sizes are always written.
 */
function foldCompoundMeasures(measures: MeasureMatch[]): { measures: MeasureMatch[]; folded: boolean } {
  for (let i = 0; i < measures.length - 1; i += 1) {
    const a = measures[i];
    const b = measures[i + 1];
    if (!a || !b) continue;
    if (a.unit.dimension !== b.unit.dimension) continue;
    if (a.unit.dimension === 'count') continue;
    if (a.unit.factor <= b.unit.factor) continue;
    if (b.index - a.end > 3) continue;
    const combinedBase = toBase(a.value, a.unit) + toBase(b.value, b.unit);
    const merged: MeasureMatch = {
      value: combinedBase / a.unit.factor,
      unit: a.unit,
      index: a.index,
      end: b.end,
      raw: `${a.raw} ${b.raw}`,
      inParens: a.inParens,
    };
    const next = [...measures.slice(0, i), merged, ...measures.slice(i + 2)];
    return { measures: next, folded: true };
  }
  return { measures, folded: false };
}

export interface ParseQuantityOptions {
  system?: MeasurementSystem;
  /** Set false when the caller has already removed prices from the text. */
  removePrices?: boolean;
}

/** Trim binary-float noise so `1.55 x 36` reports 55.8 and not 55.80000000000001. */
function tidy(value: number): number {
  return Number.isFinite(value) ? Number(value.toPrecision(12)) : value;
}

function buildQuantity(
  total: { value: number; unit: UnitDef; countNoun?: string | undefined },
  packCount: number,
  raw: string,
  confidence: number,
  alternates: QuantityView[] = [],
): Quantity {
  const value = tidy(total.value);
  const base = tidy(toBase(value, total.unit));
  const safePack = packCount > 0 ? packCount : 1;
  return {
    value,
    unit: total.unit,
    dimension: total.unit.dimension,
    base,
    packCount: safePack,
    basePerItem: base / safePack,
    raw,
    confidence,
    ...(total.countNoun ? { countNoun: total.countNoun } : {}),
    ...(alternates.length ? { alternates } : {}),
  };
}

/**
 * Read a size out of arbitrary product text.
 *
 * Patterns are tried strongest-first; the first one that fires wins, because a
 * page that says `24 x 12 fl oz` has already told us everything and any weaker
 * reading would only add noise.
 */
export function parseQuantity(input: string, options: ParseQuantityOptions = {}): Quantity | null {
  if (!input) return null;
  const system = options.system ?? 'US';
  const source = options.removePrices === false ? input : stripPrices(input);
  const text = preprocessSizeText(source);
  if (!text) return null;

  // 1. `24 x 12 fl oz` — the pack and the unit size are both stated outright.
  RE_MULTIPLIER.lastIndex = 0;
  const multiplier = RE_MULTIPLIER.exec(text);
  if (multiplier) {
    const packs = Number(multiplier[1]);
    const per = Number(multiplier[2]);
    const unit = resolveUnit(multiplier[3] ?? '', system);
    if (unit && packs > 0 && per > 0) {
      return buildQuantity(
        {
          value: packs * per,
          unit,
          countNoun: unit.dimension === 'count' ? singulariseCountNoun(multiplier[3] ?? '') : undefined,
        },
        packs,
        multiplier[0].trim(),
        0.95,
      );
    }
  }

  // 2. `500 ml x 6` — the same statement written the other way round.
  RE_MULTIPLIER_REVERSED.lastIndex = 0;
  const reversed = RE_MULTIPLIER_REVERSED.exec(text);
  if (reversed) {
    const per = Number(reversed[1]);
    const unit = resolveUnit(reversed[2] ?? '', system);
    const packs = Number(reversed[3]);
    if (unit && packs > 0 && per > 0) {
      return buildQuantity(
        {
          value: packs * per,
          unit,
          countNoun: unit.dimension === 'count' ? singulariseCountNoun(reversed[2] ?? '') : undefined,
        },
        packs,
        reversed[0].trim(),
        0.95,
      );
    }
  }

  const rawMeasures = collectMeasures(text, system);
  let measures = dedupeRestatements(rawMeasures);
  let folded = false;
  for (;;) {
    const result = foldCompoundMeasures(measures);
    measures = result.measures;
    if (!result.folded) break;
    folded = true;
  }

  const counts = measures.filter((m) => m.unit.dimension === 'count');
  const sized = measures.filter((m) => m.unit.dimension !== 'count');

  // 3. `30 rolls, 425 sheets per roll` — a container count with a stated yield.
  RE_PER_CONTAINER.lastIndex = 0;
  let perMatch: RegExpExecArray | null;
  while ((perMatch = RE_PER_CONTAINER.exec(text)) !== null) {
    const perValue = Number(perMatch[1]);
    const perUnit = resolveUnit(perMatch[2] ?? '', system);
    const containerNoun = singulariseCountNoun(perMatch[3] ?? '');
    if (!perUnit || perValue <= 0) continue;
    const container = counts.find(
      (c) => c.countNoun === containerNoun && c.index < perMatch!.index,
    );
    if (!container) continue;
    const alternates: QuantityView[] = [{
      value: container.value,
      unit: container.unit,
      base: toBase(container.value, container.unit),
      countNoun: container.countNoun ?? 'ct',
    }];
    return buildQuantity(
      {
        value: container.value * perValue,
        unit: perUnit,
        countNoun: perUnit.dimension === 'count' ? singulariseCountNoun(perMatch[2] ?? '') : undefined,
      },
      container.value,
      `${container.raw}, ${perMatch[0].trim()}`,
      0.9,
      alternates,
    );
  }

  const primarySized = sized[0];

  // 4. A unit size stated alongside a pack count, e.g. `12 fl oz, 24 pack`.
  if (primarySized) {
    // Any count can be the pack size; whether it multiplies is decided below,
    // so a dose stated before its tablet count is read the same way a can size
    // stated before its case count is.
    const packCount = counts.find((c) => c.index !== primarySized.index && c.value > 1);
    if (packCount) {
      const alternates: QuantityView[] = [{
        value: packCount.value,
        unit: packCount.unit,
        base: toBase(packCount.value, packCount.unit),
        countNoun: packCount.countNoun ?? 'ct',
      }];

      // Whether the two multiply is the crux of the whole parser. A size
      // written before its count is always per item (`12 fl oz, 24 pack`), as
      // is one marked `each`. Otherwise only a container noun implies the
      // measure describes one of the things rather than the package total.
      const measureStatedFirst = primarySized.index < packCount.index;
      const perItemNoun = !!packCount.rawNoun && PER_UNIT_COUNT_NOUNS.has(packCount.rawNoun);
      const multiplies = measureStatedFirst || PER_ITEM_SIGNAL.test(text) || perItemNoun;

      if (multiplies) {
        return buildQuantity(
          { value: primarySized.value * packCount.value, unit: primarySized.unit },
          packCount.value,
          `${packCount.raw} x ${primarySized.raw}`,
          0.85,
          alternates,
        );
      }
      // The size is the package total; the count still tells us the pack size.
      return buildQuantity(
        { value: primarySized.value, unit: primarySized.unit },
        packCount.value,
        `${primarySized.raw} across ${packCount.raw}`,
        0.75,
        alternates,
      );
    }

    // 5. A bare measurable size, e.g. `3 lb bag`.
    const alternates: QuantityView[] = counts.length && counts[0]
      ? [{
          value: counts[0].value,
          unit: counts[0].unit,
          base: toBase(counts[0].value, counts[0].unit),
          countNoun: counts[0].countNoun ?? 'ct',
        }]
      : [];
    return buildQuantity(
      { value: primarySized.value, unit: primarySized.unit },
      counts[0]?.value && counts[0].value > 1 ? counts[0].value : 1,
      primarySized.raw,
      folded ? 0.85 : 0.8,
      alternates,
    );
  }

  // 6. Nothing measurable — fall back to counting the things themselves.
  const primaryCount = counts.find((c) => !c.inParens) ?? counts[0];
  if (primaryCount) {
    // `8 packs, 42 wipes each` — a pack count and what each pack holds. The
    // finer count is the useful basis, and `each` is what makes it unambiguous.
    const perPack = counts.find(
      (c) => c !== primaryCount && !c.inParens && c.index > primaryCount.index && c.value > 1,
    );
    if (perPack && primaryCount.value > 1 && PER_ITEM_SIGNAL.test(text)) {
      return buildQuantity(
        {
          value: primaryCount.value * perPack.value,
          unit: perPack.unit,
          countNoun: perPack.countNoun ?? 'ct',
        },
        primaryCount.value,
        `${primaryCount.raw} x ${perPack.raw}`,
        0.85,
        [{
          value: primaryCount.value,
          unit: primaryCount.unit,
          base: toBase(primaryCount.value, primaryCount.unit),
          countNoun: primaryCount.countNoun ?? 'ct',
        }],
      );
    }

    const alternates: QuantityView[] = counts
      .filter((c) => c !== primaryCount)
      .map((c) => ({
        value: c.value,
        unit: c.unit,
        base: toBase(c.value, c.unit),
        countNoun: c.countNoun ?? 'ct',
      }));
    return buildQuantity(
      { value: primaryCount.value, unit: primaryCount.unit, countNoun: primaryCount.countNoun ?? 'ct' },
      primaryCount.value,
      primaryCount.raw,
      0.6,
      alternates,
    );
  }

  return null;
}
