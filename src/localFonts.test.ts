import { describe, expect, it } from 'vitest';
import { fontFamilies, fontFormat, fontspecLine, pickFaces } from './localFonts';

const face = (family: string, style: string) => ({ family, style, postscriptName: `${family}-${style.replace(' ', '')}` });

describe('fonts from this computer', () => {
  it('groups the faces by family, sorted by name', () => {
    const families = fontFamilies([face('Times', 'Regular'), face('Arial', 'Bold'), face('Arial', 'Regular')]);
    expect(families.map(([family, faces]) => `${family}:${faces.length}`)).toEqual(['Arial:2', 'Times:1']);
  });

  it('picks the regular, bold, italic and bold italic faces', () => {
    const faces = pickFaces([face('Arial', 'Bold Italic'), face('Arial', 'Italic'), face('Arial', 'Regular'), face('Arial', 'Bold'), face('Arial', 'Narrow')]);
    expect([faces?.upright.style, faces?.bold?.style, faces?.italic?.style, faces?.boldItalic?.style]).toEqual(['Regular', 'Bold', 'Italic', 'Bold Italic']);
    expect(pickFaces([face('Display', 'Black')])?.upright.style).toBe('Black'); // no regular face: the first one
    expect(pickFaces([])).toBeNull();
  });

  it('tells .otf, .ttf and font collections apart', () => {
    expect(fontFormat(new Uint8Array([0x4f, 0x54, 0x54, 0x4f]))).toBe('otf');
    expect(fontFormat(new Uint8Array([0, 1, 0, 0]))).toBe('ttf');
    expect(fontFormat(new Uint8Array([0x74, 0x74, 0x63, 0x66]))).toBe('ttc');
    expect(fontFormat(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });

  it('writes the fontspec line for the copied files', () => {
    expect(fontspecLine({ upright: 'ArialMT.ttf', bold: 'Arial-BoldMT.ttf', italic: 'Arial-ItalicMT.ttf' }))
      .toBe('\\setmainfont{ArialMT.ttf}[Path=fonts/, BoldFont=Arial-BoldMT.ttf, ItalicFont=Arial-ItalicMT.ttf]');
  });
});
