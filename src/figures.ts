// Images pasted or dropped into the editor: where they go in the project,
// what they are called, and the figure that is written for them.

// The image types pdfLaTeX and XeLaTeX can include, by MIME type.
const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'application/pdf': 'pdf' };
const IMAGE = /\.(png|jpe?g|pdf)$/i;

// The extension for an image file, or null if LaTeX cannot include it (GIF, WebP, SVG…).
export function imageExtension(name: string, type: string): string | null {
  const fromName = IMAGE.exec(name)?.[1].toLowerCase();
  return fromName ?? EXTENSIONS[type] ?? null;
}

// Images LaTeX cannot include but the browser can show, which Tilde turns into PNG.
const CONVERTIBLE = /\.(gif|webp|avif|bmp|svg)$/i;
const CONVERTIBLE_TYPES = /^image\/(gif|webp|avif|bmp|svg\+xml)$/;

export function canConvertToPng(name: string, type: string): boolean {
  return CONVERTIBLE.test(name) || CONVERTIBLE_TYPES.test(type);
}

// The folder for new images: the one that already holds most of the
// project's images, or "figures" if there are none.
export function imageFolder(paths: string[]): string {
  const counts = new Map<string, number>();
  for (const path of paths) {
    if (!IMAGE.test(path) || !path.includes('/')) continue;
    const folder = path.slice(0, path.lastIndexOf('/'));
    counts.set(folder, (counts.get(folder) ?? 0) + 1);
  }
  let best = 'figures';
  let most = 0;
  for (const [folder, count] of counts) {
    if (count > most) [best, most] = [folder, count];
  }
  return best;
}

// A path for a new image that LaTeX reads without trouble (no spaces, one
// dot) and that is not taken yet. A pasted screenshot ("image.png") is named
// after the time it was pasted.
export function imagePath(name: string, extension: string, folder: string, taken: Set<string>, now = new Date()): string {
  let base = name.replace(/\.[^.]*$/, '');
  if (!base || /^image$/i.test(base)) {
    const pad = (n: number) => String(n).padStart(2, '0');
    base = `pasted-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  }
  base = base.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'image';
  let path = `${folder}/${base}.${extension}`;
  for (let n = 2; taken.has(path); n++) path = `${folder}/${base}-${n}.${extension}`;
  return path;
}

const FLOATS = /\\(begin|end)\{(figure|table|wrapfigure|wraptable|sidewaysfigure|sidewaystable)\*?\}/g;

// Where a new figure may go, near offset `at` of a .tex file: not inside
// another figure or table (then after its \end), and not after
// \end{document} (then just before it). Returns an offset in that line.
export function figurePosition(text: string, at: number): number {
  const lines = text.split('\n');
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  let lineIndex = 0;
  while (lineIndex + 1 < starts.length && starts[lineIndex + 1] <= at) lineIndex++;
  const endOfLine = (index: number): number => starts[index] + lines[index].length;
  const code = (index: number): string => lines[index].replace(/(^|[^\\])%.*$/, '$1');

  const endDocument = lines.findIndex((_, index) => /\\end\{document\}/.test(code(index)));
  if (endDocument >= 0 && lineIndex >= endDocument) return endDocument > 0 ? endOfLine(endDocument - 1) : 0;

  let depth = 0;
  for (let index = 0; index < lines.length; index++) {
    for (const match of code(index).matchAll(FLOATS)) depth += match[1] === 'begin' ? 1 : -1;
    if (index >= lineIndex && depth <= 0) return index === lineIndex ? at : endOfLine(index);
  }
  return at;
}

// The figure for an image, and where the cursor goes in it (inside \caption{}).
export function figureFor(path: string, indent = ''): { text: string; cursor: number } {
  const label = path.split('/').pop()?.replace(/\.[^.]*$/, '') ?? 'image';
  const before = [
    `\\begin{figure}[htbp]`,
    `  \\centering`,
    `  \\includegraphics[width=0.8\\linewidth]{${path}}`,
    `  \\caption{`,
  ].map((line, i) => (i === 0 ? line : indent + line)).join('\n');
  const after = ['}', `  \\label{fig:${label}}`, `\\end{figure}`].map((line, i) => (i === 0 ? line : indent + line)).join('\n');
  return { text: before + after, cursor: before.length };
}
