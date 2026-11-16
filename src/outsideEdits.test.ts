import { describe, expect, it } from 'vitest';
import { mergeOutside, outsideCopyPath, type TextChange } from './outsideEdits';

// Applies the changes to `ours`, last first, as the shared text does.
const apply = (ours: string, changes: TextChange[]): string =>
  [...changes].sort((a, b) => b.from - a.from).reduce((text, c) => text.slice(0, c.from) + c.insert + text.slice(c.to), ours);

const base = 'Introduction.\nMethod.\nResults.\nConclusion.\n';

describe('edits made outside Tilde', () => {
  it('come in as they are when nobody edited in Tilde since', () => {
    const theirs = base.replace('Method.', 'Method, revised.');
    expect(apply(base, mergeOutside(base, base, theirs) ?? [])).toBe(theirs);
  });

  it('merge with edits made in Tilde elsewhere in the file', () => {
    const ours = base.replace('Introduction.', 'Introduction, by Efecan.');
    const theirs = base.replace('Conclusion.', 'Conclusion, by Furkan.');
    expect(apply(ours, mergeOutside(base, ours, theirs) ?? [])).toBe('Introduction, by Efecan.\nMethod.\nResults.\nConclusion, by Furkan.\n');
  });

  it('are not merged when they touch the same place', () => {
    const ours = base.replace('Method.', 'Method A.');
    const theirs = base.replace('Method.', 'Method B.');
    expect(mergeOutside(base, ours, theirs)).toBeNull();
  });

  it('change nothing when the outside version is an earlier state of the text', () => {
    const theirs = base.replace('Method.', 'Method, v2.');
    const ours = theirs.replace('Results.', 'Results, v3.'); // Tilde has the outside change and more
    expect(mergeOutside(base, ours, theirs)).toEqual([]);
  });

  it('change nothing when the file already has the text', () => {
    const ours = base.replace('Results.', 'Results!');
    expect(mergeOutside(base, ours, ours)).toEqual([]);
    expect(mergeOutside(base, ours, base)).toEqual([]);
  });

  it('keep a copy next to the file when they cannot merge', () => {
    expect(outsideCopyPath('chapters/intro.tex')).toBe('chapters/intro (changed outside Tilde).tex');
    expect(outsideCopyPath('README')).toBe('README (changed outside Tilde)');
    expect(outsideCopyPath('chapters/intro.tex', 2)).toBe('chapters/intro (changed outside Tilde 2).tex');
  });
});
