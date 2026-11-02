import { describe, expect, it } from 'vitest';
import { findMainFile, groupByProject } from './projects';

describe('groupByProject', () => {
  it('groups files by folder and makes paths relative to the project', () => {
    const projects = groupByProject('/test-docs', {
      '/test-docs/multifile/main.tex': 'main',
      '/test-docs/multifile/chapters/intro.tex': 'intro',
      '/test-docs/hello/main.tex': 'hello',
    });
    expect(projects).toEqual([
      { name: 'hello', files: [{ path: 'main.tex', content: 'hello' }] },
      {
        name: 'multifile',
        files: [
          { path: 'main.tex', content: 'main' },
          { path: 'chapters/intro.tex', content: 'intro' },
        ],
      },
    ]);
  });

  it('ignores files outside the root and loose files in the root', () => {
    const projects = groupByProject('/test-docs', {
      '/test-docs/README.md': 'loose',
      '/elsewhere/x/main.tex': 'other',
    });
    expect(projects).toEqual([]);
  });
});

describe('findMainFile', () => {
  const file = (path: string, content = '') => ({ path, content });

  it('prefers the file the user chose', () => {
    expect(findMainFile({ name: 'p', mainFile: 'b.tex', files: [file('main.tex'), file('b.tex')] })).toBe('b.tex');
  });

  it('uses main.tex when there is no choice', () => {
    expect(findMainFile({ name: 'p', files: [file('paper.tex', '\\documentclass{article}'), file('main.tex')] })).toBe('main.tex');
  });

  it('otherwise finds the top-level file with \\documentclass', () => {
    expect(findMainFile({ name: 'p', files: [
      file('figures/plot.tex', '\\documentclass{standalone}'),
      file('chapters/intro.tex', 'Intro'),
      file('paper.tex', '% my paper\n\\documentclass{article}'),
    ] })).toBe('paper.tex');
  });

  it('ignores \\documentclass inside a comment', () => {
    expect(findMainFile({ name: 'p', files: [file('notes.tex', '% \\documentclass{article}')] })).toBeUndefined();
  });
});
