// The three panes: files | editor | PDF. Drag the handles between them to
// resize, use the buttons in the top bar to hide or show them. The layout is
// remembered in this browser.

export interface Layout {
  files: boolean;
  editor: boolean;
  pdf: boolean;
  sideWidth: number; // pixels
  pdfShare: number; // the PDF's share of the space next to the files, 0 to 1
}

export const DEFAULT_LAYOUT: Layout = { files: true, editor: true, pdf: true, sideWidth: 220, pdfShare: 0.5 };
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
  return layout;
}

// The CSS grid columns for the visible panes and the handles between them.
export function gridColumns(layout: Layout): string {
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
  toggles: Record<'files' | 'editor' | 'pdf', HTMLButtonElement>;
}

export function initLayout(elements: LayoutElements): void {
  let layout = normalize(load());

  const apply = (): void => {
    elements.workspace.style.gridTemplateColumns = gridColumns(layout);
    elements.side.hidden = !layout.files;
    elements.sideHandle.hidden = !layout.files;
    elements.editorPane.hidden = !layout.editor;
    elements.pdfHandle.hidden = !(layout.editor && layout.pdf);
    elements.preview.hidden = !layout.pdf;
    for (const pane of ['files', 'editor', 'pdf'] as const) {
      const button = elements.toggles[pane];
      button.setAttribute('aria-pressed', String(layout[pane]));
      // The last visible one of editor and PDF cannot be hidden.
      button.disabled = pane !== 'files' && layout[pane] && !layout[pane === 'editor' ? 'pdf' : 'editor'];
    }
  };

  const save = (): void => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(layout)); } catch { /* not remembered */ }
  };

  for (const pane of ['files', 'editor', 'pdf'] as const) {
    elements.toggles[pane].addEventListener('click', () => {
      layout = normalize({ ...layout, [pane]: !layout[pane] });
      apply();
      save();
    });
  }

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
}

function load(): Partial<Layout> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Layout>;
  } catch {
    return {};
  }
}
