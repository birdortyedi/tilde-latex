import { basicSetup } from 'codemirror';
import { EditorState, type TransactionSpec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { StreamLanguage } from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';

// A compile problem to show on a line of a file.
export interface LineMark {
  line: number; // 1 = first line
  severity: 'error' | 'warning' | 'info';
  message: string;
}

// One CodeMirror view that shows one file at a time. Each file keeps its own
// editor state, so undo history and cursor position survive switching files.
export class Editor {
  private view: EditorView;
  private states = new Map<string, EditorState>();
  private currentPath: string | null = null;
  private marks = new Map<string, LineMark[]>(); // by file path

  constructor(parent: HTMLElement, private onChange: (path: string, text: string) => void) {
    this.view = new EditorView({ parent });
  }

  open(path: string, text: string): void {
    if (this.currentPath) this.states.set(this.currentPath, this.view.state);
    this.currentPath = path;
    this.view.setState(this.states.get(path) ?? this.newState(path, text));
    this.view.focus();
  }

  // Shows new text for a file that changed outside the editor (for example,
  // Drive's version was loaded). That file's undo history starts over.
  replace(path: string, text: string): void {
    if (path === this.currentPath) this.view.setState(this.newState(path, text));
    else this.states.delete(path); // open() will start from the new text
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
        lintGutter(),
        EditorView.lineWrapping,
        StreamLanguage.define(stex),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) this.onChange(path, update.state.doc.toString());
        }),
      ],
    });
    return state.update(this.marksFor(path, state)).state;
  }
}
