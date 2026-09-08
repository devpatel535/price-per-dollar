import type { ExtractContext, RawItem } from '../types.ts';
import { PRECEDENCE } from '../types.ts';
import { findMoney } from '../../core/money.ts';
import { parseQuantity } from '../../core/quantity.ts';

/**
 * Retailer adapters.
 *
 * These are hints, not gospel. Large retailers redesign constantly, so an
 * adapter that stops matching simply contributes nothing and the generic
 * heuristic engine carries the page. Every selector list is tried in order and
 * the first that resolves wins, which keeps a single renamed class from taking
 * a whole site down.
 */

export interface Adapter {
  id: string;
  /** Hostnames this adapter applies to. */
  match: RegExp;
  /** Container for one product. */
  card: string[];
  title: string[];
  price: string[];
  /** Retailers that render the integer and decimal parts as separate nodes. */
  priceWhole?: string[];
  priceFraction?: string[];
  size?: string[];
  unitPrice?: string[];
  link?: string[];
}

export const ADAPTERS: Adapter[] = [
  {
    id: 'amazon',
    match: /(^|\.)amazon\.(com|co\.uk|ca|de|fr|es|it|com\.au|co\.jp|in|com\.mx|nl|se|pl|sg|ae)$/i,
    card: ['[data-component-type="s-search-result"]', 'div.s-result-item[data-asin]:not([data-asin=""])', '#dp-container'],
    title: ['h2 a span', 'h2 span', '#productTitle', '[data-cy="title-recipe"] span'],
    price: ['.a-price .a-offscreen', '#corePrice_feature_div .a-offscreen', '.a-color-price'],
    priceWhole: ['.a-price .a-price-whole'],
    priceFraction: ['.a-price .a-price-fraction'],
    size: ['#productTitle', 'h2 a span', '.a-size-base.a-color-secondary'],
    unitPrice: ['.a-price[data-a-size="b"] .a-offscreen', '.a-size-base.a-color-secondary .a-price .a-offscreen'],
    link: ['h2 a', 'a.a-link-normal'],
  },
  {
    id: 'walmart',
    match: /(^|\.)walmart\.(com|ca)$/i,
    card: ['[data-item-id]', '[data-testid="list-view"] > div', '[data-testid="item-stack"] > div'],
    title: ['[data-automation-id="product-title"]', 'span[data-automation-id="product-title"]', 'a span.w_iUH7'],
    price: ['[data-automation-id="product-price"] .f2', '[itemprop="price"]', '[data-automation-id="product-price"]'],
    size: ['[data-automation-id="product-title"]'],
    unitPrice: ['[data-automation-id="product-price"] .gray'],
    link: ['a[link-identifier]', 'a[href*="/ip/"]'],
  },
  {
    id: 'target',
    match: /(^|\.)target\.com$/i,
    card: ['[data-test="@web/site-top-of-funnel/ProductCardWrapper"]', '[data-test="product-card"]', '[data-test="product-details"]'],
    title: ['[data-test="product-title"]', 'a[data-test="product-title"]'],
    price: ['[data-test="current-price"]', '[data-test="product-price"]'],
    size: ['[data-test="product-title"]'],
    unitPrice: ['[data-test="unit-price"]'],
    link: ['a[data-test="product-title"]', 'a[href*="/p/"]'],
  },
  {
    id: 'costco',
    match: /(^|\.)costco\.(com|ca|co\.uk)$/i,
    card: ['.product-tile-set', '[automation-id="productList"] > div', '#product-page-container'],
    title: ['.description a', '.product-title', 'h1[automation-id="productName"]'],
    price: ['.price', '.your-price .value', '[automation-id="itemPriceOutput"]'],
    size: ['.description a', '.product-title'],
    link: ['.description a', 'a[href*="product"]'],
  },
  {
    id: 'samsclub',
    match: /(^|\.)samsclub\.com$/i,
    card: ['[data-testid="ProductCard"]', '.sc-pc-rail-item'],
    title: ['[data-testid="ProductCard-title"]', '.sc-title'],
    price: ['[data-testid="ProductCard-price"]', '.Price-characteristic'],
    size: ['[data-testid="ProductCard-title"]'],
    link: ['a[href*="/p/"]'],
  },
  {
    id: 'kroger',
    match: /(^|\.)(kroger|ralphs|fredmeyer|kingsoopers|smithsfoodanddrug|frysfood|qfc)\.com$/i,
    card: ['[data-testid="product-card"]', '.ProductCard', '.kds-Card'],
    title: ['[data-testid="cart-page-item-description"]', '.kds-Text--l', 'a[data-testid="product-card-link"]'],
    price: ['[data-testid="cart-page-item-price"]', '.kds-Price-promotional', '.kds-Price-original'],
    size: ['.kds-Text--s', '[data-testid="cart-page-item-sizing"]'],
    unitPrice: ['[data-testid="cart-page-item-unit-price"]'],
    link: ['a[data-testid="product-card-link"]', 'a[href*="/p/"]'],
  },
  {
    id: 'bestbuy',
    match: /(^|\.)bestbuy\.(com|ca)$/i,
    card: ['li.sku-item', '.shop-sku-list-item', '.sku-title'],
    title: ['.sku-title a', 'h4.sku-title', 'h1.heading-5'],
    price: ['[data-testid="customer-price"]', '.priceView-customer-price span', '.priceView-hero-price span'],
    size: ['.sku-title a'],
    link: ['.sku-title a', 'a[href*="/site/"]'],
  },
  {
    id: 'instacart',
    match: /(^|\.)instacart\.(com|ca)$/i,
    card: ['[data-testid="item-card"]', 'li[data-testid*="item"]'],
    title: ['[data-testid="item-name"]', 'h3'],
    price: ['[data-testid="item-price"]', '.e-1ip314g'],
    size: ['[data-testid="item-size"]', '[data-testid="item-name"]'],
    link: ['a[href*="/products/"]'],
  },
  {
    id: 'tesco',
    match: /(^|\.)tesco\.com$/i,
    card: ['.product-list--list-item', '[data-testid="product-tile"]'],
    title: ['[data-testid="linkProductTitle"]', 'h3 a', '.product-details--wrapper h3'],
    price: ['.value', '[data-testid="price-details"] .text__StyledText-sc-1jpzi8m-0'],
    size: ['[data-testid="linkProductTitle"]'],
    unitPrice: ['.price-per-quantity-weight'],
    link: ['a[href*="/products/"]'],
  },
  {
    id: 'sainsburys',
    match: /(^|\.)sainsburys\.co\.uk$/i,
    card: ['.pt-grid-item', '[data-testid="product-tile"]'],
    title: ['.pt__link', '[data-testid="product-tile-description"]'],
    price: ['.pt__cost--price', '[data-testid="pt-retail-price"]'],
    size: ['.pt__link'],
    unitPrice: ['.pt__cost--per-measure'],
    link: ['.pt__link'],
  },
];

export function adapterFor(hostname: string): Adapter | null {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  return ADAPTERS.find((adapter) => adapter.match.test(host)) ?? null;
}

function firstText(scope: Element, selectors: string[] | undefined): string {
  if (!selectors) return '';
  for (const selector of selectors) {
    let node: Element | null = null;
    try {
      node = scope.querySelector(selector);
    } catch {
      continue; // A selector the browser rejects should never break the scan.
    }
    if (!node) continue;
    const content = node.getAttribute('content');
    const text = (content ?? node.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text) return text;
  }
  return '';
}

function firstElement<T extends Element>(scope: Element, selectors: string[] | undefined): T | null {
  if (!selectors) return null;
  for (const selector of selectors) {
    try {
      const node = scope.querySelector<T>(selector);
      if (node) return node;
    } catch {
      continue;
    }
  }
  return null;
}

/** Read products using a hand-tuned selector map, when one matches this host. */
export function extractWithAdapter(context: ExtractContext): RawItem[] {
  const adapter = adapterFor(context.hostname);
  if (!adapter) return [];

  const cards: HTMLElement[] = [];
  for (const selector of adapter.card) {
    try {
      cards.push(...Array.from(context.document.querySelectorAll<HTMLElement>(selector)));
    } catch {
      continue;
    }
  }
  if (cards.length === 0) return [];

  const out: RawItem[] = [];
  const seen = new Set<HTMLElement>();

  for (const card of cards) {
    if (seen.has(card)) continue;
    seen.add(card);

    const title = firstText(card, adapter.title);
    if (!title) continue;

    let priceText = firstText(card, adapter.price);
    if (!priceText) {
      // Split integer/decimal markup, e.g. Amazon's `$` `24` `99`.
      const whole = firstText(card, adapter.priceWhole).replace(/[^\d]/g, '');
      const fraction = firstText(card, adapter.priceFraction).replace(/[^\d]/g, '');
      if (whole) priceText = fraction ? `${whole}.${fraction}` : whole;
    }
    if (!priceText) continue;

    const [price] = findMoney(priceText, { currency: context.currencyHint });
    if (!price || price.amount <= 0) continue;

    const sizeText = firstText(card, adapter.size) || title;
    const link = firstElement<HTMLAnchorElement>(card, adapter.link);
    const anchor = firstElement<HTMLElement>(card, adapter.price) ?? card;
    const unitPrice = firstText(card, adapter.unitPrice);

    out.push({
      title,
      price: { amount: price.amount, currency: price.currency, raw: price.raw },
      sizeText,
      quantity: parseQuantity(sizeText, { system: context.system })
        ?? parseQuantity(title, { system: context.system }),
      ...(link?.href ? { url: link.href } : {}),
      source: 'adapter',
      adapter: adapter.id,
      element: card,
      anchor,
      ...(unitPrice ? { siteUnitPrice: unitPrice } : {}),
      precedence: PRECEDENCE.adapter,
    });
  }

  return out;
}
