import type { MeasurementSystem, Money, ObservationSource, Quantity } from '../core/types.ts';

export interface ExtractContext {
  document: Document;
  hostname: string;
  system: MeasurementSystem;
  /** Currency to assume when a page writes a bare `$`. */
  currencyHint?: string | undefined;
}

/** A product as an extractor found it, before sizes and ids are worked out. */
export interface RawItem {
  title: string;
  price: Money;
  /** Text to read a size from, when it is not in the title. */
  sizeText?: string | undefined;
  /** A size the extractor already knows for certain (structured data). */
  quantity?: Quantity | null;
  url?: string | undefined;
  imageUrl?: string | undefined;
  source: ObservationSource;
  adapter?: string | undefined;
  /** The product card, when the extractor could point at one. */
  element: HTMLElement | null;
  /** Where a badge should be pinned — usually the price element. */
  anchor: HTMLElement | null;
  /** A unit price the retailer printed itself. */
  siteUnitPrice?: string | undefined;
  priceIsRange?: boolean;
  /** Higher wins when two extractors describe the same card. */
  precedence: number;
}

export const PRECEDENCE: Record<ObservationSource, number> = {
  structured: 30,
  adapter: 20,
  heuristic: 10,
  manual: 40,
};
