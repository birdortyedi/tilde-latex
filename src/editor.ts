import { basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { StreamLanguage } from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';

// One CodeMirror view that shows one file at a time. Each file keeps its own
// editor state, so undo history and cursor position survive switching files.
export class Editor {
  private view: EditorView;
  private states = new Map<string, EditorState>();
  private currentPath: string | null = null;

  constructor(parent: HTMLElement, private onChange: (path: string, text: string) => void) {
    this.view = new EditorView({ parent });
  }

  open(path: string, text: string): void {
    if (this.currentPath) this.states.set(this.currentPath, this.view.state);
    this.currentPath = path;
    this.view.setState(this.states.get(path) ?? this.newState(path, text));
    this.view.focus();
  }

  // Forget all files, for example when another project is opened.
  clear(): void {
    this.states.clear();
    this.currentPath = null;
    this.view.setState(EditorState.create());
  }

  private newState(path: string, text: string): EditorState {
    return EditorState.create({
      doc: text,
      extensions: [
        basicSetup,
        EditorView.lineWrapping,
        StreamLanguage.define(stex),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) this.onChange(path, update.state.doc.toString());
        }),
      ],
    });
  }
}
