import type { ExtractContext, RawItem } from './types.ts';
import { PRECEDENCE } from './types.ts';
import { findMoney, type MoneyMatch } from '../core/money.ts';
import { parseQuantity, stripPrices } from '../core/quantity.ts';
import { UNIT_ALIAS_PATTERN } from '../core/units.ts';

/**
 * Generic DOM extraction.
 *
 * No selectors, no site knowledge: find text that is a price, climb to the
 * element that behaves like a product card, and read a title and a size out of
 * it. This is what makes the extension work on the long tail of stores that
 * publish no structured data and will never get a hand-written adapter.
 */

const MAX_TEXT_NODES = 25_000;
const MAX_CARDS = 400;
const MAX_CLIMB = 10;

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SELECT', 'TEXTAREA', 'OPTION',
  'SVG', 'PATH', 'HEAD', 'IFRAME', 'CANVAS',
]);

/** A quick pre-filter so the walker skips most text without running the parser. */
const LOOKS_LIKE_PRICE = /[$€£¥₹₩₽₺₪₱฿₫₴¢]|\d[.,]\d{2}(?!\d)/;

/** Money that is describing something other than this item's shelf price. */
const NOISE_CONTEXT = /\b(shipping|delivery|postage|save|savings|off\b|coupon|rebate|credit|per\s*month|\/\s*mo\b|monthly|instal?ments?|deposit|fee|tax|gift card|was\b|list price|rrp|reg\.|regular price|compare at|value of|trade[- ]in|financ)/i;

/** `$0.42/oz` and `$1.20 per 100 g` are unit prices, not the item's price. */
const UNIT_PRICE_SUFFIX = new RegExp(
  String.raw`^\s*[)\]]?\s*(?:\/|per\b|an?\b|each\b)\s*(?:\d+(?:[.,]\d+)?\s*)?(?:${UNIT_ALIAS_PATTERN})\b`,
  'i',
);

const TITLE_SELECTOR = 'a[href], h1, h2, h3, h4, [role="heading"], [data-testid*="title" i], [class*="title" i], [class*="name" i]';

interface PriceHit {
  element: HTMLElement;
  match: MoneyMatch;
  /** Text immediately after the match, used to spot unit prices. */
  trailing: string;
  /** Text around the match, used to spot noise. */
  context: string;
  isStruck: boolean;
  isUnitPrice: boolean;
  fontSize: number;
}

function isSkippableElement(element: Element): boolean {
  if (SKIP_TAGS.has(element.tagName)) return true;
  if (element.getAttribute('aria-hidden') === 'true') return true;
  if (element.hasAttribute('data-ppd-overlay')) return true;
  return false;
}

function hasSkippableAncestor(element: HTMLElement | null): boolean {
  let current: Element | null = element;
  for (let depth = 0; current && depth < 20; depth += 1) {
    if (isSkippableElement(current)) return true;
    current = current.parentElement;
  }
  return false;
}

function isStruckThrough(element: HTMLElement, view: Window): boolean {
  let current: HTMLElement | null = element;
  for (let depth = 0; current && depth < 4; depth += 1) {
    if (current.tagName === 'DEL' || current.tagName === 'S' || current.tagName === 'STRIKE') return true;
    current = current.parentElement;
  }
  try {
    const decoration = view.getComputedStyle(element).textDecorationLine;
    if (decoration && decoration.includes('line-through')) return true;
  } catch {
    // Detached or cross-origin nodes cannot be styled; treat as not struck.
  }
  return false;
}

function fontSizeOf(element: HTMLElement, view: Window): number {
  try {
    return Number.parseFloat(view.getComputedStyle(element).fontSize) || 0;
  } catch {
    return 0;
  }
}

function hasRenderedBox(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/** Text of `element` that is not inside a nested price-bearing descendant. */
function shortText(element: Element, limit = 400): string {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function collectPriceHits(context: ExtractContext): PriceHit[] {
  const doc = context.document;
  const view = doc.defaultView ?? globalThis.window;
  const root = doc.body;
  if (!root || !view) return [];

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node) {
      const text = node.nodeValue;
      if (!text || text.length > 400 || !LOOKS_LIKE_PRICE.test(text)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const hits: PriceHit[] = [];
  let seen = 0;
  let node: Node | null;
  while ((node = walker.nextNode()) !== null) {
    seen += 1;
    if (seen > MAX_TEXT_NODES) break;
    const element = node.parentElement;
    if (!element || hasSkippableAncestor(element)) continue;

    const text = node.nodeValue ?? '';
    const matches = findMoney(text, { currency: context.currencyHint });
    if (matches.length === 0) continue;

    const struck = isStruckThrough(element, view);
    const size = fontSizeOf(element, view);
    for (const match of matches) {
      const trailing = text.slice(match.index + match.length, match.index + match.length + 40);
      const start = Math.max(0, match.index - 40);
      hits.push({
        element,
        match,
        trailing,
        context: text.slice(start, match.index + match.length + 40),
        isStruck: struck,
        isUnitPrice: UNIT_PRICE_SUFFIX.test(trailing),
        fontSize: size,
      });
    }
  }
  return hits;
}

function classSignature(element: Element): string {
  return Array.from(element.classList).sort().join(' ');
}

/** Does this element sit in a run of structurally identical siblings? */
function hasRepeatedSiblings(element: HTMLElement): boolean {
  const parent = element.parentElement;
  if (!parent) return false;
  const siblings = Array.from(parent.children);
  if (siblings.length < 2) return false;
  const signature = classSignature(element);
  let alike = 0;
  for (const sibling of siblings) {
    if (sibling.tagName !== element.tagName) continue;
    if (signature && classSignature(sibling) !== signature) continue;
    alike += 1;
  }
  return alike >= 2;
}

function hasTitleCandidate(element: HTMLElement): boolean {
  const candidate = element.querySelector(TITLE_SELECTOR);
  if (candidate && shortText(candidate).length >= 8) return true;
  const image = element.querySelector('img[alt]');
  return !!image && (image.getAttribute('alt') ?? '').trim().length >= 8;
}

/**
 * Climb from a price to the element that behaves like a product card.
 *
 * A card is the first ancestor that contains a plausible title; if that
 * ancestor also sits in a run of identical siblings it is almost certainly a
 * grid cell, and the climb stops immediately.
 */
function findCard(priceElement: HTMLElement, root: HTMLElement): HTMLElement {
  let current: HTMLElement = priceElement;
  let fallback: HTMLElement | null = null;

  for (let depth = 0; depth < MAX_CLIMB; depth += 1) {
    const parent = current.parentElement;
    if (!parent || parent === root) break;
    current = parent;
    if (!hasTitleCandidate(current)) continue;
    fallback ??= current;
    if (hasRepeatedSiblings(current)) return current;
  }
  return fallback ?? priceElement.parentElement ?? priceElement;
}

/** Remove cards that contain other cards, so a grid never counts as one item. */
function dropContainerCards(cards: HTMLElement[]): HTMLElement[] {
  return cards.filter((card) => !cards.some((other) => other !== card && card.contains(other)));
}

function pickTitle(card: HTMLElement): string {
  const candidates: string[] = [];
  for (const element of Array.from(card.querySelectorAll(TITLE_SELECTOR))) {
    const text = shortText(element, 200);
    if (text.length >= 8 && !findMoney(text).length) candidates.push(text);
  }
  const image = card.querySelector('img[alt]');
  const alt = (image?.getAttribute('alt') ?? '').trim();
  if (alt.length >= 8) candidates.push(alt);
  const aria = (card.getAttribute('aria-label') ?? '').trim();
  if (aria.length >= 8) candidates.push(aria);

  // Prefer a real product name: long enough to identify, short enough not to be
  // the whole card's text swept up by a wrapper link.
  const scored = candidates
    .map((text) => ({ text, score: text.length >= 15 && text.length <= 140 ? 2 : 1 }))
    .sort((a, b) => b.score - a.score || a.text.length - b.text.length);
  return scored[0]?.text ?? shortText(card, 120);
}

interface PriceChoice {
  match: MoneyMatch;
  anchor: HTMLElement;
  isRange: boolean;
  siteUnitPrice?: string;
}

/**
 * Choose the price a card is actually asking for.
 *
 * Struck-through prices, unit prices and financing or shipping figures are
 * discarded first; of what remains the lowest is taken, which lands on the sale
 * price when a "was / now" pair is shown without any markup to distinguish them.
 */
function pickPrice(hits: PriceHit[]): PriceChoice | null {
  const unitPriceHit = hits.find((hit) => hit.isUnitPrice);
  const usable = hits.filter((hit) => !hit.isStruck && !hit.isUnitPrice && !NOISE_CONTEXT.test(hit.context));
  const pool = usable.length > 0 ? usable : hits.filter((hit) => !hit.isUnitPrice);
  if (pool.length === 0) return null;

  const sorted = [...pool].sort((a, b) => a.match.amount - b.match.amount);
  const chosen = sorted[0];
  if (!chosen) return null;

  const distinct = new Set(pool.map((hit) => hit.match.amount));
  return {
    match: chosen.match,
    anchor: chosen.element,
    isRange: distinct.size > 1 && pool.some((hit) => /[-–—]\s*$/.test(hit.context.slice(0, 40))),
    ...(unitPriceHit ? { siteUnitPrice: `${unitPriceHit.match.raw}${unitPriceHit.trailing.split(/[)\]]/)[0] ?? ''}`.trim() } : {}),
  };
}

/** Read every product the page renders, using structure alone. */
export function extractHeuristic(context: ExtractContext): RawItem[] {
  const root = context.document.body;
  if (!root) return [];

  const hits = collectPriceHits(context);
  if (hits.length === 0) return [];

  const cardCache = new Map<HTMLElement, HTMLElement>();
  const byCard = new Map<HTMLElement, PriceHit[]>();
  for (const hit of hits) {
    let card = cardCache.get(hit.element);
    if (!card) {
      card = findCard(hit.element, root);
      cardCache.set(hit.element, card);
    }
    const list = byCard.get(card) ?? [];
    list.push(hit);
    byCard.set(card, list);
  }

  const cards = dropContainerCards([...byCard.keys()]).slice(0, MAX_CARDS);
  const out: RawItem[] = [];

  for (const card of cards) {
    if (!hasRenderedBox(card)) continue;
    const cardHits = byCard.get(card) ?? [];
    const choice = pickPrice(cardHits);
    if (!choice || choice.match.amount <= 0) continue;

    const title = pickTitle(card);
    if (!title) continue;

    // The title usually carries the size; when it does not, the rest of the
    // card text is the next best source once its prices are blanked out.
    let quantity = parseQuantity(title, { system: context.system });
    let sizeText = title;
    if (!quantity) {
      sizeText = stripPrices(shortText(card, 400));
      quantity = parseQuantity(sizeText, { system: context.system, removePrices: false });
    }

    const link = card.matches('a[href]') ? card : card.querySelector<HTMLAnchorElement>('a[href]');
    const image = card.querySelector<HTMLImageElement>('img[src]');

    out.push({
      title,
      price: { amount: choice.match.amount, currency: choice.match.currency, raw: choice.match.raw },
      sizeText,
      quantity,
      ...(link instanceof HTMLAnchorElement && link.href ? { url: link.href } : {}),
      ...(image?.src ? { imageUrl: image.src } : {}),
      source: 'heuristic',
      element: card,
      anchor: choice.anchor,
      ...(choice.siteUnitPrice ? { siteUnitPrice: choice.siteUnitPrice } : {}),
      priceIsRange: choice.isRange,
      precedence: PRECEDENCE.heuristic,
    });
  }

  return out;
}
