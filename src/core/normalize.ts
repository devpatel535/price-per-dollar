import type {
  Dimension, DisplayBase, NormalizedItem, ProductItem, Quantity,
} from './types.ts';
import { BASE_UNIT } from './units.ts';
import { pluralise } from './format.ts';

/**
 * Turning a price and a size into a comparable cost-per-unit, and choosing the
 * quantum that cost is quoted in.
 */

/** The dimension plus, for counts, the specific thing being counted. */
export interface Basis {
  dimension: Dimension;
  /** `ct` means "generic items"; anything else must match exactly. */
  countNoun: string;
}

export function basisOf(quantity: Quantity): Basis {
  return {
    dimension: quantity.dimension,
    countNoun: quantity.dimension === 'count' ? (quantity.countNoun ?? 'ct') : '',
  };
}

export function basisKey(basis: Basis): string {
  return basis.dimension === 'count' ? `count:${basis.countNoun}` : basis.dimension;
}

/**
 * Two count bases are compatible when they name the same thing, or when either
 * side is the generic `ct`. Rolls never silently compare against sheets.
 */
export function basesCompatible(a: Basis, b: Basis): boolean {
  if (a.dimension !== b.dimension) return false;
  if (a.dimension !== 'count') return true;
  return a.countNoun === b.countNoun || a.countNoun === 'ct' || b.countNoun === 'ct';
}

/** Every basis a quantity can be expressed in, primary reading first. */
export function availableBases(quantity: Quantity): Array<{ basis: Basis; base: number }> {
  const out = [{ basis: basisOf(quantity), base: quantity.base }];
  for (const view of quantity.alternates ?? []) {
    out.push({
      basis: {
        dimension: view.unit.dimension,
        countNoun: view.unit.dimension === 'count' ? (view.countNoun ?? 'ct') : '',
      },
      base: view.base,
    });
  }
  return out;
}

/** Express a quantity under a specific basis, or null if it cannot be. */
export function baseUnder(quantity: Quantity, basis: Basis): number | null {
  for (const candidate of availableBases(quantity)) {
    if (basesCompatible(candidate.basis, basis)) return candidate.base;
  }
  return null;
}

/** Attach cost-per-base-unit to an item, or return null if it has no size. */
export function normalizeItem(item: ProductItem): NormalizedItem | null {
  const { quantity, price } = item;
  if (!quantity || quantity.base <= 0 || price.amount <= 0) return null;
  return {
    item,
    dimension: quantity.dimension,
    base: quantity.base,
    pricePerBase: price.amount / quantity.base,
    basePerCurrencyUnit: quantity.base / price.amount,
  };
}

interface LadderStep {
  factor: number;
  label: string;
}

const LADDERS: Record<Exclude<Dimension, 'count'>, LadderStep[]> = {
  mass: [
    { factor: 1, label: 'g' },
    { factor: 100, label: '100 g' },
    { factor: 1000, label: 'kg' },
  ],
  volume: [
    { factor: 1, label: 'mL' },
    { factor: 100, label: '100 mL' },
    { factor: 1000, label: 'L' },
  ],
  length: [
    { factor: 1, label: 'm' },
    { factor: 100, label: '100 m' },
    { factor: 1000, label: 'km' },
  ],
  area: [
    { factor: 1, label: 'm²' },
    { factor: 100, label: '100 m²' },
  ],
};

/**
 * Pick the quantum a group's unit prices are quoted in.
 *
 * Unit prices are always shown to exactly two decimals, which means the quantum
 * decides how much resolution survives. Quoting olive oil per millilitre prints
 * `$0.01` for every bottle on the shelf — technically non-zero, useless for
 * comparing. So the ladder climbs until the cheapest item reaches a dime, where
 * two decimals still carry two significant figures, and only falls back to the
 * weaker "at least a cent" rule when nothing on the ladder gets that far.
 */
export function chooseDisplayBase(
  dimension: Dimension,
  pricesPerBase: number[],
  countNoun = 'ct',
): DisplayBase {
  if (dimension === 'count') {
    const noun = countNoun === 'ct' ? 'item' : countNoun;
    return { dimension, factor: 1, label: noun, baseLabel: noun };
  }

  const ladder = LADDERS[dimension];
  const baseLabel = BASE_UNIT[dimension];
  const cheapest = pricesPerBase.length ? Math.min(...pricesPerBase.filter((p) => p > 0)) : 0;
  const fallback = ladder[ladder.length - 1] ?? { factor: 1, label: baseLabel };

  if (!Number.isFinite(cheapest) || cheapest <= 0) {
    const first = ladder[0] ?? fallback;
    return { dimension, factor: first.factor, label: first.label, baseLabel };
  }

  const step = ladder.find((candidate) => cheapest * candidate.factor >= 0.1)
    ?? ladder.find((candidate) => cheapest * candidate.factor >= 0.01)
    ?? fallback;
  return { dimension, factor: step.factor, label: step.label, baseLabel };
}

/** Render a base amount in a display base, e.g. `2.5` and `100 g` -> `2.5 x 100 g`. */
export function describeBaseAmount(base: number, display: DisplayBase): string {
  if (display.dimension === 'count') {
    return `${base} ${pluralise(display.label, base)}`;
  }
  return `${base} ${display.baseLabel}`;
}
