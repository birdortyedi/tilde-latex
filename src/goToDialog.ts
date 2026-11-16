import type { Hit, HitKind } from './goTo';

// The "Go to anything" box (Ctrl/Cmd+K): type, move with the arrow keys,
// Enter goes there. The search itself is in goTo.ts.

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`index.html is missing ${selector}`);
  return found;
}

const dialog = element<HTMLDialogElement>('#goto-dialog');
const input = element<HTMLInputElement>('#goto-input');
const list = element<HTMLUListElement>('#goto-results');

const GROUP: Record<HitKind, string> = { file: 'Files', heading: 'Headings', label: 'Labels', citation: 'Citations', text: 'Text' };

let hits: Hit[] = [];
let chosen = 0;
let search: (typed: string) => Hit[] = () => [];
let go: (hit: Hit) => void = () => {};

function render(): void {
  const rows: HTMLElement[] = [];
  hits.forEach((hit, index) => {
    if (hit.kind !== hits[index - 1]?.kind) {
      const head = document.createElement('li');
      head.className = 'goto-group';
      head.setAttribute('role', 'presentation');
      head.textContent = GROUP[hit.kind];
      rows.push(head);
    }
    const row = document.createElement('li');
    row.className = `goto-hit ${hit.kind}`;
    row.id = `goto-hit-${index}`;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(index === chosen));
    const label = document.createElement('span');
    label.className = 'goto-label';
    if (hit.match) {
      const [from, to] = hit.match;
      const mark = document.createElement('mark');
      mark.textContent = hit.label.slice(from, to);
      label.append(hit.label.slice(0, from), mark, hit.label.slice(to));
    } else {
      label.textContent = hit.label;
    }
    const detail = document.createElement('span');
    detail.className = 'goto-detail';
    detail.textContent = hit.detail;
    row.append(label, detail);
    row.addEventListener('mousemove', () => {
      if (chosen === index) return;
      chosen = index;
      for (const other of list.querySelectorAll('[aria-selected="true"]')) other.setAttribute('aria-selected', 'false');
      row.setAttribute('aria-selected', 'true');
    });
    row.addEventListener('click', () => choose(index));
    rows.push(row);
  });
  if (hits.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'goto-empty';
    empty.textContent = input.value.trim() ? `Nothing in this project matches "${input.value.trim()}".` : 'This project has no files yet.';
    rows.push(empty);
  }
  list.replaceChildren(...rows);
  input.setAttribute('aria-activedescendant', hits.length > 0 ? `goto-hit-${chosen}` : '');
  list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
}

function choose(index: number): void {
  const hit = hits[index];
  if (!hit) return;
  dialog.close();
  go(hit);
}

input.addEventListener('input', () => {
  hits = search(input.value);
  chosen = 0;
  render();
});
input.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (hits.length === 0) return;
    chosen = (chosen + (event.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length;
    render();
  } else if (event.key === 'Enter') {
    event.preventDefault();
    choose(chosen);
  } else if (event.key === 'Escape') {
    event.preventDefault(); // in a search box, Escape would only clear the text
    dialog.close();
  }
});
// A click on the dark area around the box closes it.
dialog.addEventListener('click', (event) => {
  if (event.target === dialog) dialog.close();
});

export function openGoTo(searchWith: (typed: string) => Hit[], goTo: (hit: Hit) => void): void {
  search = searchWith;
  go = goTo;
  input.value = '';
  hits = search('');
  chosen = 0;
  render();
  dialog.showModal();
  input.focus();
}
