# Third-party licenses

Tilde itself is licensed under AGPL-3.0-or-later (see `LICENSE`).
This file lists everything Tilde uses that was written by others.

## Shipped to users (runs in the browser)

| Name | Version | License | Link | Used for |
|---|---|---|---|---|
| texlyre-busytex | 1.4.1 | AGPL-3.0-or-later | https://github.com/TeXlyre/texlyre-busytex | JavaScript API that starts the TeX engine and runs compiles |
| TeXlyre BusyTeX engine files (`busytex.wasm`, `busytex.js`, `busytex_worker.js`, `busytex_pipeline.js`) | assets-v1.4.1 | AGPL-3.0 | https://github.com/TeXlyre/texlyre-busytex-build | The TeX engine compiled to WebAssembly. Downloaded with `npm run download-engine`, not committed |
| codemirror | 6.0.2 | MIT | https://codemirror.net | The code editor |
| @codemirror/language | 6.13.1 | MIT | https://codemirror.net | Language support for the editor |
| @codemirror/legacy-modes | 6.5.5 | MIT | https://codemirror.net | LaTeX syntax highlighting (`stex` mode) |
| pdfjs-dist | 6.5.438 | Apache-2.0 | https://mozilla.github.io/pdf.js/ | PDF viewer |
| TeX Live 2026 package files (`texlive-basic.data`) | 2026 | Each package has its own license (mostly LPPL-1.3c, also GPL, OFL, public domain and others); see `LICENSE.TL` inside the bundle | https://tug.org/texlive/ | LaTeX classes, packages and fonts. Served unmodified |

CodeMirror also brings in its own small helper packages, all MIT: `@codemirror/*`,
`@lezer/*`, `@marijn/find-cluster-break`, `crelt`, `style-mod`, `w3c-keyname`.
`pdfjs-dist` lists `@napi-rs/canvas` (MIT) as an optional dependency; it is only
used when PDF.js runs in Node, never in the browser.

### Programs inside the engine

The engine file bundles these TeX Live 2026 programs and libraries. All are
compatible with AGPL-3.0.

| Program | License |
|---|---|
| pdfTeX | GPL-2.0-or-later |
| bibtex8 | GPL-2.0-or-later |
| kpathsea | LGPL-2.1-or-later |
| XeTeX | MIT |
| expat 2.5.0 | MIT |
| fontconfig 2.13.96 | MIT-style (fontconfig license) |
| Emscripten 5.0.4 runtime | MIT / University of Illinois NCSA |

### Outside services

| Name | License | Link | Used for |
|---|---|---|---|
| TeXlyre TeX Live package server | Serves unmodified TeX Live files (licenses as above) | https://texlive2026.texlyre.org | Fetches package files missing from the basic bundle (TikZ, pgfplots, ...) |
| Google Identity Services (`https://accounts.google.com/gsi/client`) | Google's own terms (Google APIs Terms of Service); loaded from Google at runtime, not bundled or redistributed by Tilde | https://developers.google.com/identity/oauth2/web | "Sign in with Google" and access tokens for Drive |
| Google Drive API v3 | Google APIs Terms of Service; called with `fetch`, no Google code bundled | https://developers.google.com/drive/api | Storing projects in the user's own Drive |

## Development tools only (never shipped)

| Name | Version | License | Link | Used for |
|---|---|---|---|---|
| vite | 8.3.5 | MIT | https://vite.dev | Dev server and build |
| typescript | 6.0.3 | Apache-2.0 | https://www.typescriptlang.org | Type checking |
| vitest | 5.0.5 | MIT | https://vitest.dev | Automated tests |
| eslint | 10.14.0 | MIT | https://eslint.org | Code style checks |
| @eslint/js | 10.0.1 | MIT | https://eslint.org | ESLint's recommended rules |
| typescript-eslint | 8.72.1 | MIT | https://typescript-eslint.io | ESLint rules for TypeScript |

Notable licenses among the tools' own dependencies: `lightningcss` (MPL-2.0, via vite)
and `minimatch` (BlueOak-1.0.0, a permissive license, via eslint).
