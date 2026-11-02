import type { ProjectFile } from './projects';

// Reads a pdfLaTeX log and finds the errors, warnings and bad boxes, with the
// project file and line each one belongs to, so the user can click to jump there.

export interface LogProblem {
  level: 'error' | 'warning' | 'badbox';
  message: string;
  file?: string; // path inside the project, e.g. "chapters/intro.tex"; missing for TeX's own files
  line?: number;
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
const IGNORED_ERRORS = ['Emergency stop.', ' ==> Fatal error occurred, no output PDF file produced!'];

export function parseLog(log: string, files: ProjectFile[]): LogProblem[] {
  const lines = unwrap(log);
  const projectPaths = new Set(files.map((f) => f.path));
  // Files TeX is reading, innermost last. null stands for a "(" that is not a
  // file, so that its ")" does not close a real file.
  const stack: (string | null)[] = [];
  const problems: LogProblem[] = [];

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
      const problem: LogProblem = { level: 'error', message: error[1], file: currentFile() };
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
      problems.push({
        level: 'warning',
        message: name ? `${name}: ${message}` : message,
        file: currentFile(),
        line: at ? Number(at[1]) : undefined,
      });
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
  return unique(problems);
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

// The log of the last pdfLaTeX run: it has the final word on errors and
// warnings (earlier runs may still miss references that later runs fix).
export function lastLatexLog(logs: { cmd: string; log: string }[]): string {
  return logs.filter((l) => l.cmd.startsWith('pdflatex') && l.log).at(-1)?.log ?? '';
}
