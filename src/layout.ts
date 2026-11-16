// The three panes: files | editor | PDF. Drag the handles between them to
// resize. Each pane folds away with the button in its header and becomes a
// slim strip at its place, which brings it back. The layout is remembered in
// this browser. In a narrow window there is room for only one pane: the
// others wait as strips at the sides, like tabs.

export type Pane = 'files' | 'editor' | 'pdf';

export interface Layout {
  files: boolean;
  editor: boolean;
  pdf: boolean;
  sideWidth: number; // pixels
  pdfShare: number; // the PDF's share of the space next to the files, 0 to 1
  narrowPane: Pane; // the one pane shown in a narrow window
}

export const DEFAULT_LAYOUT: Layout = { files: true, editor: true, pdf: true, sideWidth: 220, pdfShare: 0.5, narrowPane: 'editor' };
export const NARROW_WIDTH = 900; // pixels; below this, one pane at a time
const PANES: Pane[] = ['files', 'editor', 'pdf'];
const SIDE_WIDTH = { min: 140, max: 480 };
const PDF_SHARE = { min: 0.15, max: 0.85 };
const HANDLE = 5; // pixels
const RAIL = 30; // pixels: a folded pane's strip
const STORAGE_KEY = 'tilde.layout';

const clamp = (value: number, { min, max }: { min: number; max: number }): number => Math.min(max, Math.max(min, value));

// Repairs a layout read from storage: fills in missing values, keeps sizes in
// range, and keeps the editor or the PDF visible (hiding both would leave nothing).
export function normalize(stored: Partial<Layout>): Layout {
  const layout = { ...DEFAULT_LAYOUT, ...stored };
  layout.sideWidth = clamp(layout.sideWidth, SIDE_WIDTH);
  layout.pdfShare = clamp(layout.pdfShare, PDF_SHARE);
  if (!layout.editor && !layout.pdf) layout.editor = true;
  if (!PANES.includes(layout.narrowPane)) layout.narrowPane = 'editor';
  return layout;
}

// Whether a pane is shown, in a wide or a narrow window.
export function isVisible(layout: Layout, pane: Pane, narrow: boolean): boolean {
  return narrow ? layout.narrowPane === pane : layout[pane];
}

// What goes in the workspace, left to right: panes, the handles between
// them, and the strips of folded panes, each with its width.
export type Slot = Pane | 'sideHandle' | 'pdfHandle' | `${Pane}Rail`;

export function slots(layout: Layout, narrow = false): [Slot, string][] {
  const shown = (pane: Pane): boolean => isVisible(layout, pane, narrow);
  const out: [Slot, string][] = [];
  const share = (pane: Pane): string => (narrow || !(layout.editor && layout.pdf) ? 'minmax(0, 1fr)'
    : `minmax(0, ${pane === 'pdf' ? layout.pdfShare : 1 - layout.pdfShare}fr)`);
  if (shown('files')) out.push(['files', narrow ? 'minmax(0, 1fr)' : `${layout.sideWidth}px`], ...(narrow ? [] : [['sideHandle', `${HANDLE}px`] as [Slot, string]]));
  else out.push(['filesRail', `${RAIL}px`]);
  if (shown('editor')) out.push(['editor', share('editor')]);
  else out.push(['editorRail', `${RAIL}px`]);
  if (shown('editor') && shown('pdf')) out.push(['pdfHandle', `${HANDLE}px`]);
  if (shown('pdf')) out.push(['pdf', share('pdf')]);
  else out.push(['pdfRail', `${RAIL}px`]);
  return out;
}

// The CSS grid columns for the slots.
export function gridColumns(layout: Layout, narrow = false): string {
  return slots(layout, narrow).map(([, width]) => width).join(' ');
}

export interface LayoutElements {
  workspace: HTMLElement;
  side: HTMLElement;
  sideHandle: HTMLElement;
  editorPane: HTMLElement;
  pdfHandle: HTMLElement;
  preview: HTMLElement;
  rails: Record<Pane, HTMLButtonElement>; // a folded pane's strip; a click brings it back
  folds: Record<Pane, HTMLButtonElement>; // the button in a pane's header that folds it away
}

export interface LayoutControl {
  // Makes sure a pane is visible, e.g. the editor after clicking a file in a narrow window.
  reveal(pane: Pane): void;
}

export function initLayout(elements: LayoutElements): LayoutControl {
  let layout = normalize(load());
  const isNarrow = (): boolean => window.innerWidth < NARROW_WIDTH;

  const element: Record<Slot, HTMLElement> = {
    files: elements.side, sideHandle: elements.sideHandle, editor: elements.editorPane, pdfHandle: elements.pdfHandle, pdf: elements.preview,
    filesRail: elements.rails.files, editorRail: elements.rails.editor, pdfRail: elements.rails.pdf,
  };
  const apply = (): void => {
    const narrow = isNarrow();
    const placed = slots(layout, narrow);
    elements.workspace.style.gridTemplateColumns = placed.map(([, width]) => width).join(' ');
    for (const [slot, el] of Object.entries(element) as [Slot, HTMLElement][]) {
      const at = placed.findIndex(([s]) => s === slot);
      el.hidden = at < 0;
      el.style.gridColumn = at < 0 ? '' : String(at + 1);
      el.style.gridRow = '1'; // all in one row, whatever their order in the page
    }
    for (const pane of PANES) {
      // In a narrow window the strips switch panes; and the last of source and PDF cannot fold.
      elements.folds[pane].hidden = narrow || (pane !== 'files' && !layout[pane === 'editor' ? 'pdf' : 'editor']);
    }
  };

  const save = (): void => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(layout)); } catch { /* not remembered */ }
  };

  const set = (pane: Pane, shown: boolean): void => {
    layout = normalize(isNarrow() ? { ...layout, narrowPane: pane } : { ...layout, [pane]: shown });
    apply();
    save();
  };
  for (const pane of PANES) {
    elements.rails[pane].addEventListener('click', () => set(pane, true));
    elements.folds[pane].addEventListener('click', () => set(pane, false));
  }
  // Whenever the workspace changes width (a resized window, a rotated phone), not only on "resize" events.
  let lastWidth = 0;
  new ResizeObserver(() => {
    const width = elements.workspace.clientWidth;
    if (width === lastWidth) return;
    lastWidth = width;
    apply();
  }).observe(elements.workspace);

  // Dragging a handle. Double-click puts it back where it started.
  const drag = (handle: HTMLElement, onMove: (x: number) => void, reset: () => void): void => {
    handle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      handle.classList.add('dragging');
      document.body.classList.add('resizing');
      const move = (e: PointerEvent): void => {
        onMove(e.clientX);
        apply();
      };
      const stop = (): void => {
        handle.removeEventListener('pointermove', move);
        handle.classList.remove('dragging');
        document.body.classList.remove('resizing');
        save();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', stop, { once: true });
      handle.addEventListener('pointercancel', stop, { once: true });
    });
    handle.addEventListener('dblclick', () => {
      reset();
      apply();
      save();
    });
  };

  drag(elements.sideHandle, (x) => {
    layout.sideWidth = clamp(x - elements.workspace.getBoundingClientRect().left, SIDE_WIDTH);
  }, () => { layout.sideWidth = DEFAULT_LAYOUT.sideWidth; });

  drag(elements.pdfHandle, (x) => {
    const left = elements.editorPane.getBoundingClientRect().left;
    const right = elements.preview.getBoundingClientRect().right;
    layout.pdfShare = clamp((right - x) / (right - left), PDF_SHARE);
  }, () => { layout.pdfShare = DEFAULT_LAYOUT.pdfShare; });

  // Arrow keys move a focused handle, for people who do not use a mouse.
  const keys = (handle: HTMLElement, step: (direction: number) => void): void => {
    handle.addEventListener('keydown', (event) => {
      const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
      if (!direction) return;
      event.preventDefault();
      step(direction);
      apply();
      save();
    });
  };
  keys(elements.sideHandle, (d) => { layout.sideWidth = clamp(layout.sideWidth + d * 16, SIDE_WIDTH); });
  keys(elements.pdfHandle, (d) => { layout.pdfShare = clamp(layout.pdfShare - d * 0.03, PDF_SHARE); });

  apply();
  return {
    reveal(pane) {
      if (isVisible(layout, pane, isNarrow())) return;
      layout = normalize(isNarrow() ? { ...layout, narrowPane: pane } : { ...layout, [pane]: true });
      apply();
      save();
    },
  };
}

function load(): Partial<Layout> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Layout>;
  } catch {
    return {};
  }
}
