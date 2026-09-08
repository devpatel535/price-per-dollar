import type { ItemGroup, NormalizedItem, ScanSummary, ScannedItem } from '../core/types.ts';
import type { Settings } from '../shared/settings.ts';
import {
  analyseValue, renderAnalysisMarkdown, toComparisonOption, type ValueAnalysis,
} from '../core/compare.ts';
import { formatCurrency, formatMeasure, formatMultiplier, pluralise } from '../core/format.ts';
import { buildAnalysisBody } from '../ui/analysis.ts';
import { copyText, el } from '../ui/dom.ts';
import styles from './styles.css';

/**
 * The on-page overlay.
 *
 * Everything lives in one shadow root anchored at the document origin, so the
 * host page's CSS cannot reach in, our CSS cannot leak out, and no badge is
 * ever clipped by a card's own `overflow: hidden`.
 */

const OVERLAY_ATTRIBUTE = 'data-ppd-overlay';
const MAX_BADGES = 250;
const REPOSITION_INTERVAL_MS = 120;

interface Placement {
  itemId: string;
  element: HTMLElement;
  node: HTMLDivElement;
  outline: HTMLDivElement | null;
}

export interface BadgeController {
  render(summary: ScanSummary, scanned: ScannedItem[], settings: Settings): void;
  focus(itemId: string): void;
  clear(): void;
  destroy(): void;
}

export function createBadgeController(): BadgeController {
  const host = el('div');
  host.setAttribute(OVERLAY_ATTRIBUTE, '');
  host.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;';
  const shadow = host.attachShadow({ mode: 'open' });
  const sheet = document.createElement('style');
  sheet.textContent = styles;
  const layer = el('div', 'layer');
  shadow.append(sheet, layer);
  document.documentElement.appendChild(host);

  let placements: Placement[] = [];
  let panel: HTMLDivElement | null = null;
  let pill: HTMLDivElement | null = null;
  let currency = 'USD';
  let repositionTimer: number | null = null;
  let destroyed = false;

  /**
   * The overlay host sits at the document origin, but page margins can shift
   * it. Measuring it each time keeps badge coordinates exact.
   */
  function overlayOrigin(): { x: number; y: number } {
    const rect = host.getBoundingClientRect();
    return { x: rect.left + window.scrollX, y: rect.top + window.scrollY };
  }

  function position(): void {
    if (destroyed || placements.length === 0) return;
    const origin = overlayOrigin();
    for (const placement of placements) {
      const rect = placement.element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        placement.node.style.display = 'none';
        if (placement.outline) placement.outline.style.display = 'none';
        continue;
      }
      const top = rect.top + window.scrollY - origin.y;
      const left = rect.left + window.scrollX - origin.x;
      placement.node.style.display = '';
      placement.node.style.top = `${Math.round(top + 6)}px`;
      placement.node.style.left = `${Math.round(left + 6)}px`;
      if (placement.outline) {
        placement.outline.style.display = '';
        placement.outline.style.top = `${Math.round(top - 2)}px`;
        placement.outline.style.left = `${Math.round(left - 2)}px`;
        placement.outline.style.width = `${Math.round(rect.width)}px`;
        placement.outline.style.height = `${Math.round(rect.height)}px`;
      }
    }
  }

  function scheduleReposition(): void {
    if (repositionTimer !== null) return;
    repositionTimer = window.setTimeout(() => {
      repositionTimer = null;
      requestAnimationFrame(position);
    }, REPOSITION_INTERVAL_MS);
  }

  window.addEventListener('scroll', scheduleReposition, { passive: true, capture: true });
  window.addEventListener('resize', scheduleReposition, { passive: true });

  function closePanel(): void {
    panel?.remove();
    panel = null;
  }

  /** Show the three-section analysis in a floating panel. */
  function openPanel(analysis: ValueAnalysis, groupLabel: string): void {
    closePanel();
    panel = el('div', 'panel');

    const header = el('header');
    const heading = el('div');
    heading.append(el('h2', undefined, 'Value analysis'), el('p', undefined, groupLabel));
    const close = el('button', undefined, '×');
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', closePanel);
    header.append(heading, close);

    const body = el('div', 'body');
    body.appendChild(buildAnalysisBody(analysis));

    const footer = el('footer');
    const copy = el('button', 'primary', 'Copy report');
    copy.addEventListener('click', () => {
      void copyText(renderAnalysisMarkdown(analysis)).then((ok) => {
        copy.textContent = ok ? 'Copied' : 'Copy failed';
        window.setTimeout(() => { copy.textContent = 'Copy report'; }, 1600);
      });
    });
    const dismiss = el('button', undefined, 'Close');
    dismiss.addEventListener('click', closePanel);
    footer.append(copy, dismiss);

    panel.append(header, body, footer);
    layer.appendChild(panel);
  }

  function badgeFor(member: NormalizedItem, group: ItemGroup, settings: Settings): HTMLDivElement {
    const isBest = group.best.item.id === member.item.id;
    const isWorst = !!group.worst && group.worst.item.id === member.item.id && group.members.length > 2;
    const node = el('div', `badge${isBest ? ' best' : ''}${isWorst ? ' worst' : ''}`);
    node.tabIndex = 0;
    node.setAttribute('role', 'button');

    const rate = member.pricePerBase * group.display.factor;
    node.appendChild(el('div', 'rate', `${formatCurrency(rate, currency)} / ${group.display.label}`));

    const perDollar = member.basePerCurrencyUnit;
    const unitWord = group.display.dimension === 'count'
      ? pluralise(group.display.label, perDollar)
      : group.display.baseLabel;
    node.appendChild(el('div', 'per-dollar',
      `${formatCurrency(1, currency)} = ${formatMeasure(perDollar)} ${unitWord}`));

    if (group.members.length > 1) {
      const ratio = group.best.pricePerBase > 0 ? member.pricePerBase / group.best.pricePerBase : 1;
      node.appendChild(el('div', 'tag', isBest ? 'Best value' : `${formatMultiplier(ratio)} the best rate`));
    }

    const openComparison = (): void => {
      // Comparing the best item against itself says nothing, so it is measured
      // against the next member of its group instead.
      const other = isBest
        ? group.members.find((candidate) => candidate.item.id !== member.item.id)
        : group.best;
      if (!other) return;
      const result = analyseValue(toComparisonOption(member), toComparisonOption(other), currency);
      if (result.ok) openPanel(result.analysis, group.label);
    };

    node.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openComparison();
    });
    node.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openComparison();
      }
    });

    if (settings.highlightBest && isBest && group.members.length > 1) {
      node.title = 'Best value per unit in this group';
    }
    return node;
  }

  function buildPill(summary: ScanSummary): void {
    pill?.remove();
    pill = null;
    const ranked = summary.groups.reduce((total, group) => total + group.members.length, 0);
    if (ranked === 0) return;

    pill = el('div', 'pill');
    pill.appendChild(el('div', 'mark', '$'));

    const comparableGroup = summary.groups.find((group) => group.members.length > 1);
    const best = comparableGroup?.best;
    const text = el('div', 'text');
    if (best && comparableGroup) {
      const rate = formatCurrency(best.pricePerBase * comparableGroup.display.factor, currency);
      text.append(
        el('b', undefined, String(ranked)),
        ` ranked · best: ${best.item.title.slice(0, 40)} (${rate} / ${comparableGroup.display.label})`,
      );
    } else {
      text.append(el('b', undefined, String(ranked)), ` item${ranked === 1 ? '' : 's'} ranked on this page`);
    }
    pill.appendChild(text);

    if (best) {
      const jump = el('button', undefined, 'Show');
      jump.addEventListener('click', () => focus(best.item.id));
      pill.appendChild(jump);
    }
    const hide = el('button', undefined, 'Hide');
    hide.addEventListener('click', () => { pill?.remove(); pill = null; });
    pill.appendChild(hide);

    layer.appendChild(pill);
  }

  function clear(): void {
    for (const placement of placements) {
      placement.node.remove();
      placement.outline?.remove();
    }
    placements = [];
    closePanel();
    pill?.remove();
    pill = null;
  }

  function focus(itemId: string): void {
    const placement = placements.find((candidate) => candidate.itemId === itemId);
    if (!placement) return;
    placement.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    placement.node.animate?.(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }],
      { duration: 620, easing: 'ease-in-out' },
    );
    window.setTimeout(position, 400);
  }

  function render(summary: ScanSummary, scanned: ScannedItem[], settings: Settings): void {
    clear();
    currency = summary.currency;

    if (settings.showBadges) {
      const byId = new Map(scanned.map((item) => [item.id, item]));
      let drawn = 0;

      for (const group of summary.groups) {
        for (const member of group.members) {
          if (drawn >= MAX_BADGES) break;
          const target = byId.get(member.item.id);
          if (!target) continue;

          const node = badgeFor(member, group, settings);
          layer.appendChild(node);

          let outline: HTMLDivElement | null = null;
          const isBest = group.best.item.id === member.item.id;
          if (settings.highlightBest && isBest && group.members.length > 1) {
            outline = el('div', 'outline');
            layer.appendChild(outline);
          }

          placements.push({ itemId: member.item.id, element: target.element, node, outline });
          drawn += 1;
        }
      }
    }

    if (settings.showSummary) buildPill(summary);
    position();
  }

  function destroy(): void {
    destroyed = true;
    clear();
    window.removeEventListener('scroll', scheduleReposition, true);
    window.removeEventListener('resize', scheduleReposition);
    host.remove();
  }

  return { render, focus, clear, destroy };
}
