import { describe, expect, it } from 'vitest';
import { engineQueue } from './engineQueue';

describe('the engine queue', () => {
  it('runs jobs one at a time, in the order they asked', async () => {
    const turn = engineQueue();
    const log: string[] = [];
    const job = async (name: string, ms: number): Promise<void> => {
      const release = await turn();
      log.push(`${name} starts`);
      await new Promise((resolve) => setTimeout(resolve, ms));
      log.push(`${name} ends`);
      release();
    };
    await Promise.all([job('compile', 20), job('formula A', 5), job('formula B', 1)]);
    expect(log).toEqual(['compile starts', 'compile ends', 'formula A starts', 'formula A ends', 'formula B starts', 'formula B ends']);
  });

  it('lets a compile asked for while a formula waits run after it, not forever behind it', async () => {
    const turn = engineQueue();
    const first = await turn(); // a compile is running
    const formula = turn().then((release) => { release(); return 'formula done'; });
    first(); // the compile ends, and another one asks at once
    const next = turn().then((release) => { release(); return 'next compile done'; });
    expect(await Promise.all([formula, next])).toEqual(['formula done', 'next compile done']);
  });

  it('goes on after a job that failed, as long as it released its turn', async () => {
    const turn = engineQueue();
    const failing = (async () => {
      const release = await turn();
      try { throw new Error('the formula has an error'); } finally { release(); }
    })();
    await expect(failing).rejects.toThrow('the formula has an error');
    const release = await turn();
    release();
  });
});
