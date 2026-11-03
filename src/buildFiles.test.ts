import { describe, expect, it } from 'vitest';
import { afterQuickCompile, keptBuildFiles } from './buildFiles';

describe('keptBuildFiles', () => {
  it('keeps what LaTeX needs from the run before, including those of \\include files', () => {
    const left = ['main.tex', 'main.aux', 'main.bbl', 'main.toc', 'main.pdf', 'main.log', 'main.synctex.gz', 'chapters/intro.aux', 'main.nav']
      .map((path) => ({ path, content: 'x' }));
    expect(keptBuildFiles(left, new Set(['main.tex'])).map((f) => f.path))
      .toEqual(['main.aux', 'main.bbl', 'main.toc', 'chapters/intro.aux', 'main.nav']);
  });

  it('never replaces a file of the project, such as a .bbl that came with it', () => {
    expect(keptBuildFiles([{ path: 'main.bbl', content: 'x' }], new Set(['main.bbl']))).toEqual([]);
  });
});

describe('afterQuickCompile', () => {
  it('asks for a full compile when a citation is new (real logs)', () => {
    expect(afterQuickCompile("LaTeX Warning: Citation `vaswani2017' on page 1 undefined on input line 12.")).toBe('full');
    expect(afterQuickCompile('Package natbib Warning: There were undefined citations.')).toBe('full');
    expect(afterQuickCompile('Package biblatex Warning: Please (re)run Biber on the file:')).toBe('full');
  });

  it('asks for one more quick pass when only references moved (real logs)', () => {
    expect(afterQuickCompile('LaTeX Warning: Label(s) may have changed. Rerun to get cross-references right.')).toBe('quick');
    expect(afterQuickCompile('LaTeX Warning: There were undefined references.')).toBe('quick');
  });

  it('asks for nothing when all is in place', () => {
    expect(afterQuickCompile('Output written on main.pdf (3 pages, 51234 bytes).')).toBeNull();
  });
});
