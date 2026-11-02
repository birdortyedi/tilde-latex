import { isTextFile } from './fileTree';
import type { ProjectFile } from './projects';

// What Tilde reads out of a project's LaTeX source: labels for \ref, keys
// for \cite, the outline of sections, and what kind of completion fits
// where the cursor is.

const text = (file: ProjectFile): string => (typeof file.content === 'string' ? file.content : '');

// A line without its comment: everything from an unescaped % on.
export function withoutComment(line: string): string {
  const match = /(^|[^\\])%/.exec(line);
  return match ? line.slice(0, match.index + match[1].length) : line;
}

// Every \label{...} in the project's .tex files.
export function labelsIn(files: ProjectFile[]): string[] {
  const labels = new Set<string>();
  for (const file of files) {
    if (!file.path.endsWith('.tex')) continue;
    for (const line of text(file).split('\n')) {
      for (const match of withoutComment(line).matchAll(/\\label\{([^}]+)\}/g)) labels.add(match[1].trim());
    }
  }
  return [...labels].sort();
}

// Every entry key in the project's .bib files, e.g. "knuth1984" from "@book{knuth1984,".
export function bibKeysIn(files: ProjectFile[]): string[] {
  const keys = new Set<string>();
  for (const file of files) {
    if (!file.path.endsWith('.bib')) continue;
    for (const match of text(file).matchAll(/@(\w+)\s*\{\s*([^,\s]+)\s*,/g)) {
      if (!['comment', 'string', 'preamble'].includes(match[1].toLowerCase())) keys.add(match[2]);
    }
  }
  return [...keys].sort();
}

export interface OutlineEntry {
  level: number; // 0 = part, 1 = chapter, 2 = section, 3 = subsection, 4 = subsubsection
  title: string;
  file: string;
  line: number; // 1 = first line
}

const LEVELS: Record<string, number> = { part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4 };

// The document's headings in reading order, starting at the main file and
// following \input and \include into the files they name.
export function outline(files: ProjectFile[], mainPath: string): OutlineEntry[] {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const entries: OutlineEntry[] = [];
  const visited = new Set<string>();

  const walk = (path: string): void => {
    const file = byPath.get(path) ?? byPath.get(`${path}.tex`);
    if (!file || visited.has(file.path) || !isTextFile(file.path)) return;
    visited.add(file.path);
    text(file).split('\n').forEach((raw, index) => {
      const line = withoutComment(raw);
      for (const match of line.matchAll(/\\(part|chapter|section|subsection|subsubsection|input|include)\*?(?:\[[^\]]*\])?\{([^}]*)\}/g)) {
        const [, command, argument] = match;
        if (command === 'input' || command === 'include') walk(argument.trim());
        else entries.push({ level: LEVELS[command], title: argument.trim(), file: file.path, line: index + 1 });
      }
    });
  };
  walk(mainPath);
  return entries;
}

// Which program makes the bibliography: Biber for biblatex (its default
// backend), BibTeX for natbib, plain \bibliography or biblatex with
// backend=bibtex, none when the project has no .bib file.
export function bibliographyTool(files: ProjectFile[]): 'biber' | 'bibtex' | null {
  if (!files.some((f) => f.path.endsWith('.bib'))) return null;
  for (const file of files) {
    if (!file.path.endsWith('.tex')) continue;
    for (const raw of text(file).split('\n')) {
      const match = /\\usepackage(?:\[([^\]]*)\])?\{[^}]*\bbiblatex\b[^}]*\}/.exec(withoutComment(raw));
      if (match) return /backend\s*=\s*bibtex/.test(match[1] ?? '') ? 'bibtex' : 'biber';
    }
  }
  return 'bibtex';
}

export type TexEngine = 'pdflatex' | 'xelatex';

// Packages that only work with XeLaTeX (or LuaLaTeX): Unicode fonts and scripts.
const XETEX_PACKAGES = ['fontspec', 'polyglossia', 'unicode-math', 'xeCJK', 'mathspec', 'xltxtra', 'xunicode'];

// Which program compiles the project. The main file can say so with a line
// like "% !TEX program = xelatex" (the convention other editors use too).
// Otherwise XeLaTeX when a file loads fontspec or another package that needs
// it, and pdfLaTeX for everything else, since it is faster.
export function texEngine(files: ProjectFile[], mainPath: string): TexEngine {
  const main = files.find((f) => f.path === mainPath);
  const asked = /^\s*%\s*!\s*TEX\s+(?:TS-)?program\s*=\s*(pdflatex|xelatex)\b/im.exec(main ? text(main) : '');
  if (asked) return asked[1].toLowerCase() as TexEngine;
  for (const file of files) {
    if (!/\.(tex|sty|cls)$/.test(file.path)) continue;
    for (const raw of text(file).split('\n')) {
      for (const match of withoutComment(raw).matchAll(/\\(?:usepackage|RequirePackage)(?:\[[^\]]*\])?\{([^}]*)\}/g)) {
        if (match[1].split(',').some((name) => XETEX_PACKAGES.includes(name.trim()))) return 'xelatex';
      }
    }
  }
  return 'pdflatex';
}

export type CompletionKind = 'command' | 'environment' | 'label' | 'citation' | 'texfile' | 'image';

export interface CompletionContext {
  kind: CompletionKind;
  from: number; // where the word being completed starts, as an offset into `before`
  typed: string; // what has been typed of it so far
}

// What to complete, given the text of the line before the cursor.
export function completionContext(before: string): CompletionContext | null {
  const argument = (pattern: RegExp, kind: CompletionKind): CompletionContext | null => {
    const match = pattern.exec(before);
    if (!match) return null;
    // In \cite{a,b,c} only the key after the last comma is being typed.
    const typed = kind === 'citation' ? match[1].split(',').pop()?.trimStart() ?? '' : match[1];
    return { kind, from: before.length - typed.length, typed };
  };
  return argument(/\\(?:begin|end)\{([^}]*)$/, 'environment')
    ?? argument(/\\(?:ref|eqref|pageref|autoref|cref|Cref|vref|nameref)\{([^}]*)$/, 'label')
    ?? argument(/\\(?:cite|citep|citet|citealp|citealt|citeauthor|citeyear|nocite|parencite|textcite|autocite)\*?(?:\[[^\]]*\]){0,2}\{([^}]*)$/, 'citation')
    ?? argument(/\\(?:input|include|subfile)\{([^}]*)$/, 'texfile')
    ?? argument(/\\includegraphics(?:\[[^\]]*\])?\{([^}]*)$/, 'image')
    ?? argument(/\\([A-Za-z]*)$/, 'command')
    // The command case starts at the backslash.
    ?? null;
}

// After Enter on a line that opens an environment ("\begin{figure}[h]"):
// the environment's name if it is not closed yet, so \end{...} can be added.
export function unclosedEnvironment(line: string, documentText: string): string | null {
  const match = /\\begin\{([A-Za-z*]+)\}(?:\[[^\]]*\]|\{[^}]*\})*\s*$/.exec(withoutComment(line));
  if (!match) return null;
  const name = match[1];
  const escaped = name.replace('*', '\\*');
  const count = (pattern: string): number => (documentText.match(new RegExp(pattern, 'g')) ?? []).length;
  return count(`\\\\begin\\{${escaped}\\}`) > count(`\\\\end\\{${escaped}\\}`) ? name : null;
}
