import { basicSetup } from 'codemirror';
import { EditorState, type Extension, type TransactionSpec } from '@codemirror/state';
import { EditorView, scrollPastEnd } from '@codemirror/view';
import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { latexEditing, type AddCitation } from './latexEditing';
import { latexSpellcheck } from './spellcheck';
import { findPanel } from './findPanel';
import type { ProjectFile } from './projects';

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
  '&': { height: '100%', backgroundColor: 'var(--editor)', color: 'var(--ink)', fontSize: '14px' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.6' },
  '.cm-content': { caretColor: 'var(--ink)', paddingBlock: '10px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--ink)' },
  '.cm-gutters': { backgroundColor: 'var(--editor)', color: 'var(--muted)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'var(--hover)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--ink)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    { backgroundColor: 'color-mix(in srgb, var(--teal) 28%, transparent)' },
  '.cm-matchingBracket': { backgroundColor: 'color-mix(in srgb, var(--teal) 22%, transparent)', outline: 'none' },
  '.cm-tooltip': { backgroundColor: 'var(--raised)', color: 'var(--ink)', border: '1px solid var(--rule)' },
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
  private view: EditorView;
  private states = new Map<string, EditorState>();
  private currentPath: string | null = null;
  private marks = new Map<string, LineMark[]>(); // by file path
  private language: Extension; // LaTeX colours, completion and editing helpers

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
    ];
  }

  private reportCursor(state: EditorState): void {
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    this.onCursor(line.number, head - line.from + 1);
  }

  open(path: string, text: string): void {
    if (this.currentPath) this.states.set(this.currentPath, this.view.state);
    this.currentPath = path;
    this.view.setState(this.states.get(path) ?? this.newState(path, text));
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

  // Selects a line (1 = first) of the open file and scrolls it into the middle.
  goTo(line: number): void {
    const doc = this.view.state.doc;
    const target = doc.line(Math.min(Math.max(line, 1), doc.lines));
    this.view.dispatch({
      selection: { anchor: target.from, head: target.to },
      effects: EditorView.scrollIntoView(target.from, { y: 'center' }),
    });
    this.view.focus();
  }

  // Inserts a block of lines (a figure) at an offset: on that line if it
  // is empty, else on a new line below it. `make` gets the line's indent and
  // returns the text and where in it the cursor goes. Returns where the block ends.
  insertBlock(at: number, make: (indent: string) => { text: string; cursor: number }): number {
    const line = this.view.state.doc.lineAt(Math.min(at, this.view.state.doc.length));
    const indent = /^\s*/.exec(line.text)?.[0] ?? '';
    const { text, cursor } = make(indent);
    const blank = line.text.trim() === '';
    const from = blank ? line.from : line.to;
    const insert = blank ? indent + text : `\n${indent}${text}`;
    const start = from + insert.length - text.length;
    this.view.dispatch({
      changes: { from, to: line.to, insert },
      selection: { anchor: start + cursor },
      scrollIntoView: true,
    });
    this.view.focus();
    return from + insert.length;
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

  // Forget all files, for example when another project is opened.
  clear(): void {
    this.states.clear();
    this.currentPath = null;
    this.view.setState(EditorState.create());
  }

  private newState(path: string, text: string): EditorState {
    const state = EditorState.create({
      doc: text,
      extensions: [
        basicSetup,
        syntaxHighlighting(latexColours),
        look,
        scrollPastEnd(), // the last line can scroll up, away from the bottom edge
        lintGutter(),
        EditorView.lineWrapping,
        this.language,
        latexSpellcheck,
        findPanel,
        // Pasted or dropped images become files of the project (see main.ts).
        // Text and other files are left to the editor as usual.
        EditorView.domEventHandlers({
          paste: (event, view) => {
            const data = event.clipboardData;
            const files = [...(data?.files ?? [])];
            if (!data || files.length === 0 || data.types.includes('text/plain')) return false;
            event.preventDefault();
            this.onImages(files, view.state.selection.main.head);
            return true;
          },
          drop: (event, view) => {
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
    return state.update(this.marksFor(path, state)).state;
  }
}
