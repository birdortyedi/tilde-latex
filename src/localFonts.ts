// "Add a font from this computer": Chrome and Edge can let a page read the
// fonts installed on the computer (after asking the user). Tilde copies the
// regular, bold and italic faces of one family into the project's fonts/
// folder, where XeLaTeX and LuaLaTeX load them by file name.

declare global {
  interface Window {
    // The Local Font Access API, in Chrome and Edge only.
    queryLocalFonts?: () => Promise<LocalFont[]>;
  }
}

// What the browser tells about each installed font face.
export interface LocalFont {
  family: string; // "Arial"
  style: string; // "Regular", "Bold", "Italic", "Bold Italic"
  postscriptName: string; // "Arial-BoldMT", a name without spaces
  blob(): Promise<Blob>;
}

export interface Faces<T> {
  upright: T;
  bold?: T;
  italic?: T;
  boldItalic?: T;
}

// The families, sorted by name, each with its faces.
export function fontFamilies<T extends { family: string }>(fonts: T[]): [string, T[]][] {
  const families = new Map<string, T[]>();
  for (const font of fonts) families.set(font.family, [...(families.get(font.family) ?? []), font]);
  return [...families].sort(([a], [b]) => a.localeCompare(b));
}

// The four faces a document needs from a family; the upright one is the
// regular face, or the first one if the family has no regular face.
export function pickFaces<T extends { style: string }>(faces: T[]): Faces<T> | null {
  const find = (pattern: RegExp) => faces.find((face) => pattern.test(face.style.trim()));
  const upright = find(/^(regular|book|roman|normal|plain)$/i) ?? faces[0];
  if (!upright) return null;
  return {
    upright,
    bold: find(/^bold$/i),
    italic: find(/^(italic|oblique)$/i),
    boldItalic: find(/^bold (italic|oblique)$/i),
  };
}

// The kind of font file, from its first four bytes: OpenType with CFF
// outlines (.otf), TrueType (.ttf), or a collection of several fonts (.ttc),
// which Tilde cannot split.
export function fontFormat(bytes: Uint8Array): 'otf' | 'ttf' | 'ttc' | null {
  const tag = String.fromCharCode(...bytes.slice(0, 4));
  if (tag === 'OTTO') return 'otf';
  if (tag === 'ttcf') return 'ttc';
  if (tag === 'true' || (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0)) return 'ttf';
  return null;
}

// The preamble line that loads the copied files with fontspec.
export function fontspecLine(files: Faces<string>, folder = 'fonts/'): string {
  const options = [`Path=${folder}`];
  if (files.bold) options.push(`BoldFont=${files.bold}`);
  if (files.italic) options.push(`ItalicFont=${files.italic}`);
  if (files.boldItalic) options.push(`BoldItalicFont=${files.boldItalic}`);
  return `\\setmainfont{${files.upright}}[${options.join(', ')}]`;
}
