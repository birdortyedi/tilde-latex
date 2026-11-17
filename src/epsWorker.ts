// Converts one EPS image to PDF with Ghostscript, away from the page so the
// editor never freezes. Ghostscript runs only once per start, so each image
// gets a fresh start from the same compiled program (downloaded once).
import loadGhostscript from '@okathira/ghostpdl-wasm';
import wasmUrl from '@okathira/ghostpdl-wasm/gs.wasm?url';
import { GHOSTSCRIPT_ARGS } from './eps';

let program: Promise<WebAssembly.Module> | undefined;

async function convert(eps: Uint8Array): Promise<Uint8Array> {
  if (!program) {
    program = WebAssembly.compileStreaming(fetch(wasmUrl));
    program.catch(() => { program = undefined; }); // tried again next time
  }
  const compiled = await program;
  const messages: string[] = [];
  // If Ghostscript cannot start (not enough memory, say), loading it would never end: fail instead.
  let cannotStart: (error: unknown) => void = () => {};
  const startFailed = new Promise<never>((_, reject) => { cannotStart = reject; });
  const gs = await Promise.race([loadGhostscript({
    // Started from the program compiled once, instead of downloading it again.
    instantiateWasm(imports: WebAssembly.Imports, done: (instance: WebAssembly.Instance) => void): WebAssembly.Exports {
      WebAssembly.instantiate(compiled, imports).then(done, cannotStart);
      return {}; // the real exports arrive through done()
    },
    print: () => {},
    printErr: (line: string) => messages.push(line),
  }), startFailed]);
  gs.FS.writeFile('/image.eps', eps);
  const exit = gs.callMain([...GHOSTSCRIPT_ARGS]);
  const failed = (): Error => new Error(messages.find((m) => m.trim()) ?? 'Ghostscript could not read it');
  if (exit !== 0) throw failed();
  try {
    return gs.FS.readFile('/image.pdf'); // throws if Ghostscript wrote no PDF
  } catch {
    throw failed();
  }
}

self.onmessage = async ({ data }: MessageEvent<{ id: number; eps: Uint8Array }>) => {
  try {
    const pdf = await convert(data.eps);
    self.postMessage({ id: data.id, pdf }, { transfer: [pdf.buffer] });
  } catch (error) {
    self.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) });
  }
};
