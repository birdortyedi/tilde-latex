# CLAUDE.md

Instructions for Claude Code working on this repository. Read this file fully at the start of every session.

## Name and branding

- **App name:** Tilde. Always written as "Tilde", never "TildeTeX" (a "-TeX" ending suggests a TeX engine, which this is not).
- **Repository:** `tilde-latex`
- **Logo, favicon and app icon:** a bold `~`.
- **Text-only label:** "Tilde · LaTeX editor". Use it in the browser tab (for example "paper.tex · Tilde · LaTeX editor" or the shorter "paper.tex · Tilde"), the README title, and the Google OAuth consent screen.
- **Tagline:** "Keeps your work together, like Fig.~3."
- Never put "Google" or "Drive" in the app's name. Google's OAuth verification rejects names that suggest Google endorsement. Describing the app as working with Google Drive in body text is fine.

## What we are building

A free, open-source LaTeX editor that runs entirely in the browser. Users sign in with their own Google account, and their projects are stored in their own Google Drive. There is no server or database of our own, no account system of our own, and no cost to anyone. The target users are researchers writing papers, theses and TikZ figures.

In one sentence: **Tilde is Overleaf for one person, with your own storage.** It covers what a solo researcher needs. It does not try to replace Overleaf's collaboration features, because real-time co-editing needs a server. See "Scope" below.

The project owner is not a professional web developer. They will test every change by hand in the browser. Write code they can follow, and explain what you did in plain language.

## Scope

**Version 1 (Milestones 1–6):**
- Code editor with LaTeX syntax highlighting
- Multi-file projects (`\input`, `\include`, images, `.bib` files)
- Compile in the browser with PDF preview
- TikZ and pgfplots
- BibTeX and natbib, and biblatex with Biber (decided after Milestone 5: the engine ships Biber)
- SyncTeX: double-click the PDF to jump to the source, and show the cursor's line in the PDF (decided before Milestone 6)
- XeLaTeX for Unicode text and the OpenType fonts that come with TeX Live, chosen by itself when a project loads `fontspec`, `polyglossia` or `unicode-math`, or by a `% !TEX program = …` line (decided before Milestone 6). Fonts installed on the user's computer cannot be used.
- Clickable error messages that jump to the file and line
- Autosave to Google Drive, with conflict detection between devices
- File history through Drive's own version history (no history system of our own). A "safe copy" per file and editing session: Tilde asks Drive to keep the opened version forever and offers it in the file menu. Drive cannot un-keep a version, and Tilde never deletes one (decided before Milestone 6)
- Project starters in the New project dialog, in groups (decided before Milestone 6): IEEE, ACM, Springer LNCS, thesis, beamer slides, letter and CV in `starters/`. CVPR, NeurIPS, ICML and ECCV are a guided import of the official author kit `.zip`, because their style files have no license that lets Tilde ship them. Update the kit links in `src/starters.ts` once a year.

**Possible later, only when the owner asks:**
- Offline editing with sync on reconnect

**Out of scope, do not build or suggest:**
- Real-time co-editing, track changes, or a comment system
- A visual rich-text editor
- Shell escape (`minted`, `--shell-escape`)
- Any feature that needs a server or database

## Architecture

Everything runs in the user's browser. The app is a static site built with Vite and hosted on GitHub Pages.

- **Editor:** CodeMirror 6, with LaTeX syntax highlighting.
- **TeX engine:** [TeXlyre BusyTeX](https://github.com/TeXlyre/texlyre-busytex) (npm `texlyre-busytex`, AGPL-3.0, TeX Live 2026), used in pdfLaTeX and XeLaTeX modes with bibtex8, and Biber for biblatex. It also contains LuaTeX, which Tilde does not use. Runs in a Web Worker so the editor never freezes. Chosen in Milestone 1 over SwiftLaTeX (no BibTeX, package server gone), the original BusyTeX (no current browser build) and texlive.js (GPL-2.0, unmaintained).
- **PDF viewer:** PDF.js.
- **Drive sync:** Google Identity Services for sign-in, Google Drive API v3 called with `fetch`, and the Google Picker for importing existing files.
- **Package files:** TeX Live package files are loaded on demand and cached in the browser (IndexedDB).

Data flow: the editor sends the project files to the engine, the engine returns a PDF and a log, and the viewer shows the PDF. Separately, the sync layer saves files to and loads files from Drive.

### Outside services (all free, none run by us)

- **GitHub Pages** serves the app's static files.
- **TeX package files:** the engine and the `texlive-basic` bundle (about 125 MB together) are served with the app. Files missing from that bundle (TikZ, pgfplots and so on) are fetched one at a time from TeXlyre's public package server, `https://texlive2026.texlyre.org`. Cache what it sends so each file is fetched only once. Credit TeXlyre in the README, and tell them about Tilde before the public release.
- **Google** handles sign-in and stores the user's projects in their Drive.

### What lives where

- **Google Drive is the single source of truth** for the user's source files (`.tex`, `.bib`, images, other inputs).
- **Kept in the browser between visits (IndexedDB):**
  - Unsaved changes that have not reached Drive yet, so a crashed tab or dropped network loses nothing. They are synced on the next visit.
  - The engine and the downloaded TeX package files, so only the first compile is slow.
- **Temporary, rebuilt when needed:** the compiled PDF and build files (`.aux`, `.log`, `.toc`, and so on). They are regenerated with one compile when a project is reopened. Never upload them to Drive unless the user explicitly exports the PDF.
- Google sign-in tokens expire after about an hour. Refresh them without interrupting the user where Google allows it, and never lose edits while signing in again.

### Performance expectations

Compiling runs on the user's own computer. The first visit downloads about 125 MB (engine and basic package bundle), which the owner accepted, so show clear progress for that. A typical paper should compile in a few seconds on a modern laptop. Long documents with heavy TikZ will be slower than a local TeX Live installation; that is acceptable, but the editor must stay responsive while compiling.

## Hard rules

1. **Static site only.** No backend server, no database, no serverless functions. If something seems to need a server, stop and tell the owner why before doing anything.
2. **Google scope: `drive.file` only.** Never request `drive`, `drive.readonly` or any other broad scope. These are "restricted" scopes that would require a paid security audit. With `drive.file`, the app can only see files it created or files the user picked in the Picker. Design around that.
3. **No secrets in the repo.** The Google OAuth client ID is public by design and may be committed. Never commit client secrets, API keys with billing, tokens or `.env` files with real values.
4. **TypeScript in strict mode.** No `any` unless there is a comment explaining why.
5. **Never silently overwrite user files on Drive.** See "Saving and conflicts" below.
6. **Ask before adding any dependency.** Follow the licensing policy below.

## Licensing policy

Tilde is licensed **AGPL-3.0-or-later** (decided in Milestone 1, because the engine is AGPL-3.0). The owner wants Tilde to stay free and open: AGPL lets anyone use and change it, but anyone who shares a changed version or runs it as a service must publish their source under the same license. Every dependency must be compatible with AGPL-3.0.

Before adding any dependency (npm package, WASM build, font, data file):

1. Find its license and state it to the owner.
2. Allowed without discussion: MIT, BSD-2-Clause, BSD-3-Clause, ISC, Apache-2.0, MPL-2.0, Zlib, 0BSD, Unlicense, CC0-1.0.
3. Allowed, but tell the owner first because it affects the project's own license: GPL-3.0, LGPL-3.0, AGPL-3.0 (any "or later" variant included).
4. Not allowed, stop and ask: GPL-2.0-only (incompatible with Apache-2.0 code such as PDF.js), any "non-commercial" or "no derivatives" license, any custom license, or anything with no license at all.
5. Record every dependency in `THIRD_PARTY_LICENSES.md`: name, version, license, link, and what it is used for.
6. TeX Live package files and fonts carry their own licenses (LPPL, GPL, OFL and others). Serve them unmodified and keep their license files next to them.

Run `npx license-checker --summary` after installing packages and report anything new.

## Saving and conflicts

The owner edits the same projects from two computers (Ubuntu and macOS). The sync layer must handle that safely.

- Autosave about 3 seconds after the user stops typing, and also when the tab is hidden or closed.
- Before saving a file, compare its current Drive version with the version the app last loaded. If they differ, do not save. Show the user a clear choice: keep mine, keep Drive's, or download both.
- Show sync status at all times: "Saved", "Saving…", "Offline, changes kept locally", or "Conflict".
- Keep unsaved changes in IndexedDB so nothing is lost if the network or the tab dies.
- Build output (`.aux`, `.log`, the PDF) stays in the browser. Only source files sync to Drive, unless the user explicitly exports the PDF.

## How to work

These rules matter more than speed.

**Think before coding.** State your assumptions. If something is unclear or there are several reasonable approaches, say so and ask. Do not guess silently.

**Keep it simple.** Write the minimum code that meets the current milestone. No features, settings or abstractions that were not asked for. If 50 lines would do, do not write 200.

**Make surgical changes.** Touch only what the task needs. Do not reformat or "improve" unrelated code. If you notice a problem elsewhere, mention it instead of fixing it.

**Define how we will know it works.** Before starting a task, write a short plan in this form:

```
1. [Step] → check: [how we verify it]
2. [Step] → check: [how we verify it]
```

Write automated tests (Vitest) for logic such as sync, conflict detection and log parsing. For anything visual, give the owner exact steps to test it by hand in the browser.

**At the end of every task**, tell the owner:

1. What changed, in two or three plain sentences.
2. How to test it, as numbered steps.
3. A suggested Git commit message.

Then stop and wait. Do not start the next milestone without being asked.

## Commands

- `npm run download-engine` — download the engine and TeX Live bundles into `public/core/` (about 500 MB, once per computer; Git ignores this folder)
- `npm run dev` — start the app locally
- `npm run build` — build the static site into `dist/`
- `npm test` — run the automated tests
- `npm run lint` — check code style

Known issue for Milestone 6: the Google Picker API key (in `.env.local`, never committed; the deploy workflow must get it from a GitHub Actions secret) has an API restriction but no website restriction, because the Picker rejected the key with `http://localhost:5173/*` set. Find a website restriction that works before the public release.

Known issue for Milestone 6: `npm run build` copies everything in `public/core/` (about 700 MB, including the unused `recommended` and `extra` bundles) into `dist/`. Only the engine files, Biber (`biber.*`, `busytex_biber.js`) and `texlive-basic` should be deployed.

## Test documents

Keep a folder `test-docs/` with small LaTeX projects that every engine change must still compile:

- `hello/` — minimal article
- `math/` — amsmath, equations, theorem environments
- `tikz/` — a TikZ figure and a pgfplots plot
- `bibtex/` — natbib with a `.bib` file
- `biblatex/` — biblatex with Biber
- `multifile/` — `\input`, `\include`, an image in a subfolder
- `xetex/` — Unicode text and TeX Live's OpenType fonts with XeLaTeX

The starters in `starters/` (shown in the New project dialog) must compile too.

## Milestones

Mark the current milestone with **← current**. Update this list as work is completed.

1. **Engine proof** ✓ done. All five test projects compile in the browser; tested by the owner.
   Choose the WASM TeX engine. Compare the realistic options on license, package coverage, maintenance activity and how package files are hosted, then recommend one to the owner. Compile all of `test-docs/` except `xetex/` in the browser and show the PDF. Report the engine's license so the owner can choose the project license.
2. **Editor and preview** ✓ done, tested by the owner.
   CodeMirror editor beside the PDF viewer. Compile button and Ctrl/Cmd+S to compile. Multi-file projects held in memory. A file tree for switching files.
3. **Google sign-in and Drive storage** ✓ done, tested by the owner.
   Sign in with Google. Create a "LaTeX Projects" folder in Drive. Create, open and save projects there.
4. **Autosave and conflict safety** ✓ done, tested by the owner.
   Everything in "Saving and conflicts" above, with tests.
5. **Quality of life** ✓ done, tested by the owner. Also added: a full project page, file actions (new, upload, rename/move, duplicate, delete, set main), error icons next to line numbers.
   Clickable error messages that jump to the right file and line. Project list. Import an existing project from a zip or via the Picker. Package caching so repeat compiles are fast.
6. **Public release**
   README with screenshots and a clear "what works / what doesn't" section. Privacy policy page (needed for Google verification). GitHub Actions workflow that deploys to GitHub Pages. Google OAuth verification, with the app name "Tilde · LaTeX editor" (fall back to "Tilde LaTeX Editor" if the middle dot causes trouble).

## Known limitations (state these in the README)

- Tilde is for one person working on their own projects. There is no real-time co-editing, track changes or commenting.
- Shell escape (`minted`, `--shell-escape`) is not supported.
- Very large documents compile more slowly than with a local TeX Live installation.
- Free Google accounts have 15 GB of storage, shared with Gmail and Photos.
