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
