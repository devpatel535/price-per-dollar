/** Tiny DOM helpers shared by the overlay and the popup. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Copy text, falling back to a hidden textarea where the async API is blocked. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function buildTable(headers: string[], rows: string[][]): HTMLTableElement {
  const table = el('table');
  const thead = el('thead');
  const headRow = el('tr');
  for (const header of headers) headRow.appendChild(el('th', undefined, header));
  thead.appendChild(headRow);

  const tbody = el('tbody');
  for (const row of rows) {
    const tr = el('tr');
    row.forEach((cell, index) => tr.appendChild(el('td', index === 0 ? 'name' : undefined, cell)));
    tbody.appendChild(tr);
  }
  table.append(thead, tbody);
  return table;
}
