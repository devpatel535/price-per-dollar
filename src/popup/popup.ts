import type { ItemGroup, NormalizedItem, ScanSummary } from '../core/types.ts';
import type { ScanResponse } from '../shared/messaging.ts';
import {
  CONTENT_SCRIPT_FILE, isInjectableUrl, isRestrictedUrl, sendToTab,
} from '../shared/messaging.ts';
import { loadSettings, saveSettings, type Settings } from '../shared/settings.ts';
import {
  analyseValue, renderAnalysisMarkdown, toComparisonOption, type ComparisonOption,
} from '../core/compare.ts';
import {
  formatCurrency, formatMeasure, formatMultiplier, measureToInputValue, pluralise,
} from '../core/format.ts';
import { UNITS, resolveUnit, toBase } from '../core/units.ts';
import { buildAnalysisBody } from '../ui/analysis.ts';
import { copyText, el } from '../ui/dom.ts';

/**
 * Popup controller.
 *
 * Three tabs over one shared engine: what was found on the page, a manual
 * calculator for when a page cannot be read (or you are standing in a shop),
 * and the settings that govern both.
 */

const $ = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element: ${id}`);
  return node as T;
};

/** Units offered in the calculator, in the order shoppers think of them. */
const CALCULATOR_UNITS = ['g', 'kg', 'oz', 'lb', 'ml', 'l', 'fl_oz_us', 'gal_us', 'ct'];

let settings: Settings | null = null;
let activeTabId: number | null = null;
let activeHost = '';
let lastSummary: ScanSummary | null = null;

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

function showTab(name: string): void {
  for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('.tab-button'))) {
    button.classList.toggle('is-active', button.dataset['tab'] === name);
  }
  for (const panel of Array.from(document.querySelectorAll<HTMLElement>('.panel-tab'))) {
    panel.classList.toggle('is-hidden', panel.id !== `panel-${name}`);
  }
}

// ---------------------------------------------------------------------------
// Page scan
// ---------------------------------------------------------------------------

function setStatus(text: string, isError = false): void {
  const status = $('scan-status');
  status.textContent = text;
  status.classList.toggle('error', isError);
}

function memberRow(member: NormalizedItem, group: ItemGroup, currency: string): HTMLElement {
  const isBest = group.best.item.id === member.item.id;
  const row = el('div', `row${isBest ? ' best' : ''}`);

  const name = el('button', 'name', member.item.title.slice(0, 90));
  name.type = 'button';
  name.title = 'Scroll to this item on the page';
  name.addEventListener('click', () => {
    if (activeTabId !== null) void sendToTab(activeTabId, { type: 'PPD_FOCUS_ITEM', itemId: member.item.id });
  });
  if (isBest && group.members.length > 1) name.appendChild(el('span', 'badge-best', 'Best'));
  row.appendChild(name);

  const rate = member.pricePerBase * group.display.factor;
  row.appendChild(el('div', 'rate', `${formatCurrency(rate, currency)} / ${group.display.label}`));

  const unitWord = group.display.dimension === 'count'
    ? pluralise(group.display.label, member.basePerCurrencyUnit)
    : group.display.baseLabel;
  const meta = el('div', 'meta');
  meta.append(
    `${formatCurrency(member.item.price.amount, currency)} · `
    + `${formatCurrency(1, currency)} = ${formatMeasure(member.basePerCurrencyUnit)} ${unitWord}`,
  );
  if (!isBest && group.best.pricePerBase > 0) {
    meta.append(` · ${formatMultiplier(member.pricePerBase / group.best.pricePerBase)} the best rate`);
  }
  if (group.members.length > 1) {
    const compare = el('button', 'ghost compare', isBest ? 'Compare' : 'Compare with best');
    compare.type = 'button';
    compare.addEventListener('click', () => {
      const other = isBest
        ? group.members.find((candidate) => candidate.item.id !== member.item.id)
        : group.best;
      if (other) prefillCalculator(toComparisonOption(member), toComparisonOption(other), group);
    });
    meta.appendChild(compare);
  }
  row.appendChild(meta);
  return row;
}

function renderSummary(summary: ScanSummary): void {
  lastSummary = summary;
  const container = $('scan-results');
  container.textContent = '';

  const ranked = summary.groups.reduce((total, group) => total + group.members.length, 0);
  if (ranked === 0) {
    setStatus(summary.items.length > 0
      ? `Found ${summary.items.length} price${summary.items.length === 1 ? '' : 's'}, but no sizes to rank them by.`
      : 'No product prices found on this page.');
    const empty = el('div', 'empty');
    empty.append(
      'Nothing to rank here. Try a category or search results page, ',
      'or use the calculator tab to compare two options by hand.',
    );
    container.appendChild(empty);
    return;
  }

  const scope = summary.mode === 'smart' ? 'grouped by product' : 'ranked across the page';
  setStatus(`${ranked} item${ranked === 1 ? '' : 's'} ${scope}`
    + (summary.unsizedCount > 0 ? ` · ${summary.unsizedCount} without a readable size` : ''));

  for (const group of summary.groups) {
    const section = el('section', 'group');
    const heading = el('h2');
    heading.append(group.label, el('span', 'unit', `per ${group.display.label}`));
    section.appendChild(heading);
    for (const member of group.members) {
      section.appendChild(memberRow(member, group, summary.currency));
    }
    container.appendChild(section);
  }
}

/** Say what actually went wrong when the scanner could not be injected. */
function explainInjectionFailure(url: string | undefined): string {
  if (url && isRestrictedUrl(url)) {
    return 'Chrome does not allow extensions to run on this page.';
  }
  if (url && !isInjectableUrl(url)) {
    return 'Price Per Dollar only works on ordinary web pages.';
  }
  return 'Chrome blocked access to this page. Open Price Per Dollar from the '
    + 'toolbar icon, or use "Always run here" in Settings to grant this site access.';
}

async function runScan(): Promise<void> {
  setStatus('Scanning this page…');
  $('scan-results').textContent = '';

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    setStatus('No active tab to scan.', true);
    return;
  }
  activeTabId = tab.id;
  try {
    activeHost = tab.url ? new URL(tab.url).hostname : '';
  } catch {
    activeHost = '';
  }
  renderSiteControls();

  // Chrome hides `tab.url` until the extension has been invoked, so a missing
  // URL says nothing about whether the page can be scanned. Only refuse when
  // we can see the URL and know it is off-limits; otherwise just try, and let
  // the failure explain itself.
  if (tab.url && !isInjectableUrl(tab.url)) {
    setStatus(explainInjectionFailure(tab.url), true);
    return;
  }

  try {
    // Opening the popup grants `activeTab` for this tab, which is what lets
    // this injection succeed without any host permission.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [CONTENT_SCRIPT_FILE] });
  } catch (error) {
    setStatus(explainInjectionFailure(tab.url), true);
    console.warn('[Price Per Dollar] injection failed', error);
    return;
  }

  const response = await sendToTab<ScanResponse>(tab.id, { type: 'PPD_SCAN' });
  if (!response) {
    setStatus('The page did not respond. Try reloading it.', true);
    return;
  }
  if (!response.ok) {
    setStatus(response.error, true);
    return;
  }
  renderSummary(response.summary);
}

// ---------------------------------------------------------------------------
// Calculator
// ---------------------------------------------------------------------------

function populateUnitSelect(select: HTMLSelectElement): void {
  select.appendChild(new Option('— no size —', ''));
  for (const id of CALCULATOR_UNITS) {
    const unit = UNITS.find((candidate) => candidate.id === id);
    if (unit) select.appendChild(new Option(`${unit.label} (${unit.dimension})`, unit.id));
  }
}

function readOption(prefix: 'bulk' | 'single'): ComparisonOption {
  const label = $<HTMLInputElement>(`${prefix}-label`).value.trim() || (prefix === 'bulk' ? 'Bulk case' : 'Single item');
  const totalPrice = Number($<HTMLInputElement>(`${prefix}-price`).value);
  const unitsInPack = Number($<HTMLInputElement>(`${prefix}-units`).value);
  const sizeValue = Number($<HTMLInputElement>(`${prefix}-size`).value);
  const unitId = $<HTMLSelectElement>(`${prefix}-unit`).value;
  const unit = unitId ? UNITS.find((candidate) => candidate.id === unitId) : undefined;

  const option: ComparisonOption = { label, totalPrice, unitsInPack };
  if (unit && Number.isFinite(sizeValue) && sizeValue > 0 && Number.isFinite(unitsInPack) && unitsInPack > 0) {
    option.baseTotal = toBase(sizeValue, unit) * unitsInPack;
    option.dimension = unit.dimension;
  }
  return option;
}

function renderCalculator(): void {
  const output = $('calculator-output');
  output.textContent = '';

  const bulk = readOption('bulk');
  const single = readOption('single');
  const currency = lastSummary?.currency ?? 'USD';
  const result = analyseValue(bulk, single, currency);

  if (!result.ok) {
    const list = el('ul');
    for (const error of result.errors) list.appendChild(el('li', undefined, error));
    output.append(el('p', 'status error', 'Cannot compare these yet:'), list);
    return;
  }
  output.appendChild(buildAnalysisBody(result.analysis));
}

/** Load a page comparison into the calculator and switch to it. */
function prefillCalculator(a: ComparisonOption, b: ComparisonOption, group: ItemGroup): void {
  const [bulk, single] = (a.baseTotal ?? 0) >= (b.baseTotal ?? 0) ? [a, b] : [b, a];

  const apply = (prefix: 'bulk' | 'single', option: ComparisonOption): void => {
    $<HTMLInputElement>(`${prefix}-label`).value = option.label.slice(0, 60);
    $<HTMLInputElement>(`${prefix}-price`).value = String(option.totalPrice);
    $<HTMLInputElement>(`${prefix}-units`).value = String(option.unitsInPack);

    const select = $<HTMLSelectElement>(`${prefix}-unit`);
    const sizeInput = $<HTMLInputElement>(`${prefix}-size`);
    if (option.baseTotal && option.dimension) {
      // Offer the size in the group's own display unit rather than raw base units.
      const unit = resolveUnit(group.display.dimension === 'count' ? 'ct' : group.display.baseLabel)
        ?? UNITS.find((candidate) => candidate.dimension === option.dimension);
      if (unit && CALCULATOR_UNITS.includes(unit.id)) {
        select.value = unit.id;
        sizeInput.value = measureToInputValue(option.baseTotal / unit.factor / option.unitsInPack);
        return;
      }
    }
    select.value = '';
    sizeInput.value = '';
  };

  apply('bulk', bulk);
  apply('single', single);
  renderCalculator();
  showTab('calculator');
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function renderSiteControls(): void {
  if (!settings) return;
  const host = activeHost.replace(/^www\./, '');
  $('site-name').textContent = host ? `On ${host}` : 'No site detected';

  const disabled = settings.disabledHosts.includes(host);
  const toggle = $<HTMLButtonElement>('site-toggle');
  toggle.textContent = disabled ? 'Enable here' : 'Disable here';
  toggle.disabled = !host;

  const auto = $<HTMLButtonElement>('site-auto');
  auto.disabled = !host;
  void chrome.permissions.contains({ origins: [`*://${host}/*`] }).then((granted) => {
    auto.textContent = granted ? 'Stop running automatically' : 'Always run here';
    auto.dataset['granted'] = granted ? 'yes' : 'no';
  }).catch(() => undefined);

  $('site-hint').textContent = disabled
    ? 'Price Per Dollar will not scan this site.'
    : 'Granting a site permanent access lets the extension run without opening this popup.';
}

function renderSettings(): void {
  if (!settings) return;
  $<HTMLInputElement>('set-badges').checked = settings.showBadges;
  $<HTMLInputElement>('set-highlight').checked = settings.highlightBest;
  $<HTMLInputElement>('set-summary').checked = settings.showSummary;
  $<HTMLSelectElement>('set-mode').value = settings.mode;
  $<HTMLInputElement>('set-threshold').value = String(settings.similarityThreshold);
  $<HTMLSelectElement>('set-system').value = settings.measurementSystem;
  $('set-threshold-value').textContent =
    `${Math.round(settings.similarityThreshold * 100)}% — ${settings.similarityThreshold >= 0.55 ? 'tighter groups' : 'broader groups'}`;
  renderSiteControls();
}

async function applySettings(patch: Partial<Settings>): Promise<void> {
  settings = await saveSettings(patch);
  renderSettings();
  if (activeTabId !== null) {
    const response = await sendToTab<ScanResponse>(activeTabId, { type: 'PPD_APPLY_SETTINGS', settings });
    if (response?.ok) renderSummary(response.summary);
  }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function wire(): void {
  for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('.tab-button'))) {
    button.addEventListener('click', () => showTab(button.dataset['tab'] ?? 'scan'));
  }
  $('rescan').addEventListener('click', () => void runScan());

  populateUnitSelect($<HTMLSelectElement>('bulk-unit'));
  populateUnitSelect($<HTMLSelectElement>('single-unit'));
  $<HTMLSelectElement>('bulk-unit').value = 'fl_oz_us';
  $<HTMLSelectElement>('single-unit').value = 'fl_oz_us';

  for (const id of ['bulk-label', 'bulk-price', 'bulk-units', 'bulk-size', 'bulk-unit',
    'single-label', 'single-price', 'single-units', 'single-size', 'single-unit']) {
    $(id).addEventListener('input', renderCalculator);
    $(id).addEventListener('change', renderCalculator);
  }

  $('calculator-copy').addEventListener('click', () => {
    const result = analyseValue(readOption('bulk'), readOption('single'), lastSummary?.currency ?? 'USD');
    if (!result.ok) return;
    const button = $<HTMLButtonElement>('calculator-copy');
    void copyText(renderAnalysisMarkdown(result.analysis)).then((ok) => {
      button.textContent = ok ? 'Copied' : 'Copy failed';
      window.setTimeout(() => { button.textContent = 'Copy report'; }, 1600);
    });
  });

  $('set-badges').addEventListener('change', (event) => {
    void applySettings({ showBadges: (event.target as HTMLInputElement).checked });
  });
  $('set-highlight').addEventListener('change', (event) => {
    void applySettings({ highlightBest: (event.target as HTMLInputElement).checked });
  });
  $('set-summary').addEventListener('change', (event) => {
    void applySettings({ showSummary: (event.target as HTMLInputElement).checked });
  });
  $('set-mode').addEventListener('change', (event) => {
    void applySettings({ mode: (event.target as HTMLSelectElement).value === 'page' ? 'page' : 'smart' });
  });
  $('set-threshold').addEventListener('change', (event) => {
    void applySettings({ similarityThreshold: Number((event.target as HTMLInputElement).value) });
  });
  $('set-system').addEventListener('change', (event) => {
    const value = (event.target as HTMLSelectElement).value;
    void applySettings({
      measurementSystem: value === 'US' || value === 'IMPERIAL' ? value : 'auto',
    });
  });

  $('site-toggle').addEventListener('click', () => {
    if (!settings || !activeHost) return;
    const host = activeHost.replace(/^www\./, '');
    const disabled = settings.disabledHosts.includes(host);
    const next = disabled
      ? settings.disabledHosts.filter((entry) => entry !== host)
      : [...settings.disabledHosts, host];
    void applySettings({ disabledHosts: next });
  });

  $('site-auto').addEventListener('click', () => {
    const host = activeHost.replace(/^www\./, '');
    if (!host) return;
    const origins = [`*://${host}/*`, `*://www.${host}/*`];
    const button = $<HTMLButtonElement>('site-auto');
    const granted = button.dataset['granted'] === 'yes';
    const request = granted
      ? chrome.permissions.remove({ origins })
      : chrome.permissions.request({ origins });
    void request.then(() => renderSiteControls()).catch(() => undefined);
  });
}

async function init(): Promise<void> {
  wire();
  settings = await loadSettings();
  renderSettings();
  renderCalculator();
  await runScan();
}

void init();
