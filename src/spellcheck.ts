import { syntaxTree } from '@codemirror/language';
import type { Extension, Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';

// Spell checking by the browser, in the language the browser is set to.
// LaTeX that is not prose is left out, so it is not marked as misspelt:
// commands, labels, citation keys, file names, options and maths.

// Parts of the source the LaTeX colouring already knows are not prose.
const NOT_PROSE = new Set(['tagName', 'atom', 'keyword', 'variableName.special', 'number', 'bracket']);

// Commands whose {argument} is a name, a file or a list of packages, not text.
const NAME_ARGUMENT = /\\(?:includegraphics|input|include|includeonly|usepackage|RequirePackage|documentclass|bibliography|bibliographystyle|addbibresource|graphicspath|url|href|label|ref|eqref|cref|Cref|autoref|pageref|cite[a-z]*|nocite|newcommand|renewcommand|setmainfont|setsansfont|setmonofont|setmathfont)\*?((?:\[[^\]\n]*\])*)\{([^}\n]*)\}/g;
// Options right after a command: \begin{figure}[htbp], \section[short]{…} is text but rare.
const OPTIONS = /\\[A-Za-z@]+\*?(?:\{[^}\n]*\})?((?:\[[^\]\n]*\])+)/g;
// Display maths environments, over several lines.
const MATH_ENVIRONMENT = /\\begin\{(equation|align|gather|multline|eqnarray|math|displaymath|tikzpicture|axis)(\*?)\}[\s\S]*?\\end\{\1\2\}/g;

// The ranges of `text` (from, to) that are not prose, found by pattern.
export function notProse(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  for (const match of text.matchAll(NAME_ARGUMENT)) {
    const end = match.index + match[0].length;
    ranges.push([end - match[2].length - 1, end - 1]);
    if (match[1]) ranges.push([end - match[2].length - 2 - match[1].length, end - match[2].length - 2]);
  }
  for (const match of text.matchAll(OPTIONS)) {
    const end = match.index + match[0].length;
    ranges.push([end - match[1].length, end]);
  }
  for (const match of text.matchAll(MATH_ENVIRONMENT)) ranges.push([match.index, match.index + match[0].length]);
  return ranges.filter(([from, to]) => to > from);
}

const noSpellcheck = Decoration.mark({ attributes: { spellcheck: 'false' } });

function decorations(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from, to,
      enter: (node) => {
        if (NOT_PROSE.has(node.name) && node.to > node.from) ranges.push(noSpellcheck.range(node.from, node.to));
      },
    });
  }
  for (const [from, to] of notProse(view.state.doc.toString())) ranges.push(noSpellcheck.range(from, to));
  return Decoration.set(ranges, true);
}

export const latexSpellcheck: Extension = [
  EditorView.contentAttributes.of({ spellcheck: 'true', autocorrect: 'off', autocapitalize: 'off' }),
  ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = decorations(view);
    }
    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged || syntaxTree(update.state) !== syntaxTree(update.startState)) {
        this.decorations = decorations(update.view);
      }
    }
  }, { decorations: (plugin) => plugin.decorations }),
];
