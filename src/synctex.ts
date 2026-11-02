import { gunzipSync } from 'fflate';

// Reads the .synctex.gz file the engine writes next to the PDF, which says
// which source file and line every piece of the PDF came from. With it,
// Tilde jumps from a place in the PDF to the source, and back.

// A rectangle on a PDF page, in PDF points (1/72 inch), measured from the
// page's top-left corner.
export interface PdfRect {
  page: number; // 1 = first
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SourcePlace {
  file: string; // path inside the project, e.g. "chapters/intro.tex"
  line: number; // 1 = first
}

// One line of text in the PDF (TeX's horizontal box).
interface Box extends PdfRect {
  file: string;
  line: number;
}

// A point inside a box: a character, a space or a kern, with the line it came from.
interface Mark {
  box: number; // index into boxes
  file: string;
  line: number;
  x: number;
}

// TeX's scaled points per PDF point.
const SP_PER_BP = 65781.76;

// The engine runs in /home/web_user/project_dir; "…/project_dir/./chapters/intro.tex" → "chapters/intro.tex".
const projectPath = (path: string): string => path.replace(/^.*?\/project_dir\//, '').replace(/^(\.\/)+/, '');

export class SyncTex {
  private constructor(private boxes: Box[], private marks: Mark[]) {}

  // Reads the file as the engine gives it: gzipped, or plain text.
  static read(data: Uint8Array): SyncTex {
    const bytes = data[0] === 0x1f && data[1] === 0x8b ? gunzipSync(data) : data;
    return SyncTex.parse(new TextDecoder().decode(bytes));
  }

  static parse(text: string): SyncTex {
    const files = new Map<string, string>(); // tag → path
    const boxes: Box[] = [];
    const marks: Mark[] = [];
    const open: number[] = []; // the boxes not closed yet, innermost last; -1 for a vertical box
    let scale = 1 / SP_PER_BP;
    let xOffset = 0;
    let yOffset = 0;
    let page = 0;

    for (const line of text.split('\n')) {
      const header = /^(Input|Unit|Magnification|X Offset|Y Offset):(.*)$/.exec(line);
      if (header) {
        const [, key, value] = header;
        if (key === 'Input') {
          const [tag, ...path] = value.split(':');
          files.set(tag, projectPath(path.join(':')));
        } else if (key === 'Unit') scale *= Number(value);
        else if (key === 'Magnification') scale *= Number(value) / 1000;
        else if (key === 'X Offset') xOffset = Number(value);
        else if (key === 'Y Offset') yOffset = Number(value);
        continue;
      }
      if (line.startsWith('{')) {
        page = Number(line.slice(1));
        continue;
      }
      if (line === ')' || line === ']') {
        open.pop();
        continue;
      }
      // A record: kind, then "tag,line:h,v", then ":W,H,D" for boxes.
      const record = /^([[(hvxkg$])(\d+),(\d+):(-?\d+),(-?\d+)(?::(-?\d+),(-?\d+),(-?\d+))?/.exec(line);
      if (!record || page === 0) continue;
      const [, kind, tag, lineNumber, h, v, width, height, depth] = record;
      const file = files.get(tag) ?? '';
      const at = { file, line: Number(lineNumber), x: (Number(h) + xOffset) * scale };
      if (kind === '[') {
        open.push(-1);
      } else if (kind === '(' || kind === 'h') {
        const baseline = (Number(v) + yOffset) * scale;
        const above = Number(height ?? 0) * scale;
        boxes.push({ ...at, page, y: baseline - above, width: Number(width ?? 0) * scale, height: above + Number(depth ?? 0) * scale });
        if (kind === '(') open.push(boxes.length - 1);
      } else if (kind !== 'v') {
        const box = open.at(-1);
        if (box !== undefined && box >= 0) marks.push({ ...at, box });
      }
    }
    return new SyncTex(boxes, marks);
  }

  // The source line at a point of a page: the innermost line of text at
  // that point, then the character in it nearest to the left of the point.
  toSource(page: number, x: number, y: number): SourcePlace | null {
    const inside = (box: Box): boolean => box.page === page && box.height > 0
      && x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
    let best = -1;
    this.boxes.forEach((box, index) => {
      if (inside(box) && (best < 0 || box.height * box.width <= this.boxes[best].height * this.boxes[best].width)) best = index;
    });
    if (best < 0) best = this.nearestBox(page, x, y);
    if (best < 0) return null;
    const marks = this.marks.filter((mark) => mark.box === best && mark.file);
    const left = marks.filter((mark) => mark.x <= x).at(-1) ?? marks[0];
    const box = this.boxes[best];
    const place = left ?? box;
    return place.file ? { file: place.file, line: place.line } : null;
  }

  // Where a source line is in the PDF: the lines of text it made, on the
  // first page where it appears. A line that made nothing visible (a blank
  // line, \begin{figure}) uses the nearest line above it that did.
  toPdf(file: string, line: number): PdfRect[] {
    const marksIn = this.marks.filter((mark) => mark.file === file);
    const lines = [...new Set(marksIn.map((mark) => mark.line))].filter((l) => l <= line);
    if (lines.length === 0) return [];
    const target = Math.max(...lines);
    const boxIndexes = [...new Set(marksIn.filter((mark) => mark.line === target).map((mark) => mark.box))];
    const boxes = boxIndexes.map((index) => this.boxes[index]);
    const page = Math.min(...boxes.map((box) => box.page));
    return boxes.filter((box) => box.page === page)
      .map(({ page: p, x, y, width, height }) => ({ page: p, x, y, width, height }));
  }

  private nearestBox(page: number, x: number, y: number): number {
    let best = -1;
    let bestDistance = Infinity;
    this.boxes.forEach((box, index) => {
      if (box.page !== page || box.height <= 0) return;
      const dx = Math.max(box.x - x, 0, x - box.x - box.width);
      const dy = Math.max(box.y - y, 0, y - box.y - box.height);
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        best = index;
        bestDistance = distance;
      }
    });
    return best;
  }
}
