import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import './style.css';
import { BusyTexRunner, LuaLatex, PdfLatex, XeLatex } from 'texlyre-busytex';
import { findMainFile, groupByProject, pathProblem, type Project, type ProjectFile } from './projects';
import { buildTree, isTextFile, type TreeNode } from './fileTree';
import { Editor, type LineMark } from './editor';
import { PdfViewer, type PdfViewState } from './pdfViewer';
import type { Zoom } from './pdfZoom';
import { forgetToken, restoreSignIn, signIn, SignInNeededError, signOut } from './auth';
import { googleDrive, type DriveFile } from './drive';
import { createProject, lastEdited, listProjects, moveProjectsFolder, openProject, projectsFolder, setMainFile as saveMainFile } from './driveProjects';
import { GROUPS, kitMainFile, STARTERS, type Kit, type StarterGroup } from './starters';
import { browserDrafts, forgetOtherAccounts, type Draft } from './drafts';
import { ProjectSync, type DriveChanges, type SyncState } from './sync';
import { cachedPackages, REMOTE_DIR, storeNewPackages } from './packageCache';
import { lastLatexLog, parseLog, type LogProblem } from './logParser';
import { unzipProject, zipProject } from './zipImport';
import { timeAgo, versionTime } from './time';
import { bibKeysIn, bibliographyTool, loadsPackage, outline, preambleInsertAt, texEngine } from './latex';
import { SyncTex } from './synctex';
import { afterQuickCompile, keptBuildFiles } from './buildFiles';
import { canConvertToPng, figureFor, figurePosition, imageExtension, imageFolder, imagePath } from './figures';
import { convertToPng } from './imageConvert';
import { fontFamilies, fontFormat, fontspecLine, pickFaces, type Faces, type LocalFont } from './localFonts';
import { fetchBibtex, keyWithDoi, parseDoi, tidyBibtex } from './doi';
import { showChanges } from './changesView';
import { isGoogleDoc, pickDriveFiles, pickDriveFolder, type PickedFile } from './picker';
import { askConfirm, askText } from './ask';
import { initLayout, type Pane } from './layout';
import { initTheme } from './theme';
import { openMenu } from './menu';
import { hideBusy, notify, showBusy } from './notices';

// Files that TeX Live's basic bundle lacks (TikZ, pgfplots, ...) are fetched
// one at a time from TeXlyre's public package server.
const PACKAGE_SERVER = 'https://texlive2026.texlyre.org';
const LAST_PROJECT_KEY = 'tilde.lastProject'; // reopened after a reload
// One line about each example, for the welcome page and the New project dialog.
const EXAMPLE_NOTES: Record<string, string> = {
  hello: 'The smallest document',
  math: 'Equations and theorems with amsmath',
  tikz: 'A TikZ figure and a pgfplots plot',
  bibtex: 'Citations with natbib and BibTeX',
  biblatex: 'Citations with biblatex and Biber',
  multifile: '\\input, \\include and an image in a folder',
  xetex: 'Unicode text and OpenType fonts with XeLaTeX',
};

const BLANK_PROJECT: ProjectFile[] = [{
  path: 'main.tex',
  content: '\\documentclass{article}\n\\begin{document}\nHello from Tilde.\n\\end{document}\n',
}];

// Vite collects the test documents at build time: text files as strings,
// binary files (images) as URLs that we download when the page loads.
const textFiles = import.meta.glob<string>('/test-docs/**/*.{tex,bib,sty,cls,bst}', {
  query: '?raw', import: 'default', eager: true,
});
const binaryFileUrls = import.meta.glob<string>('/test-docs/**/*.{png,jpg,jpeg,pdf}', {
  query: '?url', import: 'default', eager: true,
});
// The starters for new projects (papers, thesis, slides, letter, CV), in the same way.
const starterProjects = groupByProject('/starters', import.meta.glob<string>('/starters/**/*.{tex,bib,sty,cls,bst}', {
  query: '?raw', import: 'default', eager: true,
}));

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`index.html is missing ${selector}`);
  return found;
}

const projectsButton = element<HTMLButtonElement>('#show-projects');
const projectNameLabel = element<HTMLSpanElement>('#project-name');
const projectsPage = element<HTMLElement>('#projects-page');
const projectsWhere = element<HTMLSpanElement>('#projects-where');
const changeFolderButton = element<HTMLButtonElement>('#change-folder');
const projectList = element<HTMLUListElement>('#project-list');
const projectSearch = element<HTMLInputElement>('#project-search');
const projectSort = element<HTMLSelectElement>('#project-sort');
const projectsTools = element<HTMLDivElement>('#projects-tools');
const projectsEmpty = element<HTMLDivElement>('#projects-empty');
const projectsNoMatch = element<HTMLParagraphElement>('#projects-no-match');
const signedInSection = element<HTMLDivElement>('#projects-signed-in');
const importMenuButton = element<HTMLButtonElement>('#import-menu');
const zipInput = element<HTMLInputElement>('#zip-input');
const closeProjectsButton = element<HTMLButtonElement>('#close-projects');
const mainArea = element<HTMLElement>('main');
const compileButton = element<HTMLButtonElement>('#compile');
const syncButton = element<HTMLButtonElement>('#sync');
const conflictDialog = element<HTMLDialogElement>('#conflict-dialog');
const conflictPath = element<HTMLElement>('#conflict-path');
const downloadBothButton = element<HTMLButtonElement>('#download-both');
const signOutDialog = element<HTMLDialogElement>('#sign-out-dialog');
const signOutFiles = element<HTMLUListElement>('#sign-out-files');
const newProjectButton = element<HTMLButtonElement>('#new-project');
const signInButton = element<HTMLButtonElement>('#sign-in');
const signOutButton = element<HTMLButtonElement>('#sign-out');
const newProjectDialog = element<HTMLDialogElement>('#new-project-dialog');
const newProjectName = element<HTMLInputElement>('#new-project-name');
const newProjectForm = element<HTMLFormElement>('#new-project-form');
const newProjectProblem = element<HTMLParagraphElement>('#new-project-problem');
const templateChoices = element<HTMLDivElement>('#template-choices');
const starterGroups = element<HTMLDivElement>('#starter-groups');
const kitSteps = element<HTMLDivElement>('#kit-steps');
const kitLink = element<HTMLAnchorElement>('#kit-link');
const kitFind = element<HTMLSpanElement>('#kit-find');
const kitNote = element<HTMLParagraphElement>('#kit-note');
const kitInput = element<HTMLInputElement>('#kit-input');
const createProjectButton = element<HTMLButtonElement>('#create-project');
const exampleList = element<HTMLUListElement>('#example-list');
const backBar = element<HTMLDivElement>('#back-bar');
const logButton = element<HTMLButtonElement>('#toggle-log');
const statusText = element<HTMLSpanElement>('#status');
const treeView = element<HTMLElement>('#tree');
const editorElement = element<HTMLDivElement>('#editor');
const imagePreview = element<HTMLImageElement>('#image-preview');
const logView = element<HTMLPreElement>('#log');
const addFilesButton = element<HTMLButtonElement>('#add-files');
const projectActionsButton = element<HTMLButtonElement>('#project-actions');
const cursorPosition = element<HTMLSpanElement>('#cursor-position');
const wordCount = element<HTMLSpanElement>('#word-count');
const problemCount = element<HTMLButtonElement>('#problem-count');
const pdfContainer = element<HTMLDivElement>('#pdf');
const uploadInput = element<HTMLInputElement>('#upload-input');
const problemList = element<HTMLUListElement>('#problems');
const problemsPanel = element<HTMLElement>('#problems-panel');
const outlinePanel = element<HTMLElement>('#outline-panel');
const outlineToggle = element<HTMLButtonElement>('#outline-toggle');
const outlineView = element<HTMLElement>('#outline');
const problemsTitle = element<HTMLSpanElement>('#problems-title');
const preview = element<HTMLElement>('#preview');
const welcome = element<HTMLDivElement>('#welcome');

let examples: Project[] = []; // the test-docs projects, shown while signed out
let driveFolders: DriveFile[] = []; // the project folders in Drive, shown while signed in
let rootId: string | null = null; // the folder in Drive that holds the projects; null while signed out
let rootName = ''; // its name, which the user may change in Drive
let accountId = ''; // the signed-in Google account; drafts are tagged with it
let unsavedAtSignOut: Draft[] = []; // shown in the sign-out dialog
let project: Project | null = null; // the open project; edits change its files in memory
let activePath: string | null = null;
let runner: Promise<BusyTexRunner> | null = null; // the TeX engine, once it has started loading
let compiling = false;
// Build files of the last compile (.aux, .bbl…), for quick compiles; see buildFiles.ts.
// They belong to one main file compiled by one engine, noted in buildKey.
let buildFiles: ProjectFile[] = [];
let buildKey = '';
const ENGINE_PROJECT_DIR = '/home/web_user/project_dir'; // where the engine compiles
let syncTex: SyncTex | null = null; // where each part of the PDF came from, from the last compile
let cursorLine = 1; // in the open file, for "Show in PDF"
let sync: ProjectSync | null = null; // saves the open project to Drive; null for examples
let conflictShown = ''; // the file the conflict dialog was last opened for
let braveHintShown = false;
let welcomeShown = false;

const editor = new Editor(editorElement, (path, text) => {
  const file = project?.files.find((f) => f.path === path);
  if (!file) return;
  file.content = text;
  sync?.edited(path);
  scheduleAutoCompile();
  scheduleOutline();
}, (line, column) => {
  cursorLine = line;
  cursorPosition.textContent = `Ln ${line}, Col ${column}`;
}, () => project?.files ?? []);
const pdfViewer = new PdfViewer(pdfContainer, showPdfState);

// The toolbar above the PDF: zoom, page number, auto-compile, download.
const zoomMenuButton = element<HTMLButtonElement>('#zoom-menu');
const zoomLabel = element<HTMLSpanElement>('#zoom-label');
const zoomInButton = element<HTMLButtonElement>('#zoom-in');
const zoomOutButton = element<HTMLButtonElement>('#zoom-out');
const pageNav = element<HTMLLabelElement>('#page-nav');
const pageNumber = element<HTMLInputElement>('#page-number');
const pageCount = element<HTMLSpanElement>('#page-count');
const autoCompileBox = element<HTMLInputElement>('#auto-compile');
const downloadPdfButton = element<HTMLButtonElement>('#download-pdf');
const showInPdfButton = element<HTMLButtonElement>('#show-in-pdf');
const ZOOM_KEY = 'tilde.pdfZoom';
const AUTO_COMPILE_KEY = 'tilde.autoCompile';
const AUTO_COMPILE_DELAY = 1500; // milliseconds after the last edit

function showPdfState(state: PdfViewState): void {
  zoomLabel.textContent = state.zoom === 'width' ? 'Fit width' : state.zoom === 'page' ? 'Fit page' : `${state.percent}%`;
  const hasPdf = state.pages > 0;
  for (const button of [zoomInButton, zoomOutButton, downloadPdfButton]) button.disabled = !hasPdf;
  showInPdfButton.disabled = !hasPdf || !syncTex;
  wordCount.hidden = !hasPdf;
  wordCount.textContent = `${state.words.toLocaleString()} ${state.words === 1 ? 'word' : 'words'}`;
  pageNav.hidden = !hasPdf;
  if (document.activeElement !== pageNumber) pageNumber.value = String(state.page);
  pageCount.textContent = `of ${state.pages}`;
  try { localStorage.setItem(ZOOM_KEY, JSON.stringify(state.zoom)); } catch { /* not remembered */ }
}

function setZoom(zoom: Zoom): void {
  pdfViewer.setZoom(zoom);
}

function showZoomMenu(): void {
  const sizes = [0.5, 0.75, 1, 1.25, 1.5, 2];
  openMenu(zoomMenuButton, [
    { label: 'Fit width', action: () => setZoom('width') },
    { label: 'Fit page', action: () => setZoom('page') },
    ...sizes.map((size) => ({ label: `${Math.round(size * 100)}%`, action: () => setZoom(size) })),
  ]);
}

// SyncTeX: from the cursor's line to the PDF, and from a double-click in
// the PDF back to the source.
function showInPdf(): void {
  if (!syncTex || !activePath) return;
  const rects = syncTex.toPdf(activePath, cursorLine);
  if (rects.length === 0) {
    setStatus(`Line ${cursorLine} of ${activePath} is not in the PDF.`);
    return;
  }
  reveal('pdf');
  pdfViewer.highlight(rects);
}

// Citations from a DOI, from the "+" menu or the \cite{} suggestions.
editor.onAddCitation = addCitation;

// The .bib file new citations go into: the only one, or the one the
// document names in \bibliography{} or \addbibresource{}, or the first.
function bibFileFor(files: ProjectFile[]): ProjectFile | undefined {
  const bibs = files.filter((f) => f.path.endsWith('.bib') && typeof f.content === 'string');
  if (bibs.length <= 1) return bibs[0];
  for (const file of files) {
    if (!file.path.endsWith('.tex') || typeof file.content !== 'string') continue;
    const named = /\\(?:bibliography|addbibresource)\{([^},]+)/.exec(file.content)?.[1].trim();
    const found = named && bibs.find((b) => b.path === named || b.path === `${named}.bib` || b.path.endsWith(`/${named}`) || b.path.endsWith(`/${named}.bib`));
    if (found) return found;
  }
  return bibs[0];
}

async function addCitation(given: string | null): Promise<string | null> {
  if (!project) return null;
  let doi = given;
  if (!doi) {
    const answer = await askText('The DOI or arXiv link of the paper, for example 10.1145/3292500.3330701 or arxiv.org/abs/1706.03762:', '');
    if (answer === null || !answer.trim()) return null;
    doi = parseDoi(answer);
    if (!doi) {
      showError(new Error(`"${answer.trim()}" is not a DOI or an arXiv link.`));
      return null;
    }
  }
  for (const file of project.files) {
    const key = file.path.endsWith('.bib') && typeof file.content === 'string' ? keyWithDoi(file.content, doi) : null;
    if (key) {
      notify(`${file.path} already has this paper, as ${key}.`);
      return key;
    }
  }
  setStatus(`Looking up ${doi} at doi.org…`);
  let entry: { key: string; text: string } | null;
  try {
    entry = tidyBibtex(await fetchBibtex(doi), new Set(bibKeysIn(project.files)));
  } catch (error) {
    setStatus('');
    showError(error);
    return null;
  }
  setStatus('');
  if (!entry) {
    showError(new Error(`doi.org sent a citation for ${doi} that Tilde cannot read.`));
    return null;
  }
  const bib = bibFileFor(project.files);
  if (bib && typeof bib.content === 'string') {
    const gap = bib.content === '' || bib.content.endsWith('\n\n') ? '' : bib.content.endsWith('\n') ? '\n' : '\n\n';
    if (bib.path === activePath) {
      editor.insertText(bib.content.length, gap + entry.text); // through the editor, so Ctrl/Cmd+Z undoes it
    } else {
      bib.content += gap + entry.text;
      editor.replace(bib.path, bib.content);
      sync?.edited(bib.path);
    }
    notify(`Added ${entry.key} to ${bib.path}.`);
  } else {
    const projectSync = sync;
    const text = entry.text;
    if (projectSync) {
      if (!await runFileAction('Creating refs.bib', 'Created refs.bib.', () => projectSync.addFile('refs.bib', text))) return null;
    } else {
      project.files.push({ path: 'refs.bib', content: text });
      renderTree();
    }
    notify(`Added ${entry.key} to a new file, refs.bib. To print the list of references, add \\bibliographystyle{plain} and \\bibliography{refs} before \\end{document}.`);
  }
  return entry.key;
}

// "+" menu → "Add citation from DOI…": adds it, then cites it at the cursor.
async function citeFromMenu(): Promise<void> {
  const target = activePath;
  const key = await addCitation(null);
  if (key && target?.endsWith('.tex') && activePath === target) editor.insertAtCursor(`\\cite{${key}}`);
}

// An image pasted or dropped into the editor: saved in the project's image
// folder, with a figure for it written into the text.
editor.onImages = (files, at) => void addImages(files, at);

async function addImages(files: File[], at: number): Promise<void> {
  const target = activePath;
  if (!project || !target?.endsWith('.tex')) return;
  let position = at;
  let added = false;
  for (const file of files) {
    let extension = imageExtension(file.name, file.type);
    let bytes: Uint8Array;
    if (extension) {
      bytes = new Uint8Array(await file.arrayBuffer());
    } else if (canConvertToPng(file.name, file.type)) {
      // GIF, WebP, SVG and the like: LaTeX cannot include them, so Tilde makes a PNG.
      try {
        bytes = await convertToPng(file);
      } catch (error) {
        showError(error);
        continue;
      }
      extension = 'png';
      const name = file.name || 'This image';
      notify(/\.svg$/i.test(file.name) || file.type === 'image/svg+xml'
        ? `${name} is now a PNG picture. For lines that stay sharp at any size, export it as PDF and add that instead.`
        : `${name} is now a PNG${/gif/i.test(file.type + file.name) ? ' (its first frame)' : ''}, which LaTeX can include.`);
    } else {
      notify(`${file.name || 'This image'} cannot go into a LaTeX document. Save it as PNG, JPG or PDF, then add it again.`, 'error');
      continue;
    }
    const taken = new Set(project.files.map((f) => f.path));
    const path = imagePath(file.name, extension, imageFolder([...taken]), taken);
    const projectSync = sync;
    if (projectSync) {
      if (!await runFileAction(`Adding ${path}`, `Added ${path}.`, () => projectSync.addFile(path, bytes))) return;
    } else {
      project.files.push({ path, content: bytes }); // an example: kept in the browser only
      renderTree();
      notify(`Added ${path}.`);
    }
    if (activePath !== target) return; // another file was opened meanwhile
    position = editor.insertBlock(figurePosition(editor.text(), position), (indent) => figureFor(path, indent));
    added = true;
  }
  const mainPath = added ? loadGraphicx() : null;
  if (mainPath) notify(`Also added \\usepackage{graphicx} to ${mainPath}, which \\includegraphics needs.`);
}

// \includegraphics needs the graphicx package. If no file of the project
// loads it, adds it to the main file, right after \documentclass.
// Returns the main file's path if it did.
function loadGraphicx(): string | null {
  if (!project || loadsPackage(project.files, ['graphicx', 'graphics'])) return null;
  const mainPath = findMainFile(project);
  const main = project.files.find((f) => f.path === mainPath);
  if (!main || typeof main.content !== 'string') return null;
  const at = preambleInsertAt(main.content);
  if (at === null) return null;
  const line = `${main.content[at - 1] === '\n' ? '' : '\n'}\\usepackage{graphicx}\n`;
  if (main.path === activePath) {
    editor.insertText(at, line); // through the editor, so Ctrl/Cmd+Z undoes it
  } else {
    main.content = main.content.slice(0, at) + line + main.content.slice(at);
    editor.replace(main.path, main.content);
    sync?.edited(main.path);
  }
  return main.path;
}

pdfViewer.onDoubleClick = (page, x, y) => {
  const place = syncTex?.toSource(page, x, y);
  if (!place || !project?.files.some((f) => f.path === place.file)) return;
  if (place.file !== activePath) openFile(place.file);
  reveal('editor');
  editor.goTo(place.line);
};

function downloadPdf(): void {
  const pdf = pdfViewer.current();
  if (pdf && project) downloadFile(`${project.name}.pdf`, pdf);
}

// Auto-compile: compile by itself a moment after typing stops, quickly (one
// LaTeX pass with the build files of the last compile). A compile that is
// asked for while one runs starts right after it.
type CompileKind = 'full' | 'quick';
let autoCompileTimer: ReturnType<typeof setTimeout> | undefined;
let compileAgain: CompileKind | null = null;
let againIsFollowUp = false; // compileAgain was asked for by a quick compile's log, not by typing
function scheduleAutoCompile(): void {
  if (!autoCompileBox.checked) return;
  clearTimeout(autoCompileTimer);
  autoCompileTimer = setTimeout(() => {
    if (compiling) {
      compileAgain = compileAgain ?? 'quick';
      againIsFollowUp = false;
    } else {
      void compile('quick');
    }
  }, AUTO_COMPILE_DELAY);
}

// The account buttons in the top bar. Only one is ever shown: "Sign in"
// when signed out, "Sign in again" when Google's sign-in ran out (the
// project stays open and edits are kept), "Sign out" otherwise.
type AccountState = 'signed-out' | 'signed-in' | 'expired';
function showAccount(state: AccountState): void {
  signInButton.hidden = state === 'signed-in';
  signOutButton.hidden = state !== 'signed-in';
  const [long, short] = signInButton.querySelectorAll('span');
  long.textContent = state === 'expired' ? 'Sign in again' : 'Sign in with Google';
  short.textContent = state === 'expired' ? 'Sign in again' : 'Sign in';
}

// The status bar shows the current state (the last compile, "Compiling…").
// Results of the user's actions are notices instead (see notices.ts).
function setStatus(text: string): void {
  statusText.textContent = text;
  statusText.title = text; // the full text, if the bar cuts it off
}

function showError(error: unknown): void {
  hideBusy();
  notify(error instanceof Error ? error.message : String(error), 'error');
  if (error instanceof SignInNeededError) showAccount('expired');
}

async function loadExamples(): Promise<void> {
  const binaryFiles: Record<string, Uint8Array> = {};
  for (const [path, url] of Object.entries(binaryFileUrls)) {
    binaryFiles[path] = new Uint8Array(await (await fetch(url)).arrayBuffer());
  }
  examples = groupByProject('/test-docs', { ...textFiles, ...binaryFiles });
  renderTemplateChoices();
}

// The "Start from" part of the New project dialog: the kinds of starting
// points on the left, the ones of the chosen kind as cards on the right.
// Choosing a kind chooses its first card, so what Create makes is always in view.
// A card's value: "blank", "starter:ieee" or "example:hello".
let starterGroup: StarterGroup = 'blank';
let chosenTemplate = 'blank';

function chosenKit(): Kit | undefined {
  return STARTERS.find((s) => `starter:${s.id}` === chosenTemplate)?.kit;
}

function renderTemplateChoices(): void {
  starterGroups.replaceChildren(...GROUPS.map((group) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(group.id === starterGroup));
    tab.textContent = group.label;
    tab.addEventListener('click', () => {
      starterGroup = group.id;
      chosenTemplate = '';
      renderTemplateChoices();
    });
    return tab;
  }));
  const cards: [string, string, string][] = starterGroup === 'blank' ? [['blank', 'Blank', 'One main.tex to start from']]
    : starterGroup === 'examples' ? examples.map((e) => [`example:${e.name}`, e.name, EXAMPLE_NOTES[e.name] ?? 'An example'])
    : STARTERS.filter((s) => s.group === starterGroup).map((s) => [`starter:${s.id}`, s.name, s.note]);
  if (!cards.some(([value]) => value === chosenTemplate)) chosenTemplate = cards[0]?.[0] ?? 'blank';
  const choice = (value: string, name: string, note: string): HTMLLabelElement => {
    const label = document.createElement('label');
    label.className = 'choice';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'template';
    radio.value = value;
    radio.checked = value === chosenTemplate;
    radio.addEventListener('change', () => {
      chosenTemplate = value;
      showKitSteps();
    });
    const title = document.createElement('span');
    title.className = 'name';
    title.textContent = name;
    const detail = document.createElement('span');
    detail.className = 'note';
    detail.textContent = note;
    label.append(radio, title, detail);
    return label;
  };
  templateChoices.replaceChildren(...cards.map(([value, name, note]) => choice(value, name, note)));
  showKitSteps();
}

// For a conference: the two steps to get its official kit, and Create becomes "Choose the .zip…".
function showKitSteps(): void {
  const starter = STARTERS.find((s) => `starter:${s.id}` === chosenTemplate);
  const kit = starter?.kit;
  kitSteps.hidden = !kit;
  createProjectButton.textContent = kit ? 'Choose the .zip…' : 'Create project';
  if (!starter || !kit) return;
  kitLink.href = kit.page;
  kitLink.textContent = `open the ${starter.name} page`;
  kitFind.textContent = `choose ${kit.find}`;
  kitNote.hidden = !kit.note;
  kitNote.textContent = kit.note ?? '';
}

// After sign-in: reopens the last project, or shows the project page.
async function showDriveProjects(): Promise<void> {
  if (!rootId) return;
  driveFolders = await listProjects(googleDrive, rootId);
  let last: string | null = null;
  try { last = localStorage.getItem(LAST_PROJECT_KEY); } catch { /* storage blocked */ }
  if (driveFolders.some((f) => f.id === last) && last) await openProjectById(last);
  else {
    showProject(null);
    showProjectsPage(true);
  }
}

// The project page lists the Drive projects (newest first) while signed in,
// and the built-in examples while signed out.
function showProjectsPage(visible: boolean): void {
  projectsPage.hidden = !visible;
  mainArea.hidden = visible;
  document.body.classList.toggle('on-projects', visible);
  if (!visible) document.body.classList.remove('on-welcome');
  if (visible) {
    renderProjectsPage();
    if (rootId) refreshProjects().catch((error: unknown) => console.warn('Could not refresh the project list', error));
  }
}

function renderProjectsPage(): void {
  const signedIn = rootId !== null;
  backBar.hidden = !project;
  // Signed out, the page welcomes the user and offers the examples next to it.
  welcome.hidden = signedIn;
  projectsPage.classList.toggle('welcoming', !signedIn);
  document.body.classList.toggle('on-welcome', !signedIn);
  // The tie draws itself only the first time the welcome is shown.
  if (!signedIn && !welcomeShown) {
    welcomeShown = true;
    welcome.classList.add('first-visit');
    setTimeout(() => welcome.classList.remove('first-visit'), 1500);
  }
  signedInSection.hidden = !signedIn;
  exampleList.replaceChildren(...examples.map((example) => {
    const button = document.createElement('button');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = example.name;
    const note = document.createElement('span');
    note.className = 'note';
    note.textContent = EXAMPLE_NOTES[example.name] ?? '';
    button.append(name, note);
    button.addEventListener('click', () => void openProjectById(example.name));
    const item = document.createElement('li');
    item.append(button);
    return item;
  }));
  if (signedIn) renderProjectList();
}

// The signed-in list: filtered by the search box, sorted by last edit or name.
function renderProjectList(): void {
  const count = driveFolders.length;
  projectsWhere.textContent = count === 0
    ? `Kept in the folder "${rootName}" in your Google Drive.`
    : `${count} ${count === 1 ? 'project' : 'projects'} in the folder "${rootName}" in your Google Drive.`;
  projectsEmpty.hidden = count > 0;
  projectsTools.hidden = count === 0;

  const query = projectSearch.value.trim().toLowerCase();
  const rows = driveFolders
    .map((folder) => ({ id: folder.id, name: folder.name, edited: lastEdited(folder) }))
    .filter((row) => row.name.toLowerCase().includes(query))
    .sort(projectSort.value === 'name'
      ? (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })
      : (a, b) => (b.edited?.getTime() ?? 0) - (a.edited?.getTime() ?? 0));
  projectsNoMatch.hidden = count === 0 || rows.length > 0;
  projectsNoMatch.textContent = `No project matches "${projectSearch.value.trim()}".`;

  projectList.replaceChildren(...rows.map((row) => {
    const open = document.createElement('button');
    open.className = 'project-open';
    const name = document.createElement('span');
    name.className = 'project-name';
    name.textContent = row.name;
    if (project?.driveId === row.id) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'Current';
      name.append(badge);
    }
    const edited = document.createElement('span');
    edited.className = 'project-edited';
    edited.textContent = row.edited ? `Edited ${timeAgo(row.edited)}` : '';
    edited.title = row.edited?.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' }) ?? '';
    open.append(name, edited);
    open.addEventListener('click', () => void (project?.driveId === row.id ? showProjectsPage(false) : openProjectById(row.id)));

    const more = document.createElement('button');
    more.className = 'project-more';
    more.textContent = '⋯';
    more.title = `Actions for ${row.name}`;
    more.setAttribute('aria-haspopup', 'menu');
    more.addEventListener('click', () => openMenu(more, [
      { label: 'Open', action: () => void openProjectById(row.id) },
      { label: 'Download as .zip', action: () => void downloadProjectZip(row.id) },
      { label: 'Rename…', action: () => void renameProject(row.id, row.name) },
      { label: 'Delete…', action: () => void deleteProject(row.id, row.name), danger: true },
    ]));

    const item = document.createElement('li');
    item.append(open, more);
    return item;
  }));
}

// Opens a project from the project page. Examples are already in memory;
// Drive projects are downloaded first.
async function openProjectById(id: string): Promise<void> {
  if (!rootId) {
    showProject(examples.find((p) => p.name === id) ?? null);
    showProjectsPage(false);
    return;
  }
  const folder = driveFolders.find((f) => f.id === id);
  if (!folder) return;
  showBusy(`Opening ${folder.name}…`);
  try {
    // Save the project we leave. Whatever cannot be saved now stays in the
    // browser and is saved the next time that project is opened.
    await sync?.saveNow();
    showProject(await openProject(googleDrive, folder));
    showProjectsPage(false);
    hideBusy();
  } catch (error) {
    showError(error);
  }
}

// What is wrong with a name for a new project, or null if it can be used.
function projectNameProblem(name: string): string | null {
  if (!name) return 'Type a name for the project.';
  if (name.includes('/')) return 'A project name cannot contain "/".';
  if (driveFolders.some((f) => f.name === name)) return `You already have a project called "${name}".`;
  return null;
}

// Asks for a project name until it is usable. Returns null if the user cancels.
async function askProjectName(question: string, suggestion: string, unchanged?: string): Promise<string | null> {
  let message = question;
  let answer = suggestion;
  for (;;) {
    const typed = await askText(message, answer);
    if (typed === null) return null;
    answer = typed.trim();
    if (answer === unchanged) return null;
    const problem = projectNameProblem(answer);
    if (!problem) return answer;
    message = `${problem}\n\n${question}`;
  }
}

// Reads the projects folder's name and its projects again: the folder may
// have been renamed in Drive, or projects added on another computer.
async function refreshProjects(): Promise<void> {
  const id = rootId;
  if (id) {
    const [folder, projects] = await Promise.all([googleDrive.get(id), listProjects(googleDrive, id)]);
    if (rootId !== id) return; // signed out or switched folder meanwhile
    rootName = folder.name;
    driveFolders = projects;
  }
  if (!projectsPage.hidden) renderProjectsPage();
}

async function renameProject(id: string, name: string): Promise<void> {
  const newName = await askProjectName(`New name for "${name}":`, name, name);
  if (!newName) return;
  try {
    await googleDrive.updateMetadata(id, { name: newName });
    if (project?.driveId === id) {
      project.name = newName;
      projectNameLabel.textContent = newName;
    }
    await refreshProjects();
    notify(`Renamed "${name}" to "${newName}".`);
  } catch (error) {
    showError(error);
  }
}

async function deleteProject(id: string, name: string): Promise<void> {
  if (!await askConfirm(`Delete the project "${name}"? Its folder goes to the trash in your Google Drive, where you can restore it for 30 days.`, 'Delete')) return;
  try {
    await googleDrive.updateMetadata(id, { trashed: true });
    if (project?.driveId === id) showProject(null);
    for (const draft of await browserDrafts.list()) {
      if (draft.projectId === id) await browserDrafts.remove(draft);
    }
    await refreshProjects();
    notify(`Deleted "${name}". You can restore it from the trash in Google Drive for 30 days.`);
  } catch (error) {
    showError(error);
  }
}

// Creates a project in Drive from files, shows upload progress, and opens it.
async function createAndOpen(name: string, files: ProjectFile[], mainFile?: string): Promise<void> {
  if (!rootId) return;
  showBusy(`Creating ${name}…`);
  try {
    await sync?.saveNow();
    const created = await createProject(googleDrive, rootId, name, files, (done, total) => {
      showBusy(`Creating ${name}… ${done} of ${total} files`);
    });
    if (mainFile && mainFile !== findMainFile(created)) await saveMainFile(googleDrive, created, mainFile);
    await refreshProjects();
    showProject(created);
    showProjectsPage(false);
    hideBusy();
    notify(`Created ${name}.`);
  } catch (error) {
    showError(error);
  }
}

// Lets the user pick files in their Drive. Google Docs and the like are left
// out (with a message), since they have no file content Tilde can use.
// Brave blocks the cross-site cookies Google's Picker needs; Google then opens
// the Picker in its own tab, from which the choice never reaches Tilde. Before
// the first Picker in Brave, say so and how to fix it. Resolves false to cancel.
async function readyForPicker(): Promise<boolean> {
  if (!('brave' in navigator) || braveHintShown) return true;
  braveHintShown = true;
  return askConfirm('Brave blocks the cookies Google\'s file picker needs. Then the picker opens in a new tab, '
    + 'and what you choose there does not reach Tilde.\n\nTo fix it: click the lion icon at the right of the address bar, '
    + 'allow cross-site cookies for this site, and reload Tilde.', 'Open the picker anyway');
}

async function pickUsableFiles(title: string, inFolder?: string): Promise<PickedFile[]> {
  if (!await readyForPicker()) return [];
  const picked = await pickDriveFiles(title, inFolder);
  const skipped = picked.filter(isGoogleDoc);
  if (skipped.length > 0) {
    notify(`Left out, because Google Docs and Sheets have no file Tilde can use: ${skipped.map((f) => f.name).join(', ')}`, 'info');
  }
  return picked.filter((f) => !isGoogleDoc(f));
}

const toContent = (path: string, bytes: Uint8Array): string | Uint8Array =>
  isTextFile(path) ? new TextDecoder().decode(bytes) : bytes;

// "Import from Drive" on the project page: copies picked files into a new
// project. The originals stay where they are. Files with the same name are
// only imported once, since the picked files end up in one folder.
async function importFromDrive(): Promise<void> {
  try {
    const picked = await pickUsableFiles('Pick the files of your LaTeX project');
    if (picked.length === 0) return;
    const name = await askProjectName(`Name for the new project (${picked.length} files):`, '');
    if (!name) return;
    const files: ProjectFile[] = [];
    for (const [index, file] of picked.entries()) {
      if (files.some((f) => f.path === file.name)) continue;
      showBusy(`Reading ${file.name}… ${index + 1} of ${picked.length}`);
      files.push({ path: file.name, content: toContent(file.name, await googleDrive.download(file.id)) });
    }
    await createAndOpen(name, files);
  } catch (error) {
    showError(error);
  }
}

// Saves a whole project as a .zip on the computer. The open project comes
// from memory (so edits not yet in Drive are included); others are read from Drive.
async function downloadProjectZip(id?: string): Promise<void> {
  try {
    let target = project;
    if (id && project?.driveId !== id) {
      const folder = driveFolders.find((f) => f.id === id);
      if (!folder) return;
      showBusy(`Reading ${folder.name}…`);
      target = await openProject(googleDrive, folder);
      hideBusy();
    }
    if (!target) return;
    downloadFile(`${target.name}.zip`, zipProject(target.name, target.files));
    notify(`Saved ${target.name}.zip to your downloads.`);
  } catch (error) {
    showError(error);
  }
}

// Renames the projects folder. Tilde created it, so this works without the
// Picker, in every browser.
async function renameProjectsFolder(): Promise<void> {
  const id = rootId;
  if (!id) return;
  let message = 'New name for your projects folder:';
  let name = rootName;
  for (;;) {
    const typed = await askText(message, name);
    if (typed === null) return;
    name = typed.trim();
    if (name === rootName) return;
    if (name && !name.includes('/')) break;
    message = 'Type a folder name without "/".\n\nNew name for your projects folder:';
  }
  try {
    await googleDrive.updateMetadata(id, { name });
    const old = rootName;
    rootName = name;
    renderProjectsPage();
    notify(`Renamed "${old}" to "${name}". To move it, drag it anywhere in your Google Drive; Tilde will still find it.`);
  } catch (error) {
    showError(error);
  }
}

// "Choose another folder…": the user picks a folder in Drive, and every
// project moves into it. The old folder stays, empty, where it was.
async function chooseProjectsFolder(): Promise<void> {
  const fromId = rootId;
  if (!fromId) return;
  try {
    if (!await readyForPicker()) return;
    const picked = await pickDriveFolder('Choose the folder for your LaTeX projects');
    if (!picked || picked.id === fromId) return;
    if (driveFolders.some((f) => f.id === picked.id)) {
      notify(`"${picked.name}" is one of your projects. Choose a folder that is not a project.`, 'error');
      return;
    }
    const count = driveFolders.length;
    const question = count === 0
      ? `Keep new projects in "${picked.name}"?`
      : `Move your ${count} ${count === 1 ? 'project' : 'projects'} from "${rootName}" into "${picked.name}"? `
        + 'The folders move in Drive with all their files and history; nothing is copied or deleted.';
    if (!await askConfirm(question, count === 0 ? 'Use this folder' : 'Move projects')) return;
    await sync?.saveNow();
    showBusy(`Moving projects to ${picked.name}…`);
    const moved = await moveProjectsFolder(googleDrive, fromId, { id: picked.id, name: picked.name, mimeType: picked.mimeType });
    rootId = picked.id;
    rootName = picked.name;
    await refreshProjects();
    hideBusy();
    notify(moved > 0 ? `Moved ${moved} ${moved === 1 ? 'project' : 'projects'} to "${picked.name}".` : `New projects will go into "${picked.name}".`);
  } catch (error) {
    showError(error);
  }
}

async function importZip(file: File): Promise<void> {
  let files: ProjectFile[];
  try {
    files = unzipProject(new Uint8Array(await file.arrayBuffer()));
  } catch {
    showError(new Error(`${file.name} is not a .zip file Tilde can read.`));
    return;
  }
  if (files.length === 0) {
    showError(new Error(`${file.name} has no files to import.`));
    return;
  }
  const name = await askProjectName(`Name for the imported project (${files.length} files):`, file.name.replace(/\.zip$/i, ''));
  if (name) await createAndOpen(name, files);
}

function showProject(newProject: Project | null): void {
  sync?.close();
  sync = newProject?.driveId
    ? new ProjectSync(googleDrive, browserDrafts, accountId, newProject, {
      stateChanged: showSyncState,
      fileReplaced: (path, content) => editor.replace(path, content),
      filesChanged: showDriveChanges,
    })
    : null;
  project = newProject;
  collapsedFolders = new Set();
  projectNameLabel.textContent = newProject?.name ?? 'Tilde';
  editor.clear();
  activePath = null;
  pdfViewer.clear();
  syncTex = null;
  buildFiles = [];
  buildKey = '';
  showEmptyPdf('Compile to see the PDF here. Ctrl/Cmd+S saves and compiles.');
  cursorPosition.textContent = '';
  showProblems([]);
  showSyncState();
  renderTree();
  if (!project) return;
  if (project.driveId) {
    try { localStorage.setItem(LAST_PROJECT_KEY, project.driveId); } catch { /* storage blocked */ }
  }
  setStatus('');
  const main = findMainFile(project);
  if (main) openFile(main);
  void sync?.restoreDrafts(); // edits from last time that never reached Drive
  preloadEngine();
}

// Files added, renamed or deleted on another computer: the editor and the
// file tree follow them.
function showDriveChanges({ moved, removed, kept }: DriveChanges): void {
  for (const [from, to] of moved) editor.rename(from, to);
  for (const path of removed) editor.forget(path);
  for (const path of kept) {
    notify(`${path} was deleted in Google Drive, but you had edited it here. Your version is kept and saved again.`);
  }
  const renamed = moved.find(([from]) => from === activePath)?.[1];
  if (activePath && removed.includes(activePath)) {
    activePath = null;
    const next = project && (findMainFile(project) ?? project.files[0]?.path);
    if (next) openFile(next);
    else editor.clear();
  } else if (renamed) {
    openFile(renamed);
  }
  renderTree();
  scheduleOutline();
}

const SYNC_TEXT: Record<SyncState, string> = {
  saved: 'Saved',
  unsaved: 'Unsaved changes',
  saving: 'Saving…',
  offline: 'Offline, changes kept locally',
  signin: 'Sign in again to keep saving',
  error: 'Not saved yet, will try again',
  conflict: 'Conflict',
};

// Shows the sync status next to the buttons. In a conflict it becomes a
// button that opens the conflict dialog.
function showSyncState(): void {
  syncButton.hidden = !sync;
  if (!sync) return;
  syncButton.textContent = SYNC_TEXT[sync.state];
  syncButton.className = sync.state;
  syncButton.title = sync.state === 'error' ? sync.errorMessage : '';
  syncButton.disabled = sync.state !== 'conflict';
  if (sync.state === 'signin') showAccount('expired');
  // Open the dialog by itself once for each new conflict.
  if (!sync.conflicts.has(conflictShown)) conflictShown = '';
  const first = sync.conflicts.values().next().value;
  if (first && first !== conflictShown && !conflictDialog.open) showConflict();
}

function showConflict(): void {
  const path = sync?.conflicts.values().next().value;
  if (!path) return;
  conflictShown = path;
  conflictPath.textContent = path;
  conflictDialog.returnValue = '';
  conflictDialog.showModal();
}

// "Download both": saves this computer's and Drive's version of the file to
// the Downloads folder, as for example "main (mine).tex" and "main (Drive).tex".
// The dialog stays open, so the user still chooses which one Tilde keeps.
async function downloadBoth(): Promise<void> {
  const file = project?.files.find((f) => f.path === conflictShown);
  if (!file || !sync) return;
  const name = conflictShown.split('/').pop() ?? conflictShown;
  const dot = name.lastIndexOf('.');
  const [base, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  try {
    downloadFile(`${base} (mine)${extension}`, file.content);
    downloadFile(`${base} (Drive)${extension}`, await sync.driveVersion(conflictShown));
  } catch (error) {
    showError(error);
  }
}

function downloadFile(name: string, content: string | Uint8Array): void {
  const url = URL.createObjectURL(new Blob([typeof content === 'string' ? content : content.slice()]));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function handleSignIn(): Promise<void> {
  try {
    await signIn();
  } catch (error) {
    showError(error);
    return;
  }
  if (rootId) {
    // The sign-in had run out while working: carry on where we were, but
    // only with the same Google account.
    try {
      if (await googleDrive.whoAmI() !== accountId) {
        forgetToken();
        notify('That is a different Google account. Sign in with the one you used before, or sign out first.', 'error');
        return;
      }
    } catch (error) {
      showError(error);
      return;
    }
    showAccount('signed-in');
    notify('Signed in again. Saving continues.');
    void sync?.saveNow();
    return;
  }
  await startDrive();
}

// After sign-in, or after a reload while still signed in: show the user's projects.
async function startDrive(): Promise<void> {
  showBusy('Loading your projects…');
  try {
    accountId = await googleDrive.whoAmI();
    // Unsaved edits left in this browser by another Google account are deleted.
    await forgetOtherAccounts(browserDrafts, accountId)
      .catch((error: unknown) => console.warn('Could not clean up the copies kept in the browser', error));
    const folder = await projectsFolder(googleDrive);
    rootId = folder.id;
    rootName = folder.name;
    showAccount('signed-in');
    await showDriveProjects();
    hideBusy();
  } catch (error) {
    showError(error);
  }
}

// Signing out deletes everything Tilde keeps in this browser for the user.
// Edits that could not be saved to Drive are listed first, with the choice
// to download them.
async function handleSignOut(): Promise<void> {
  await sync?.saveNow();
  try {
    unsavedAtSignOut = await browserDrafts.list();
  } catch {
    unsavedAtSignOut = [];
  }
  if (unsavedAtSignOut.length === 0) {
    await finishSignOut();
    return;
  }
  signOutFiles.replaceChildren(...unsavedAtSignOut.map((draft) => {
    const item = document.createElement('li');
    item.textContent = `${draft.projectName}/${draft.path}`;
    return item;
  }));
  signOutDialog.returnValue = '';
  signOutDialog.showModal(); // continues in the dialog's "close" handler
}

async function finishSignOut(): Promise<void> {
  rootId = null;
  accountId = '';
  driveFolders = [];
  showAccount('signed-out');
  showProject(null); // also stops saving the Drive project
  showProjectsPage(true);
  signOut();
  try {
    await browserDrafts.clear();
    localStorage.removeItem(LAST_PROJECT_KEY);
  } catch (error) {
    console.warn('Could not clean up the copies kept in the browser', error);
  }
  notify('Signed out. Nothing of yours is kept in this browser.');
}

// Runs when the "New project" dialog closes with the Create button.
async function createFromDialog(): Promise<void> {
  if (!rootId) return;
  const name = newProjectName.value.trim();
  const [kind, id] = chosenTemplate.split(':');
  const template = kind === 'starter' ? starterProjects.find((p) => p.name === id)
    : kind === 'example' ? examples.find((p) => p.name === id) : undefined;
  await createAndOpen(name, template?.files ?? BLANK_PROJECT);
}

// "Choose the .zip…": makes the project from a conference's official kit.
async function createFromKit(file: File): Promise<void> {
  const starter = STARTERS.find((s) => `starter:${s.id}` === chosenTemplate);
  const kit = starter?.kit;
  if (!starter || !kit) return;
  let files: ProjectFile[];
  try {
    files = unzipProject(new Uint8Array(await file.arrayBuffer()));
  } catch {
    showError(new Error(`${file.name} is not a .zip file Tilde can read.`));
    return;
  }
  if (!files.some((f) => kit.styleFile.test(f.path))
    && !await askConfirm(`${file.name} does not look like the ${starter.name} author kit: it has no ${starter.name} style file. Make the project anyway?`, 'Make it anyway')) return;
  const name = newProjectName.value.trim();
  newProjectDialog.close();
  await createAndOpen(name, files, kitMainFile(kit, files.map((f) => f.path)));
}

function openFile(path: string): void {
  const file = project?.files.find((f) => f.path === path);
  if (!file) return;
  activePath = path;
  document.title = `${path.split('/').pop()} · Tilde`;

  if (isTextFile(path) && typeof file.content === 'string') {
    imagePreview.hidden = true;
    editorElement.hidden = false;
    editor.open(path, file.content);
  } else {
    editorElement.hidden = true;
    imagePreview.hidden = false;
    cursorPosition.textContent = '';
    if (imagePreview.src) URL.revokeObjectURL(imagePreview.src);
    const bytes = typeof file.content === 'string' ? new TextEncoder().encode(file.content) : file.content;
    imagePreview.src = URL.createObjectURL(new Blob([bytes.slice()]));
    imagePreview.alt = `No preview for ${path}`;
  }
  renderTree();
}

// Small icons that tell file kinds apart in the tree.
const ICONS: Record<string, string> = {
  folder: 'M1.5 4.5v8a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H8L6.5 3.5h-4a1 1 0 0 0-1 1z',
  tex: 'M4 1.5h5.5l3 3v9a1 1 0 0 1-1 1h-7.5a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z M5.5 8h5 M5.5 10.5h5 M5.5 5.5h2',
  bib: 'M3.5 2.5h8a1 1 0 0 1 1 1v10h-8.5a.5.5 0 0 1-.5-.5z M3.5 12a1 1 0 0 1 1-1h8 M6 5.5h4',
  image: 'M2 3.5h12v9H2z M2 11l3.5-3.5 3 3 2-2 3.5 3.5 M10.5 6.5h.01',
  file: 'M4 1.5h5.5l3 3v9a1 1 0 0 1-1 1h-7.5a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z',
};

function icon(kind: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('class', `file-icon ${kind}`);
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICONS[kind] ?? ICONS.file);
  svg.append(path);
  return svg;
}

const iconFor = (path: string): string =>
  path.endsWith('.tex') ? 'tex' : path.endsWith('.bib') ? 'bib' : /\.(png|jpe?g|gif|svg|eps|pdf)$/i.test(path) ? 'image' : 'file';

let collapsedFolders = new Set<string>(); // folders folded in the tree, for the open project

function renderTree(): void {
  const toList = (nodes: TreeNode[]): HTMLUListElement => {
    const list = document.createElement('ul');
    for (const node of nodes) {
      const item = document.createElement('li');
      if (node.children) {
        // A folder: click to fold or unfold it; its ⋯ menu adds files into it.
        const collapsed = collapsedFolders.has(node.path);
        const row = document.createElement('div');
        row.className = 'row folder-row';
        row.dataset.folder = node.path;
        const toggle = document.createElement('button');
        toggle.className = 'open-file';
        toggle.setAttribute('aria-expanded', String(!collapsed));
        const chevron = document.createElement('span');
        chevron.className = 'chevron';
        chevron.setAttribute('aria-hidden', 'true');
        toggle.append(chevron, icon('folder'), node.name);
        toggle.addEventListener('click', () => {
          if (collapsed) collapsedFolders.delete(node.path);
          else collapsedFolders.add(node.path);
          renderTree();
        });
        row.append(toggle);
        if (sync) row.append(moreButton(node.name, () => showFolderMenu(row, node.path)));
        item.append(row);
        if (!collapsed) item.append(toList(node.children));
      } else {
        const row = document.createElement('div');
        row.className = 'row';
        row.classList.toggle('active', node.path === activePath);
        const open = document.createElement('button');
        open.className = 'open-file';
        open.append(icon(iconFor(node.path)), node.name);
        if (project && node.path === findMainFile(project)) {
          const label = document.createElement('span');
          label.className = 'main-file';
          label.textContent = ' (main)';
          open.append(label);
        }
        open.addEventListener('click', () => {
          openFile(node.path);
          reveal('editor');
        });
        row.append(open);
        if (sync) {
          const more = moreButton(node.name, () => showFileMenu(more, node.path));
          row.append(more);
        }
        item.append(row);
      }
      list.append(item);
    }
    return list;
  };
  treeView.replaceChildren(toList(buildTree(project?.files.map((f) => f.path) ?? [])));

  // Adding files is for Drive projects; the examples stay as they are.
  addFilesButton.hidden = !sync;
  projectActionsButton.hidden = !project;
  renderOutline();
}

// The outline: the document's headings, following \input and \include from
// the main file. It is rebuilt shortly after typing stops.
let outlineTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleOutline(): void {
  clearTimeout(outlineTimer);
  outlineTimer = setTimeout(renderOutline, 500);
}

function renderOutline(): void {
  const main = project ? findMainFile(project) : undefined;
  const entries = project && main ? outline(project.files, main) : [];
  outlinePanel.hidden = entries.length === 0;
  outlineView.replaceChildren(...entries.map((entry) => {
    const button = document.createElement('button');
    button.className = `level-${entry.level}`;
    button.textContent = entry.title || '(no title)';
    button.title = `${entry.title} · ${entry.file}:${entry.line}`;
    button.addEventListener('click', () => {
      openFile(entry.file);
      reveal('editor');
      editor.goTo(entry.line);
    });
    return button;
  }));
}

// The "⋯" button on a row of the tree.
function moreButton(name: string, onClick: () => void): HTMLButtonElement {
  const more = document.createElement('button');
  more.className = 'file-menu';
  more.textContent = '⋯';
  more.title = `Actions for ${name}`;
  more.setAttribute('aria-haspopup', 'menu');
  more.addEventListener('click', onClick);
  return more;
}

// The "⋯" menu of a folder in the tree.
function showFolderMenu(anchor: HTMLElement, dir: string): void {
  openMenu(anchor.querySelector('.file-menu') ?? anchor, [
    { label: 'New file here…', action: () => void newFile(dir) },
    { label: 'Upload here…', action: () => chooseUploads(dir) },
    { label: 'Add from Google Drive here…', action: () => void addFromDrive(dir) },
    { label: 'Rename folder…', action: () => void renameFolderAction(dir) },
  ]);
}

async function renameFolderAction(dir: string): Promise<void> {
  const projectSync = sync;
  if (!projectSync) return;
  const parts = dir.split('/');
  const oldName = parts.pop() ?? dir;
  const question = `New name for the folder ${dir}:`;
  let message = question;
  let name = oldName;
  for (;;) {
    const typed = await askText(message, name);
    if (typed === null) return;
    name = typed.trim();
    if (name === oldName) return;
    const problem = !name || name.includes('/') ? 'Type a folder name without "/".' : pathProblem(projectSync.project, [...parts, name].join('/'));
    if (!problem) break;
    message = `${problem}\n\n${question}`;
  }
  let moved: [string, string][] = [];
  const done = await runFileAction(`Renaming ${dir}`, `Renamed ${dir} to ${[...parts, name].join('/')}.`, async () => {
    moved = await projectSync.renameFolder(dir, name);
  });
  if (!done) return;
  for (const [from, to] of moved) editor.rename(from, to);
  const opened = moved.find(([from]) => from === activePath);
  if (opened) openFile(opened[1]);
  else renderTree();
}

// The "⋯" menu of a file in the tree.
function showFileMenu(anchor: HTMLElement, path: string): void {
  const isMain = project ? path === findMainFile(project) : false;
  const file = project?.files.find((f) => f.path === path);
  const safeCopy = file?.safeCopy && file.safeCopy.revision !== file.revision ? file.safeCopy : undefined;
  openMenu(anchor, [
    { label: 'Rename or move…', action: () => void renameFile(path) },
    { label: 'Duplicate…', action: () => void duplicateFile(path) },
    ...(safeCopy ? [{ label: `Go back to the version from ${versionTime(new Date(safeCopy.time))}…`, action: () => void goBack(path) }] : []),
    { label: isMain ? 'This is the main file' : 'Set as main file', action: () => void setMainFile(path), disabled: isMain || !path.endsWith('.tex') },
    { label: 'Delete…', action: () => void deleteFile(path), danger: true },
  ]);
}

// "Go back to the version from 10:42": shows what changed since that version
// (the safe copy Drive keeps), and puts it back if the user says so. The
// current text is not lost: Ctrl/Cmd+Z brings it back, and Drive keeps it
// as an old version.
async function goBack(path: string): Promise<void> {
  const projectSync = sync;
  const file = projectSync?.project.files.find((f) => f.path === path);
  if (!projectSync || !file?.safeCopy || typeof file.content !== 'string') return;
  const when = versionTime(new Date(file.safeCopy.time));
  let before: string;
  showBusy(`Loading the version from ${when}…`);
  try {
    before = await projectSync.safeCopyText(path);
  } catch (error) {
    showError(error);
    return;
  } finally {
    hideBusy();
  }
  const now = file.content;
  if (before === now) {
    notify(`${path} is the same as the version from ${when}.`);
    return;
  }
  element<HTMLElement>('#restore-title').textContent = `Go back to the version from ${when}?`;
  element<HTMLElement>('#restore-note').textContent = `${path} as it was at ${when} on the left, as it is now on the right. `
    + 'Only the changed parts are shown. After restoring, Ctrl/Cmd+Z brings the current text back.';
  element<HTMLElement>('#restore-before').textContent = when;
  const dialog = element<HTMLDialogElement>('#restore-dialog');
  const hide = showChanges(element<HTMLElement>('#restore-changes'), before, now);
  dialog.returnValue = '';
  dialog.addEventListener('close', () => {
    hide();
    if (dialog.returnValue !== 'restore') return;
    openFile(path);
    editor.setText(before); // saved to Drive like any edit
    notify(`${path} is back to the version from ${when}. Ctrl/Cmd+Z undoes this.`);
  }, { once: true });
  dialog.showModal();
}

// "Add a font from this computer…" (Chrome and Edge): copies a family's
// regular, bold and italic files into fonts/, and copies the line that loads
// them to the clipboard.
const fontDialog = element<HTMLDialogElement>('#font-dialog');
const fontSearch = element<HTMLInputElement>('#font-search');
const fontList = element<HTMLUListElement>('#font-list');

async function addLocalFont(): Promise<void> {
  const projectSync = sync;
  if (!projectSync || !window.queryLocalFonts) return;
  const refused = new Error('This browser did not let Tilde read the fonts on this computer. Upload the font file instead: + → Upload from this computer.');
  let fonts: LocalFont[];
  try {
    fonts = await window.queryLocalFonts();
  } catch {
    showError(refused);
    return;
  }
  if (fonts.length === 0) {
    showError(refused);
    return;
  }
  const families = fontFamilies(fonts);
  const show = (): void => {
    const wanted = fontSearch.value.trim().toLowerCase();
    fontList.replaceChildren(...families.filter(([family]) => family.toLowerCase().includes(wanted)).slice(0, 300).map(([family, faces]) => {
      const button = document.createElement('button');
      button.value = family;
      button.textContent = family;
      button.style.fontFamily = `"${family}", var(--ui)`;
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = faces.length === 1 ? '1 style' : `${faces.length} styles`;
      button.append(count);
      const item = document.createElement('li');
      item.append(button);
      return item;
    }));
  };
  fontSearch.value = '';
  fontSearch.oninput = show;
  show();
  fontDialog.returnValue = '';
  fontDialog.showModal();
  await new Promise((resolve) => fontDialog.addEventListener('close', resolve, { once: true }));
  const chosen = families.find(([family]) => family === fontDialog.returnValue);
  const faces = chosen && pickFaces(chosen[1]);
  if (!chosen || !faces) return;

  const names: Partial<Faces<string>> = {};
  for (const [role, face] of Object.entries(faces) as [keyof Faces<LocalFont>, LocalFont | undefined][]) {
    if (!face) continue;
    const bytes = new Uint8Array(await (await face.blob()).arrayBuffer());
    const format = fontFormat(bytes);
    if (format !== 'otf' && format !== 'ttf') {
      showError(new Error(`${chosen[0]} is stored as a font collection (.ttc), which Tilde cannot split. Find its .otf or .ttf files and upload those instead.`));
      return;
    }
    const name = `${face.postscriptName.replace(/[^A-Za-z0-9_-]+/g, '-')}.${format}`;
    if (!await runFileAction(`Adding fonts/${name}`, `Added fonts/${name}.`, () => projectSync.addFile(`fonts/${name}`, bytes))) return;
    names[role] = name;
  }
  if (!names.upright) return;
  const line = fontspecLine({ ...names, upright: names.upright });
  const copied = await navigator.clipboard.writeText(line).then(() => true, () => false);
  notify(`${chosen[0]} is in fonts/. To use it, put \\usepackage{fontspec} and this line in the preamble${copied ? ' (it is copied)' : ''}: ${line}`);
}

// The "+" menu above the file tree.
function showAddMenu(): void {
  openMenu(addFilesButton, [
    { label: 'New file…', action: () => void newFile() },
    { label: 'Upload from this computer…', action: () => chooseUploads() },
    { label: 'Add from Google Drive…', action: () => void addFromDrive() },
    { label: 'Add citation from DOI…', action: () => void citeFromMenu() },
    ...(window.queryLocalFonts ? [{ label: 'Add a font from this computer…', action: () => void addLocalFont() }] : []),
  ]);
}

// The folder of a path: "chapters/intro.tex" → "chapters", "main.tex" → "".
const folderOf = (path: string | null): string => path?.split('/').slice(0, -1).join('/') ?? '';

// Asks for a file path until it is usable. Returns null if the user cancels
// or keeps the path unchanged.
async function askForPath(question: string, suggestion: string, unchanged?: string): Promise<string | null> {
  let message = question;
  let answer = suggestion;
  for (;;) {
    const typed = await askText(message, answer);
    if (typed === null) return null;
    answer = typed.trim();
    if (answer === unchanged) return null;
    const problem = project ? pathProblem(project, answer) : null;
    if (!problem) return answer;
    message = `${problem}\n\n${question}`;
  }
}

// Runs a file action with a status message. Returns false if it failed.
// Runs a file action: "Deleting refs.bib…" in the status bar while it runs,
// then a notice such as "Deleted refs.bib.". Returns false if it failed.
async function runFileAction(working: string, done: string, action: () => Promise<void>): Promise<boolean> {
  setStatus(`${working}…`);
  try {
    await action();
    setStatus('');
    notify(done);
    return true;
  } catch (error) {
    setStatus('');
    showError(error);
    return false;
  } finally {
    renderTree();
  }
}

async function newFile(folder = folderOf(activePath)): Promise<void> {
  const projectSync = sync;
  if (!projectSync) return;
  const path = await askForPath('Name of the new file, e.g. method.tex or chapters/method.tex:', folder ? `${folder}/` : '');
  if (path && await runFileAction(`Creating ${path}`, `Created ${path}.`, () => projectSync.addFile(path, ''))) openFile(path);
}

// Files to add to the open project, from the computer or from Drive.
interface IncomingFile {
  name: string;
  read: () => Promise<Uint8Array>;
}

// Opens the computer's file chooser; the chosen files go into `folder`
// (asked for afterwards when it is not given).
let uploadTarget: string | undefined;
function chooseUploads(folder?: string): void {
  uploadTarget = folder;
  uploadInput.value = '';
  uploadInput.click();
}

async function uploadFiles(files: File[], folder?: string): Promise<void> {
  await addFiles(files.map((file) => ({ name: file.name, read: async () => new Uint8Array(await file.arrayBuffer()) })), folder);
}

// "Add from Google Drive" in the "+" menu: copies picked files into the open project.
// The Picker opens in the project's own folder in Drive. Files picked there
// that Tilde could not see yet (uploaded on the Drive website, say) join the
// project where they are; picking them is what lets Tilde see them. Files
// picked anywhere else are copied in.
async function addFromDrive(folder?: string): Promise<void> {
  const projectSync = sync;
  if (!projectSync) return;
  try {
    let picked = await pickUsableFiles('Pick files to add to this project', projectSync.project.driveId);
    if (picked.length === 0) return;
    const before = new Set(projectSync.project.files.map((f) => f.driveId));
    await projectSync.checkDrive();
    const inProject = new Set(projectSync.project.files.map((f) => f.driveId));
    const joined = picked.filter((f) => inProject.has(f.id) && !before.has(f.id));
    if (joined.length > 0) notify(`Added ${joined.map((f) => f.name).join(', ')} from this project's folder in Drive.`);
    picked = picked.filter((f) => !inProject.has(f.id));
    await addFiles(picked.map((file) => ({ name: file.name, read: () => googleDrive.download(file.id) })), folder);
  } catch (error) {
    showError(error);
  }
}

async function addFiles(files: IncomingFile[], into?: string): Promise<void> {
  const projectSync = sync;
  if (!projectSync || files.length === 0) return;
  const answer = into ?? await askText('Add the files to which folder? Leave empty for the top level.', folderOf(activePath));
  if (answer === null) return;
  const folder = answer.trim().replace(/^\/+|\/+$/g, '');
  for (const upload of files) {
    const path = folder ? `${folder}/${upload.name}` : upload.name;
    const exists = projectSync.project.files.some((f) => f.path === path);
    const problem = pathProblem(projectSync.project, path);
    if (problem && !exists) {
      showError(new Error(problem));
      return;
    }
    if (exists && !await askConfirm(`${path} already exists. Replace it? Drive keeps the old version in its version history.`, 'Replace')) continue;
    let content: string | Uint8Array;
    try {
      content = toContent(path, await upload.read());
    } catch (error) {
      showError(error);
      return;
    }
    if (!await runFileAction(`Adding ${path}`, `Added ${path}.`, () => projectSync.addFile(path, content))) return;
  }
}

async function renameFile(from: string): Promise<void> {
  const projectSync = sync;
  if (!projectSync) return;
  const to = await askForPath(`New name for ${from}. Change the folder part to move it, e.g. chapters/${from.split('/').pop()}:`, from, from);
  if (!to) return;
  if (await runFileAction(`Renaming ${from}`, `Renamed ${from} to ${to}.`, () => projectSync.moveFile(from, to))) {
    editor.rename(from, to);
    if (activePath === from) openFile(to);
  }
}

async function duplicateFile(original: string): Promise<void> {
  const projectSync = sync;
  const file = projectSync?.project.files.find((f) => f.path === original);
  if (!projectSync || !file) return;
  // "chapters/intro.tex" → "chapters/intro-copy.tex" (no spaces: LaTeX dislikes them in file names)
  const suggestion = file.path.replace(/(\.[^./]+)?$/, (extension) => `-copy${extension}`);
  const path = await askForPath(`Name for the copy of ${file.path}:`, suggestion);
  const content = typeof file.content === 'string' ? file.content : file.content.slice();
  if (path && await runFileAction(`Duplicating ${file.path}`, `Made ${path}, a copy of ${file.path}.`, () => projectSync.addFile(path, content))) openFile(path);
}

async function deleteFile(path: string): Promise<void> {
  const projectSync = sync;
  if (!projectSync) return;
  if (!await askConfirm(`Delete ${path}? It goes to the trash in your Google Drive, where you can restore it for 30 days.`, 'Delete')) return;
  if (await runFileAction(`Deleting ${path}`, `Deleted ${path}. You can restore it from the trash in Google Drive for 30 days.`, () => projectSync.deleteFile(path))) {
    editor.forget(path);
    if (activePath !== path) return;
    activePath = null;
    const next = findMainFile(projectSync.project) ?? projectSync.project.files[0]?.path;
    if (next) openFile(next);
    else editor.clear();
  }
}

async function setMainFile(path: string): Promise<void> {
  const projectSync = sync;
  if (projectSync) await runFileAction(`Making ${path} the main file`, `Tilde now compiles ${path}.`, () => projectSync.setMainFile(path));
}

// A short text where the PDF goes, while there is none yet.
function showEmptyPdf(text: string): void {
  const empty = document.createElement('p');
  empty.className = 'empty';
  empty.textContent = text;
  pdfContainer.replaceChildren(empty);
}

// The engine (about 125 MB) is downloaded on the first compile and comes from
// the browser's cache after that; both report progress, shown where the PDF will appear.
function showEngineDownload(percent: number): void {
  let bar = pdfContainer.querySelector('progress');
  if (!bar && percent >= 100) return; // loaded from the browser's cache, nothing to show
  if (!bar) {
    const box = document.createElement('div');
    box.className = 'engine';
    const title = document.createElement('p');
    title.textContent = 'Loading the TeX engine. The first time this downloads about 125 MB; after that it comes from your browser\'s cache.';
    bar = document.createElement('progress');
    bar.max = 100;
    const detail = document.createElement('p');
    box.append(title, bar, detail);
    pdfContainer.replaceChildren(box);
  }
  bar.value = percent;
  const detail = bar.nextElementSibling;
  if (detail) detail.textContent = `${Math.round(percent)}%`;
  setStatus(`Loading the TeX engine… ${Math.round(percent)}%`);
}

// The engine is downloaded and started only once. That starts as soon as a
// project opens, so the first compile has less to wait for.
function getRunner(): Promise<BusyTexRunner> {
  runner ??= startRunner().catch((error: unknown) => {
    runner = null; // try again on the next compile
    throw error;
  });
  return runner;
}

// Loads the engine in the background. If it fails, the next compile tries
// again and shows the error.
function preloadEngine(): void {
  getRunner().then(() => {
    if (compiling) return; // the compile takes it from here
    if (pdfContainer.querySelector('.engine')) showEmptyPdf('The TeX engine is ready. Compile to see the PDF here. Ctrl/Cmd+S saves and compiles.');
    setStatus('');
  }).catch((error: unknown) => console.warn('Could not load the TeX engine yet', error));
}

async function startRunner(): Promise<BusyTexRunner> {
  const newRunner = new BusyTexRunner({
    busytexBasePath: `${import.meta.env.BASE_URL}core/busytex`,
    preloadDataPackages: [`${import.meta.env.BASE_URL}core/busytex/texlive-basic.js`],
    onDownloadProgress: ({ percent }) => showEngineDownload(percent),
  });
  setStatus('Starting the TeX engine…');
  await newRunner.initialize(true); // true = run the engine in a Web Worker
  try {
    // Package files downloaded on earlier visits, so they are not downloaded again.
    await newRunner.writeTexliveRemoteFiles(await cachedPackages(PACKAGE_SERVER));
  } catch (error) {
    console.warn('Could not load the cached TeX packages', error);
  }
  return newRunner;
}

// A full compile runs LaTeX as often as needed, with BibTeX or Biber, from
// scratch. A quick one (for auto-compile) runs LaTeX once, with the build
// files of the last compile; if its log asks for more, another compile
// follows by itself: a full one for a new citation, one more quick pass for
// moved references. `followUp` marks that second compile, so it never loops.
async function compile(kind: CompileKind = 'full', followUp = false): Promise<void> {
  if (compiling || !project) return;
  const mainPath = findMainFile(project);
  const main = project.files.find((f) => f.path === mainPath);
  if (!main || typeof main.content !== 'string') {
    notify('This project has no .tex file with \\documentclass to compile.', 'error');
    return;
  }

  compiling = true;
  compileButton.setAttribute('aria-busy', 'true');
  compileButton.textContent = 'Compiling…';
  preview.classList.add('compiling');
  try {
    const currentRunner = await getRunner();
    if (pdfContainer.querySelector('.engine')) showEmptyPdf('');
    // XeLaTeX for fontspec and Unicode fonts, pdfLaTeX for everything else.
    const engineName = texEngine(project.files, main.path);
    const engine = engineName === 'xelatex' ? new XeLatex(currentRunner)
      : engineName === 'lualatex' ? new LuaLatex(currentRunner) : new PdfLatex(currentRunner);
    const withEngine = { pdflatex: '', xelatex: ' with XeLaTeX', lualatex: ' with LuaLaTeX' }[engineName];
    const key = `${main.path}|${engineName}`;
    const quick = kind === 'quick' && buildFiles.length > 0 && buildKey === key;
    setStatus(`Compiling${withEngine}…`);
    const started = performance.now();
    const result = await engine.compile({
      input: main.content,
      mainTexPath: main.path,
      additionalFiles: [...project.files.filter((f) => f !== main), ...(quick ? buildFiles : [])],
      // Biber for biblatex, BibTeX for natbib and \bibliography.
      bibtex: !quick && bibliographyTool(project.files) === 'bibtex',
      biber: !quick && bibliographyTool(project.files) === 'biber',
      rerun: !quick, // run LaTeX again so references and citations resolve
      remoteEndpoint: PACKAGE_SERVER,
    });
    // Keep this compile's build files for the next quick one, if it made a
    // PDF; after an error they may be cut short, so the next compile is a full one.
    try {
      buildFiles = result.pdf ? keptBuildFiles(await currentRunner.readProjectFiles(ENGINE_PROJECT_DIR), new Set(project.files.map((f) => f.path))) : [];
      buildKey = key;
    } catch (error) {
      buildFiles = [];
      console.warn('Could not keep the build files', error);
    }
    const next = quick && result.pdf ? afterQuickCompile(lastLatexLog(result.logs)) : null;
    if ((next === 'full' || (next === 'quick' && !followUp)) && !compileAgain) {
      compileAgain = next;
      againIsFollowUp = true;
    }
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    logView.textContent = result.log;
    try {
      // Keep the package files this compile downloaded, for next time.
      await storeNewPackages(PACKAGE_SERVER, await currentRunner.readProjectFiles(REMOTE_DIR));
    } catch (error) {
      console.warn('Could not cache the downloaded TeX packages', error);
    }

    const problems = parseLog(lastLatexLog(result.logs), project.files);
    showProblems(problems);
    const warnings = problems.filter((p) => p.level === 'warning').length;
    if (result.success && result.pdf) {
      try {
        syncTex = result.synctex ? SyncTex.read(result.synctex) : null;
      } catch (error) {
        syncTex = null;
        console.warn('Could not read the SyncTeX file', error);
      }
      await pdfViewer.show(result.pdf);
      setStatus(`Compiled${withEngine} in ${seconds} s` + (warnings > 0 ? `, ${warnings} warning${warnings > 1 ? 's' : ''}` : ''));
    } else if (problems.some((p) => p.level === 'error')) {
      setStatus(`Compile stopped at an error after ${seconds} s`);
      if (!pdfContainer.querySelector('canvas')) showEmptyPdf('The PDF appears here once the error below is fixed.');
    } else {
      logView.hidden = false;
      setStatus(`Compile failed after ${seconds} s. The log has the details.`);
    }
  } catch (error) {
    setStatus('');
    showError(error);
  } finally {
    compiling = false;
    compileButton.removeAttribute('aria-busy');
    compileButton.textContent = 'Compile';
    preview.classList.remove('compiling');
    if (compileAgain) {
      const again = compileAgain;
      const isFollowUp = againIsFollowUp;
      compileAgain = null;
      againIsFollowUp = false;
      void compile(again, isFollowUp);
    }
  }
}

const PROBLEM_LABEL: Record<LogProblem['level'], string> = { error: 'Error', warning: 'Warning', badbox: 'Bad box' };
const PROBLEM_ORDER: Record<LogProblem['level'], number> = { error: 0, warning: 1, badbox: 2 };

// The list of errors and warnings under the PDF. Clicking one opens its file
// at its line; problems inside TeX's own files cannot be clicked.
function showProblems(problems: LogProblem[]): void {
  const sorted = [...problems].sort((a, b) => PROBLEM_ORDER[a.level] - PROBLEM_ORDER[b.level]);
  problemList.replaceChildren(...sorted.map((problem) => {
    const button = document.createElement('button');
    button.className = problem.level;
    const level = document.createElement('span');
    level.className = 'level';
    level.textContent = PROBLEM_LABEL[problem.level];
    const where = document.createElement('span');
    where.className = 'where';
    where.textContent = problem.file ? `${problem.file}${problem.line ? `:${problem.line}` : ''}` : '';
    const message = document.createElement('span');
    message.className = 'message';
    message.textContent = problem.message;
    button.append(level, where, message);
    if (problem.hint) {
      const hint = document.createElement('span');
      hint.className = 'hint';
      hint.textContent = problem.hint;
      button.append(hint);
    }
    button.disabled = !problem.file;
    button.addEventListener('click', () => jumpTo(problem));
    const item = document.createElement('li');
    item.append(button);
    return item;
  }));
  problemsPanel.hidden = problems.length === 0;
  problemsTitle.textContent = `Problems (${problems.length})`;
  const errors = problems.filter((p) => p.level === 'error').length;
  const warnings = problems.filter((p) => p.level === 'warning').length;
  const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
  problemCount.hidden = problems.length === 0;
  problemCount.textContent = [errors && plural(errors, 'error'), warnings && plural(warnings, 'warning'),
    !errors && !warnings && plural(problems.length, 'bad box')].filter(Boolean).join(', ');
  problemCount.classList.toggle('has-errors', errors > 0);
  problemCount.classList.toggle('has-warnings', errors === 0 && warnings > 0);

  // The same problems as icons next to the editor's line numbers.
  const marks = new Map<string, LineMark[]>();
  for (const problem of problems) {
    if (!problem.file || !problem.line) continue;
    const severity = problem.level === 'badbox' ? 'info' : problem.level;
    marks.set(problem.file, [...(marks.get(problem.file) ?? []), { line: problem.line, severity, message: problem.message }]);
  }
  editor.showMarks(marks);
}

function jumpTo(problem: LogProblem): void {
  if (!problem.file) return;
  openFile(problem.file);
  reveal('editor');
  if (problem.line && problem.file === activePath) editor.goTo(problem.line);
}

compileButton.addEventListener('click', () => void compile());
addFilesButton.addEventListener('click', showAddMenu);
projectActionsButton.addEventListener('click', () => openMenu(projectActionsButton, [
  { label: 'Download as .zip', action: () => void downloadProjectZip() },
  { label: 'All projects', action: () => showProjectsPage(true) },
]));
outlineToggle.addEventListener('click', () => {
  const open = outlineToggle.getAttribute('aria-expanded') !== 'true';
  outlineToggle.setAttribute('aria-expanded', String(open));
  outlineView.hidden = !open;
  try { localStorage.setItem('tilde.outlineOpen', String(open)); } catch { /* not remembered */ }
});
try {
  if (localStorage.getItem('tilde.outlineOpen') === 'false') {
    outlineToggle.setAttribute('aria-expanded', 'false');
    outlineView.hidden = true;
  }
} catch { /* open */ }

// PDF toolbar
zoomMenuButton.addEventListener('click', showZoomMenu);
zoomInButton.addEventListener('click', () => pdfViewer.stepZoom(1));
zoomOutButton.addEventListener('click', () => pdfViewer.stepZoom(-1));
downloadPdfButton.addEventListener('click', downloadPdf);
showInPdfButton.addEventListener('click', showInPdf);
pageNumber.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  pdfViewer.goToPage(Number(pageNumber.value) || 1);
  pageNumber.blur();
});
pageNumber.addEventListener('focus', () => pageNumber.select());
autoCompileBox.addEventListener('change', () => {
  try { localStorage.setItem(AUTO_COMPILE_KEY, String(autoCompileBox.checked)); } catch { /* not remembered */ }
  if (autoCompileBox.checked) void compile();
});
try {
  autoCompileBox.checked = localStorage.getItem(AUTO_COMPILE_KEY) === 'true';
  const zoom = JSON.parse(localStorage.getItem(ZOOM_KEY) ?? '"width"') as Zoom;
  if (zoom === 'width' || zoom === 'page' || typeof zoom === 'number') pdfViewer.setZoom(zoom);
} catch { /* defaults */ }

// Ctrl/Cmd with + or − (or the mouse wheel) zooms the PDF while the pointer
// is over it, instead of zooming the whole page. Ctrl/Cmd+0 fits the width.
let pointerOverPdf = false;
preview.addEventListener('pointerenter', () => { pointerOverPdf = true; });
preview.addEventListener('pointerleave', () => { pointerOverPdf = false; });
window.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey) || !(pointerOverPdf || preview.contains(document.activeElement))) return;
  const direction = event.key === '+' || event.key === '=' ? 1 : event.key === '-' ? -1 : 0;
  if (event.key === '0') setZoom('width');
  else if (direction) pdfViewer.stepZoom(direction);
  else return;
  event.preventDefault();
});
let lastWheelZoom = 0;
pdfContainer.addEventListener('wheel', (event) => {
  if (!(event.ctrlKey || event.metaKey)) return;
  event.preventDefault();
  if (Date.now() - lastWheelZoom < 150) return; // one step per flick of the wheel
  lastWheelZoom = Date.now();
  pdfViewer.stepZoom(event.deltaY < 0 ? 1 : -1);
}, { passive: false });
problemCount.addEventListener('click', () => {
  problemsPanel.hidden = !problemsPanel.hidden;
  if (!problemsPanel.hidden) reveal('pdf');
});
element<HTMLButtonElement>('#close-problems').addEventListener('click', () => { problemsPanel.hidden = true; });
element<HTMLButtonElement>('#welcome-sign-in').addEventListener('click', () => void handleSignIn());
initTheme(element<HTMLButtonElement>('#theme-toggle'));
const layout = initLayout({
  workspace: mainArea,
  side: element<HTMLElement>('#side'),
  sideHandle: element<HTMLElement>('#side-handle'),
  editorPane: element<HTMLElement>('#editor-pane'),
  pdfHandle: element<HTMLElement>('#pdf-handle'),
  preview: element<HTMLElement>('#preview'),
  toggles: {
    files: element<HTMLButtonElement>('#toggle-files'),
    editor: element<HTMLButtonElement>('#toggle-editor'),
    pdf: element<HTMLButtonElement>('#toggle-pdf'),
  },
});
uploadInput.addEventListener('change', () => void uploadFiles([...(uploadInput.files ?? [])], uploadTarget));

// Drag files from the computer onto the file tree: onto a folder to put them
// there, anywhere else for the top level.
const side = element<HTMLElement>('#side');
const dropFolder = (event: DragEvent): HTMLElement | null =>
  (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-folder]') ?? null;
const clearDropMarks = (): void => {
  side.classList.remove('drop-target');
  for (const row of side.querySelectorAll('.drop-folder')) row.classList.remove('drop-folder');
};
side.addEventListener('dragover', (event) => {
  if (!event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = sync ? 'copy' : 'none';
  clearDropMarks();
  side.classList.add('drop-target');
  dropFolder(event)?.classList.add('drop-folder');
});
side.addEventListener('dragleave', (event) => {
  if (!side.contains(event.relatedTarget as Node | null)) clearDropMarks();
});
side.addEventListener('drop', (event) => {
  if (!event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault();
  clearDropMarks();
  if (!sync) {
    notify('Sign in and open one of your projects to add files to it.', 'info');
    return;
  }
  // Folders cannot be read this way; leave them out with a hint.
  const items = [...event.dataTransfer.items];
  const folders = items.filter((item) => item.webkitGetAsEntry()?.isDirectory).length;
  const files = items.filter((item) => item.kind === 'file' && !item.webkitGetAsEntry()?.isDirectory)
    .map((item) => item.getAsFile()).filter((file): file is File => file !== null);
  if (folders > 0) notify('Folders cannot be dropped yet. Drop the files themselves, or import the folder as a .zip on the project page.', 'info');
  void uploadFiles(files, dropFolder(event)?.dataset.folder ?? '');
});
syncButton.addEventListener('click', showConflict);
logButton.addEventListener('click', () => { logView.hidden = !logView.hidden; });
projectsButton.addEventListener('click', () => showProjectsPage(true));
closeProjectsButton.addEventListener('click', () => showProjectsPage(false));
// Esc on the project page goes back to the open project (dialogs and menus close first).
window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || projectsPage.hidden || !project) return;
  if (document.querySelector('dialog[open], .menu')) return;
  showProjectsPage(false);
});
changeFolderButton.addEventListener('click', () => void chooseProjectsFolder());
element<HTMLButtonElement>('#rename-root').addEventListener('click', () => void renameProjectsFolder());
importMenuButton.addEventListener('click', () => openMenu(importMenuButton, [
  { label: 'From a .zip file…', action: () => { zipInput.value = ''; zipInput.click(); } },
  { label: 'From Google Drive…', action: () => void importFromDrive() },
]));
projectSearch.addEventListener('input', renderProjectList);
projectSort.addEventListener('change', () => {
  renderProjectList();
  try { localStorage.setItem('tilde.projectSort', projectSort.value); } catch { /* not remembered */ }
});
try { projectSort.value = localStorage.getItem('tilde.projectSort') ?? 'edited'; } catch { /* default */ }
if (!projectSort.value) projectSort.value = 'edited';
zipInput.addEventListener('change', () => {
  const file = zipInput.files?.[0];
  if (file) void importZip(file);
});
signInButton.addEventListener('click', () => void handleSignIn());
signOutButton.addEventListener('click', () => void handleSignOut());
newProjectButton.addEventListener('click', () => {
  newProjectName.value = '';
  newProjectProblem.hidden = true;
  starterGroup = 'blank';
  chosenTemplate = 'blank';
  renderTemplateChoices();
  newProjectDialog.returnValue = '';
  newProjectDialog.showModal();
});
// "Create project" keeps the dialog open, with a message, while the name is not usable.
newProjectForm.addEventListener('submit', (event) => {
  if (event.submitter?.getAttribute('value') !== 'create') return;
  const problem = projectNameProblem(newProjectName.value.trim());
  newProjectProblem.textContent = problem ?? '';
  newProjectProblem.hidden = !problem;
  if (problem) {
    event.preventDefault();
    newProjectName.focus();
  } else if (chosenKit()) {
    event.preventDefault(); // the dialog stays open while the .zip is chosen
    kitInput.value = '';
    kitInput.click();
  }
});
kitInput.addEventListener('change', () => {
  const file = kitInput.files?.[0];
  if (file) void createFromKit(file);
});
newProjectName.addEventListener('input', () => { newProjectProblem.hidden = true; });
newProjectDialog.addEventListener('close', () => {
  if (newProjectDialog.returnValue === 'create') void createFromDialog();
});
conflictDialog.addEventListener('close', () => {
  if (conflictDialog.returnValue === 'mine') void sync?.keepMine(conflictShown);
  if (conflictDialog.returnValue === 'drive') void sync?.keepDrive(conflictShown);
});
downloadBothButton.addEventListener('click', () => void downloadBoth());
signOutDialog.addEventListener('close', () => {
  const choice = signOutDialog.returnValue;
  if (choice === 'download') {
    for (const draft of unsavedAtSignOut) {
      downloadFile(`${draft.projectName} - ${draft.path.replaceAll('/', ' - ')}`, draft.content);
    }
  }
  if (choice === 'download' || choice === 'delete') void finishSignOut();
});

// Ctrl+S (Cmd+S on a Mac) saves to Drive right away and compiles, instead
// of opening the browser's "Save page" dialog.
window.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    void sync?.saveNow();
    void compile();
  }
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'Enter') {
    event.preventDefault();
    showInPdf();
  }
});

// Save when the user leaves the tab or closes it; look for changes made
// elsewhere (for example on the other computer) when they come back.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) void sync?.saveNow();
});
window.addEventListener('pagehide', () => void sync?.saveNow());
window.addEventListener('focus', () => {
  void sync?.checkDrive();
  if (!projectsPage.hidden && rootId) refreshProjects().catch((error: unknown) => console.warn('Could not refresh the project list', error));
});
window.addEventListener('online', () => void sync?.saveNow());

// The browser asks "Leave site?" while edits have not reached Drive yet.
// (They are kept in the browser either way and saved on the next visit.)
window.addEventListener('beforeunload', (event) => {
  if (sync?.hasUnsaved()) event.preventDefault();
});

// Makes sure a pane is shown (in a narrow window, switches to it).
function reveal(pane: Pane): void {
  layout.reveal(pane);
}

void loadExamples().then(() => {
  if (restoreSignIn()) void startDrive(); // still signed in from before a reload
  else showProjectsPage(true); // the welcome page, with the examples
});
