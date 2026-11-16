// EPS images in pdfLaTeX and LuaLaTeX. LaTeX converts an EPS image by
// running a program (epstopdf), which cannot run in the browser; when that
// fails it looks for "<name>-eps-converted-to.pdf" next to the image. Tilde
// makes that file with Ghostscript and gives it to the engine with the
// project's files. It is never saved to Drive. The converter (about 15 MB)
// is downloaded the first time it is needed.
import type { ProjectFile } from './projects';

export const isEps = (path: string): boolean => /\.eps$/i.test(path);
export const convertedPath = (path: string): string => path.replace(/\.eps$/i, '-eps-converted-to.pdf');
// Ghostscript's command line for /image.eps to /image.pdf. -dEPSCrop: the
// PDF page is the image's bounding box, as epstopdf makes it.
export const GHOSTSCRIPT_ARGS = ['-q', '-dSAFER', '-dBATCH', '-dNOPAUSE', '-sDEVICE=pdfwrite', '-dEPSCrop', '-sOutputFile=/image.pdf', '/image.eps'];

let worker: Worker | undefined;
let nextId = 0;
const waiting = new Map<number, { resolve: (pdf: Uint8Array) => void; reject: (error: Error) => void }>();

// Each image is converted once; a changed image is a new Uint8Array.
const converted = new WeakMap<Uint8Array, Promise<Uint8Array>>();

function convertOne(eps: Uint8Array): Promise<Uint8Array> {
  if (!worker) {
    worker = new Worker(new URL('./epsWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }: MessageEvent<{ id: number; pdf?: Uint8Array; error?: string }>) => {
      const job = waiting.get(data.id);
      waiting.delete(data.id);
      if (data.pdf) job?.resolve(data.pdf);
      else job?.reject(new Error(data.error ?? 'Ghostscript could not read it'));
    };
  }
  const id = nextId++;
  const done = new Promise<Uint8Array>((resolve, reject) => waiting.set(id, { resolve, reject }));
  worker.postMessage({ id, eps });
  return done;
}

function cached(content: string | Uint8Array): Promise<Uint8Array> {
  if (typeof content === 'string') return convertOne(new TextEncoder().encode(content));
  let job = converted.get(content);
  if (!job) {
    job = convertOne(content.slice());
    converted.set(content, job);
    job.catch(() => converted.delete(content)); // tried again at the next compile
  }
  return job;
}

// The PDF versions of the project's EPS images, as extra files for the
// engine, and the images that could not be converted, with the reason.
export async function convertEpsImages(files: ProjectFile[]): Promise<{ files: ProjectFile[]; failed: string[] }> {
  const paths = new Set(files.map((f) => f.path));
  const images = files.filter((f) => isEps(f.path) && !paths.has(convertedPath(f.path)));
  const results = await Promise.allSettled(images.map((f) => cached(f.content)));
  const out: ProjectFile[] = [];
  const failed: string[] = [];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') out.push({ path: convertedPath(images[i].path), content: result.value });
    else failed.push(`${images[i].path} (${(result.reason as Error).message})`);
  });
  return { files: out, failed };
}
