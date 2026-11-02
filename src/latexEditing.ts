import { completionStatus, snippetCompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { foldService } from '@codemirror/language';
import { EditorSelection, Prec, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { bibKeysIn, completionContext, foldEnd, labelsIn, unclosedEnvironment } from './latex';
import type { ProjectFile } from './projects';

// Editor helpers for LaTeX: completion, \begin…\end, Ctrl/Cmd+B and +I, and
// folding of environments and sections (the arrows next to the line numbers).

const IMAGE = /\.(png|jpe?g|pdf|eps|svg)$/i;

// Common commands. "${}" marks where the cursor goes; Tab moves to the next one.
const COMMANDS: Completion[] = [
  ...['part', 'chapter', 'section', 'subsection', 'subsubsection', 'paragraph'].flatMap((name) => [
    snippetCompletion(`\\${name}{\${}}`, { label: `\\${name}`, detail: 'heading', type: 'keyword' }),
  ]),
  ...['textbf', 'textit', 'emph', 'underline', 'texttt', 'textsc', 'footnote', 'url', 'caption', 'label', 'ref', 'eqref',
    'pageref', 'cite', 'citep', 'citet', 'input', 'include', 'usepackage', 'documentclass', 'title', 'author', 'date',
    'bibliography', 'bibliographystyle', 'mathbb', 'mathbf', 'mathrm', 'mathcal', 'text', 'sqrt', 'vspace', 'hspace']
    .map((name) => snippetCompletion(`\\${name}{\${}}`, { label: `\\${name}`, type: 'function' })),
  snippetCompletion('\\begin{${}}', { label: '\\begin', detail: 'environment', type: 'keyword' }),
  snippetCompletion('\\end{${}}', { label: '\\end', type: 'keyword' }),
  snippetCompletion('\\frac{${}}{${}}', { label: '\\frac', type: 'function' }),
  snippetCompletion('\\href{${url}}{${text}}', { label: '\\href', type: 'function' }),
  snippetCompletion('\\includegraphics[width=\\linewidth]{${}}', { label: '\\includegraphics', type: 'function' }),
  snippetCompletion('\\newcommand{\\${name}}{${}}', { label: '\\newcommand', type: 'function' }),
  ...['item', 'centering', 'maketitle', 'tableofcontents', 'newpage', 'clearpage', 'noindent', 'hline', 'toprule',
    'midrule', 'bottomrule', 'linewidth', 'textwidth', 'left', 'right', 'cdot', 'ldots', 'infty', 'partial', 'sum', 'int',
    'prod', 'lim', 'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'theta', 'lambda', 'mu', 'pi', 'sigma', 'phi', 'omega',
    'LaTeX', 'TeX'].map((name) => ({ label: `\\${name}`, type: 'variable' })),
];

const ENVIRONMENTS = ['document', 'figure', 'table', 'tabular', 'equation', 'equation*', 'align', 'align*', 'gather',
  'itemize', 'enumerate', 'description', 'center', 'abstract', 'minipage', 'quote', 'verbatim', 'tikzpicture', 'axis',
  'theorem', 'lemma', 'proof', 'definition', 'frame', 'thebibliography'].map((label) => ({ label, type: 'type' }));

function completions(files: () => ProjectFile[]) {
  return (context: CompletionContext): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos);
    const found = completionContext(line.text.slice(0, context.pos - line.from));
    if (!found) return null;
    const projectFiles = files();
    const paths = (test: (path: string) => boolean, strip = false): Completion[] => projectFiles
      .map((f) => f.path).filter(test).map((path) => ({ label: strip ? path.replace(/\.tex$/, '') : path, type: 'text' }));
    const options: Record<typeof found.kind, () => Completion[]> = {
      command: () => COMMANDS,
      environment: () => ENVIRONMENTS,
      label: () => labelsIn(projectFiles).map((label) => ({ label, type: 'variable' })),
      citation: () => bibKeysIn(projectFiles).map((label) => ({ label, type: 'constant' })),
      texfile: () => paths((path) => path.endsWith('.tex'), true),
      image: () => paths((path) => IMAGE.test(path)),
    };
    // Commands are completed from their backslash on; arguments from the start of the word.
    if (found.kind === 'command') {
      return { from: line.from + found.from - 1, options: COMMANDS, validFor: /^\\[A-Za-z]*$/ };
    }
    // An argument gets its closing } too, if it is missing (for example after pasting "\begin{fig").
    const closing = context.state.sliceDoc(context.pos, context.pos + 1) === '}' ? '' : '}';
    const withClosing = options[found.kind]().map((option) => ({ ...option, apply: option.label + closing }));
    return { from: line.from + found.from, options: withClosing, validFor: /^[^},\s]*$/ };
  };
}

// Enter at the end of "\begin{figure}[h]" adds an empty line and "\end{figure}".
function closeEnvironment(view: EditorView): boolean {
  const { state } = view;
  if (completionStatus(state) === 'active') return false; // Enter picks the suggestion instead
  const range = state.selection.main;
  if (!range.empty) return false;
  const line = state.doc.lineAt(range.head);
  if (!/^[}\]]*\s*$/.test(line.text.slice(range.head - line.from))) return false; // only at the end of the line
  const name = unclosedEnvironment(line.text, state.doc.toString());
  if (!name) return false;
  const indent = /^\s*/.exec(line.text)?.[0] ?? '';
  const inner = `\n${indent}  `;
  view.dispatch({
    changes: { from: line.to, insert: `${inner}\n${indent}\\end{${name}}` },
    selection: { anchor: line.to + inner.length },
    scrollIntoView: true,
  });
  return true;
}

// Wraps the selection in \command{...}, or puts the cursor inside an empty one.
function wrapIn(command: string) {
  return (view: EditorView): boolean => {
    const open = `\\${command}{`;
    view.dispatch(view.state.changeByRange((range) => {
      const inner = view.state.sliceDoc(range.from, range.to);
      const start = range.from + open.length;
      return {
        changes: { from: range.from, to: range.to, insert: `${open}${inner}}` },
        range: EditorSelection.range(start, start + inner.length),
      };
    }));
    return true;
  };
}

export function latexEditing(files: () => ProjectFile[]): { languageData: Record<string, unknown>; extensions: Extension } {
  return {
    // Brackets and $ close by themselves; quotes do not, since LaTeX writes them as `` and ''.
    languageData: { autocomplete: completions(files), closeBrackets: { brackets: ['(', '[', '{', '$'] } },
    extensions: [foldService.of((state, lineStart) => {
      const line = state.doc.lineAt(lineStart);
      const end = foldEnd((n) => state.doc.line(n).text, line.number, state.doc.lines);
      return end ? { from: line.to, to: state.doc.line(end).to } : null;
    }), Prec.high(keymap.of([
      { key: 'Enter', run: closeEnvironment },
      { key: 'Mod-b', run: wrapIn('textbf'), preventDefault: true },
      { key: 'Mod-i', run: wrapIn('textit'), preventDefault: true },
    ]))],
  };
}
