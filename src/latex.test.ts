import { describe, expect, it } from 'vitest';
import { bibKeysIn, bibliographyTool, completionContext, foldEnd, labelsIn, loadsPackage, preambleInsertAt, outline, texEngine, unclosedEnvironment, withoutComment } from './latex';

const files = [
  { path: 'main.tex', content: '\\documentclass{report}\n\\begin{document}\n\\chapter{Intro}\\label{chap:intro}\n% \\section{Hidden}\n\\input{chapters/method}\n\\section*{Summary}\n\\end{document}\n' },
  { path: 'chapters/method.tex', content: '\\section{Method}\n\\label{sec:method}\n\\subsection[Short]{Data}\n' },
  { path: 'refs.bib', content: '@book{knuth1984,\n title={The TeXbook}}\n@string{x = "y"}\n@Article{ lamport1994 ,\n}\n' },
  { path: 'figures/plot.png', content: new Uint8Array([1]) },
];

describe('reading LaTeX source', () => {
  it('drops comments but keeps escaped percent signs', () => {
    expect(withoutComment('50\\% done % really')).toBe('50\\% done ');
    expect(withoutComment('% all comment')).toBe('');
  });

  it('finds labels and bibliography keys', () => {
    expect(labelsIn(files)).toEqual(['chap:intro', 'sec:method']);
    expect(bibKeysIn(files)).toEqual(['knuth1984', 'lamport1994']);
  });

  it('builds the outline in reading order, through \\input, without commented headings', () => {
    expect(outline(files, 'main.tex').map((e) => `${e.level} ${e.title} ${e.file}:${e.line}`)).toEqual([
      '1 Intro main.tex:3',
      '2 Method chapters/method.tex:1',
      '3 Data chapters/method.tex:3',
      '2 Summary main.tex:6',
    ]);
  });
});

describe('bibliographyTool', () => {
  const bib = { path: 'refs.bib', content: '@book{a,}' };
  const tex = (content: string) => ({ path: 'main.tex', content });
  it('uses Biber for biblatex, BibTeX otherwise', () => {
    expect(bibliographyTool([tex('\\usepackage[style=authoryear]{biblatex}'), bib])).toBe('biber');
    expect(bibliographyTool([tex('\\usepackage[backend=bibtex,style=numeric]{biblatex}'), bib])).toBe('bibtex');
    expect(bibliographyTool([tex('\\usepackage[round]{natbib}'), bib])).toBe('bibtex');
    expect(bibliographyTool([tex('% \\usepackage{biblatex}'), bib])).toBe('bibtex');
    expect(bibliographyTool([tex('\\usepackage{biblatex}')])).toBeNull(); // no .bib file
  });
});

describe('texEngine', () => {
  const tex = (content: string, path = 'main.tex') => ({ path, content });
  it('uses XeLaTeX for fontspec and similar packages, pdfLaTeX otherwise', () => {
    expect(texEngine([tex('\\usepackage{amsmath}')], 'main.tex')).toBe('pdflatex');
    expect(texEngine([tex('\\usepackage{fontspec}')], 'main.tex')).toBe('xelatex');
    expect(texEngine([tex('\\usepackage[english]{babel}\n\\usepackage{amsmath,unicode-math}')], 'main.tex')).toBe('xelatex');
    expect(texEngine([tex('x'), tex('\\RequirePackage{polyglossia}', 'mystyle.sty')], 'main.tex')).toBe('xelatex');
    expect(texEngine([tex('% \\usepackage{fontspec}')], 'main.tex')).toBe('pdflatex');
  });

  it('follows a "% !TEX program" line in the main file', () => {
    expect(texEngine([tex('% !TEX program = xelatex\n\\documentclass{article}')], 'main.tex')).toBe('xelatex');
    expect(texEngine([tex('%!TEX TS-program = pdflatex\n\\usepackage{fontspec}')], 'main.tex')).toBe('pdflatex');
  });
});

describe('completionContext', () => {
  it('knows what is being typed', () => {
    expect(completionContext('Some text \\sec')).toEqual({ kind: 'command', from: 11, typed: 'sec' });
    expect(completionContext('\\begin{fig')).toMatchObject({ kind: 'environment', typed: 'fig' });
    expect(completionContext('see Figure~\\ref{fig:')).toMatchObject({ kind: 'label', typed: 'fig:' });
    expect(completionContext('\\citep[p.~3]{knuth1984, lam')).toMatchObject({ kind: 'citation', typed: 'lam' });
    expect(completionContext('\\input{chap')).toMatchObject({ kind: 'texfile', typed: 'chap' });
    expect(completionContext('\\includegraphics[width=3cm]{fig')).toMatchObject({ kind: 'image', typed: 'fig' });
  });

  it('offers nothing in plain text', () => {
    expect(completionContext('Just words')).toBeNull();
    expect(completionContext('\\ref{done} and')).toBeNull();
  });
});

describe('unclosedEnvironment', () => {
  it('names an environment that still needs its \\end', () => {
    expect(unclosedEnvironment('  \\begin{figure}[h]', '\\begin{figure}[h]\n')).toBe('figure');
    expect(unclosedEnvironment('\\begin{tabular}{ll}', '\\begin{tabular}{ll}')).toBe('tabular');
    expect(unclosedEnvironment('\\begin{align*}', '\\begin{align*}')).toBe('align*');
  });

  it('does nothing when the environment is already closed, or the line has more text', () => {
    expect(unclosedEnvironment('\\begin{figure}', '\\begin{figure}\n\\end{figure}')).toBeNull();
    expect(unclosedEnvironment('\\begin{figure} text', '\\begin{figure} text')).toBeNull();
  });
});

describe('foldEnd', () => {
  const doc = [
    '\\section{Intro}', //            1
    'Text.', //                       2
    '\\begin{figure}[h]', //        3
    '  \\begin{figure}', //         4 (nested, same name)
    '  \\end{figure}', //           5
    '  \\caption{A}', //            6
    '\\end{figure}', //             7
    '\\subsection{Detail}', //      8
    'More.', //                       9
    '', //                            10
    '\\section{Next}', //           11
    'Last.', //                       12
    '\\end{document}', //           13
  ];
  const fold = (line: number) => foldEnd((n) => doc[n - 1], line, doc.length);

  it('folds an environment up to the line before its \\end, past nested ones', () => {
    expect(fold(3)).toBe(6);
    expect(fold(4)).toBeNull(); // nothing between \\begin and \\end
  });

  it('folds a heading up to the next heading of the same or a higher level', () => {
    expect(fold(1)).toBe(9); // the blank line 10 stays in view
    expect(fold(8)).toBe(9);
    expect(fold(11)).toBe(12); // stops at \\end{document}
  });

  it('does not fold other lines', () => {
    expect(fold(2)).toBeNull();
    expect(foldEnd(() => '% \\section{Commented out}', 1, 1)).toBeNull();
  });
});

describe('the preamble', () => {
  it('knows whether a package is loaded, also in a list or a .sty file', () => {
    expect(loadsPackage([{ path: 'main.tex', content: '\\usepackage{amsmath,graphicx}' }], ['graphicx'])).toBe(true);
    expect(loadsPackage([{ path: 'my.sty', content: '\\RequirePackage[draft]{graphicx}' }], ['graphicx'])).toBe(true);
    expect(loadsPackage([{ path: 'main.tex', content: '% \\usepackage{graphicx}' }], ['graphicx'])).toBe(false);
  });

  it('puts a new package line right after \\documentclass', () => {
    const source = '% A paper\n\\documentclass[11pt]{article} % comment\n\\begin{document}\n';
    const at = preambleInsertAt(source) ?? -1;
    expect(source.slice(at)).toBe('\\begin{document}\n');
    expect(preambleInsertAt('no class here')).toBeNull();
  });
});
