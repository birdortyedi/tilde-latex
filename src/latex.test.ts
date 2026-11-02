import { describe, expect, it } from 'vitest';
import { bibKeysIn, completionContext, labelsIn, outline, unclosedEnvironment, withoutComment } from './latex';

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
