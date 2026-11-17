import { afterEach, describe, expect, it, vi } from 'vitest';
import { assetBytes } from './assetBytes';

describe('the bytes of a bundled file', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('decodes a file the build put inline as a data: address, without fetch (the CSP blocks that)', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect([...await assetBytes('data:image/png;base64,iVBORw0K')]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    expect(new TextDecoder().decode(await assetBytes('data:image/svg+xml,%3Csvg%2F%3E'))).toBe('<svg/>');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fetches a file served on its own, and says so when it is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.endsWith('ok.png')
      ? new Response(new Uint8Array([1, 2, 3])) : new Response('', { status: 404 }))));
    expect([...await assetBytes('/assets/ok.png')]).toEqual([1, 2, 3]);
    await expect(assetBytes('/assets/gone.png')).rejects.toThrow('/assets/gone.png could not be loaded (404)');
  });
});
