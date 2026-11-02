import {
  closeSearchPanel, findNext, findPrevious, getSearchQuery, replaceAll, replaceNext, search, SearchQuery, setSearchQuery,
} from '@codemirror/search';
import type { Extension } from '@codemirror/state';
import { EditorView, runScopeHandlers, type Panel, type ViewUpdate } from '@codemirror/view';

// Tilde's own find-and-replace bar for the editor (Ctrl/Cmd+F), in place of
// CodeMirror's plain one. It floats at the top right of the open file and
// searches only that file. Enter finds the next match, Shift+Enter the
// previous one, Esc closes it.

const MAX_COUNT = 999; // counting stops here, so a huge file stays quick

const ICONS = {
  chevron: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l4 4-4 4"/></svg>',
  up: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 13V3M4 7l4-4 4 4"/></svg>',
  down: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v10M4 9l4 4 4-4"/></svg>',
  close: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
};

type SearchOption = 'caseSensitive' | 'wholeWord' | 'regexp';

let replaceShown = false; // remembered between openings

function button(className: string, title: string, content: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.title = title;
  element.setAttribute('aria-label', title);
  element.innerHTML = content;
  element.addEventListener('click', onClick);
  return element;
}

class FindPanel implements Panel {
  dom = document.createElement('div');
  top = true;
  private find = document.createElement('input');
  private replace = document.createElement('input');
  private count = document.createElement('span');
  private replaceRow = document.createElement('div');
  private expand: HTMLButtonElement;
  private options: Record<SearchOption, HTMLButtonElement>;

  constructor(private view: EditorView) {
    this.dom.className = 'find-bar';
    this.dom.setAttribute('role', 'search');

    this.find.placeholder = 'Find';
    this.find.setAttribute('aria-label', 'Find');
    this.find.setAttribute('main-field', 'true'); // CodeMirror focuses this one when the bar opens
    this.replace.placeholder = 'Replace with';
    this.replace.setAttribute('aria-label', 'Replace with');
    for (const input of [this.find, this.replace]) {
      input.spellcheck = false;
      input.autocomplete = 'off';
      input.addEventListener('input', () => this.commit(input === this.find));
      input.addEventListener('keydown', (event) => this.keydown(event, input));
    }
    this.count.className = 'find-count';
    this.count.setAttribute('aria-live', 'polite');

    const option = (title: string, label: string) => {
      const toggle = button('find-option', title, label, () => {
        toggle.setAttribute('aria-pressed', String(toggle.getAttribute('aria-pressed') !== 'true'));
        this.commit(true);
      });
      toggle.setAttribute('aria-pressed', 'false');
      return toggle;
    };
    this.options = {
      caseSensitive: option('Match case', 'Aa'),
      wholeWord: option('Whole words only', 'W'),
      regexp: option('Regular expression', '.*'),
    };

    this.expand = button('find-expand', 'Show Replace', ICONS.chevron, () => this.showReplace(!replaceShown));
    const field = (input: HTMLInputElement, extra?: HTMLElement) => {
      const box = document.createElement('div');
      box.className = 'find-field';
      box.append(input, ...(extra ? [extra] : []));
      return box;
    };
    const separator = document.createElement('span');
    separator.className = 'find-separator';

    const findRow = document.createElement('div');
    findRow.className = 'find-row';
    findRow.append(
      this.expand, field(this.find, this.count),
      this.options.caseSensitive, this.options.wholeWord, this.options.regexp, separator,
      button('', 'Previous match (Shift+Enter)', ICONS.up, () => this.step('previous')),
      button('', 'Next match (Enter)', ICONS.down, () => this.step('next')),
      button('', 'Close (Esc)', ICONS.close, () => closeSearchPanel(view)),
    );
    this.replaceRow.className = 'find-row replace-row';
    this.replaceRow.append(
      field(this.replace),
      button('find-text', 'Replace this match (Enter in the Replace box)', 'Replace', () => replaceNext(view)),
      button('find-text', 'Replace every match in this file', 'Replace all', () => replaceAll(view)),
    );
    this.dom.append(findRow, this.replaceRow);
    this.showReplace(replaceShown);
    this.fill();
  }

  mount(): void {
    this.showCount();
  }

  update(update: ViewUpdate): void {
    const queryChanged = !getSearchQuery(update.state).eq(getSearchQuery(update.startState));
    if (queryChanged) this.fill(); // for example, opened again with other text selected
    if (queryChanged || update.docChanged || update.selectionSet) this.showCount();
  }

  // Shows the current search in the boxes and toggles.
  private fill(): void {
    const query = getSearchQuery(this.view.state);
    if (this.find.value !== query.search) this.find.value = query.search;
    if (this.replace.value !== query.replace) this.replace.value = query.replace;
    for (const name of ['caseSensitive', 'wholeWord', 'regexp'] as const) {
      this.options[name].setAttribute('aria-pressed', String(query[name]));
    }
  }

  // Makes what is in the boxes the search. Typing in Find jumps to the first
  // match from where the cursor was.
  private commit(jump: boolean): void {
    const pressed = (toggle: HTMLButtonElement) => toggle.getAttribute('aria-pressed') === 'true';
    const query = new SearchQuery({
      search: this.find.value,
      replace: this.replace.value,
      caseSensitive: pressed(this.options.caseSensitive),
      wholeWord: pressed(this.options.wholeWord),
      regexp: pressed(this.options.regexp),
    });
    if (query.eq(getSearchQuery(this.view.state))) return;
    const state = this.view.state;
    // The first match from where the cursor is, or from the top if there is none below.
    let match: { from: number; to: number } | undefined;
    if (jump && query.valid) {
      for (const start of [state.selection.main.from, 0]) {
        const result = query.getCursor(state, start).next();
        if (!result.done) {
          match = result.value;
          break;
        }
      }
    }
    this.view.dispatch({
      effects: setSearchQuery.of(query),
      selection: match ? { anchor: match.from, head: match.to } : undefined,
      scrollIntoView: Boolean(match),
      userEvent: 'select.search',
    });
  }

  // Next or previous match. CodeMirror's commands select all the text in the
  // Find box; put the cursor back at its end, so typing goes on from there.
  private step(direction: 'next' | 'previous'): void {
    if (direction === 'next') findNext(this.view);
    else findPrevious(this.view);
    if (document.activeElement === this.find) this.find.setSelectionRange(this.find.value.length, this.find.value.length);
  }

  private keydown(event: KeyboardEvent, input: HTMLInputElement): void {
    if (runScopeHandlers(this.view, event, 'search-panel')) {
      event.preventDefault(); // Esc, Ctrl/Cmd+G and the like
    } else if (event.key === 'Enter' && input === this.find) {
      event.preventDefault();
      this.step(event.shiftKey ? 'previous' : 'next');
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) replaceAll(this.view);
      else replaceNext(this.view);
    }
  }

  private showReplace(shown: boolean): void {
    replaceShown = shown;
    this.replaceRow.hidden = !shown;
    this.expand.setAttribute('aria-expanded', String(shown));
    this.expand.title = shown ? 'Hide Replace' : 'Show Replace';
    if (shown && this.dom.isConnected) this.replace.focus();
  }

  // "2 of 5": which match is selected, and how many there are.
  private showCount(): void {
    const query = getSearchQuery(this.view.state);
    this.count.classList.remove('none');
    if (!query.search) {
      this.count.textContent = '';
      return;
    }
    if (!query.valid) {
      this.count.textContent = 'Invalid';
      this.count.classList.add('none');
      return;
    }
    const selection = this.view.state.selection.main;
    const cursor = query.getCursor(this.view.state);
    let total = 0;
    let current = 0;
    for (let next = cursor.next(); !next.done && total <= MAX_COUNT; next = cursor.next()) {
      total++;
      if (next.value.from === selection.from && next.value.to === selection.to) current = total;
    }
    if (total === 0) {
      this.count.textContent = 'No results';
      this.count.classList.add('none');
    } else if (total > MAX_COUNT) {
      this.count.textContent = `${MAX_COUNT}+`;
    } else {
      this.count.textContent = current ? `${current} of ${total}` : `${total} found`;
    }
  }
}

export const findPanel: Extension = [
  search({ top: true, createPanel: (view) => new FindPanel(view) }),
  EditorView.theme({
    // The bar floats over the text instead of pushing it down.
    '.cm-panels.cm-panels-top': {
      position: 'absolute', top: '8px', right: '14px', left: 'auto', zIndex: '5',
      maxWidth: 'calc(100% - 28px)', border: 'none', backgroundColor: 'transparent',
    },
    '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--amber) 30%, transparent)', borderRadius: '2px' },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: 'color-mix(in srgb, var(--teal) 38%, transparent)', outline: '1px solid var(--teal)',
    },
  }),
];
