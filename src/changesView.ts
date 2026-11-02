import { MergeView } from '@codemirror/merge';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';

// Two versions of a file side by side, with what changed marked: removed
// text in red on the left, added text in green on the right. Unchanged
// stretches are folded away. Read-only, for "Go back to the version from …".

const look = EditorView.theme({
  '&': { backgroundColor: 'var(--editor)', color: 'var(--ink)', fontSize: '13px' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.55' },
  '.cm-gutters': { backgroundColor: 'var(--editor)', color: 'var(--muted)', border: 'none' },
  '&.cm-merge-a .cm-changedLine': { backgroundColor: 'color-mix(in srgb, var(--red) 10%, transparent)' },
  '&.cm-merge-b .cm-changedLine': { backgroundColor: 'color-mix(in srgb, var(--green) 10%, transparent)' },
  '&.cm-merge-a .cm-changedText': { background: 'color-mix(in srgb, var(--red) 30%, transparent)' },
  '&.cm-merge-b .cm-changedText': { background: 'color-mix(in srgb, var(--green) 30%, transparent)' },
  '.cm-collapsedLines': {
    background: 'var(--chrome)', color: 'var(--muted)', fontFamily: 'var(--ui)', fontSize: '12px', padding: '3px 12px',
  },
});

const readOnly = [
  EditorView.editable.of(false), EditorState.readOnly.of(true), EditorView.lineWrapping, lineNumbers(), look,
];

// Shows the two versions in `parent`; returns a function that removes them again.
export function showChanges(parent: HTMLElement, before: string, after: string): () => void {
  const view = new MergeView({
    a: { doc: before, extensions: readOnly },
    b: { doc: after, extensions: readOnly },
    parent,
    collapseUnchanged: { margin: 2, minSize: 4 },
    gutter: false,
  });
  return () => view.destroy();
}
