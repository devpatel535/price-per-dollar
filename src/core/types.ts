/**
 * Core domain types for Price Per Dollar.
 *
 * Everything in `core/` is pure: no DOM, no chrome APIs, no I/O. That keeps the
 * arithmetic — which is the part users actually trust us with — testable in
 * isolation from the messy business of scraping retail pages.
 */

/** Physical dimension a quantity is measured in. Only same-dimension items compare. */
export type Dimension = 'mass' | 'volume' | 'count' | 'length' | 'area';

/** Which set of customary units a page should be read with. */
export type MeasurementSystem = 'US' | 'IMPERIAL';

export interface UnitDef {
  /** Stable identifier, e.g. `fl_oz_us`. */
  id: string;
  dimension: Dimension;
  /** Multiply a value in this unit by `factor` to get the dimension's base unit. */
  factor: number;
  /** Short human label, e.g. `fl oz`. */
  label: string;
  /** Lowercase spellings that resolve to this unit. */
  aliases: string[];
  /** Only resolved when the page is being read in this system. */
  system?: MeasurementSystem;
}

/** A parsed size such as "24 x 12 fl oz" or "1.5 kg" or "30 rolls". */
export interface Quantity {
  /** Total amount, expressed in `unit` (already multiplied out across the pack). */
  value: number;
  unit: UnitDef;
  dimension: Dimension;
  /** Total amount converted to the dimension's base unit (g / mL / ct / m / m²). */
  base: number;
  /** Discrete sellable items in the package. 1 for a single item. */
  packCount: number;
  /** Base units contained in one individual item (`base / packCount`). */
  basePerItem: number;
  /**
   * For count quantities, the canonical singular noun being counted (`roll`,
   * `sheet`, `capsule`), or `ct` when the label counted nothing in particular.
   * Two count quantities only compare when this matches or one side is `ct`.
   */
  countNoun?: string;
  /**
   * Other valid readings of the same size, e.g. a pack stated as `30 rolls`
   * that also tells us it holds `12750 sheets`. Grouping uses these to find a
   * basis every member of a comparison can express.
   */
  alternates?: QuantityView[];
  /** The substring the size was read from. */
  raw: string;
  /** 0..1 — how much we trust this reading. */
  confidence: number;
}

/** One way of expressing a size. */
export interface QuantityView {
  value: number;
  unit: UnitDef;
  base: number;
  countNoun?: string;
}

/** A parsed price. */
export interface Money {
  amount: number;
  /** Best-effort ISO 4217 code. `XXX` when the symbol was genuinely ambiguous. */
  currency: string;
  raw: string;
}

export type ObservationSource = 'structured' | 'adapter' | 'heuristic' | 'manual';

/** A product read off a page. Must stay structured-clone friendly for messaging. */
export interface ProductItem {
  id: string;
  title: string;
  price: Money;
  quantity: Quantity | null;
  url?: string;
  imageUrl?: string;
  source: ObservationSource;
  /** Adapter id when `source === 'adapter'`. */
  adapter?: string;
  /** A unit price the retailer printed itself, kept verbatim for cross-checking. */
  siteUnitPrice?: string;
  /** True when the price came from a range like "$9.99 – $19.99" (low end used). */
  priceIsRange?: boolean;
}

/** A `ProductItem` that we can still point at in the live DOM. */
export interface ScannedItem extends ProductItem {
  element: HTMLElement;
  /** Element the badge should be anchored to (usually the price node's block). */
  anchor: HTMLElement;
}

/** A product item with its cost-per-unit worked out. */
export interface NormalizedItem {
  item: ProductItem;
  dimension: Dimension;
  /** Total size in base units. */
  base: number;
  /** Price per one base unit (per g / mL / item / m / m²). Full precision. */
  pricePerBase: number;
  /** Base units obtained per single unit of currency. Full precision. */
  basePerCurrencyUnit: number;
}

/** How much of a base unit a display row is quoted in, e.g. 100 g. */
export interface DisplayBase {
  dimension: Dimension;
  /** Base units per display quantum, e.g. 100 for "per 100 g". */
  factor: number;
  /** Rendered label for the quantum, e.g. `100 g` or `kg`. */
  label: string;
  /** Label for one base unit alone, e.g. `g`. */
  baseLabel: string;
}

export type GroupingMode = 'smart' | 'page';

export interface ItemGroup {
  id: string;
  dimension: Dimension;
  /** Human label, derived from the shared tokens of the members' titles. */
  label: string;
  members: NormalizedItem[];
  /** Cheapest member per base unit. */
  best: NormalizedItem;
  /** Most expensive member per base unit, when the group has more than one. */
  worst: NormalizedItem | null;
  display: DisplayBase;
}

export interface ScanSummary {
  url: string;
  hostname: string;
  scannedAt: number;
  /** Every item we could read a price from. */
  items: ProductItem[];
  /** Items we could not derive a size for, and so cannot rank. */
  unsizedCount: number;
  groups: ItemGroup[];
  currency: string;
  measurementSystem: MeasurementSystem;
  mode: GroupingMode;
}
