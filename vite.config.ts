import { statSync } from 'node:fs';
import { defineConfig } from 'vite';

// The unpacked size of the TeX engine's data (texlive-basic.data), for an
// exact download percentage (see src/engineProgress.ts). 0 when the engine
// has not been downloaded (npm run download-engine); the percentage then
// counts against what the server says.
function engineDataBytes(): number {
  try {
    return statSync('public/core/busytex/texlive-basic.data').size;
  } catch {
    return 0;
  }
}

export default defineConfig({
  define: { __ENGINE_DATA_BYTES__: JSON.stringify(engineDataBytes()) },
});
