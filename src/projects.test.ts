import { describe, expect, it } from 'vitest';
import { groupByProject } from './projects';

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
