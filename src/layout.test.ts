import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, gridColumns, isVisible, normalize, slots } from './layout';

describe('layout', () => {
  it('shows files, editor and PDF with handles between them', () => {
    expect(gridColumns(DEFAULT_LAYOUT)).toBe('220px 5px minmax(0, 0.5fr) 5px minmax(0, 0.5fr)');
  });

  it('folds a pane into a strip at its place, giving its space to the others', () => {
    expect(gridColumns({ ...DEFAULT_LAYOUT, pdf: false })).toBe('220px 5px minmax(0, 1fr) 30px');
    const names = (layout: typeof DEFAULT_LAYOUT) => slots(layout).map(([slot]) => slot);
    expect(names({ ...DEFAULT_LAYOUT, pdf: false })).toEqual(['files', 'sideHandle', 'editor', 'pdfRail']);
    expect(names({ ...DEFAULT_LAYOUT, files: false, editor: false })).toEqual(['filesRail', 'editorRail', 'pdf']);
    expect(gridColumns({ ...DEFAULT_LAYOUT, files: false, editor: false })).toBe('30px 30px minmax(0, 1fr)');
  });

  it('repairs stored layouts: missing values, sizes out of range, nothing visible', () => {
    expect(normalize({})).toEqual(DEFAULT_LAYOUT);
    expect(normalize({ sideWidth: 5000, pdfShare: -1 })).toMatchObject({ sideWidth: 480, pdfShare: 0.15 });
    expect(normalize({ editor: false, pdf: false })).toMatchObject({ editor: true, pdf: false });
  });

  it('shows one pane at a time in a narrow window', () => {
    const layout = { ...DEFAULT_LAYOUT, narrowPane: 'pdf' as const };
    expect(slots(layout, true)).toEqual([['filesRail', '30px'], ['editorRail', '30px'], ['pdf', 'minmax(0, 1fr)']]);
    expect(slots({ ...layout, narrowPane: 'files' }, true).map(([slot]) => slot)).toEqual(['files', 'editorRail', 'pdfRail']);
    expect(['files', 'editor', 'pdf'].filter((pane) => isVisible(layout, pane as 'files', true))).toEqual(['pdf']);
    expect(isVisible(layout, 'editor', false)).toBe(true); // the wide layout is kept for later
  });
});
