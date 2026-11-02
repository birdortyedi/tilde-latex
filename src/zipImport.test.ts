import { describe, expect, it } from 'vitest';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { unzipProject, zipProject } from './zipImport';

const paths = (zip: Record<string, Uint8Array>) => unzipProject(zipSync(zip)).map((f) => f.path).sort();

describe('zipProject', () => {
  it('packs a project into one folder, and unpacks to the same files', () => {
    const files = [{ path: 'main.tex', content: 'x' }, { path: 'figures/a.png', content: new Uint8Array([1, 2]) }];
    const zip = zipProject('paper', files);
    expect(Object.keys(unzipSync(zip)).sort()).toEqual(['paper/figures/a.png', 'paper/main.tex']);
    expect(unzipProject(zip)).toEqual([files[0], files[1]]);
  });
});

describe('unzipProject', () => {
  it('reads a typical project zip: text as text, images as bytes', () => {
    const files = unzipProject(zipSync({
      'main.tex': strToU8('\\documentclass{article}'),
      'figures/plot.png': new Uint8Array([137, 80, 78, 71]),
    }));
    expect(files).toEqual([
      { path: 'main.tex', content: '\\documentclass{article}' },
      { path: 'figures/plot.png', content: new Uint8Array([137, 80, 78, 71]) },
    ]);
  });

  it('removes a folder that holds everything', () => {
    expect(paths({ 'paper/main.tex': strToU8('x'), 'paper/sections/a.tex': strToU8('a') }))
      .toEqual(['main.tex', 'sections/a.tex']);
  });

  it('keeps the top folders when there are several', () => {
    expect(paths({ 'paper/main.tex': strToU8('x'), 'other/b.tex': strToU8('b') }))
      .toEqual(['other/b.tex', 'paper/main.tex']);
  });

  it('skips build files, system files and unsafe paths', () => {
    expect(paths({
      'main.tex': strToU8('x'),
      'main.aux': strToU8(''),
      'main.log': strToU8(''),
      'main.synctex.gz': new Uint8Array(),
      'main.bbl': strToU8('kept: needed when there is no .bib'),
      '__MACOSX/._main.tex': new Uint8Array(),
      '.DS_Store': new Uint8Array(),
      '../evil.tex': strToU8('x'),
    })).toEqual(['main.bbl', 'main.tex']);
  });
});
