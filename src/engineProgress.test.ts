import { describe, expect, it } from 'vitest';
import { shownPercent } from './engineProgress';

const DATA = 92_785_062; // texlive-basic.data, unpacked
const GZIPPED = 65_762_633; // its Content-Length from GitHub Pages
const bytes = (loaded: number, total: number) => ({ loaded, total, percent: Math.round((loaded / total) * 100) });
const done = { loaded: 1, total: 1, percent: 100 };

describe('the engine download percentage', () => {
  it('counts against the unpacked size when the server sends the file compressed, so it never passes 100', () => {
    // The loader's own percentage would be 35% at a quarter of the way, and 141% at the end.
    expect(shownPercent(0, bytes(DATA / 4, GZIPPED), DATA)).toBe(25);
    expect(shownPercent(25, bytes(DATA / 2, GZIPPED), DATA)).toBe(50);
    expect(shownPercent(50, bytes(DATA, GZIPPED), DATA)).toBe(99); // all bytes in, not yet ready
    expect(shownPercent(99, done, DATA)).toBe(100);
  });

  it('works the same when the server does not compress, or the size is not known', () => {
    expect(shownPercent(0, bytes(DATA / 2, DATA), DATA)).toBe(50);
    expect(shownPercent(0, bytes(DATA / 2, DATA), 0)).toBe(50);
    expect(shownPercent(0, bytes(DATA * 1.4, DATA), 0)).toBe(99); // never past 99 before ready
  });

  it('never goes backwards, for example when a second file starts and the total grows', () => {
    expect(shownPercent(60, bytes(DATA * 0.3, DATA), DATA)).toBe(60);
  });

  it('ignores the start-up steps, so nothing shows when the engine comes from the cache', () => {
    expect(shownPercent(0, { loaded: 2, total: 5, percent: 40 }, DATA)).toBeNull();
    expect(shownPercent(0, done, DATA)).toBe(100); // then showEngineDownload shows nothing
  });
});
