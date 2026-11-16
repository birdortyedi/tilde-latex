import { withoutComment } from './latex';
import type { ProjectFile } from './projects';

// "Download for arXiv": the project's files as arXiv and most journals want
// them. The compiled bibliography (.bbl) goes in, because arXiv does not run
// BibTeX or Biber; build files stay out; comments can be taken out, because
// arXiv shows everyone the source.

// Environments whose lines LaTeX prints as they are: a % in them is not a comment.
const VERBATIM = ['verbatim', 'verbatim*', 'Verbatim', 'lstlisting', 'alltt', 'filecontents', 'filecontents*'];

// A .tex file's text without its comments. A line that is only a comment
// goes; a comment after text leaves its %, so the line ends the same way for
// LaTeX (a % at the end of a line stops a space). Lines like
// "% !TEX program = xelatex" stay, since editors read them.
export function stripComments(text: string): string {
  const lines: string[] = [];
  let verbatim: string | null = null;
  for (const line of text.split('\n')) {
    if (verbatim) {
      lines.push(line);
      if (line.includes(`\\end{${verbatim}}`)) verbatim = null;
      continue;
    }
    const begin = /\\begin\{([^}]+)\}/.exec(withoutComment(line));
    if (begin && VERBATIM.includes(begin[1]) && !line.includes(`\\end{${begin[1]}}`)) {
      verbatim = begin[1];
      lines.push(line);
      continue;
    }
    if (/^\s*%\s*!/.test(line)) {
      lines.push(line);
      continue;
    }
    const code = withoutComment(line);
    if (code === line) lines.push(line);
    else if (code.trim() !== '') lines.push(`${code}%`);
    // else: a line that is only a comment
  }
  return lines.join('\n');
}

export interface ArxivFiles {
  files: ProjectFile[];
  bbl: string | null; // the .bbl file put in, if any
}

// The files for arXiv: every file of the project (with comments taken out of
// the .tex files if `strip`), and the .bbl of the main file from the last compile.
export function arxivFiles(project: ProjectFile[], build: ProjectFile[], mainPath: string, strip: boolean): ArxivFiles {
  const files = project.map((file) => ({
    path: file.path,
    content: strip && file.path.endsWith('.tex') && typeof file.content === 'string' ? stripComments(file.content) : file.content,
  }));
  const bblPath = mainPath.replace(/\.tex$/, '.bbl');
  const bbl = build.find((f) => f.path === bblPath && !project.some((p) => p.path === bblPath));
  if (bbl) files.push({ path: bbl.path, content: bbl.content });
  return { files, bbl: bbl ? bbl.path : null };
}
