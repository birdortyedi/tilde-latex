import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, gridColumns, normalize } from './layout';

describe('layout', () => {
  it('shows files, editor and PDF with handles between them', () => {
    expect(gridColumns(DEFAULT_LAYOUT)).toBe('220px 5px minmax(0, 0.5fr) 5px minmax(0, 0.5fr)');
  });

  it('gives all the space to the editor when the PDF is hidden', () => {
    expect(gridColumns({ ...DEFAULT_LAYOUT, pdf: false })).toBe('220px 5px minmax(0, 1fr)');
  });

  it('gives all the space to the PDF when files and editor are hidden', () => {
    expect(gridColumns({ ...DEFAULT_LAYOUT, files: false, editor: false })).toBe('minmax(0, 1fr)');
  });

  it('repairs stored layouts: missing values, sizes out of range, nothing visible', () => {
    expect(normalize({})).toEqual(DEFAULT_LAYOUT);
    expect(normalize({ sideWidth: 5000, pdfShare: -1 })).toMatchObject({ sideWidth: 480, pdfShare: 0.15 });
    expect(normalize({ editor: false, pdf: false })).toMatchObject({ editor: true, pdf: false });
  });
});
