import { describe, expect, it } from 'vitest';
import { lastLatexLog, parseLog } from './logParser';
import type { ProjectFile } from './projects';

// The start of a real pdfLaTeX log: main.tex opens, the article class loads and closes.
const START = [
  'This is pdfTeX, Version 3.141592653-2.6-1.40.29 (TeX Live 2026_texlyre_busytexwasm)',
  '**main.tex',
  '(./main.tex',
  'LaTeX2e <2025-11-01>',
  '(/texlive/texmf-dist/tex/latex/base/article.cls',
  'Document Class: article 2025/01/22 v1.4n Standard LaTeX document class',
  '(/texlive/texmf-dist/tex/latex/base/size10.clo',
  'File: size10.clo 2025/01/22 v1.4n Standard LaTeX file (size option)',
  ')',
  '\\c@part=\\count275',
  ')',
].join('\n');

const files: ProjectFile[] = [
  { path: 'main.tex', content: '\\documentclass{article}\n\\begin{document}\nHello\n\\input{chapters/intro}\nAfter \\ref{nolabel}\n\\end{document}\n' },
  { path: 'chapters/intro.tex', content: 'Intro line one\n\nIntro \\badmacro{x} here\n' },
];

const log = (...lines: string[]) => [START, ...lines].join('\n');

describe('parseLog', () => {
  it('finds an error in an \\input file, with its line (real log)', () => {
    const problems = parseLog(log(
      '(./chapters/intro.tex',
      '! Undefined control sequence.',
      'l.3 Intro \\badmacro',
      '                   {x} here',
      'The control sequence at the end of the top line',
      'of your error message was never \\def\'ed.',
      '',
      '!  ==> Fatal error occurred, no output PDF file produced!',
    ), files);
    expect(problems).toEqual([
      { level: 'error', message: 'Undefined control sequence.', file: 'chapters/intro.tex', line: 3 },
    ]);
  });

  it('finds the line when the error context is padded to 79 characters (real log)', () => {
    const intro = { path: 'chapters/intro.tex', content: '\\chapter{Introduct \\badmacro{x}ion}\n' };
    const problems = parseLog(log(
      '(./chapters/intro.tex',
      'Chapter 1.',
      '! Undefined control sequence.',
      '<argument> ...e {\\thechapter }Introduct \\badmacro ',
      `${' '.repeat(50)}{x}ion}{\\thepage }{}\\prote...`,
      'l.1 \\chapter{Introduct \\badmacro{x}ion}',
      ' '.repeat(39),
      '!  ==> Fatal error occurred, no output PDF file produced!',
    ), [files[0], intro]);
    expect(problems).toEqual([
      { level: 'error', message: 'Undefined control sequence.', file: 'chapters/intro.tex', line: 1 },
    ]);
  });

  it('gives a warning to the file TeX was reading at the time', () => {
    const problems = parseLog(log(
      '(./chapters/intro.tex)',
      'LaTeX Warning: Reference `nolabel\' on page 1 undefined on input line 5.',
    ), files);
    expect(problems).toEqual([
      { level: 'warning', message: 'Reference `nolabel\' on page 1 undefined on input line 5.', file: 'main.tex', line: 5 },
    ]);
  });

  it('joins package warnings that continue on "(package)" lines', () => {
    const problems = parseLog(log(
      'Package hyperref Warning: Token not allowed in a PDF string (Unicode):',
      '(hyperref)                removing `\\textbf\' on input line 7.',
    ), files);
    expect(problems).toEqual([{
      level: 'warning',
      message: 'hyperref: Token not allowed in a PDF string (Unicode): removing `\\textbf\' on input line 7.',
      file: 'main.tex',
      line: 7,
      hint: expect.stringContaining('printed page'),
    }]);
  });

  it('finds bad boxes with their line', () => {
    const [problem] = parseLog(log(
      'Overfull \\hbox (12.3pt too wide) in paragraph at lines 10--12',
      '[]\\OT1/cmr/m/n/10 Some text',
    ), files);
    expect(problem).toMatchObject({ level: 'badbox', file: 'main.tex', line: 10 });
  });

  it('follows file names that TeX wrapped at 79 characters', () => {
    const name = `chapters/${'a'.repeat(70)}.tex`;
    const opened = `(./${name}`;
    const problems = parseLog(log(
      opened.slice(0, 79),
      opened.slice(79),
      '! Undefined control sequence.',
      'l.1 \\oops',
    ), [...files, { path: name, content: '\\oops\n' }]);
    expect(problems[0]).toMatchObject({ file: name, line: 1 });
  });

  it('is not confused by parentheses in messages or in the document text', () => {
    const problems = parseLog(log(
      '(see the transcript file for additional information)',
      '! Missing $ inserted.',
      'l.3 Hello (see Fig',
      '                  ure 2',
      'LaTeX Warning: There were undefined references.',
    ), files);
    expect(problems.map((p) => p.file)).toEqual(['main.tex', 'main.tex']);
  });

  it('corrects the file when the shown text is only found in another file', () => {
    const problems = parseLog(log(
      '! Undefined control sequence.',
      'l.3 Intro \\badmacro',
    ), files);
    expect(problems[0]).toMatchObject({ file: 'chapters/intro.tex', line: 3 });
  });

  it('leaves out the file for problems inside TeX\'s own files', () => {
    const problems = parseLog([
      '(/texlive/texmf-dist/tex/latex/base/article.cls',
      'LaTeX Warning: Something odd.',
    ].join('\n'), files);
    expect(problems).toEqual([{ level: 'warning', message: 'Something odd.', file: undefined, line: undefined }]);
  });
});

describe('hints', () => {
  it('joins a package error that goes on over "(package)" lines, and suggests TeX Live fonts (real log)', () => {
    const [problem] = parseLog(log(
      '! Package fontspec Error: ',
      '(fontspec)                The font "Arial" cannot be found; this may be but',
      '(fontspec)                usually is not a fontspec bug.',
      '',
      'l.3 \\setmainfont{Arial}',
    ), files);
    expect(problem.message).toBe('Package fontspec Error: The font "Arial" cannot be found; this may be but usually is not a fontspec bug.');
    expect(problem.line).toBe(3);
    expect(problem.hint).toContain('TeX Gyre Termes');
  });

  it('explains that minted needs shell escape (real log)', () => {
    const [problem] = parseLog(log(
      '! Package minted Error: Missing definition for highlighting style "default" (mi',
      'nted executable is unavailable or disabled); attempting to substitute fallback ',
      'style.',
    ), files);
    expect(problem.hint).toContain('listings');
  });

  it('suggests fontspec when pdfLaTeX cannot typeset a character (real log)', () => {
    const [problem] = parseLog(log(
      '! LaTeX Error: Unicode character ^^d0^^9f (U+041F)',
      '               not set up for use with LaTeX.',
      '',
      'l.3 ^^d',
    ), files);
    expect(problem.message).toBe('LaTeX Error: Unicode character ^^d0^^9f (U+041F) not set up for use with LaTeX.');
    expect(problem.hint).toContain('\\usepackage{fontspec}');
  });

  it('names a missing package file', () => {
    const [problem] = parseLog(log("! LaTeX Error: File `notapackage.sty' not found."), files);
    expect(problem.hint).toContain('notapackage.sty');
  });

  it('collects the characters a font does not have into one warning (real log)', () => {
    const problems = parseLog(log(
      'Missing character: There is no П (U+041F) in font [lmroman10-regular]:mapping=t',
      'ex-text;!',
      'Missing character: There is no р (U+0440) in font [lmroman10-regular]:mapping=t',
      'ex-text;!',
      'Missing character: There is no П (U+041F) in font [lmroman10-regular]:mapping=t',
      'ex-text;!',
    ), files);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ level: 'warning', message: 'The font lmroman10-regular has no П р, so they are left out of the PDF.' });
    expect(problems[0].hint).toContain('Noto Serif');
  });

  it('leaves out the epstopdf warning every graphicx document gets, and explains EPS images (real log)', () => {
    const problems = parseLog(log(
      'Package epstopdf Warning: Shell escape feature is not enabled.',
      '',
      "! Package pdftex.def Error: File `figures/plot-eps-converted-to.pdf' not found:",
      '(pdftex.def)                using draft setting.',
    ), files);
    expect(problems).toHaveLength(1);
    expect(problems[0].hint).toContain('Convert figures/plot.eps to PDF');
  });

  it('explains the review line-number warning and hyperref\'s PDF string warning (real logs)', () => {
    const problems = parseLog(log(
      'Package lineno Warning: Line number reference failed,',
      '(lineno)                re-run to get it right.',
      'Package hyperref Warning: Token not allowed in a PDF string (Unicode):',
      "(hyperref)                removing `\\\\' on input line 110.",
    ), files);
    expect(problems.map((p) => p.hint)).toEqual([expect.stringContaining('final version'), expect.stringContaining('printed page')]);
  });

  it('explains the \\vec warning amsmath gives with llncs (real log)', () => {
    const [problem] = parseLog(log('Package amsmath Warning: Unable to redefine math accent \\vec.'), files);
    expect(problem.hint).toContain('harmless');
  });

  it('explains a raw TeX font that LuaLaTeX cannot draw (real log, ICCV kit)', () => {
    const [problem] = parseLog(log('! error:  (file 3_ptmb) (type 3): font 3_ptmb at 660 not found'), files);
    expect(problem.hint).toContain('old TeX font ptmb');
    expect(problem.hint).toContain('pdfLaTeX');
  });

  it('gives no hint to ordinary errors', () => {
    const [problem] = parseLog(log('! Undefined control sequence.', 'l.3 Intro \\badmacro'), files);
    expect(problem.hint).toBeUndefined();
  });
});

describe('lastLatexLog', () => {
  it('reads LuaLaTeX runs too', () => {
    expect(lastLatexLog([{ cmd: 'luahblatex main.tex', log: 'lua' }, { cmd: 'biber main', log: 'b' }])).toBe('lua');
  });

  it('reads XeLaTeX runs too', () => {
    expect(lastLatexLog([
      { cmd: 'xelatex --no-pdf main.tex', log: 'xe' },
      { cmd: 'xdvipdfmx -o main.pdf main.xdv', log: 'pdf' },
    ])).toBe('xe');
  });

  it('picks the log of the last pdfLaTeX run, not BibTeX', () => {
    expect(lastLatexLog([
      { cmd: 'pdflatex main.tex', log: 'first' },
      { cmd: 'bibtex8 main', log: 'bib' },
      { cmd: 'pdflatex main.tex', log: 'last' },
      { cmd: 'bibtex8 main', log: 'bib again' },
    ])).toBe('last');
  });
});
