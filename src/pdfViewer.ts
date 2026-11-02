import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// PDF.js does its parsing in its own Web Worker.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// Shows every page of a PDF in a scrollable column, as wide as the panel.
// When the panel is resized, the pages are drawn again at the new width.
export class PdfViewer {
  private last: Uint8Array | null = null;
  private drawnWidth = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private drawing = 0; // counts calls to show(), so an older, slower drawing never replaces a newer one

  constructor(private container: HTMLElement) {
    new ResizeObserver(() => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        const width = this.pageWidth();
        if (this.last && width > 100 && Math.abs(width - this.drawnWidth) > 8) void this.show(this.last);
      }, 250);
    }).observe(container);
  }

  // Forget the PDF, for example when another project is opened.
  clear(): void {
    this.last = null;
  }

  private pageWidth(): number {
    return this.container.clientWidth - 48; // leave room for the padding and the scrollbar
  }

  async show(pdf: Uint8Array): Promise<void> {
    this.last = pdf;
    const drawing = ++this.drawing;
    // PDF.js takes ownership of the bytes it is given, so pass a copy.
    const loading = pdfjs.getDocument({ data: pdf.slice() });
    const doc = await loading.promise;
    const pixelRatio = window.devicePixelRatio || 1;
    const width = this.pageWidth();
    this.drawnWidth = width;

    // Draw all pages first, then swap them in at once, so the view does not
    // flicker and the scroll position can be kept.
    const pages: HTMLCanvasElement[] = [];
    for (let number = 1; number <= doc.numPages; number++) {
      const page = await doc.getPage(number);
      const viewport = page.getViewport({ scale: (width / page.getViewport({ scale: 1 }).width) * pixelRatio });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${viewport.width / pixelRatio}px`;
      await page.render({ canvas, viewport }).promise;
      pages.push(canvas);
    }
    await loading.destroy(); // free the memory PDF.js used for this document
    if (drawing !== this.drawing) return;

    const scrollTop = this.container.scrollTop;
    this.container.replaceChildren(...pages);
    this.container.scrollTop = scrollTop;
  }
}
