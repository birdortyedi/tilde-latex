import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, keymap, showTooltip, type Tooltip } from '@codemirror/view';

// Comments in the editor (see comments.ts for where they are kept): the
// commented words are underlined, a click on them opens their thread in a
// card below the text, and selecting text offers a small "Comment" button
// (or Ctrl/Cmd+Alt+M). The cards themselves are made by commentsUi.ts.

export interface CommentRange {
  id: string;
  from: number;
  to: number;
}

// A card: an existing thread, or a new comment on the selected text.
export type CardTarget = { id: string } | { from: number; to: number };

export interface CommentHooks {
  canComment(): boolean; // a project this account may change
  // The card's content. `target` gives what it is about now (a new comment's
  // text moves with edits made while it is being written).
  card(target: () => CardTarget | null, close: () => void): HTMLElement;
}

export const setCommentRanges = StateEffect.define<CommentRange[]>();
export const openCard = StateEffect.define<CardTarget | null>();

// Where the comments of the open file are; moves with the edits.
const ranges = StateField.define<CommentRange[]>({
  create: () => [],
  update(value, transaction) {
    let next = transaction.docChanged
      ? value.map((r) => ({ ...r, from: transaction.changes.mapPos(r.from, 1), to: Math.max(transaction.changes.mapPos(r.from, 1), transaction.changes.mapPos(r.to, -1)) }))
      : value;
    for (const effect of transaction.effects) if (effect.is(setCommentRanges)) next = effect.value;
    return next;
  },
});

// The card that is open, if any, with a number that stays the same while it is open.
let cards = 0;
const card = StateField.define<{ key: number; target: CardTarget } | null>({
  create: () => null,
  update(value, transaction) {
    let next = value;
    if (next && 'from' in next.target && transaction.docChanged) {
      const { from, to } = next.target;
      next = { key: next.key, target: { from: transaction.changes.mapPos(from, 1), to: transaction.changes.mapPos(to, -1) } };
    }
    for (const effect of transaction.effects) if (effect.is(openCard)) next = effect.value && { key: ++cards, target: effect.value };
    return next;
  },
});

const commented = (id: string, active: boolean) => Decoration.mark({ class: active ? 'cm-commented active' : 'cm-commented', attributes: { 'data-comment': id } });

export function commentsExtension(hooks: CommentHooks): Extension {
  // CodeMirror keeps a tooltip's view while its `create` stays the same function.
  const creators = new Map<number, Tooltip['create']>();
  const cardTooltip = (state: EditorState): Tooltip | null => {
    const open = state.field(card);
    if (!open) return null;
    const { key, target } = open;
    const range = 'id' in target ? state.field(ranges).find((r) => r.id === target.id) : target;
    if (!range) return null;
    let create = creators.get(key);
    if (!create) {
      creators.clear(); // only one card at a time
      create = (view) => {
        const dom = hooks.card(() => view.state.field(card)?.target ?? null, () => {
          view.dispatch({ effects: openCard.of(null) });
          view.focus();
        });
        return { dom };
      };
      creators.set(key, create);
    }
    return { pos: range.from, end: range.to, above: false, create };
  };
  // The small button over selected text.
  const button: Tooltip['create'] = (view) => {
    const dom = document.createElement('button');
    dom.className = 'comment-button';
    dom.textContent = 'Comment';
    dom.title = 'Comment on the selected text (Ctrl/Cmd+Alt+M)';
    dom.addEventListener('mousedown', (event) => event.preventDefault()); // keep the selection
    dom.addEventListener('click', () => startComment(view));
    return { dom };
  };
  const buttonTooltip = (state: EditorState): Tooltip | null => {
    const selection = state.selection.main;
    if (selection.empty || state.field(card) || state.readOnly || !hooks.canComment()) return null;
    return { pos: selection.head, above: selection.head === selection.from, strictSide: false, arrow: false, create: button };
  };
  const startComment = (view: EditorView): boolean => {
    const { from, to, empty } = view.state.selection.main;
    if (empty || view.state.readOnly || !hooks.canComment()) return false;
    view.dispatch({ effects: openCard.of({ from, to }) });
    return true;
  };
  return [
    ranges,
    card,
    EditorView.decorations.compute([ranges, card], (state) => {
      const open = state.field(card)?.target;
      const marks = state.field(ranges).filter((r) => r.to > r.from)
        .map((r) => commented(r.id, open !== undefined && 'id' in open && open.id === r.id).range(r.from, r.to));
      return Decoration.set(marks, true);
    }),
    showTooltip.compute([card, ranges], cardTooltip),
    showTooltip.compute(['selection', card], buttonTooltip),
    keymap.of([
      { key: 'Mod-Alt-m', run: startComment },
      { key: 'Escape', run: (view) => (view.state.field(card) ? (view.dispatch({ effects: openCard.of(null) }), true) : false) },
    ]),
    EditorView.domEventHandlers({
      click: (event, view) => {
        const mark = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-comment]');
        const id = mark?.dataset.comment;
        if (id) view.dispatch({ effects: openCard.of({ id }) });
        else if (view.state.field(card)) view.dispatch({ effects: openCard.of(null) });
        return false;
      },
    }),
  ];
}
