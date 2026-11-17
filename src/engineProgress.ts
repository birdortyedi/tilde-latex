// The TeX engine's download percentage, as Tilde shows it.
//
// The engine's data loader counts the bytes it has unpacked against the
// download's Content-Length. A server that compresses the file (GitHub Pages
// sends texlive-basic.data gzipped, 66 MB for 93 MB) gives a Content-Length
// smaller than the unpacked size, so the loader's own percentage runs past
// 100. Tilde counts against the real, unpacked size instead (known when the
// site is built, see vite.config.ts), never goes backwards, and says 100 only
// when the engine says it is ready.

export interface DownloadProgress {
  loaded: number;
  total: number;
  percent: number;
}

// The loader's "All downloads complete." arrives as 1 of 1 (texlyre-busytex).
const isDone = (progress: DownloadProgress): boolean => progress.loaded === 1 && progress.total === 1;

// Below this, a total counts the engine's start-up steps ("Preparing… (2/5)"), not bytes.
const BYTES = 1_000_000;

// The percentage to show after this message, or null if it says nothing about
// the download (then there is nothing to show, for example when the engine
// comes from the browser's cache). `dataBytes` is the unpacked size of the
// engine's data, or 0 if unknown.
export function shownPercent(previous: number, progress: DownloadProgress, dataBytes: number): number | null {
  if (isDone(progress)) return 100;
  if (progress.total < BYTES) return null;
  const fraction = progress.loaded / Math.max(progress.total, dataBytes);
  return Math.max(previous, Math.min(99, Math.floor(fraction * 100)));
}
