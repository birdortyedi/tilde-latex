import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { pageScale, stepZoom, zoomPercent, type Size, type Zoom } from './pdfZoom';
import type { PdfRect } from './synctex';
import { countWords } from './words';

// PDF.js does its parsing in its own Web Worker.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const PADDING = 20; // around and between the pages, as in style.css

export interface PdfViewState {
  page: number; // the page at the top of the view, 1 = first
  pages: number;
  percent: number; // the size of the first page, as a percentage of its printed size
  zoom: Zoom;
  words: number; // in the whole PDF, for the word count
}

// Shows every page of a PDF in a scrollable column. The pages are drawn as
// wide as the pane, a whole page at a time, or at a chosen zoom; they are
// drawn again when the pane is resized or the zoom changes, and the view
// stays at the same place in the document. Each page has its text on top,
// invisible, so it can be selected, copied and found with the browser's search.
//
// Only the pages in view, and one screen above and below, are drawn: a drawn
// page takes several megabytes, so a long thesis drawn in full would take
// gigabytes. Pages that scroll far out of view are wiped again.
export class PdfViewer {
  // Double-click on a page: the page (1 = first) and the point, in PDF points from its top-left corner.
  onDoubleClick: (page: number, x: number, y: number) => void = () => {};
  private words = 0;
  private last: Uint8Array | null = null;
  private zoom: Zoom = 'width';
  private firstPage: Size | null = null; // in points
  private drawnArea = { width: 0, height: 0 };
  private timer: ReturnType<typeof setTimeout> | undefined;
  private drawing = 0; // counts calls to draw(), so an older, slower drawing never replaces a newer one
  // The document on show, kept open to draw pages as they come into view.
  private doc: { proxy: pdfjs.PDFDocumentProxy; loading: pdfjs.PDFDocumentLoadingTask } | null = null;
  private painting = new Map<HTMLElement, pdfjs.RenderTask>(); // pages being drawn now
  private nearView: IntersectionObserver; // tells which pages come near the view or leave it

  constructor(private container: HTMLElement, private onState: (state: PdfViewState) => void = () => {}) {
    // Near the view: in it, or within one screen above or below.
    this.nearView = new IntersectionObserver((entries) => {
      for (const { target, isIntersecting } of entries) {
        const page = target as HTMLElement;
        if (isIntersecting) void this.paint(page);
        else this.wipe(page);
      }
    }, { root: container, rootMargin: '100% 0px' });
    new ResizeObserver(() => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        const area = this.area();
        const changed = Math.abs(area.width - this.drawnArea.width) > 8
          || (this.zoom === 'page' && Math.abs(area.height - this.drawnArea.height) > 8);
        if (this.last && area.width > 100 && changed) void this.draw();
      }, 250);
    }).observe(container);
    container.addEventListener('scroll', () => this.report(), { passive: true });
    container.addEventListener('dblclick', (event) => {
      const page = (event.target as HTMLElement).closest<HTMLElement>('.page');
      if (!page) return;
      const box = page.getBoundingClientRect();
      const scale = Number(page.dataset.scale);
      this.onDoubleClick(Number(page.dataset.number), (event.clientX - box.left) / scale, (event.clientY - box.top) / scale);
    });
  }

  // Scrolls to a place in the PDF and marks it for a moment.
  highlight(rects: PdfRect[]): void {
    const first = rects[0];
    const page = this.pages()[first?.page - 1];
    if (!first || !page) return;
    const scale = Number(page.dataset.scale);
    for (const old of this.container.querySelectorAll('.sync-mark')) old.remove();
    for (const rect of rects) {
      const mark = document.createElement('div');
      mark.className = 'sync-mark';
      Object.assign(mark.style, {
        left: `${rect.x * scale}px`, top: `${rect.y * scale}px`,
        width: `${rect.width * scale}px`, height: `${rect.height * scale}px`,
      });
      page.append(mark);
      mark.addEventListener('animationend', () => mark.remove());
    }
    this.container.scrollTop = page.offsetTop + first.y * scale - this.container.clientHeight / 3;
  }

  // Forget the PDF, for example when another project is opened.
  clear(): void {
    this.drawing++; // a draw still running must not swap its pages in
    this.nearView.disconnect();
    this.painting.clear();
    void this.doc?.loading.destroy(); // free the memory PDF.js used for this document
    this.doc = null;
    this.last = null;
    this.firstPage = null;
    this.words = 0;
    this.report();
  }

  // The PDF on show, for "Download PDF".
  current(): Uint8Array | null {
    return this.last;
  }

  async show(pdf: Uint8Array): Promise<void> {
    this.last = pdf;
    await this.draw();
  }

  setZoom(zoom: Zoom): void {
    this.zoom = zoom;
    if (this.last) void this.draw();
    else this.report();
  }

  // One step bigger (+1) or smaller (−1).
  stepZoom(direction: 1 | -1): void {
    if (!this.firstPage) return;
    this.setZoom(stepZoom(this.zoom, direction, this.firstPage, this.area()));
  }

  goToPage(number: number): void {
    const pages = this.pages();
    const page = pages[Math.min(Math.max(number, 1), pages.length) - 1];
    if (page) this.container.scrollTop = page.offsetTop - PADDING;
  }

  // The room for one page: the pane minus its padding and scrollbar.
  private area(): Size {
    return { width: this.container.clientWidth - 2 * PADDING - 8, height: this.container.clientHeight - 2 * PADDING };
  }

  private pages(): HTMLElement[] {
    return [...this.container.querySelectorAll<HTMLElement>('.page')];
  }

  private async draw(): Promise<void> {
    const pdf = this.last;
    if (!pdf) return;
    const drawing = ++this.drawing;
    // PDF.js takes ownership of the bytes it is given, so pass a copy.
    const loading = pdfjs.getDocument({ data: pdf.slice() });
    const doc = { proxy: await loading.promise, loading };
    const { proxy } = doc;
    try {
      const area = this.area();
      this.drawnArea = area;

      // Lay out all pages first (blank, at their size, with their text), then
      // swap them in at once, so the place in the document can be kept.
      const pages: HTMLElement[] = [];
      const texts: string[] = [];
      for (let number = 1; number <= proxy.numPages; number++) {
        const page = await proxy.getPage(number);
        const size = page.getViewport({ scale: 1 });
        if (number === 1) this.firstPage = { width: size.width, height: size.height };
        const scale = pageScale(this.zoom, size, area);
        const canvas = document.createElement('canvas');
        canvas.width = 0; // drawn once it comes near the view
        canvas.height = 0;

        // The page's text, laid out exactly over the drawing.
        const text = await page.getTextContent();
        texts.push(text.items.map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : '')).join(''));
        const textLayer = document.createElement('div');
        textLayer.className = 'textLayer';
        const holder = document.createElement('div');
        holder.className = 'page';
        holder.dataset.number = String(number);
        holder.dataset.scale = String(scale);
        holder.style.width = `${size.width * scale}px`;
        holder.style.height = `${size.height * scale}px`;
        holder.style.setProperty('--total-scale-factor', String(scale));
        holder.append(canvas, textLayer);
        await new pdfjs.TextLayer({ textContentSource: text, container: textLayer, viewport: page.getViewport({ scale }) }).render();
        pages.push(holder);
      }
      // So the view does not flicker: draw the pages in view now before swapping.
      const inView = this.pagesInView().map((page) => pages[Number(page.dataset.number) - 1]).filter((page) => page !== undefined);
      await Promise.all(inView.map((page) => this.paint(page, doc)));
      if (drawing !== this.drawing) {
        await loading.destroy();
        return;
      }

      const old = this.doc;
      this.doc = doc;
      this.words = countWords(texts.join('\n'));
      this.nearView.disconnect();
      this.painting.clear();
      // Keep the same place: the same fraction of the way down the document.
      const before = this.container.scrollHeight - this.container.clientHeight;
      const fraction = before > 0 ? this.container.scrollTop / before : 0;
      this.container.replaceChildren(...pages);
      const after = this.container.scrollHeight - this.container.clientHeight;
      this.container.scrollTop = fraction * after;
      for (const page of pages) this.nearView.observe(page);
      void old?.loading.destroy();
      this.report();
    } catch (error) {
      if (this.doc !== doc) await loading.destroy(); // free its memory; it is not on show
      throw error;
    }
  }

  // Draws a page into its canvas, if it is not drawn yet.
  private async paint(page: HTMLElement, doc = this.doc): Promise<void> {
    const canvas = page.querySelector('canvas');
    if (!doc || !canvas || page.dataset.drawn) return;
    page.dataset.drawn = 'true';
    let task: pdfjs.RenderTask | undefined;
    try {
      const pdfPage = await doc.proxy.getPage(Number(page.dataset.number));
      if (!page.dataset.drawn) return; // wiped meanwhile: it left the view
      const viewport = pdfPage.getViewport({ scale: Number(page.dataset.scale) * (window.devicePixelRatio || 1) });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      task = pdfPage.render({ canvas, viewport });
      this.painting.set(page, task);
      await task.promise;
    } catch (error) {
      // Cancelled because the page left the view, or the document was closed.
      delete page.dataset.drawn;
      if (!(error instanceof pdfjs.RenderingCancelledException) && this.doc === doc) console.warn('Could not draw a PDF page', error);
    } finally {
      if (task && this.painting.get(page) === task) this.painting.delete(page);
    }
  }

  // Frees a page's drawing once it is far out of view.
  private wipe(page: HTMLElement): void {
    this.painting.get(page)?.cancel();
    this.painting.delete(page);
    delete page.dataset.drawn;
    const canvas = page.querySelector('canvas');
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  // The pages shown now, at least partly.
  private pagesInView(): HTMLElement[] {
    const top = this.container.scrollTop;
    const bottom = top + this.container.clientHeight;
    return this.pages().filter((page) => page.offsetTop < bottom && page.offsetTop + page.offsetHeight > top);
  }

  private report(): void {
    const pages = this.pages();
    // The current page: the last one whose top is above the upper third of the view.
    const mark = this.container.scrollTop + this.container.clientHeight / 3;
    const current = pages.filter((page) => page.offsetTop <= mark).length || 1;
    this.onState({
      page: this.last ? current : 0,
      pages: this.last ? pages.length : 0,
      percent: this.firstPage ? zoomPercent(this.zoom, this.firstPage, this.area()) : 100,
      zoom: this.zoom,
      words: this.last ? this.words : 0,
    });
  }
}
