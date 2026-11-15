import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { googleDrive, RETRIES } from './drive';

vi.mock('./auth', () => ({
  getAccessToken: async () => 'token',
  forgetToken: () => {},
  SignInNeededError: class extends Error {},
}));

// Drive's answers, one per request, in order.
function answers(...list: [number, string][]) {
  const fetch = vi.fn(async () => {
    const [status, body] = list.shift() ?? [200, '{}'];
    return new Response(body, { status });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('Drive requests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { onLine: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // Runs a request while letting the waits between tries pass.
  const settle = async <T>(work: Promise<T>): Promise<T> => {
    const result = work.then((value) => ({ value }), (error: unknown) => ({ error }));
    await vi.runAllTimersAsync();
    const outcome = await result;
    if ('error' in outcome) throw outcome.error;
    return outcome.value;
  };

  it('tries again when Drive asks to slow down', async () => {
    const fetch = answers(
      [429, 'Too many requests'],
      [403, '{"error":{"errors":[{"reason":"userRateLimitExceeded"}]}}'],
      [200, '{"id":"f1","name":"main.tex"}'],
    );
    expect((await settle(googleDrive.get('f1'))).name).toBe('main.tex');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('tries reading again after trouble on Google\'s side, but not a change', async () => {
    let fetch = answers([503, 'Unavailable'], [200, 'text']);
    expect(new TextDecoder().decode(await settle(googleDrive.download('f1')))).toBe('text');
    expect(fetch).toHaveBeenCalledTimes(2);

    fetch = answers([503, 'Unavailable'], [200, '{}']);
    await expect(settle(googleDrive.updateFile('f1', new Uint8Array([1])))).rejects.toThrow('503');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not try again when access is refused', async () => {
    const fetch = answers([403, '{"error":{"errors":[{"reason":"insufficientFilePermissions"}]}}']);
    await expect(settle(googleDrive.get('f1'))).rejects.toThrow('403');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('gives up after a few tries', async () => {
    const fetch = answers(...Array.from({ length: RETRIES + 5 }, (): [number, string] => [429, 'Too many requests']));
    await expect(settle(googleDrive.get('f1'))).rejects.toThrow('429');
    expect(fetch).toHaveBeenCalledTimes(RETRIES + 1);
  });
});
