import { describe, expect, it } from 'vitest';
import { isFramed } from './notFramed';

describe('running only in its own tab', () => {
  it('starts in its own tab', () => {
    const tab = {} as Window;
    Object.assign(tab, { top: tab, self: tab });
    expect(isFramed(tab)).toBe(false);
  });

  it('refuses inside a frame, also one on another site that hides window.top', () => {
    const page = {} as Window;
    expect(isFramed(Object.assign({} as Window, { top: page, self: {} }))).toBe(true);
    const crossSite = { self: {} } as unknown as Window;
    Object.defineProperty(crossSite, 'top', { get: () => { throw new Error('SecurityError'); } });
    expect(isFramed(crossSite)).toBe(true);
  });
});
