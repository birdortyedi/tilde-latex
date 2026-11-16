import { afterEach, describe, expect, it, vi } from 'vitest';
import loadGhostscript from '@okathira/ghostpdl-wasm';
import { convertedPath, convertEpsImages, GHOSTSCRIPT_ARGS, isEps } from './eps';

// A blue box 100 × 60 points, placed at (10, 10) on the page.
const BOX_EPS = `%!PS-Adobe-3.0 EPSF-3.0
%%BoundingBox: 10 10 110 70
newpath 10 10 moveto 110 10 lineto 110 70 lineto 10 70 lineto closepath
0.2 0.4 0.8 setrgbcolor fill
showpage
%%EOF
`;

describe('EPS images', () => {
  it('knows EPS files and the name LaTeX looks for', () => {
    expect(isEps('figures/plot.eps')).toBe(true);
    expect(isEps('figures/plot.EPS')).toBe(true);
    expect(isEps('figures/plot.pdf')).toBe(false);
    expect(convertedPath('figures/plot.eps')).toBe('figures/plot-eps-converted-to.pdf');
  });

  it('converts with Ghostscript to a PDF the size of the bounding box', async () => {
    const gs = await loadGhostscript({ print: () => {}, printErr: () => {} });
    gs.FS.writeFile('/image.eps', new TextEncoder().encode(BOX_EPS));
    expect(gs.callMain([...GHOSTSCRIPT_ARGS])).toBe(0);
    const pdf = new TextDecoder('latin1').decode(gs.FS.readFile('/image.pdf'));
    expect(pdf.startsWith('%PDF-')).toBe(true);
    expect(pdf).toMatch(/MediaBox \[0 0 100 60\]/);
  });

  describe('in the page, through the worker', () => {
    const posted: Uint8Array[] = [];
    // A stand-in for the worker: "converts" by answering with the bytes reversed, or fails on "bad".
    class FakeWorker {
      onmessage: ((event: { data: unknown }) => void) | null = null;
      postMessage({ id, eps }: { id: number; eps: Uint8Array }): void {
        posted.push(eps);
        const bad = new TextDecoder().decode(eps) === 'bad';
        setTimeout(() => this.onmessage?.({ data: bad ? { id, error: 'Unrecoverable error' } : { id, pdf: eps.slice().reverse() } }));
      }
    }
    vi.stubGlobal('Worker', FakeWorker);
    afterEach(() => { posted.length = 0; });

    it('gives the engine a PDF next to each image, converting each image once', async () => {
      const image = new TextEncoder().encode('abc');
      const files = [{ path: 'main.tex', content: '\\includegraphics{fig/a.eps}' }, { path: 'fig/a.eps', content: image }];
      const first = await convertEpsImages(files);
      expect(first.files.map((f) => f.path)).toEqual(['fig/a-eps-converted-to.pdf']);
      expect(new TextDecoder().decode(first.files[0].content as Uint8Array)).toBe('cba');
      expect(first.failed).toEqual([]);
      await convertEpsImages(files);
      expect(posted).toHaveLength(1); // the same image is not converted again
    });

    it('leaves a PDF the project already has, and reports images it could not convert', async () => {
      const files = [
        { path: 'a.eps', content: new TextEncoder().encode('abc') },
        { path: 'a-eps-converted-to.pdf', content: new Uint8Array([1]) },
        { path: 'b.eps', content: new TextEncoder().encode('bad') },
      ];
      const result = await convertEpsImages(files);
      expect(result.files).toEqual([]);
      expect(result.failed).toEqual(['b.eps (Unrecoverable error)']);
    });
  });
});
