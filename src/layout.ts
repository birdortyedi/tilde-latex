// The three panes: files | editor | PDF. Drag the handles between them to
// resize, use the buttons in the top bar to hide or show them. The layout is
// remembered in this browser. In a narrow window there is room for only one
// pane, so the buttons work like tabs instead.

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

// The CSS grid columns for the visible panes and the handles between them.
export function gridColumns(layout: Layout, narrow = false): string {
  if (narrow) return 'minmax(0, 1fr)';
  const columns: string[] = [];
  if (layout.files) columns.push(`${layout.sideWidth}px`, `${HANDLE}px`);
  if (layout.editor && layout.pdf) {
    columns.push(`minmax(0, ${1 - layout.pdfShare}fr)`, `${HANDLE}px`, `minmax(0, ${layout.pdfShare}fr)`);
  } else {
    columns.push('minmax(0, 1fr)');
  }
  return columns.join(' ');
}

export interface LayoutElements {
  workspace: HTMLElement;
  side: HTMLElement;
  sideHandle: HTMLElement;
  editorPane: HTMLElement;
  pdfHandle: HTMLElement;
  preview: HTMLElement;
  toggles: Record<Pane, HTMLButtonElement>;
}

export interface LayoutControl {
  // Makes sure a pane is visible, e.g. the editor after clicking a file in a narrow window.
  reveal(pane: Pane): void;
}

export function initLayout(elements: LayoutElements): LayoutControl {
  let layout = normalize(load());
  const isNarrow = (): boolean => window.innerWidth < NARROW_WIDTH;

  const apply = (): void => {
    const narrow = isNarrow();
    const shown = (pane: Pane): boolean => isVisible(layout, pane, narrow);
    elements.workspace.style.gridTemplateColumns = gridColumns(layout, narrow);
    elements.side.hidden = !shown('files');
    elements.sideHandle.hidden = narrow || !layout.files;
    elements.editorPane.hidden = !shown('editor');
    elements.pdfHandle.hidden = narrow || !(layout.editor && layout.pdf);
    elements.preview.hidden = !shown('pdf');
    for (const pane of PANES) {
      const button = elements.toggles[pane];
      button.setAttribute('aria-pressed', String(shown(pane)));
      // The last visible one of editor and PDF cannot be hidden.
      button.disabled = !narrow && pane !== 'files' && layout[pane] && !layout[pane === 'editor' ? 'pdf' : 'editor'];
    }
  };

  const save = (): void => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(layout)); } catch { /* not remembered */ }
  };

  for (const pane of PANES) {
    elements.toggles[pane].addEventListener('click', () => {
      layout = normalize(isNarrow() ? { ...layout, narrowPane: pane } : { ...layout, [pane]: !layout[pane] });
      apply();
      save();
    });
  }
  window.addEventListener('resize', apply);

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
