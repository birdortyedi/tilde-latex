import { describe, expect, it } from 'vitest';
import { searchProject } from './goTo';

describe('Go to anything', () => {
  const files = [
    { path: 'main.tex', content: '\\documentclass{article}\n\\begin{document}\n\\section{Introduction}\\label{sec:intro}\nWe use transformers.\n\\input{chapters/method}\n\\end{document}' },
    { path: 'chapters/method.tex', content: '\\section{Method}\n\\label{sec:method}\nA transformer encoder.' },
    { path: 'refs.bib', content: '@article{vaswani2017,\n title={Attention}}\n' },
    { path: 'fig/plot.png', content: new Uint8Array([1]) },
  ];
  const show = (typed: string) => searchProject(files, 'main.tex', typed).map((h) => `${h.kind} ${h.label} ${h.detail}`);

  it('shows the files and headings before anything is typed', () => {
    expect(show('')).toEqual([
      'file main.tex main.tex', 'file method.tex chapters/method.tex', 'file plot.png fig/plot.png', 'file refs.bib refs.bib',
      'heading Introduction main.tex:3', 'heading Method chapters/method.tex:1',
    ]);
  });

  it('finds files, headings, labels, citation keys and text, best matches first', () => {
    expect(show('method')).toEqual([
      'file method.tex chapters/method.tex', 'heading Method chapters/method.tex:1', 'label sec:method chapters/method.tex:2',
      'text \\input{chapters/method} main.tex:5', 'text \\section{Method} chapters/method.tex:1', 'text \\label{sec:method} chapters/method.tex:2',
    ]);
    expect(show('vaswani')[0]).toBe('citation vaswani2017 refs.bib:1');
  });

  it('marks where the text matched', () => {
    const hit = searchProject(files, 'main.tex', 'Transformer').find((h) => h.kind === 'text' && h.file === 'main.tex');
    expect(hit && hit.label.slice(...(hit.match ?? [0, 0]))).toBe('transformer');
    expect(hit?.column).toBe(7);
  });
});
