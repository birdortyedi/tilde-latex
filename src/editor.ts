import { basicSetup } from 'codemirror';
import { Compartment, EditorSelection, EditorState, Prec, type Extension, type TransactionSpec } from '@codemirror/state';
import { runScopeHandlers, EditorView, keymap, scrollPastEnd, tooltips } from '@codemirror/view';
import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { latexEditing, type AddCitation } from './latexEditing';
import { latexSpellcheck } from './spellcheck';
import { findPanel } from './findPanel';
import { cellsFrom, insideTabular, latexTable, tableRows } from './pasteTable';
import { mathPreview, type TexTypesetter } from './mathPreview';
import { commentsExtension, openCard, setCommentRanges, type CommentHooks, type CommentRange } from './commentsView';
import type { ProjectFile } from './projects';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';

// A file of a shared project: its text, which merges everyone's edits, an
// undo history of this browser's edits only, and the cursors of the people
// connected directly (see sharedSync.ts and live.ts).
export interface SharedText {
  text: Y.Text;
  undo: Y.UndoManager;
  awareness: Awareness | null;
}

// Colours for LaTeX source. They are CSS variables from style.css, so they
// follow the light and dark themes by themselves.
const latexColours = HighlightStyle.define([
  { tag: tags.tagName, color: 'var(--syn-command)' }, // \section, \begin
  { tag: tags.atom, color: 'var(--syn-argument)' }, // {figure}, \label{fig:a}
  { tag: tags.keyword, color: 'var(--syn-math)' }, // $x^2$, \[ \]
  { tag: tags.comment, color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: tags.number, color: 'var(--syn-number)' },
  { tag: tags.bracket, color: 'var(--muted)' },
  { tag: tags.invalid, color: 'var(--red)' },
]);

const look = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--editor)', color: 'var(--ink)', fontSize: 'var(--editor-size, 14px)' },
  '&.cm-focused': { outline: 'none' }, // CodeMirror's dotted frame; the cursor shows where you type
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.6' },
  '.cm-content': { caretColor: 'var(--ink)', paddingBlock: '10px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--ink)' },
  '.cm-gutters': { backgroundColor: 'var(--editor)', color: 'var(--muted)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'var(--hover)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--ink)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    { backgroundColor: 'color-mix(in srgb, var(--teal) 28%, transparent)' },
  '.cm-matchingBracket': { backgroundColor: 'color-mix(in srgb, var(--teal) 22%, transparent)', outline: 'none' },
  // Pop-ups in the text (suggestions, maths, comments) look like Tilde's menus.
  '.cm-tooltip': { backgroundColor: 'var(--raised)', color: 'var(--ink)', border: '1px solid var(--rule)', borderRadius: '6px', boxShadow: '0 6px 20px rgba(0, 0, 0, 0.2)' },
  '.cm-panels': { backgroundColor: 'var(--chrome)', color: 'var(--ink)' },
});

// A compile problem to show on a line of a file.
export interface LineMark {
  line: number; // 1 = first line
  severity: 'error' | 'warning' | 'info';
  message: string;
}

// One CodeMirror view that shows one file at a time. Each file keeps its own
// editor state, so undo history and cursor position survive switching files.
export class Editor {
  // Image files pasted or dropped into the text, and where (an offset in the open file).
  onImages: (files: File[], at: number) => void = () => {};
  // "Add a paper from its DOI…" in the \cite{} suggestions (see main.ts).
  onAddCitation: AddCitation = () => Promise.resolve(null);
  // Cells pasted from a spreadsheet became a table (or rows, inside a
  // tabular) from `from` to `to`; `plain` is what was pasted (see main.ts).
  onTablePasted: (from: number, to: number, plain: string, rowsOnly: boolean) => void = () => {};
  // Maths KaTeX cannot preview, typeset by the TeX engine instead (see main.ts).
  typesetWithTex: TexTypesetter = () => Promise.reject(new Error('the TeX engine is not ready'));
  // In a shared project, a file's shared text; null in other projects.
  shared: (path: string) => SharedText | null = () => null;
  // Comments: whether this account may add them, and the thread cards (see commentsUi.ts).
  commentHooks: CommentHooks = { canComment: () => false, card: () => document.createElement('div') };
  private view: EditorView;
  private states = new Map<string, EditorState>();
  private currentPath: string | null = null;
  private marks = new Map<string, LineMark[]>(); // by file path
  private language: Extension; // LaTeX colours, completion and editing helpers
  private readOnly = false; // a project this account may only view
  private comments = new Map<string, CommentRange[]>(); // by file path, in shared projects
  private commenting: Extension;
  private wrapping = new Compartment(); // long lines wrap, or scroll sideways
  private wrap = true;

  constructor(
    parent: HTMLElement,
    private onChange: (path: string, text: string) => void,
    private onCursor: (line: number, column: number) => void = () => {},
    files: () => ProjectFile[] = () => [], // the project's files, for completing labels, citations and paths
  ) {
    this.view = new EditorView({ parent });
    const latex = latexEditing(files, (doi) => this.onAddCitation(doi));
    this.language = [
      StreamLanguage.define({ ...stex, languageData: { ...stex.languageData, ...latex.languageData } }),
      latex.extensions,
      mathPreview(files, (math) => this.typesetWithTex(math)),
    ];
    this.commenting = commentsExtension({ canComment: () => this.commentHooks.canComment(), card: (target, close) => this.commentHooks.card(target, close) });
  }

  private reportCursor(state: EditorState): void {
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    this.onCursor(line.number, head - line.from + 1);
  }

  open(path: string, text: string): void {
    if (this.currentPath) this.states.set(this.currentPath, this.view.state);
    this.currentPath = path;
    const kept = this.states.get(path);
    const shared = this.shared(path);
    // Others may have changed a shared file while it was closed, so it
    // starts again from the shared text, with the cursor where it was.
    this.view.setState(shared ? this.newState(path, shared.text.toString(), shared, kept?.selection.main.head) : kept ?? this.newState(path, text));
    this.reportCursor(this.view.state);
    this.view.focus();
  }

  // Shows new text for a file that changed outside the editor (for example,
  // Drive's version was loaded). That file's undo history starts over.
  replace(path: string, text: string): void {
    if (path === this.currentPath) this.view.setState(this.newState(path, text));
    else this.states.delete(path); // open() will start from the new text
  }

  // A file was renamed or moved: keep its undo history under the new path.
  rename(from: string, to: string): void {
    const state = this.states.get(from);
    this.states.delete(from);
    if (state) this.states.set(to, state);
    if (this.currentPath === from) this.currentPath = to;
  }

  // A file was deleted.
  forget(path: string): void {
    this.states.delete(path);
    if (this.currentPath === path) this.currentPath = null;
  }

  // Puts the cursor at an offset of the open file and scrolls it into the middle.
  goToOffset(offset: number): void {
    const at = Math.min(Math.max(offset, 0), this.view.state.doc.length);
    this.view.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: 'center' }) });
    this.view.focus();
  }

  // Runs what a key combination such as "Mod-b" does in the editor, as if it
  // were pressed there (for the keyboard shortcut list). False if nothing ran.
  runKey(combo: string, mac: boolean): boolean {
    const parts = combo.split('-');
    const key = parts.pop() ?? '';
    const mod = parts.includes('Mod');
    this.view.focus();
    return runScopeHandlers(this.view, new KeyboardEvent('keydown', {
      key, metaKey: mod && mac, ctrlKey: mod && !mac, shiftKey: parts.includes('Shift'), altKey: parts.includes('Alt'),
    }), 'editor');
  }

  // Selects a line (1 = first) of the open file and scrolls it into the middle.
  // With `column` and `length`, selects only that part of the line.
  goTo(line: number, column?: number, length = 0): void {
    const doc = this.view.state.doc;
    const target = doc.line(Math.min(Math.max(line, 1), doc.lines));
    const from = column === undefined ? target.from : Math.min(target.from + column, target.to);
    const to = column === undefined ? target.to : Math.min(from + length, target.to);
    this.view.dispatch({
      selection: { anchor: from, head: to },
      effects: EditorView.scrollIntoView(target.from, { y: 'center' }),
    });
    this.view.focus();
  }

  // Inserts a block of lines (a figure) at an offset: on that line if it
  // is empty, else on a new line below it. `make` gets the line's indent and
  // returns the text and where in it the cursor goes. Returns where the block ends.
  insertBlock(at: number, make: (indent: string) => { text: string; cursor: number }): number {
    return this.insertBlockAt(this.view, at, make)[1];
  }

  // The same, in a given view; returns where the inserted text starts and ends.
  private insertBlockAt(view: EditorView, at: number, make: (indent: string) => { text: string; cursor: number }): [number, number] {
    const line = view.state.doc.lineAt(Math.min(at, view.state.doc.length));
    const indent = /^\s*/.exec(line.text)?.[0] ?? '';
    const { text, cursor } = make(indent);
    const blank = line.text.trim() === '';
    const from = blank ? line.from : line.to;
    const insert = blank ? indent + text : `\n${indent}${text}`;
    const start = from + insert.length - text.length;
    view.dispatch({
      changes: { from, to: line.to, insert },
      selection: { anchor: start + cursor },
      scrollIntoView: true,
    });
    view.focus();
    return [from, from + insert.length];
  }

  // Pasted spreadsheet cells: a whole table, or only its rows inside a tabular.
  private pasteTable(view: EditorView, rows: string[][], plain: string): void {
    const { from, to } = view.state.selection.main;
    const rowsOnly = insideTabular(view.state.sliceDoc(0, from));
    if (to > from) view.dispatch({ changes: { from, to } });
    const [start, end] = this.insertBlockAt(view, from, rowsOnly ? (indent) => {
      const text = tableRows(rows, indent).join('\n').slice(indent.length);
      return { text, cursor: text.length };
    } : (indent) => latexTable(rows, indent));
    this.onTablePasted(start, end, plain, rowsOnly);
  }

  // Replaces part of the open file, if it still holds `expected` there.
  // Returns false if it does not (it was edited meanwhile).
  replaceRange(from: number, to: number, expected: string, insert: string): boolean {
    if (this.view.state.sliceDoc(from, to) !== expected) return false;
    this.view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, scrollIntoView: true });
    this.view.focus();
    return true;
  }

  // The text of the open file between two offsets.
  slice(from: number, to: number): string {
    return this.view.state.sliceDoc(from, to);
  }

  // The path of the open file.
  path(): string | null {
    return this.currentPath;
  }

  // The text of the open file.
  text(): string {
    return this.view.state.doc.toString();
  }

  // Inserts text at the cursor of the open file.
  insertAtCursor(text: string): void {
    const { from, to } = this.view.state.selection.main;
    this.view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, scrollIntoView: true });
    this.view.focus();
  }

  // Replaces all the text of the open file, as an edit Ctrl/Cmd+Z can undo.
  setText(text: string): void {
    this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: text } });
  }

  // Inserts text into the open file, as an edit Ctrl/Cmd+Z can undo.
  insertText(at: number, text: string): void {
    this.view.dispatch({ changes: { from: at, insert: text } });
  }

  // Shows compile problems as small icons next to the line numbers, with a
  // wavy underline; hovering shows the message. Replaces the previous marks.
  showMarks(byPath: Map<string, LineMark[]>): void {
    this.marks = byPath;
    if (this.currentPath) this.view.dispatch(this.marksFor(this.currentPath, this.view.state));
    for (const [path, state] of this.states) this.states.set(path, state.update(this.marksFor(path, state)).state);
  }

  private marksFor(path: string, state: EditorState): TransactionSpec {
    const doc = state.doc;
    const diagnostics: Diagnostic[] = (this.marks.get(path) ?? []).map((mark) => {
      const line = doc.line(Math.min(Math.max(mark.line, 1), doc.lines));
      return { from: line.from, to: line.to, severity: mark.severity, message: mark.message };
    });
    return setDiagnostics(state, diagnostics);
  }

  // The text size, in pixels (set on the page as --editor-size).
  setFontSize(pixels: number): void {
    this.view.dom.parentElement?.style.setProperty('--editor-size', `${pixels}px`);
    this.view.requestMeasure();
  }

  // Whether long lines wrap onto the next line, or the text scrolls sideways.
  setWrap(wrap: boolean): void {
    if (wrap === this.wrap) return;
    this.wrap = wrap;
    const effects = this.wrapping.reconfigure(wrap ? EditorView.lineWrapping : []);
    this.view.dispatch({ effects });
    for (const [path, state] of this.states) this.states.set(path, state.update({ effects }).state);
  }

  get isReadOnly(): boolean {
    return this.readOnly;
  }

  // For a project this account may only view: text can be selected and
  // copied, not changed. Others' edits still show up.
  setReadOnly(readOnly: boolean): void {
    if (this.readOnly === readOnly) return;
    this.readOnly = readOnly;
    this.states.clear();
    const path = this.currentPath;
    if (!path) return;
    const shared = this.shared(path);
    this.view.setState(this.newState(path, this.view.state.doc.toString(), shared ?? undefined, this.view.state.selection.main.head));
  }

  // The comments of a shared project's file, where they are in its text now.
  showComments(path: string, ranges: CommentRange[]): void {
    this.comments.set(path, ranges);
    const effects = setCommentRanges.of(ranges);
    if (path === this.currentPath) this.view.dispatch({ effects });
    else {
      const state = this.states.get(path);
      if (state) this.states.set(path, state.update({ effects }).state);
    }
  }

  // Opens a comment's thread in the open file, and scrolls to it.
  openComment(id: string): void {
    const range = this.comments.get(this.currentPath ?? '')?.find((r) => r.id === id);
    if (!range) return;
    this.view.dispatch({ effects: [openCard.of({ id }), EditorView.scrollIntoView(range.from, { y: 'center' })], selection: { anchor: range.from } });
  }

  // Forget all files, for example when another project is opened.
  clear(): void {
    this.comments.clear();
    this.states.clear();
    this.currentPath = null;
    this.view.setState(EditorState.create());
  }

  private newState(path: string, text: string, shared?: SharedText, cursor?: number): EditorState {
    const state = EditorState.create({
      doc: text,
      selection: cursor === undefined ? undefined : EditorSelection.cursor(Math.min(cursor, text.length)),
      extensions: [
        // Shared text: typing goes into it, others' edits come out of it, and
        // Ctrl/Cmd+Z undoes only this browser's edits.
        shared ? [yCollab(shared.text, shared.awareness, { undoManager: shared.undo }), Prec.high(keymap.of(yUndoManagerKeymap))] : [],
        // Comments, in every project that may change (the first one in a project of one's own turns them on).
        this.commenting,
        basicSetup,
        EditorState.readOnly.of(this.readOnly),
        syntaxHighlighting(latexColours),
        look,
        scrollPastEnd(), // the last line can scroll up, away from the bottom edge
        // Pop-ups stay over the source (not the PDF), a little in from its edges.
        tooltips({ tooltipSpace: (view) => {
          const box = view.dom.getBoundingClientRect();
          return { left: box.left + 6, right: box.right - 6, top: box.top, bottom: box.bottom };
        } }),
        lintGutter(),
        this.wrapping.of(this.wrap ? EditorView.lineWrapping : []),
        this.language,
        latexSpellcheck,
        findPanel,
        // Pasted or dropped images become files of the project (see main.ts).
        // Text and other files are left to the editor as usual.
        EditorView.domEventHandlers({
          paste: (event, view) => {
            if (view.state.readOnly) return false;
            const data = event.clipboardData;
            // Cells copied from a spreadsheet become a table in a .tex file.
            const plain = data?.getData('text/plain') ?? '';
            const rows = this.currentPath?.endsWith('.tex') && plain ? cellsFrom(plain) : null;
            if (rows) {
              event.preventDefault();
              this.pasteTable(view, rows, plain);
              return true;
            }
            const files = [...(data?.files ?? [])];
            if (!data || files.length === 0 || data.types.includes('text/plain')) return false;
            event.preventDefault();
            this.onImages(files, view.state.selection.main.head);
            return true;
          },
          drop: (event, view) => {
            if (view.state.readOnly) return false;
            const files = [...(event.dataTransfer?.files ?? [])].filter((file) => file.type.startsWith('image/') || file.type === 'application/pdf');
            if (files.length === 0) return false;
            event.preventDefault();
            this.onImages(files, view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head);
            return true;
          },
        }),
        // Only the open file can change, so report it under its current
        // path (which a rename may have changed since this state was made).
        EditorView.updateListener.of((update) => {
          if (update.docChanged && this.currentPath) this.onChange(this.currentPath, update.state.doc.toString());
          if (update.selectionSet || update.docChanged) this.reportCursor(update.state);
        }),
      ],
    });
    const withMarks = state.update(this.marksFor(path, state)).state;
    return shared ? withMarks.update({ effects: setCommentRanges.of(this.comments.get(path) ?? []) }).state : withMarks;
  }
}
