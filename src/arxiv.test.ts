import { describe, expect, it } from 'vitest';
import { arxivFiles, stripComments } from './arxiv';

describe('Download for arXiv', () => {
  it('takes comments out, keeping the % that ends a line', () => {
    const source = '% !TEX program = xelatex\n% a note to myself\nText with 50\\% % secret\n  % indented note\n\\foo%\nEnd.';
    expect(stripComments(source)).toBe('% !TEX program = xelatex\nText with 50\\% %\n\\foo%\nEnd.');
  });

  it('leaves verbatim text as it is', () => {
    const source = '\\begin{verbatim}\n% printed\n\\end{verbatim}\n% gone\n\\begin{lstlisting}\nx = 1 % printed too\n\\end{lstlisting}';
    expect(stripComments(source)).toBe('\\begin{verbatim}\n% printed\n\\end{verbatim}\n\\begin{lstlisting}\nx = 1 % printed too\n\\end{lstlisting}');
  });

  it('adds the main file\'s .bbl and leaves the other build files out', () => {
    const project = [{ path: 'paper.tex', content: 'x % y' }, { path: 'refs.bib', content: '% kept\n@book{a,}' }, { path: 'fig.png', content: new Uint8Array([1]) }];
    const build = [{ path: 'paper.aux', content: '' }, { path: 'paper.bbl', content: 'bbl' }];
    const { files, bbl } = arxivFiles(project, build, 'paper.tex', true);
    expect(bbl).toBe('paper.bbl');
    expect(files.map((f) => [f.path, f.content])).toEqual([
      ['paper.tex', 'x %'], ['refs.bib', '% kept\n@book{a,}'], ['fig.png', new Uint8Array([1])], ['paper.bbl', 'bbl'],
    ]);
    expect(arxivFiles(project, [], 'paper.tex', false).files[0].content).toBe('x % y');
  });
});
