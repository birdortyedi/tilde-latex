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

In one sentence: **Tilde is an online LaTeX editor that keeps your projects in your own storage.** It covers what a researcher needs, alone or with a few co-authors. Writing together works without a server of our own (Milestone 7): the text merges in each browser, and Drive and direct browser-to-browser connections carry it. See "Scope" below.

The project owner is not a professional web developer. They will test every change by hand in the browser. Write code they can follow, and explain what you did in plain language.

## Scope

**Version 1 (Milestones 1–6):**
- Code editor with LaTeX syntax highlighting
- Multi-file projects (`\input`, `\include`, images, `.bib` files)
- Compile in the browser with PDF preview
- TikZ and pgfplots
- BibTeX and natbib, and biblatex with Biber (decided after Milestone 5: the engine ships Biber)
- SyncTeX: double-click the PDF to jump to the source, and show the cursor's line in the PDF (decided before Milestone 6)
- XeLaTeX for Unicode text and the OpenType fonts that come with TeX Live, chosen by itself when a project loads `fontspec`, `polyglossia` or `unicode-math`, or by a `% !TEX program = …` line (decided before Milestone 6). LuaLaTeX when a document runs Lua (`luacode`, `\directlua`) or asks for it. Installed fonts are not found by name; font files in the project are, and in Chrome and Edge Tilde can copy an installed font into the project.
- Clickable error messages that jump to the file and line
- Autosave to Google Drive, with conflict detection between devices
- File history through Drive's own version history (no history system of our own). A "safe copy" per file and editing session: Tilde asks Drive to keep the opened version forever and offers it in the file menu. Drive cannot un-keep a version, and Tilde never deletes one (decided before Milestone 6)
- Project starters in the New project dialog, in groups (decided before Milestone 6): IEEE, ACM, Springer LNCS, thesis, beamer slides, letter and CV in `starters/`. CVPR, ICCV, ECCV, ICIP, NeurIPS and ICML are a guided import of the official author kit `.zip`, because their style files have no license that lets Tilde ship them. Update the kit links in `src/starters.ts` once a year.

**Possible later, only when the owner asks:**
- Offline editing with sync on reconnect

**Out of scope, do not build or suggest:**
- Track changes (suggestions to accept or reject). Comments are in scope since Milestone 8
- A visual rich-text editor
- Shell escape (`minted`, `--shell-escape`)
- Any feature that needs a server or database

## Architecture

Everything runs in the user's browser. The app is a static site built with Vite and hosted on GitHub Pages.

- **Editor:** CodeMirror 6, with LaTeX syntax highlighting.
- **TeX engine:** [TeXlyre BusyTeX](https://github.com/TeXlyre/texlyre-busytex) (npm `texlyre-busytex`, AGPL-3.0, TeX Live 2026), used in pdfLaTeX, XeLaTeX and LuaLaTeX modes with bibtex8, and Biber for biblatex. Runs in a Web Worker so the editor never freezes. Chosen in Milestone 1 over SwiftLaTeX (no BibTeX, package server gone), the original BusyTeX (no current browser build) and texlive.js (GPL-2.0, unmaintained).
- **PDF viewer:** PDF.js.
- **Maths preview:** KaTeX (MIT; fonts OFL-1.1), loaded the first time the pointer rests on maths (Milestone 8). Maths KaTeX cannot show is typeset by the TeX engine in a one-formula document with the main file's preamble, never during a compile.
- **EPS images:** Ghostscript (`@okathira/ghostpdl-wasm`, AGPL-3.0-or-later, about 15 MB) in a Web Worker, only when the user turns on "Convert EPS images". It makes `<name>-eps-converted-to.pdf`, which the engine gets with the project's files; never saved to Drive.
- **Engine scripts:** `public/engine/keep-going.js` and `stop-at-errors.js`, one loaded into the engine's worker before every compile, decide whether LaTeX stops at the first error ("Show all errors", off by default).
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
  - Projects started without signing in ("Start writing", `src/localProjects.ts`), decided after Milestone 8: kept only in the browser until "Save to Google Drive" makes them Drive projects and removes them. They belong to no account; signing out leaves them. The status bar always says they are only in this browser.
- **Temporary, rebuilt when needed:** the compiled PDF and build files (`.aux`, `.log`, `.toc`, and so on). They are regenerated with one compile when a project is reopened. Never upload them to Drive unless the user explicitly exports the PDF. The last compile's `.aux`, `.bbl` and similar files are kept in memory, so auto-compile can run one quick LaTeX pass (`src/buildFiles.ts`).
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

Exception: the starters (`starters/`) and examples (`test-docs/`) are **CC0-1.0** (decided before Milestone 6), each folder with its own `LICENSE`, so that users' papers made from them carry no conditions. Write new starters and examples ourselves; never copy third-party templates into these folders.

Before adding any dependency (npm package, WASM build, font, data file):

1. Find its license and state it to the owner.
2. Allowed without discussion: MIT, BSD-2-Clause, BSD-3-Clause, ISC, Apache-2.0, MPL-2.0, Zlib, 0BSD, Unlicense, CC0-1.0.
3. Allowed, but tell the owner first because it affects the project's own license: GPL-3.0, LGPL-3.0, AGPL-3.0 (any "or later" variant included).
4. Not allowed, stop and ask: GPL-2.0-only (incompatible with Apache-2.0 code such as PDF.js), any "non-commercial" or "no derivatives" license, any custom license, or anything with no license at all.
5. Record every dependency in `THIRD_PARTY_LICENSES.md`: name, version, license, link, and what it is used for.
6. TeX Live package files and fonts carry their own licenses (LPPL, GPL, OFL and others). Serve them unmodified and keep their license files next to them.

Run `npx license-checker --summary` after installing packages and report anything new. Then run `npm run licenses`, which rewrites `public/licenses/npm-packages.txt` (the license file of every npm package in the page), and commit it.

The license texts of the TeX engine, Biber and the libraries inside them are in `public/licenses/` with `NOTICE.txt`, which says where each one's source code is. Update it when the engine changes.

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

- `npm run download-engine` — download the engine into `public/core/` (about 500 MB, once per computer; Git ignores this folder). It keeps only what Tilde uses (engine, Biber, `texlive-basic`: about 150 MB) and deletes the unused `recommended` and `extra` bundles
- `npm run dev` — start the app at `http://localhost:5173`, always that port (`--strictPort`), because Google sign-in only allows that origin
- `npm run build` — build the static site into `dist/`
- `npm test` — run the automated tests
- `npm run lint` — check code style
- `npm run licenses` — rewrite `public/licenses/npm-packages.txt` after changing dependencies

The Google Picker API keys: the public site's key is restricted to `https://tildelatex.app/*` and the Picker API, and lives only in the GitHub Actions secret `VITE_GOOGLE_API_KEY`. The local key in `.env.local` (never committed) has an API restriction but no website restriction, because the Picker rejected it with `http://localhost:5173/*` set; never let it reach a deployed site.

The Google IDs: Tilde's own OAuth client ID is the default in `src/config.ts`; `VITE_GOOGLE_CLIENT_ID` and `VITE_GOOGLE_API_KEY` in `.env.local` override it for someone's own copy. The Picker's project number is read from the client ID, so the API key must come from the same Google Cloud project.

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
6. **Release** ✓ live at https://tildelatex.app (17 November 2026), linked from the README
   Decided before Milestone 6: no custom domain for now (cost); a free site on GitHub Pages later. Then the owner bought `tildelatex.app` (Squarespace Domains).
   - **Phase 1, open-source release that people run on their own computer.** Easy install (`npm run download-engine` keeps only what Tilde uses, Node 22 in `.nvmrc` and `engines`, `npm run dev` always on port 5173). Sign-in for anyone with Tilde's own Google app, switched to "In production" (`drive.file` only, a non-sensitive scope); own IDs through `.env.local`. "Add from Google Drive" explains what is missing when there is no Picker key. README with "Run it yourself" first and a clear "what works / what doesn't" section. Version 1.0.0 with a Git tag and a GitHub Release.
   - **Phase 2, a public site on GitHub Pages** at `https://tildelatex.app`. Tilde moved to its own Google Cloud project "Tilde", with no billing linked (decided before phase 2).
     - Done, waiting for the domain: privacy policy (`public/privacy.html`); "Privacy", "Source code" and "Licenses" in the welcome page's footer and, signed in, in the account menu (AGPL section 13); license texts and `NOTICE.txt` in `public/licenses/`; a Content-Security-Policy in `index.html` (tested: sign-in session, Drive, compiling, the package server, DOI lookups through Crossref, DataCite and mEDRA, the Picker; other sites blocked); the workflow `.github/workflows/deploy.yml`, started by hand for now, with the base path in the repository variable `BASE_PATH`.
     - Tested before the domain (17 November 2026): the production build (`vite preview` on port 5173) under its CSP: sign-in, Drive, the Picker, compiling, EPS conversion, the maths preview, the examples. Never deploy a `dist/` built on a computer: it holds the unrestricted Picker key from `.env.local` and, locally, the unused TeX Live bundles.
     - Done with the domain (17 November 2026): DNS at Squarespace (GitHub Pages' A and AAAA records, `www` as a CNAME to `birdortyedi.github.io`, TXT records verifying the domain for GitHub and for Google Search Console; Squarespace's email-security records kept); the domain verified on the GitHub account, the custom domain and Enforce HTTPS in Pages; the restricted Picker key as the secret `VITE_GOOGLE_API_KEY`; `https://tildelatex.app` as a sign-in origin, and the consent screen's home page, privacy policy and authorized domain; the workflow publishes on every push to main. Tested on the live site: the welcome page, compiling with and without signing in (TikZ from the package server), EPS conversion, sign-in, Drive projects, the Picker.
     - Still to do: tell TeXlyre about the site, whose visitors use their package server.
7. **Writing together** ✓ done, tested by the owner with two Google accounts (all three phases on main). Also checked by two independent code reviews and a randomized stress test (`src/sharedSync.stress.test.ts`; `STRESS_SEEDS=50 STRESS_STEPS=300 npx vitest run src/sharedSync.stress.test.ts` for a longer run).
   Decided after a test with two Google accounts (branch `collab-spike`): with `drive.file`, each person's Tilde sees only the files it created and the files that person picked, so files one person adds later are invisible to the other; two browsers on different networks connected directly (WebRTC, Google's STUN server only) with an 18 ms round trip; a Drive file as the go-between gives about 3 s delay. Libraries: Yjs, y-protocols, y-codemirror.next, lib0 (all MIT). Up to 5 people per project. Solo projects stay as they are.
   - The text of a shared project lives in one file in its folder, `Tilde shared project.tilde` (a Yjs document: files by a stable id, each with its path and text). Everyone picks it once when joining, so files added later travel inside it. Saving reads it, merges, and writes it back only if it lacks something of this browser's; a write that covers someone else's is repaired by their next save, so no conflict dialog.
   - Only the owner's Tilde writes the plain files in the folder, from the shared file, so the folder stays an ordinary LaTeX project and nothing is created twice.
   - Images and other binary files stay ordinary Drive files, referenced from the shared file. Those a collaborator adds go into the folder `Tilde uploads`. A file someone else added needs one "Allow" in the Picker before this browser can read it.
   - `Tilde mailbox.tilde` shows who has the project open and carries the introductions for direct connections (`src/live.ts`): every tab says "here" every 10 s; the tab with the smaller id offers, the other answers; while a connection is being made both read the mailbox every 2 s. Connected tabs send Yjs updates, cursors (y-protocols awareness) and binary files directly; the shared file in Drive stays the fallback and the saved copy.
   - The owner's Tilde notes in the document (`plain` map) the Drive version of each plain file it wrote. A plain file with another version was edited outside Tilde: the edit is merged three ways (`src/outsideEdits.ts`), or kept as "name (changed outside Tilde).tex" where it clashes.
   - Phase 1: shared projects (sharing by email, join link, merging, plain files, Allow, who is here). Phase 2: live typing and cursors over direct connections. Phase 3: images directly between browsers, edits made outside Tilde, Leave…, privacy page, README.

8. **Everyday tools** ← current (branch `part-e`; tested in the browser with two Google accounts, waiting to be merged)
   Chosen by the owner after comparing Tilde with other online LaTeX editors (not copying their design): Download for arXiv (a `.zip` with the `.bbl`, comments taken out if asked), Go to anything (Ctrl/Cmd+K), pasting spreadsheet cells as a `booktabs` table, the spell checker told the document's language (babel, polyglossia), Share the PDF by link (saved in the project folder with Tilde's note `tilde: shared-pdf`, so it is never a project file), Make a copy, own starters (a `.zip` in the projects folder with the note `tildeStarter`), People and access (invite to edit or to view; viewers' Tilde writes nothing to Drive), a maths preview on hover (KaTeX), and comments in the margin (`src/comments.ts`: threads in the shared document's `comments` map, tied to the text by Yjs relative positions; resolving deletes one). A solo project's first comment changes it to the shared format, with no one else in it. Also, chosen later: the maths preview falls back to the TeX engine, and two options next to Update PDF, off by default: "Show all errors" and "Convert EPS images". Later, when the owner asks: a time slider over the project's Drive versions, Zotero.

## Known limitations (state these in the README)

- Up to 5 people can write in one project. There is no track changes.
- Shell escape (`minted`, `--shell-escape`) is not supported.
- Very large documents compile more slowly than with a local TeX Live installation.
- Free Google accounts have 15 GB of storage, shared with Gmail and Photos.
