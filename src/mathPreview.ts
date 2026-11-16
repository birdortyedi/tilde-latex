import { hoverTooltip, type Tooltip } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { withoutComment } from './latex';
import type { ProjectFile } from './projects';

// Math preview: hovering over maths in the source ($…$, \[…\], an equation
// or align environment) shows it typeset, by KaTeX. KaTeX is loaded the first
// time, so it costs nothing until then. The document's own \newcommand
// macros are used too. It is a preview: the PDF stays what counts.

export interface MathAt {
  from: number;
  to: number;
  tex: string; // what KaTeX gets
  display: boolean;
}

// Display environments, and what KaTeX gets for each (unnumbered: a preview has no equation numbers).
const ENVIRONMENTS: Record<string, string | null> = {
  equation: null, 'equation*': null, displaymath: null, math: null,
  align: 'align*', 'align*': 'align*', flalign: 'align*', 'flalign*': 'align*', alignat: 'alignat*', 'alignat*': 'alignat*',
  gather: 'gather*', 'gather*': 'gather*', multline: 'gather*', 'multline*': 'gather*', eqnarray: 'eqnarray*', 'eqnarray*': 'eqnarray*',
};
const WINDOW = 4000; // how far from the pointer to look for the start and end of the maths

// Commands KaTeX does not know but that only matter for the PDF.
const tidy = (tex: string): string => tex.replace(/\\label\{[^}]*\}/g, '').trim();

// The maths around offset `pos` of `text`, or null if `pos` is not in maths.
export function mathAt(text: string, pos: number): MathAt | null {
  const start = Math.max(0, pos - WINDOW);
  const before = text.slice(start, pos);
  // An environment opened before `pos` and closed after it.
  const opened = [...before.matchAll(/\\begin\{([a-z]+\*?)\}/g)].filter((m) => m[1] in ENVIRONMENTS).pop();
  if (opened) {
    const name = opened[1];
    const from = start + (opened.index ?? 0);
    const innerFrom = from + opened[0].length;
    const endTag = `\\end{${name}}`;
    const close = text.indexOf(endTag, innerFrom);
    if (close >= 0 && close + endTag.length >= pos) {
      const inner = tidy(text.slice(innerFrom, close).split('\n').map(withoutComment).join('\n'));
      const env = ENVIRONMENTS[name];
      return { from, to: close + endTag.length, tex: env ? `\\begin{${env}}${inner}\\end{${env}}` : inner, display: true };
    }
  }
  // \[…\] and \(…\)
  // (Not "\\\\[2pt]", a line break with space after it.)
  const last = (within: string, token: string, from = within.length): number => {
    let at = within.lastIndexOf(token, from);
    while (at > 0 && within[at - 1] === '\\') at = within.lastIndexOf(token, at - 2);
    return at;
  };
  const first = (token: string, from: number): number => {
    let at = text.indexOf(token, from);
    while (at > 0 && text[at - 1] === '\\') at = text.indexOf(token, at + 1);
    return at;
  };
  for (const [open, close, display] of [['\\[', '\\]', true], ['\\(', '\\)', false]] as const) {
    const at = last(before, open);
    if (at < 0 || last(before, close) > at) continue;
    const end = first(close, pos - close.length + 1);
    const next = first(open, start + at + open.length);
    if (end < 0 || (next >= 0 && next < end)) continue;
    const from = start + at;
    return { from, to: end + close.length, tex: tidy(text.slice(from + open.length, end)), display };
  }
  // $…$ and $$…$$, paired from the start of the paragraph (a blank line ends maths in LaTeX).
  const paragraphStart = Math.max(start, text.lastIndexOf('\n\n', pos) + 1);
  const paragraphEnd = text.indexOf('\n\n', pos) < 0 ? Math.min(text.length, pos + WINDOW) : text.indexOf('\n\n', pos);
  const paragraph = text.slice(paragraphStart, paragraphEnd).split('\n').map((line) => withoutComment(line).padEnd(line.length)).join('\n');
  const dollars = [...paragraph.matchAll(/(?<!\\)\$\$?/g)];
  for (let i = 0; i + 1 < dollars.length; i += 2) {
    const [open, close] = [dollars[i], dollars[i + 1]];
    const from = paragraphStart + (open.index ?? 0);
    const to = paragraphStart + (close.index ?? 0) + close[0].length;
    if (pos < from || pos > to) continue;
    if (open[0] !== close[0]) return null; // $…$$: not what it seems
    return { from, to, tex: tidy(text.slice(from + open[0].length, to - close[0].length)), display: open[0] === '$$' };
  }
  return null;
}

// The argument in braces that starts at `at` (which must be "{"), and where it ends.
function braced(text: string, at: number): [string, number] | null {
  if (text[at] !== '{') return null;
  let depth = 0;
  for (let i = at; i < text.length; i++) {
    if (text[i] === '\\') { i++; continue; }
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return [text.slice(at + 1, i), i + 1];
  }
  return null;
}

// The project's own macros, for KaTeX: \newcommand, \renewcommand, \def and \DeclareMathOperator.
export function macrosIn(files: ProjectFile[]): Record<string, string> {
  const macros: Record<string, string> = {};
  for (const file of files) {
    if (!/\.(tex|sty)$/.test(file.path) || typeof file.content !== 'string') continue;
    const code = file.content.split('\n').map(withoutComment).join('\n');
    for (const match of code.matchAll(/\\(?:(?:re)?newcommand|providecommand)\*?\s*\{?\s*(\\[A-Za-z]+)\s*\}?\s*(?:\[\d\])?\s*(?:\[[^\]]*\])?\s*(?=\{)/g)) {
      const body = braced(code, (match.index ?? 0) + match[0].length);
      if (body) macros[match[1]] = body[0];
    }
    for (const match of code.matchAll(/\\def\s*(\\[A-Za-z]+)((?:#\d)*)\s*(?=\{)/g)) {
      const body = braced(code, (match.index ?? 0) + match[0].length);
      if (body) macros[match[1]] = body[0];
    }
    for (const match of code.matchAll(/\\DeclareMathOperator(\*?)\s*\{\s*(\\[A-Za-z]+)\s*\}\s*(?=\{)/g)) {
      const body = braced(code, (match.index ?? 0) + match[0].length);
      if (body) macros[match[2]] = `\\operatorname${match[1]}{${body[0]}}`;
    }
  }
  return macros;
}

type Katex = typeof import('katex').default;
let katex: Promise<Katex> | null = null;
// KaTeX and its stylesheet, loaded the first time maths is hovered.
function loadKatex(): Promise<Katex> {
  katex ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([module]) => module.default);
  return katex;
}

// Typesets maths with the real TeX engine, when KaTeX cannot (see main.ts).
export type TexTypesetter = (math: MathAt) => Promise<HTMLCanvasElement>;

// A one-formula document for the TeX engine: the main file's preamble, so
// the document's own packages and commands work, around just the formula.
export function formulaDocument(main: string, math: MathAt): string {
  const preamble = /\\documentclass\s*(?:\[[^\]]*\])?\s*\{[^}]*\}([\s\S]*?)\\begin\s*\{document\}/.exec(main)?.[1] ?? '';
  const body = math.tex.startsWith('\\begin{') ? math.tex : math.display ? `\\[${math.tex}\\]` : `$${math.tex}$`;
  return `\\documentclass[border=3pt,varwidth=40em]{standalone}\n${preamble}\n\\begin{document}\n${body}\n\\end{document}\n`;
}

// What KaTeX said, without its prefix: "Undefined control sequence: \foo".
const katexProblem = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).replace(/^KaTeX parse error: /, '').replace(/ at position \d+:[\s\S]*$/, '');

function render(dom: HTMLElement, math: MathAt, files: () => ProjectFile[], tex?: TexTypesetter): void {
  loadKatex().then((library) => {
    try {
      library.render(math.tex, dom, { displayMode: math.display, throwOnError: true, strict: 'ignore', macros: macrosIn(files()), maxSize: 20 });
    } catch (error) {
      const problem = katexProblem(error);
      dom.className = 'math-preview problem';
      if (!tex) {
        dom.textContent = `No preview: ${problem}`;
        return;
      }
      // KaTeX is a quick preview, not LaTeX: TeX itself typesets what KaTeX cannot, and the preview says so.
      dom.textContent = `The quick preview cannot show this (${problem}), so TeX is typesetting it…`;
      tex(math).then((canvas) => {
        dom.className = 'math-preview by-tex';
        const note = document.createElement('div');
        note.className = 'math-note';
        note.textContent = 'Typeset by TeX: the quick preview did not know this.';
        dom.replaceChildren(canvas, note);
      }).catch((texError: unknown) => {
        dom.textContent = `No preview: ${problem}. TeX could not typeset it either: ${texError instanceof Error ? texError.message : String(texError)}`;
      });
    }
  }).catch(() => {
    dom.className = 'math-preview problem';
    dom.textContent = 'The maths preview could not be loaded.';
  });
}

export function mathPreview(files: () => ProjectFile[], tex?: TexTypesetter): Extension {
  return hoverTooltip((view, pos): Tooltip | null => {
    const math = mathAt(view.state.doc.toString(), pos);
    if (!math || !math.tex) return null;
    return {
      pos: math.from,
      end: math.to,
      above: true,
      create: () => {
        const dom = document.createElement('div');
        dom.className = 'math-preview';
        dom.textContent = '…';
        render(dom, math, files, tex);
        return { dom };
      },
    };
  }, { hoverTime: 350 });
}
