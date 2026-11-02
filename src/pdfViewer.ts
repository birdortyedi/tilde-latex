import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// PDF.js does its parsing in its own Web Worker.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// Shows every page of a PDF in a scrollable column, as wide as the panel.
export class PdfViewer {
  constructor(private container: HTMLElement) {}

  async show(pdf: Uint8Array): Promise<void> {
    // PDF.js takes ownership of the bytes it is given, so pass a copy.
    const loading = pdfjs.getDocument({ data: pdf.slice() });
    const doc = await loading.promise;
    const pixelRatio = window.devicePixelRatio || 1;
    const width = this.container.clientWidth - 32; // leave room for padding and the scrollbar

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

    const scrollTop = this.container.scrollTop;
    this.container.replaceChildren(...pages);
    this.container.scrollTop = scrollTop;
  }
}
