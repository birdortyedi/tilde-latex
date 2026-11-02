import { describe, expect, it } from 'vitest';
import { buildTree, isTextFile } from './fileTree';

describe('buildTree', () => {
  it('nests files in folders, folders first, sorted by name', () => {
    const tree = buildTree(['main.tex', 'figures/tilde.png', 'chapters/results.tex', 'chapters/intro.tex', 'a.bib']);
    expect(tree).toEqual([
      {
        name: 'chapters', path: 'chapters', children: [
          { name: 'intro.tex', path: 'chapters/intro.tex' },
          { name: 'results.tex', path: 'chapters/results.tex' },
        ],
      },
      { name: 'figures', path: 'figures', children: [{ name: 'tilde.png', path: 'figures/tilde.png' }] },
      { name: 'a.bib', path: 'a.bib' },
      { name: 'main.tex', path: 'main.tex' },
    ]);
  });

  it('handles deeper folders', () => {
    expect(buildTree(['a/b/c.tex'])).toEqual([
      { name: 'a', path: 'a', children: [{ name: 'b', path: 'a/b', children: [{ name: 'c.tex', path: 'a/b/c.tex' }] }] },
    ]);
  });
});

describe('isTextFile', () => {
  it('treats LaTeX sources as text and images as not', () => {
    expect(isTextFile('main.tex')).toBe(true);
    expect(isTextFile('refs.BIB')).toBe(true);
    expect(isTextFile('figures/tilde.png')).toBe(false);
    expect(isTextFile('Makefile')).toBe(false);
  });
});
