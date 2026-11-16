import { describe, expect, it } from 'vitest';
import keepGoing from '../public/engine/keep-going.js?raw';
import stopAtErrors from '../public/engine/stop-at-errors.js?raw';

// The scripts in public/engine/ that the engine's worker loads before each
// compile, run here against a stand-in for the engine's pipeline.
const SCRIPTS: Record<string, string> = { 'keep-going.js': keepGoing, 'stop-at-errors.js': stopAtErrors };

interface Run { exit_code: number; log: string }

function engine(results: Record<string, Run>) {
  const seen: string[][] = [];
  class BusytexPipeline {
    _run_cmd(_module: unknown, _fs: unknown, cmd: string[]): Run {
      seen.push(cmd);
      return results[cmd[0]];
    }
  }
  const self: Record<string, unknown> = {}; // the worker's global scope
  // Runs a script as the worker would, with its global names.
  const load = (name: string): void => { new Function('self', 'BusytexPipeline', SCRIPTS[name])(self, BusytexPipeline); };
  const run = (cmd: string[]): Run => new BusytexPipeline()._run_cmd(null, null, cmd);
  return { seen, load, run };
}

const FAILED_WITH_PDF = { exit_code: 1, log: '! Undefined control sequence.\nl.5 \\foo\nOutput written on main.pdf (1 page).' };

describe('show all errors', () => {
  it('takes away --halt-on-error and counts a run that wrote a PDF as finished', () => {
    const { seen, load, run } = engine({ pdflatex: FAILED_WITH_PDF });
    load('keep-going.js');
    expect(run(['pdflatex', '--interaction=batchmode', '--halt-on-error', 'main.tex']).exit_code).toBe(0);
    expect(seen[0]).toEqual(['pdflatex', '--interaction=batchmode', 'main.tex']);
  });

  it('still fails when LaTeX wrote no PDF, and leaves BibTeX alone', () => {
    const { load, run } = engine({ pdflatex: { exit_code: 1, log: '! Emergency stop.' }, bibtex8: { exit_code: 2, log: 'Output written on x' } });
    load('keep-going.js');
    expect(run(['pdflatex', 'main.tex']).exit_code).toBe(1);
    expect(run(['bibtex8', 'main.aux']).exit_code).toBe(2);
  });

  it('stops at the first error again after stop-at-errors.js, loaded before the next compile', () => {
    const { seen, load, run } = engine({ pdflatex: FAILED_WITH_PDF });
    load('keep-going.js');
    load('stop-at-errors.js');
    expect(run(['pdflatex', '--halt-on-error', 'main.tex']).exit_code).toBe(1);
    expect(seen[0]).toContain('--halt-on-error');
    load('keep-going.js'); // loaded again: wraps only once, and goes on again
    expect(run(['pdflatex', '--halt-on-error', 'main.tex']).exit_code).toBe(0);
    expect(seen).toHaveLength(2);
  });
});
