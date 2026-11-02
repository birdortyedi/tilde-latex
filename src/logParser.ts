import type { ProjectFile } from './projects';

// Reads a pdfLaTeX or XeLaTeX log and finds the errors, warnings and bad
// boxes, with the project file and line each one belongs to, so the user can
// click to jump there. Some get a hint on what to do about them.

export interface LogProblem {
  level: 'error' | 'warning' | 'badbox';
  message: string;
  file?: string; // path inside the project, e.g. "chapters/intro.tex"; missing for TeX's own files
  line?: number;
  hint?: string; // what to do about it, for problems with a known fix
}

// TeX wraps its log at this many characters (max_print_line in texmf.cnf).
const LINE_WIDTH = 79;

// Joins lines that TeX wrapped because they were exactly LINE_WIDTH long.
// An error's context lines are also padded to that width, so a line number
// line ("l.12 ...") always starts a new line.
function unwrap(log: string): string[] {
  const lines: string[] = [];
  let current = '';
  for (const line of log.split('\n')) {
    if (current && /^l\.\d+ /.test(line)) {
      lines.push(current);
      current = '';
    }
    current += line;
    if (line.length !== LINE_WIDTH) {
      lines.push(current);
      current = '';
    }
  }
  if (current) lines.push(current);
  return lines;
}

// "(./chapters/intro.tex" opens a file, but "(see the transcript" does not.
const looksLikeFile = (name: string): boolean => /^\.{0,2}\//.test(name) || /\.[A-Za-z]+$/.test(name);

const ERROR = /^! (.*)$/;
const ERROR_LINE = /^l\.(\d+) (.*)$/;
const WARNING = /^(?:LaTeX|Package (\S+)|Class (\S+)) Warning: (.*)$/;
const BADBOX = /^(Overfull|Underfull) \\[hv]box .*?lines? (\d+)/;
const PACKAGE_ERROR = /^(?:Fatal )?Package (\S+) Error:/;
// XeLaTeX: a character the font does not have, so it is left out of the PDF.
const MISSING_CHARACTER = /^Missing character: There is no (\S+)(?: \(U\+[0-9A-F]+\))? in font ([^:!/]+)/;
const IGNORED_ERRORS = ['Emergency stop.', ' ==> Fatal error occurred, no output PDF file produced!'];
// Warnings that say nothing useful in Tilde. epstopdf warns in every document
// that loads graphicx, because it may not start programs; an EPS image then
// fails with its own error, which gets a hint below.
const IGNORED_WARNINGS = [/^epstopdf: Shell escape feature is not enabled\./];

// Advice for problems that come from what Tilde cannot do, or that have a
// common fix. The first pattern that matches a message gives its hint.
const HINTS: [RegExp, (match: RegExpExecArray) => string][] = [
  [/minted executable is unavailable|shell[- ]escape|write18/i, () => 'Tilde runs in the browser and cannot start other '
    + 'programs, so packages that need shell escape, such as minted, do not work. For code listings, use the listings package.'],
  [/File `([^']+)-eps-converted-to\.pdf' not found/, (m) => `Tilde cannot convert EPS images in the browser. Convert `
    + `${m[1]}.eps to PDF and include that file instead.`],
  [/^LaTeX Error: File `([^']+)' not found/, (m) => `Tilde looked for ${m[1]} in the project and on the TeX Live `
    + 'package server. Check the spelling, or add the file to the project.'],
  [/The font "([^"]+)" cannot be found/, (m) => `"${m[1]}" is not one of the fonts that come with TeX Live. Tilde runs `
    + 'in the browser, so it cannot use the fonts installed on your computer. Try TeX Gyre Termes (like Times), '
    + 'TeX Gyre Heros (like Helvetica), Libertinus Serif or Noto Serif.'],
  [/^LaTeX Error: Unicode character .* not set up for use with LaTeX/, () => 'pdfLaTeX cannot typeset this character. '
    + 'Add \\usepackage{fontspec} to the preamble: Tilde then compiles with XeLaTeX, which handles any Unicode text.'],
  [/fontspec package requires either XeTeX or LuaTeX/, () => 'Remove the "% !TEX program = pdflatex" line from the main '
    + 'file, so Tilde compiles with XeLaTeX.'],
  [/^lineno: Line number reference failed/, () => 'This comes from the line numbers the template prints on review '
    + 'copies (the lineno package), and it stays however often you compile. The final version has no line numbers, '
    + 'and no such warning.'],
  [/^amsmath: Unable to redefine math accent \\vec/, () => 'The document class (llncs, for example) has its own '
    + '\\vec, for bold vectors, so amsmath leaves it as it is. This is harmless: \\vec keeps the look of the class.'],
  [/^hyperref: Token not allowed in a PDF string/, () => 'hyperref leaves this command out of the PDF\'s bookmarks or '
    + 'title field only. The printed page is not affected.'],
  [/^The font .* has no /, () => 'Choose a font that has these characters with \\setmainfont, for example Noto Serif, '
    + 'which covers Latin, Greek and Cyrillic.'],
];

function withHint(problem: LogProblem): LogProblem {
  for (const [pattern, hint] of HINTS) {
    const match = pattern.exec(problem.message);
    if (match) return { ...problem, hint: hint(match) };
  }
  return problem;
}

export function parseLog(log: string, files: ProjectFile[]): LogProblem[] {
  const lines = unwrap(log);
  const projectPaths = new Set(files.map((f) => f.path));
  // Files TeX is reading, innermost last. null stands for a "(" that is not a
  // file, so that its ")" does not close a real file.
  const stack: (string | null)[] = [];
  const problems: LogProblem[] = [];
  const missing = new Map<string, Set<string>>(); // font → the characters it does not have

  const currentFile = (): string | undefined => {
    for (let i = stack.length - 1; i >= 0; i--) {
      const name = stack[i];
      if (name !== null) {
        const path = name.replace(/^\.\//, '');
        return projectPaths.has(path) ? path : undefined;
      }
    }
    return undefined;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const error = ERROR.exec(line);
    if (error) {
      if (IGNORED_ERRORS.includes(error[1])) continue;
      // The message can go on over more lines: "(fontspec)  The font ..." for
      // a package error, indented text for a LaTeX error.
      let message = error[1];
      const name = PACKAGE_ERROR.exec(message)?.[1];
      const continues = (next: string | undefined): boolean => next !== undefined
        && (name ? next.startsWith(`(${name})`) : message.startsWith('LaTeX Error:') && /^\s{4,}\S/.test(next));
      while (continues(lines[i + 1])) {
        i++;
        message += ` ${(name ? lines[i].slice(name.length + 2) : lines[i]).trim()}`;
      }
      const problem: LogProblem = { level: 'error', message: message.replace(/:\s+/, ': '), file: currentFile() };
      // The line number comes a few lines later: "l.3 Intro \badmacro".
      for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
        const where = ERROR_LINE.exec(lines[j]);
        if (where) {
          problem.line = Number(where[1]);
          locate(problem, where[2], files);
          i = j + 1; // skip the context lines, which may hold unbalanced "(" from the document
          break;
        }
      }
      problems.push(problem);
      continue;
    }

    const warning = WARNING.exec(line);
    if (warning) {
      let message = warning[3];
      // Package warnings continue on lines that start with "(package name)".
      const name = warning[1] ?? warning[2];
      while (name && lines[i + 1]?.startsWith(`(${name})`)) {
        i++;
        message += ` ${lines[i].slice(name.length + 2).trim()}`;
      }
      const at = /on input line (\d+)\.?$/.exec(message);
      if (IGNORED_WARNINGS.some((pattern) => pattern.test(name ? `${name}: ${message}` : message))) continue;
      problems.push({
        level: 'warning',
        message: name ? `${name}: ${message}` : message,
        file: currentFile(),
        line: at ? Number(at[1]) : undefined,
      });
      continue;
    }

    const lost = MISSING_CHARACTER.exec(line);
    if (lost) {
      const font = lost[2].replace(/^\[|\]$/g, '').trim();
      missing.set(font, (missing.get(font) ?? new Set()).add(lost[1]));
      continue;
    }

    const badbox = BADBOX.exec(line);
    if (badbox) {
      problems.push({ level: 'badbox', message: line, file: currentFile(), line: Number(badbox[2]) });
      continue;
    }

    for (const match of line.matchAll(/\(([^\s()]*)|\)/g)) {
      if (match[0] === ')') stack.pop();
      else stack.push(looksLikeFile(match[1]) ? match[1] : null);
    }
  }
  for (const [font, characters] of missing) {
    const list = [...characters].join(' ');
    problems.push({ level: 'warning', message: `The font ${font} has no ${list}, so ${characters.size === 1 ? 'it is' : 'they are'} left out of the PDF.` });
  }
  return unique(problems).map(withHint);
}

// Checks that the text TeX showed ("Intro \badmacro") is really on that line
// of that file. If not (the file guess can be wrong), looks for the one
// project file where it is.
function locate(problem: LogProblem, shown: string, files: ProjectFile[]): void {
  const snippet = shown.replace(/^\.\.\./, '').trim();
  if (!snippet || problem.line === undefined) return;
  const lineIndex = problem.line - 1;
  const hasSnippet = (file: ProjectFile): boolean =>
    typeof file.content === 'string' && (file.content.split('\n')[lineIndex] ?? '').includes(snippet);

  const guessed = files.find((f) => f.path === problem.file);
  if (guessed && hasSnippet(guessed)) return;
  const matches = files.filter(hasSnippet);
  if (matches.length === 1) problem.file = matches[0].path;
}

function unique(problems: LogProblem[]): LogProblem[] {
  const seen = new Set<string>();
  return problems.filter((p) => {
    const key = `${p.level}|${p.message}|${p.file}|${p.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// The log of the last pdfLaTeX or XeLaTeX run: it has the final word on errors
// and warnings (earlier runs may still miss references that later runs fix).
export function lastLatexLog(logs: { cmd: string; log: string }[]): string {
  return logs.filter((l) => /^(pdf|xe)latex/.test(l.cmd) && l.log).at(-1)?.log ?? '';
}
