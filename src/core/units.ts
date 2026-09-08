import type { Dimension, MeasurementSystem, UnitDef } from './types.ts';

/**
 * Unit registry.
 *
 * Every dimension has exactly one base unit; conversion is a single multiply.
 * US and Imperial share spellings ("fl oz", "pint", "gallon") but not values,
 * so those units are registered twice and resolved against the page's system.
 */
export const BASE_UNIT: Record<Dimension, string> = {
  mass: 'g',
  volume: 'mL',
  count: 'ct',
  length: 'm',
  area: 'm²',
};

const U = (
  id: string,
  dimension: Dimension,
  factor: number,
  label: string,
  aliases: string[],
  system?: MeasurementSystem,
): UnitDef => ({ id, dimension, factor, label, aliases, ...(system ? { system } : {}) });

/**
 * Nouns that describe a discrete sellable thing. These are what a "pack of N"
 * multiplies, and they are the fallback dimension when nothing measurable is
 * printed on the label.
 */
export const COUNT_NOUNS = [
  'ct', 'count', 'cnt', 'pack', 'packs', 'pk', 'pkg', 'package', 'packages',
  'piece', 'pieces', 'pc', 'pcs', 'unit', 'units', 'each', 'ea', 'item', 'items',
  'can', 'cans', 'bottle', 'bottles', 'box', 'boxes', 'bag', 'bags', 'jar', 'jars',
  'pouch', 'pouches', 'carton', 'cartons', 'tub', 'tubs', 'tube', 'tubes',
  'roll', 'rolls', 'bar', 'bars', 'stick', 'sticks', 'pod', 'pods',
  'capsule', 'capsules', 'caps', 'tablet', 'tablets', 'softgel', 'softgels',
  'gummy', 'gummies', 'sachet', 'sachets', 'packet', 'packets', 'pouchette',
  'tray', 'trays', 'case', 'cases', 'bundle', 'bundles', 'set', 'sets',
  'slice', 'slices', 'wipe', 'wipes', 'sheet', 'sheets', 'diaper', 'diapers',
  'pair', 'pairs', 'bulb', 'bulbs', 'battery', 'batteries', 'cartridge', 'cartridges',
  'k-cup', 'kcup', 'kcups', 'k-cups', 'sleeve', 'sleeves', 'canister', 'canisters',
];

export const UNITS: UnitDef[] = [
  // ---- mass (base: gram) ----
  U('mg', 'mass', 0.001, 'mg', ['mg', 'milligram', 'milligrams', 'milligramme', 'milligrammes']),
  U('g', 'mass', 1, 'g', ['g', 'gr', 'gm', 'gms', 'gram', 'grams', 'gramme', 'grammes']),
  U('kg', 'mass', 1000, 'kg', ['kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms', 'kilogramme', 'kilogrammes']),
  U('oz', 'mass', 28.349523125, 'oz', ['oz', 'ozs', 'ounce', 'ounces']),
  U('lb', 'mass', 453.59237, 'lb', ['lb', 'lbs', 'pound', 'pounds']),

  // ---- volume (base: millilitre) ----
  U('ml', 'volume', 1, 'mL', ['ml', 'mls', 'millilitre', 'millilitres', 'milliliter', 'milliliters', 'cc']),
  U('cl', 'volume', 10, 'cL', ['cl', 'centilitre', 'centilitres', 'centiliter', 'centiliters']),
  U('dl', 'volume', 100, 'dL', ['dl', 'decilitre', 'decilitres', 'deciliter', 'deciliters']),
  U('l', 'volume', 1000, 'L', ['l', 'ltr', 'ltrs', 'litre', 'litres', 'liter', 'liters']),
  U('fl_oz_us', 'volume', 29.5735295625, 'fl oz', ['fl oz', 'floz', 'fl ounce', 'fl ounces', 'fluid oz', 'fluid ounce', 'fluid ounces'], 'US'),
  U('fl_oz_uk', 'volume', 28.4130625, 'fl oz', ['fl oz', 'floz', 'fl ounce', 'fl ounces', 'fluid oz', 'fluid ounce', 'fluid ounces'], 'IMPERIAL'),
  U('pt_us', 'volume', 473.176473, 'pt', ['pt', 'pts', 'pint', 'pints'], 'US'),
  U('pt_uk', 'volume', 568.26125, 'pt', ['pt', 'pts', 'pint', 'pints'], 'IMPERIAL'),
  U('qt_us', 'volume', 946.352946, 'qt', ['qt', 'qts', 'quart', 'quarts'], 'US'),
  U('qt_uk', 'volume', 1136.5225, 'qt', ['qt', 'qts', 'quart', 'quarts'], 'IMPERIAL'),
  U('gal_us', 'volume', 3785.411784, 'gal', ['gal', 'gals', 'gallon', 'gallons'], 'US'),
  U('gal_uk', 'volume', 4546.09, 'gal', ['gal', 'gals', 'gallon', 'gallons'], 'IMPERIAL'),
  U('cup', 'volume', 236.5882365, 'cup', ['cup', 'cups']),
  U('tbsp', 'volume', 14.78676478125, 'tbsp', ['tbsp', 'tbsps', 'tablespoon', 'tablespoons']),
  U('tsp', 'volume', 4.92892159375, 'tsp', ['tsp', 'tsps', 'teaspoon', 'teaspoons']),

  // ---- length (base: metre) ----
  U('mm', 'length', 0.001, 'mm', ['mm', 'millimetre', 'millimetres', 'millimeter', 'millimeters']),
  U('cm', 'length', 0.01, 'cm', ['cm', 'centimetre', 'centimetres', 'centimeter', 'centimeters']),
  U('m', 'length', 1, 'm', ['m', 'metre', 'metres', 'meter', 'meters']),
  U('km', 'length', 1000, 'km', ['km', 'kilometre', 'kilometres', 'kilometer', 'kilometers']),
  U('in', 'length', 0.0254, 'in', ['in', 'ins', 'inch', 'inches']),
  U('ft', 'length', 0.3048, 'ft', ['ft', 'foot', 'feet']),
  U('yd', 'length', 0.9144, 'yd', ['yd', 'yds', 'yard', 'yards']),

  // ---- area (base: square metre) ----
  U('sqm', 'area', 1, 'm²', ['m2', 'm²', 'sq m', 'sqm', 'square metre', 'square metres', 'square meter', 'square meters']),
  U('sqft', 'area', 0.09290304, 'ft²', ['ft2', 'ft²', 'sq ft', 'sqft', 'square foot', 'square feet']),
  U('sqin', 'area', 0.00064516, 'in²', ['in2', 'in²', 'sq in', 'sqin', 'square inch', 'square inches']),

  // ---- count (base: item) ----
  U('ct', 'count', 1, 'ct', COUNT_NOUNS),
];

/**
 * `oz` is the single most dangerous alias in retail text: bare it means mass,
 * prefixed it means volume. Alias matching is longest-first so `fl oz` always
 * wins over `oz`, but callers that build their own regexes need to know.
 */
export const VOLUME_OZ_PREFIXES = ['fl', 'fluid'];

interface AliasEntry {
  alias: string;
  unit: UnitDef;
}

const ALIAS_ENTRIES: AliasEntry[] = UNITS.flatMap((unit) =>
  unit.aliases.map((alias) => ({ alias, unit })),
).sort((a, b) => b.alias.length - a.alias.length || a.alias.localeCompare(b.alias));

/** Every spelling we know, longest first — safe to interpolate into a regex. */
export const ALL_ALIASES: string[] = ALIAS_ENTRIES.map((e) => e.alias);

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A regex fragment matching any known unit spelling. Whitespace inside a
 * multi-word alias is relaxed so "fl.oz", "fl oz" and "fl  oz" all match.
 */
export const UNIT_ALIAS_PATTERN: string = ALL_ALIASES
  .map((alias) => escapeRegExp(alias).replace(/\\?\s+/g, '[\\s.]*'))
  .join('|');

/**
 * Resolve a spelling to a unit definition.
 *
 * Units that exist in both customary systems resolve against `system`; unit
 * spellings that are system-independent ignore it.
 */
export function resolveUnit(
  alias: string,
  system: MeasurementSystem = 'US',
): UnitDef | null {
  const key = normaliseAlias(alias);
  if (!key) return null;
  let systemAgnostic: UnitDef | null = null;
  for (const entry of ALIAS_ENTRIES) {
    if (entry.alias !== key) continue;
    if (!entry.unit.system) {
      systemAgnostic ??= entry.unit;
      continue;
    }
    if (entry.unit.system === system) return entry.unit;
  }
  return systemAgnostic;
}

/** Lowercase, strip trailing dots, collapse internal whitespace. */
export function normaliseAlias(alias: string): string {
  return alias
    .toLowerCase()
    .replace(/\./g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function toBase(value: number, unit: UnitDef): number {
  return value * unit.factor;
}

export function fromBase(base: number, unit: UnitDef): number {
  return base / unit.factor;
}

/** Currencies whose smallest circulating unit is the whole number. */
export const ZERO_DECIMAL_CURRENCIES = new Set([
  'JPY', 'KRW', 'VND', 'CLP', 'ISK', 'HUF', 'TWD', 'IDR', 'COP', 'PYG',
  'RWF', 'UGX', 'VUV', 'XAF', 'XOF', 'XPF', 'KMF', 'DJF', 'GNF', 'BIF',
]);

/** Currencies that are quoted against imperial rather than US customary units. */
const IMPERIAL_CURRENCIES = new Set(['GBP']);

const IMPERIAL_TLDS = ['.co.uk', '.uk', '.ie'];

/** Pick a measurement system from whatever weak signals the page gives us. */
export function inferMeasurementSystem(opts: {
  currency?: string | undefined;
  hostname?: string | undefined;
  locale?: string | undefined;
}): MeasurementSystem {
  if (opts.currency && IMPERIAL_CURRENCIES.has(opts.currency.toUpperCase())) return 'IMPERIAL';
  const host = (opts.hostname ?? '').toLowerCase();
  if (IMPERIAL_TLDS.some((tld) => host.endsWith(tld))) return 'IMPERIAL';
  const locale = (opts.locale ?? '').toLowerCase();
  if (locale === 'en-gb' || locale.endsWith('-gb')) return 'IMPERIAL';
  return 'US';
}
