import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import './style.css';
import { BusyTexRunner, LuaLatex, PdfLatex, XeLatex } from 'texlyre-busytex';
import { findMainFile, groupByProject, pathProblem, type Project, type ProjectFile } from './projects';
import { buildTree, isTextFile, type TreeNode } from './fileTree';
import { Editor, type LineMark } from './editor';
import { PdfViewer, pdfToCanvas, type PdfViewState } from './pdfViewer';
import { formulaDocument } from './mathPreview';
import type { Zoom } from './pdfZoom';
import { forgetToken, restoreSignIn, signIn, SignInNeededError, signOut } from './auth';
import { FOLDER_TYPE, googleDrive, type DriveFile, type Role } from './drive';
import { createProject, lastEdited, listProjects, moveProjectsFolder, openProject, projectsFolder, setMainFile as saveMainFile } from './driveProjects';
import { GROUPS, kitMainFile, STARTERS, type Kit, type StarterGroup } from './starters';
import { browserDrafts, forgetOtherAccounts, type Draft } from './drafts';
import { ProjectSync, type DriveChanges, type SyncState } from './sync';
import { SharedSync, type Face } from './sharedSync';
import { browserShared, type SharedCopy } from './sharedStore';
import { sharedFiles, textHash } from './sharedDoc';
import {
  forgetJoined, invite, joinedProjects, joinFromPicked, joinLink, joinTarget, loadShared, makeShared, rememberJoined, sharedStateIn,
  type Joined, type LoadedShared,
} from './sharing';
import * as Y from 'yjs';
import { cachedPackages, REMOTE_DIR, storeNewPackages } from './packageCache';
import { lastLatexLog, parseLog, type LogProblem } from './logParser';
import { latexTokens } from './excerpt';
import showcaseSource from './showcase/main.tex?raw';
import showcasePicture from './showcase/main.png';
import { COMMANDS, describe, findCommands, keycaps, type CommandId } from './commands';
import { browserLocal, createLocal, LocalSync, toProject, untitledName, type LocalProject } from './localProjects';
import { convertEpsImages, isEps } from './eps';
import { unzipProject, zipFiles, zipProject } from './zipImport';
import { timeAgo, versionTime } from './time';
import { bibKeysIn, bibliographyTool, loadsPackage, outline, preambleInsertAt, texEngine } from './latex';
import { SyncTex } from './synctex';
import { afterQuickCompile, keptBuildFiles } from './buildFiles';
import { canConvertToPng, figureFor, figurePosition, imageExtension, imageFolder, imagePath } from './figures';
import { convertToPng } from './imageConvert';
import { fontFamilies, fontFormat, fontspecLine, pickFaces, type Faces, type LocalFont } from './localFonts';
import { fetchBibtex, keyWithDoi, parseDoi, tidyBibtex } from './doi';
import { showChanges } from './changesView';
import { isGoogleDoc, openPicker, pickDriveFiles, pickDriveFolder, type PickedFile } from './picker';
import { askConfirm, askText } from './ask';
import { initLayout, type Pane } from './layout';
import { initTheme } from './theme';
import { openMenu } from './menu';
import { hideBusy, notify, showBusy } from './notices';
import { arxivFiles } from './arxiv';
import { searchProject, type Hit } from './goTo';
import { openGoTo } from './goToDialog';
import { documentLanguage } from './language';
import { pdfLink, sharedPdf, sharePdf, stopSharingPdf } from './pdfLink';
import { ownStarters, removeStarter, saveStarter, starterFiles, type OwnStarter } from './ownStarters';
import { MAX_PEOPLE, peopleCount, peopleOf, type Person } from './people';
import { CommentsUi } from './commentsUi';
import { colorFor, webrtcLink } from './live';
import { avatar } from './avatar';
import { setIcon } from './icons';

// Files that TeX Live's basic bundle lacks (TikZ, pgfplots, ...) are fetched
// one at a time from TeXlyre's public package server.
const PACKAGE_SERVER = 'https://texlive2026.texlyre.org';
const LAST_PROJECT_KEY = 'tilde.lastProject'; // reopened after a reload
// One line about each example, for the welcome page and the New project
// dialog, in the order they are listed: from the simplest to the most
// involved (one file; several files; graphics; a bibliography tool; another engine).
const EXAMPLE_NOTES: Record<string, string> = {
  hello: 'The smallest document',
  math: 'Equations and theorems with amsmath',
  multifile: '\\input, \\include and an image in a folder',
  tikz: 'A TikZ figure and a pgfplots plot',
  bibtex: 'Citations with natbib and BibTeX',
  biblatex: 'Citations with biblatex and Biber',
  xetex: 'Unicode text and OpenType fonts with XeLaTeX',
};
const exampleRank = (name: string): number => {
  const rank = Object.keys(EXAMPLE_NOTES).indexOf(name);
  return rank < 0 ? Infinity : rank; // a new example without a note goes last
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
const compileLabel = element<HTMLSpanElement>('#compile-label');
const freshness = element<HTMLSpanElement>('#freshness');
const railFreshness = element<HTMLSpanElement>('#rail-freshness'); // the same dot on the folded PDF's strip
const editorPath = element<HTMLSpanElement>('#editor-path');
const syncButton = element<HTMLButtonElement>('#sync');
const facesView = element<HTMLDivElement>('#faces');
const conflictDialog = element<HTMLDialogElement>('#conflict-dialog');
const conflictPath = element<HTMLElement>('#conflict-path');
const downloadBothButton = element<HTMLButtonElement>('#download-both');
const signOutDialog = element<HTMLDialogElement>('#sign-out-dialog');
const signOutFiles = element<HTMLUListElement>('#sign-out-files');
const newProjectButton = element<HTMLButtonElement>('#new-project');
const signInButton = element<HTMLButtonElement>('#sign-in');
const accountButton = element<HTMLButtonElement>('#account');
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
const backBar = element<HTMLDivElement>('#back-bar');
const logButton = element<HTMLButtonElement>('#toggle-log');
const statusText = element<HTMLSpanElement>('#status');
const treeView = element<HTMLElement>('#tree');
const editorElement = element<HTMLDivElement>('#editor');
const imagePreview = element<HTMLImageElement>('#image-preview');
const logView = element<HTMLPreElement>('#log');
const addFilesButton = element<HTMLButtonElement>('#add-files');
const projectActionsButton = element<HTMLButtonElement>('#project-actions');
const goToButton = element<HTMLButtonElement>('#go-to');
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
// Saves the open project: to Drive, or to this browser (LocalSync, for a project
// started without signing in); null for examples.
let sync: ProjectSync | SharedSync | LocalSync | null = null;
let myName = ''; // the signed-in account's name, for "who is here" in shared projects
let myPhoto: string | undefined; // and its Google profile photo
let joinedById = new Map<string, Joined>(); // projects others shared with this account, by folder
let starterList: OwnStarter[] = []; // the user's own starters (see ownStarters.ts)
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
editor.shared = (path) => (sync instanceof SharedSync ? sync.textFor(path) : null);
const commentsUi = new CommentsUi({
  editor,
  panel: element<HTMLElement>('#comments-panel'),
  title: element<HTMLElement>('#comments-title'),
  list: element<HTMLElement>('#comment-list'),
  openFile: (path) => {
    if (path !== activePath) openFile(path);
    reveal('editor');
  },
  soloCanComment: () => sync instanceof ProjectSync,
  turnOnComments,
});
const pdfViewer = new PdfViewer(pdfContainer, showPdfState);

// The toolbar above the PDF: zoom, page number, auto-compile, download.
const zoomMenuButton = element<HTMLButtonElement>('#zoom-menu');
const zoomLabel = element<HTMLSpanElement>('#zoom-label');
const zoomInButton = element<HTMLButtonElement>('#zoom-in');
const zoomOutButton = element<HTMLButtonElement>('#zoom-out');
const pageNav = element<HTMLLabelElement>('#page-nav');
const pageNumber = element<HTMLInputElement>('#page-number');
const pageCount = element<HTMLSpanElement>('#page-count');
const downloadPdfButton = element<HTMLButtonElement>('#download-pdf');
const sharePdfButton = element<HTMLButtonElement>('#share-pdf');
const showInPdfButton = element<HTMLButtonElement>('#show-in-pdf');
const ZOOM_KEY = 'tilde.pdfZoom';
const AUTO_COMPILE_KEY = 'tilde.autoCompile';
const KEEP_GOING_KEY = 'tilde.keepGoing';
const CONVERT_EPS_KEY = 'tilde.convertEps';
const AUTO_COMPILE_DELAY = 1500; // milliseconds after the last edit

function showPdfState(state: PdfViewState): void {
  zoomLabel.textContent = state.zoom === 'width' ? 'Fit width' : state.zoom === 'page' ? 'Fit page' : `${state.percent}%`;
  const hasPdf = state.pages > 0;
  for (const button of [zoomInButton, zoomOutButton, downloadPdfButton, sharePdfButton]) button.disabled = !hasPdf;
  showInPdfButton.disabled = !hasPdf || !syncTex;
  wordCount.hidden = !hasPdf;
  wordCount.textContent = `${state.words.toLocaleString()} ${state.words === 1 ? 'word' : 'words'}`;
  pageNav.hidden = !hasPdf;
  if (document.activeElement !== pageNumber) pageNumber.value = String(state.page);
  pageCount.textContent = `/ ${state.pages}`;
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
      insertIntoClosedFile(bib, bib.content.length, gap + entry.text);
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

// Spreadsheet cells pasted into a .tex file became a table (see editor.ts).
// The notice offers the plain text instead, for those who wanted that.
editor.onTablePasted = (from, to, plain, rowsOnly) => {
  const path = activePath;
  const table = editor.slice(from, to).replace(/^\n/, ''); // the table goes on a line of its own
  const text = plain.replace(/\r?\n$/, '');
  const mainPath = rowsOnly ? null : loadPackage('booktabs');
  const rows = text.split(/\r?\n/).length;
  notify(`Pasted ${rows} rows as a ${rowsOnly ? 'part of the table' : 'table'}.`
    + (mainPath ? ` Also added \\usepackage{booktabs} to ${mainPath}, for its lines.` : ''), 'success', {
    label: 'Paste as text instead',
    run: () => {
      // Found by its text: adding \usepackage{booktabs} above it moved it.
      const at = activePath === path ? editor.text().indexOf(table) : -1;
      if (at < 0 || !editor.replaceRange(at, at + table.length, table, text)) notify('The table was changed since, so it stays.', 'info');
    },
  });
};

// \includegraphics needs the graphicx package. If no file of the project
// loads it, adds it to the main file, right after \documentclass.
// Returns the main file's path if it did.
function loadGraphicx(): string | null {
  return loadPackage('graphicx', ['graphics']);
}

// Adds \usepackage{name} to the main file if no file of the project loads
// it (or one of `instead`). Returns the main file's path if it did.
function loadPackage(name: string, instead: string[] = []): string | null {
  if (!project || loadsPackage(project.files, [name, ...instead])) return null;
  const mainPath = findMainFile(project);
  const main = project.files.find((f) => f.path === mainPath);
  if (!main || typeof main.content !== 'string') return null;
  const at = preambleInsertAt(main.content);
  if (at === null) return null;
  const line = `${main.content[at - 1] === '\n' ? '' : '\n'}\\usepackage{${name}}\n`;
  if (main.path === activePath) {
    editor.insertText(at, line); // through the editor, so Ctrl/Cmd+Z undoes it
  } else {
    insertIntoClosedFile(main, at, line);
  }
  return main.path;
}

// Inserts text into a file that is not open in the editor. In a shared
// project it goes into the shared text, so everyone gets it.
function insertIntoClosedFile(file: ProjectFile, at: number, text: string): void {
  if (sync instanceof SharedSync && sync.insertText(file.path, at, text)) return;
  const content = typeof file.content === 'string' ? file.content : '';
  file.content = content.slice(0, at) + text + content.slice(at);
  editor.replace(file.path, file.content);
  sync?.edited(file.path);
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

// "Share" above the PDF: saves the PDF in the project's Drive folder and makes
// a link anyone can open (see pdfLink.ts). Once shared, the button offers to
// copy the link, update the PDF behind it, or stop sharing it.
async function sharePdfMenu(): Promise<void> {
  const target = project;
  const pdf = pdfViewer.current();
  if (!target?.driveId || !pdf) return;
  const folderId = target.driveId;
  let existing;
  try {
    existing = await sharedPdf(googleDrive, folderId);
  } catch (error) {
    showError(error);
    return;
  }
  if (existing) {
    const link = pdfLink(existing.id);
    openMenu(sharePdfButton, [
      { label: 'Copy the link', action: () => void copyLink(link, 'The link to the PDF is copied.') },
      { label: 'Update it to this PDF', action: () => void publishPdf(target, pdf) },
      { label: 'Open it in Google Drive', action: () => window.open(link, '_blank', 'noopener') },
      { label: 'Stop sharing it…', action: () => void stopSharing(folderId), danger: true },
    ]);
    return;
  }
  if (!await askConfirm(`Share this PDF by link? Tilde saves it in the project's folder in your Google Drive, and anyone with the link can view it, `
    + 'without a Google account. The link shows this version until you update it here.', 'Make a link')) return;
  await publishPdf(target, pdf);
}

async function publishPdf(target: Project, pdf: Uint8Array): Promise<void> {
  showBusy('Sharing the PDF…');
  try {
    const link = await sharePdf(googleDrive, target, pdf);
    hideBusy();
    await copyLink(link, 'Anyone with the link can view the PDF. The link is copied; Share PDF → Update puts a newer PDF behind the same link.');
  } catch (error) {
    hideBusy();
    const text = error instanceof Error ? error.message : '';
    if (/publishOutNotPermitted|cannotShare/i.test(text)) {
      notify('Your Google account\'s organisation does not allow links that anyone can open. The PDF is in the project\'s folder in Drive; '
        + 'share it from there with people by name.', 'error');
    } else {
      showError(error);
    }
  }
}

async function copyLink(link: string, done: string): Promise<void> {
  const copied = await navigator.clipboard.writeText(link).then(() => true, () => false);
  notify(copied ? done : `The link: ${link}`, 'success', copied ? undefined : { label: 'Open', run: () => window.open(link, '_blank', 'noopener') });
}

async function stopSharing(folderId: string): Promise<void> {
  if (!await askConfirm('Stop sharing the PDF? It goes to the trash in your Google Drive, and its link stops working.', 'Stop sharing')) return;
  try {
    await stopSharingPdf(googleDrive, folderId);
    notify('The PDF is not shared any more. Its link stops working.');
  } catch (error) {
    showError(error);
  }
}

// Whether the PDF matches the source: a green dot when it does, amber when
// the source changed since (yours or a co-author's edits), red when the last
// compile stopped at an error. Compared by a fingerprint of the files.
let pdfStamp: string | null = null; // the fingerprint of the source of the PDF shown
let lastCompileFailed = false;
let autoCompile = false; // "Compile as you type"
// Options in the menu next to Update PDF, off unless chosen, remembered in this browser.
let keepGoing = false; // "Show all errors": LaTeX does not stop at the first error
let convertEps = false; // "Convert EPS images" with Ghostscript (pdfLaTeX and LuaLaTeX)

// A script the engine loads before each compile: whether LaTeX stops at the
// first error (public/engine/). The maths preview always stops at an error.
function engineScript(goOn: boolean): string[] {
  return [new URL(`${import.meta.env.BASE_URL}engine/${goOn ? 'keep-going' : 'stop-at-errors'}.js`, location.href).href];
}

function sourceStamp(files: ProjectFile[]): string {
  return files.map((f) => `${f.path}\u0000${typeof f.content === 'string' ? textHash(f.content) : f.content.length}`).sort().join('\n');
}

function showFreshness(): void {
  const state = compiling ? 'busy' : !project ? '' : lastCompileFailed ? 'error' : pdfStamp === null ? ''
    : sourceStamp(project.files) === pdfStamp ? 'fresh' : 'behind';
  freshness.className = state;
  railFreshness.className = state;
  compileButton.title = {
    busy: 'Updating the PDF…',
    fresh: 'The PDF matches the source. Ctrl/Cmd+S updates it again.',
    behind: 'The source changed since this PDF was made. Update it with this button or Ctrl/Cmd+S.',
    error: 'The last update had an error (see the problems list). Ctrl/Cmd+S tries again.',
    '': 'Make the PDF (Ctrl/Cmd+S)',
  }[state] ?? '';
}

// Maths the quick preview (KaTeX) cannot show, typeset by the TeX engine: a
// one-formula document with the main file's preamble, so the document's own
// packages and commands work. Never at the same time as a compile.
let engineFree: Promise<void> = Promise.resolve();
const typesetCache = new Map<string, Promise<HTMLCanvasElement>>();
editor.typesetWithTex = (math) => {
  const target = project;
  const mainPath = target ? findMainFile(target) : undefined;
  const main = target?.files.find((f) => f.path === mainPath);
  if (!target || !main || typeof main.content !== 'string') return Promise.reject(new Error('this project has no main file'));
  const source = formulaDocument(main.content, math);
  const cached = typesetCache.get(source);
  if (cached) return cached;
  const job = (async () => {
    while (compiling) await new Promise((resolve) => setTimeout(resolve, 200));
    const currentRunner = await getRunner();
    const engineName = texEngine(target.files, main.path);
    const engine = engineName === 'xelatex' ? new XeLatex(currentRunner) : engineName === 'lualatex' ? new LuaLatex(currentRunner) : new PdfLatex(currentRunner);
    const result = await engine.compile({
      input: source, mainTexPath: 'tilde-maths-preview.tex', additionalFiles: target.files.filter((f) => f !== main),
      bibtex: false, biber: false, rerun: false, remoteEndpoint: PACKAGE_SERVER, shellHandlerScripts: engineScript(false),
    });
    if (!result.success || !result.pdf || result.pdf.length === 0) {
      const problem = parseLog(lastLatexLog(result.logs), target.files).find((p) => p.level === 'error');
      throw new Error(problem?.message ?? 'the formula has an error');
    }
    try {
      await storeNewPackages(PACKAGE_SERVER, await currentRunner.readProjectFiles(REMOTE_DIR));
    } catch { /* fetched again next time */ }
    return pdfToCanvas(result.pdf);
  })();
  engineFree = job.then(() => {}, () => {});
  typesetCache.set(source, job);
  job.catch(() => typesetCache.delete(source)); // an error may be fixed by the next edit
  return job;
};

// Auto-compile: compile by itself a moment after typing stops, quickly (one
// LaTeX pass with the build files of the last compile). A compile that is
// asked for while one runs starts right after it.
type CompileKind = 'full' | 'quick';
let autoCompileTimer: ReturnType<typeof setTimeout> | undefined;
let compileAgain: CompileKind | null = null;
let againIsFollowUp = false; // compileAgain was asked for by a quick compile's log, not by typing
function scheduleAutoCompile(): void {
  if (!autoCompile) return;
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
  accountButton.hidden = state !== 'signed-in';
  if (state === 'signed-in') {
    accountButton.replaceChildren(avatar(myName, accountId, myPhoto));
    accountButton.title = `Signed in as ${myName}`;
    accountButton.setAttribute('aria-label', `${myName}: account`);
  }
  // An icon to sign in; words when the sign-in ran out, since that needs the user.
  const label = signInButton.querySelector('.label');
  if (label) label.textContent = state === 'expired' ? 'Sign in again' : '';
  signInButton.classList.toggle('expired', state === 'expired');
  signInButton.title = state === 'expired' ? 'Google\'s sign-in ran out. Sign in again to keep saving; your edits are kept.' : 'Sign in with Google';
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
  examples = groupByProject('/test-docs', { ...textFiles, ...binaryFiles })
    .sort((a, b) => exampleRank(a.name) - exampleRank(b.name));
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
  if (starterGroup === 'yours' && starterList.length === 0) starterGroup = 'blank';
  starterGroups.replaceChildren(...GROUPS.filter((group) => group.id !== 'yours' || starterList.length > 0).map((group) => {
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
    : starterGroup === 'yours' ? starterList.map((s) => [`own:${s.id}`, s.name, s.saved ? `Saved ${timeAgo(s.saved)}` : 'Your starter'])
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
    const own = starterList.find((s) => `own:${s.id}` === value);
    if (own) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'link remove-starter';
      remove.textContent = 'Remove';
      remove.title = `Remove the starter "${own.name}"`;
      remove.addEventListener('click', (event) => {
        event.preventDefault();
        void removeOwnStarter(own);
      });
      detail.append(' · ', remove);
    }
    return label;
  };
  templateChoices.replaceChildren(...cards.map(([value, name, note]) => choice(value, name, note)));
  showKitSteps();
}

async function removeOwnStarter(starter: OwnStarter): Promise<void> {
  try {
    await removeStarter(googleDrive, starter);
    starterList = starterList.filter((s) => s !== starter);
    renderTemplateChoices();
    notify(`Removed the starter "${starter.name}". It is in the trash in your Google Drive for 30 days.`);
  } catch (error) {
    showError(error);
  }
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
// The projects in the projects folder, and the projects others shared with
// this account (shown like folders, under the shared folder's id).
async function listAllProjects(id: string): Promise<DriveFile[]> {
  const [own, joined] = await Promise.all([listProjects(googleDrive, id), joinedProjects(googleDrive, id)]);
  joinedById = new Map(joined.map((j) => [j.folderId, j]));
  return [...own, ...joined.map((j) => ({ id: j.folderId, name: j.name, mimeType: FOLDER_TYPE }))];
}

async function showDriveProjects(): Promise<void> {
  if (!rootId) return;
  driveFolders = await listAllProjects(rootId);
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
  void refreshLocalProjects();
  if (signedIn) renderProjectList();
}

// The welcome page's showcase: the source of a short intro (its document
// body, to the figure's end) next to a picture of its PDF. Both come from
// src/showcase/, so they always match.
function renderShowcase(): void {
  const lines = showcaseSource.split('\n');
  const from = lines.findIndex((line) => line.startsWith('\\begin{document}')) + 1;
  const to = lines.findIndex((line) => line.startsWith('\\end{figure}'));
  const source = element<HTMLPreElement>('#showcase-source');
  source.replaceChildren(...lines.slice(from, to + 1).map((line, index) => {
    const row = document.createElement('div');
    row.className = 'line';
    const number = document.createElement('span');
    number.className = 'ln';
    number.textContent = String(from + index + 1);
    const code = document.createElement('code');
    code.append(...latexTokens(line).map((token) => {
      if (token.kind === 'text') return token.text;
      const span = document.createElement('span');
      span.className = token.kind;
      span.textContent = token.text;
      return span;
    }));
    row.append(number, code);
    return row;
  }));
  element<HTMLImageElement>('#showcase-page').src = showcasePicture;
}
renderShowcase();

// "Try an example": the examples, from the simplest.
const openExampleButton = element<HTMLButtonElement>('#open-example');
openExampleButton.addEventListener('click', () => openMenu(openExampleButton, [
  { label: 'Examples, from the simplest' },
  ...examples.map((example) => ({ label: EXAMPLE_NOTES[example.name] ?? example.name, action: () => void openProjectById(example.name) })),
]));
element<HTMLButtonElement>('#start-writing').addEventListener('click', () => void startWriting());
// "Import it from Google Drive": signs in, then opens the picker.
element<HTMLButtonElement>('#welcome-import').addEventListener('click', () => void (async () => {
  if (!rootId) await handleSignIn();
  if (rootId) await importFromDrive();
})());

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
    for (const label of [project?.driveId === row.id ? 'Current' : '', joinedById.has(row.id) ? 'Shared with you' : '']) {
      if (!label) continue;
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = label;
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
    setIcon(more, 'more');
    more.title = `Actions for ${row.name}`;
    more.setAttribute('aria-label', more.title); // screen readers would read only "⋯"
    more.setAttribute('aria-haspopup', 'menu');
    // A project shared with this account belongs to someone else: no renaming or deleting it here.
    more.addEventListener('click', () => openMenu(more, joinedById.has(row.id) ? [
      { label: 'Open', action: () => void openProjectById(row.id) },
      { label: 'Make a copy…', action: () => void copyProject(row.id) },
      { label: 'Download as .zip', action: () => void downloadProjectZip(row.id) },
      { label: 'Leave…', action: () => void leaveProject(row.id, row.name), danger: true },
    ] : [
      { label: 'Open', action: () => void openProjectById(row.id) },
      { label: 'Make a copy…', action: () => void copyProject(row.id) },
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
    const joined = joinedById.get(id);
    if (joined) {
      // Shared with this account: everything is in the shared document.
      const [loaded, editable] = await Promise.all([loadShared(googleDrive, joined.stateId), googleDrive.canEdit(joined.stateId)]);
      showProject(null, { loaded, viewOnly: !editable });
      const name = project?.name;
      if (rootId && name && name !== joined.name) {
        // The owner renamed it: the project list follows.
        rememberJoined(googleDrive, rootId, { ...joined, name })
          .catch((error: unknown) => console.warn('Could not update the list of shared projects', error));
      }
    } else {
      const [plain, stateId] = await Promise.all([openProject(googleDrive, folder), sharedStateIn(googleDrive, folder.id)]);
      if (stateId) showProject(null, { loaded: await loadShared(googleDrive, stateId), plain });
      else showProject(plain);
    }
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
    const [folder, projects] = await Promise.all([googleDrive.get(id), listAllProjects(id)]);
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
      if (sync instanceof SharedSync) await sync.rename(newName); // co-authors see the new name too
      project.name = newName;
      projectNameLabel.textContent = newName;
    }
    await refreshProjects();
    notify(`Renamed "${name}" to "${newName}".`);
  } catch (error) {
    showError(error);
  }
}

// Leaves a project someone else shared: it leaves the project list. The
// project itself stays in its owner's Drive, with everyone's edits.
async function leaveProject(id: string, name: string): Promise<void> {
  if (!rootId) return;
  const root = rootId;
  if (!await askConfirm(`Leave "${name}"? It leaves your project list; the project stays in its owner's Drive with everyone's edits. `
    + 'The link they sent you brings it back. To stop sharing it with you, the owner removes you in Google Drive.', 'Leave')) return;
  try {
    if (project?.driveId === id) {
      await sync?.saveNow();
      showProject(null);
    }
    await forgetJoined(googleDrive, root, id);
    await browserShared.remove(accountId, id).catch(() => {});
    await refreshProjects();
    notify(`Left "${name}".`);
  } catch (error) {
    showError(error);
  }
}

async function deleteProject(id: string, name: string): Promise<void> {
  if (!await askConfirm(`Delete the project "${name}"? Its folder goes to the trash in your Google Drive, where you can restore it for 30 days.`, 'Delete')) return;
  try {
    // Save the last edits first, so restoring it from the trash brings them back.
    if (project?.driveId === id) await sync?.saveNow();
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
async function createAndOpen(name: string, files: ProjectFile[], mainFile?: string, announce = true): Promise<boolean> {
  if (!rootId) return false;
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
    if (announce) notify(`Created ${name}.`);
    return true;
  } catch (error) {
    showError(error);
    return false;
  }
}

// "Start writing" on the welcome page: a blank project, without signing in,
// kept in this browser until the user saves it to Google Drive.
async function startWriting(): Promise<void> {
  try {
    // Signed out there is one place to write: the latest project kept here.
    if (localProjects[0]) {
      await openLocal(localProjects[0]);
      return;
    }
    const local = await createLocal(browserLocal, untitledName(localProjects.map((p) => p.name)), BLANK_PROJECT);
    // Asks the browser not to clear Tilde's storage when space runs low (Firefox asks the user).
    navigator.storage?.persist?.().catch(() => false);
    await openLocal(local);
    notify('This project is kept in this browser only. Save it to Google Drive (the button in the status bar) to keep it safe '
      + 'and open it on other computers.', 'info');
  } catch (error) {
    showError(error);
  }
}

async function openLocal(local: LocalProject): Promise<void> {
  await sync?.saveNow();
  showProject(toProject(local), undefined, local.id);
  showProjectsPage(false);
}

// "Save to Google Drive": signs in if needed, makes the project an ordinary
// Drive project, opens that, and removes it from this browser.
async function saveLocalToDrive(id?: string): Promise<void> {
  const open = sync instanceof LocalSync && (!id || sync.id === id) ? sync : null;
  await open?.saveNow();
  const local = open ? { id: open.id, ...open.project } : localProjects.find((p) => p.id === id);
  if (!local) return;
  if (!rootId) {
    await handleSignIn();
    if (!rootId) return;
  }
  const name = projectNameProblem(local.name)
    ? await askProjectName(`You already have a project called "${local.name}" in Google Drive. Name for this one:`, `${local.name} 2`)
    : local.name;
  if (!name) return;
  if (!await createAndOpen(name, local.files.map((f) => ({ path: f.path, content: f.content })), local.mainFile, false)) return;
  await browserLocal.remove(local.id).catch((error: unknown) => console.warn('Could not remove the copy kept in this browser', error));
  await refreshLocalProjects();
  notify(`${name} is in your Google Drive now, and no longer kept in this browser only.`);
}

// The projects kept in this browser, listed on the welcome page and above the Drive projects.
let localProjects: LocalProject[] = [];
async function refreshLocalProjects(): Promise<void> {
  try {
    localProjects = (await browserLocal.list()).sort((a, b) => b.edited - a.edited);
  } catch (error) {
    localProjects = [];
    console.warn('Could not read the projects kept in this browser', error);
  }
  renderLocalProjects();
}

// The list shows on the welcome page (signed out) and above the Drive projects (signed in).
function renderLocalProjects(): void {
  element<HTMLButtonElement>('#start-writing').textContent = localProjects.length > 0 ? 'Continue writing' : 'Start writing';
  for (const section of document.querySelectorAll<HTMLElement>('.local-projects')) {
    section.hidden = localProjects.length === 0;
    section.querySelector('ul')?.replaceChildren(...localProjects.map(localRow));
  }
}

function localRow(local: LocalProject): HTMLLIElement {
  const isOpen = sync instanceof LocalSync && sync.id === local.id;
  const open = document.createElement('button');
  open.className = 'project-open';
  const name = document.createElement('span');
  name.className = 'project-name';
  name.textContent = local.name;
  if (isOpen) {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = 'Current';
    name.append(badge);
  }
  const edited = document.createElement('span');
  edited.className = 'project-edited';
  edited.textContent = `Edited ${timeAgo(new Date(local.edited))}`;
  open.append(name, edited);
  open.addEventListener('click', () => void (isOpen ? showProjectsPage(false) : openLocal(local)));
  const more = document.createElement('button');
  more.className = 'project-more';
  setIcon(more, 'more');
  more.title = `Actions for ${local.name}`;
  more.setAttribute('aria-label', more.title);
  more.setAttribute('aria-haspopup', 'menu');
  more.addEventListener('click', () => openMenu(more, [
    { label: 'Open', action: () => void openLocal(local) },
    { label: 'Save to Google Drive', action: () => void saveLocalToDrive(local.id) },
    { label: 'Download as .zip', action: () => downloadFile(`${local.name}.zip`, zipProject(local.name, local.files)) },
    { label: 'Rename…', action: () => void renameLocal(local) },
    { label: 'Delete…', action: () => void deleteLocal(local), danger: true },
  ]));
  const item = document.createElement('li');
  item.append(open, more);
  return item;
}

// The open browser project as it is listed (its row), for renaming or deleting it from the editor.
async function withOpenLocal(act: (local: LocalProject) => Promise<void>): Promise<void> {
  if (!(sync instanceof LocalSync)) return;
  await sync.saveNow();
  await refreshLocalProjects();
  const open = sync;
  const local = localProjects.find((p) => p.id === open.id);
  if (local) await act(local);
}

async function renameLocal(local: LocalProject): Promise<void> {
  const typed = (await askText('New name for the project:', local.name))?.trim();
  if (!typed || typed === local.name) return;
  local.name = typed;
  if (sync instanceof LocalSync && sync.id === local.id) {
    projectNameLabel.textContent = typed;
    await sync.rename(typed);
  } else {
    await browserLocal.put(local);
  }
  await refreshLocalProjects();
}

async function deleteLocal(local: LocalProject): Promise<void> {
  if (!await askConfirm(`Delete ${local.name}? It is kept only in this browser, so it cannot be brought back.`, 'Delete')) return;
  if (sync instanceof LocalSync && sync.id === local.id) {
    showProject(null);
    showProjectsPage(true);
  }
  await browserLocal.remove(local.id);
  await refreshLocalProjects();
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
    const target = await projectSnapshot(id);
    if (!target) return;
    downloadFile(`${target.name}.zip`, zipProject(target.name, target.files));
    notify(`Saved ${target.name}.zip to your downloads.`);
  } catch (error) {
    showError(error);
  }
}

// A project as it is now, open or not: the open one from memory (with edits
// not yet in Drive), others read from Drive.
async function projectSnapshot(id?: string): Promise<Project | null> {
  if (!id || project?.driveId === id) return project;
  const folder = driveFolders.find((f) => f.id === id);
  if (!folder) return null;
  showBusy(`Reading ${folder.name}…`);
  try {
    const joined = joinedById.get(id);
    if (joined) {
      // Shared with this account: the text is in the shared file; images are
      // read where this account may read them.
      const doc = (await loadShared(googleDrive, joined.stateId)).doc;
      const files: ProjectFile[] = [];
      for (const entry of sharedFiles(doc)) {
        if (entry.text) files.push({ path: entry.path, content: entry.text.toString() });
        else if (entry.driveId) {
          const bytes = await googleDrive.download(entry.driveId).catch(() => null);
          if (bytes) files.push({ path: entry.path, content: bytes });
          else notify(`${entry.path} was left out: someone else added it, and Google lets Tilde read it only after you open the project and allow it.`, 'info');
        }
      }
      return { name: joined.name, files, mainFile: doc.getMap<string>('project').get('mainFile') };
    }
    const plain = await openProject(googleDrive, folder);
    // A shared project's newest text is in its shared file; the plain files may lag behind.
    const stateId = await sharedStateIn(googleDrive, folder.id);
    return stateId ? sharedSnapshot((await loadShared(googleDrive, stateId)).doc, plain) : plain;
  } finally {
    hideBusy();
  }
}

// "Make a copy…": a new project of the user's own, with the same files.
async function copyProject(id?: string): Promise<void> {
  const name = id ? driveFolders.find((f) => f.id === id)?.name : project?.name;
  if (!name || !rootId) return;
  const newName = await askProjectName(`Name for the copy of "${name}":`, `${name} (copy)`);
  if (!newName) return;
  try {
    const source = await projectSnapshot(id);
    if (!source) return;
    const files = source.files.map((f) => ({ path: f.path, content: typeof f.content === 'string' ? f.content : f.content.slice() }));
    await createAndOpen(newName, files, findMainFile(source));
  } catch (error) {
    showError(error);
  }
}

// "Save as a starter…": the open project becomes one of the user's starters,
// under "Yours" in the New project dialog (see ownStarters.ts).
async function saveAsStarter(): Promise<void> {
  const source = project;
  const root = rootId;
  if (!source || !root) return;
  const name = (await askText('Name for the starter. New project shows it under "Yours", on all your computers. '
    + 'It keeps the files as they are now, text and all.', source.name))?.trim();
  if (!name) return;
  try {
    starterList = await ownStarters(googleDrive, root);
    if (starterList.some((s) => s.name === name)
      && !await askConfirm(`You already have a starter called "${name}". Replace it?`, 'Replace')) return;
    showBusy(`Saving the starter ${name}…`);
    await saveStarter(googleDrive, root, name, source, findMainFile(source));
    hideBusy();
    notify(`Saved "${name}" as a starter. New project → Yours makes a project from it.`);
  } catch (error) {
    showError(error);
  }
}

// "Recently deleted…" in a shared project: files deleted in the last 30 days,
// by anyone; choosing one brings it back for everyone.
function showRecentlyDeleted(): void {
  const shared = sync;
  if (!(shared instanceof SharedSync)) return;
  const deleted = shared.recentlyDeleted;
  if (deleted.length === 0) {
    notify('Nothing was deleted in this project in the last 30 days.', 'info');
    return;
  }
  openMenu(projectActionsButton, [
    { label: 'Bring back a file deleted in the last 30 days:' },
    ...deleted.map((file) => ({
      label: `${file.path} (${file.by ? `${file.by}, ` : ''}${timeAgo(new Date(file.at))})`,
      action: () => void (async () => {
        try {
          const path = await shared.restoreFile(file.id);
          if (path) openFile(path);
          notify(path === file.path ? `${path} is back.` : `${file.path} is back, as ${path}: its old name was taken meanwhile.`);
        } catch (error) {
          showError(error);
        }
      })(),
    })),
  ]);
}

// "Download for arXiv…": compiles once more (for a fresh .bbl), then saves the
// source files with the bibliography in one .zip, comments taken out if asked.
const arxivDialog = element<HTMLDialogElement>('#arxiv-dialog');
const arxivStrip = element<HTMLInputElement>('#arxiv-strip');

async function downloadForArxiv(): Promise<void> {
  const target = project;
  if (!target) return;
  arxivDialog.returnValue = '';
  arxivDialog.showModal();
  await new Promise((resolve) => arxivDialog.addEventListener('close', resolve, { once: true }));
  if (arxivDialog.returnValue !== 'download') return;
  const strip = arxivStrip.checked;
  const waitForCompiles = async (): Promise<void> => {
    while (compiling) await new Promise((resolve) => setTimeout(resolve, 200));
  };
  await waitForCompiles();
  await compile('full');
  await waitForCompiles();
  if (project !== target) return;
  const mainPath = findMainFile(target);
  if (!mainPath) return;
  if (!pdfViewer.current() || buildKey.split('|')[0] !== mainPath) {
    notify('The project did not compile, so there is nothing to send to arXiv yet. Fix the errors first.', 'error');
    return;
  }
  const { files, bbl } = arxivFiles(target.files, buildFiles, mainPath, strip);
  const tool = bibliographyTool(target.files);
  if (tool && !bbl) {
    notify('The bibliography was not made, so arXiv would show [?] for every citation. Look at the problems list, then try again.', 'error');
    return;
  }
  downloadFile(`${target.name}-arxiv.zip`, zipFiles(files));
  notify(`Saved ${target.name}-arxiv.zip to your downloads${bbl ? `, with ${bbl}` : ''}${strip ? ', without comments' : ''}.`
    + (tool === 'biber' ? ' With biblatex, arXiv needs a .bbl from the same biblatex version it has; if arXiv reports a .bbl version error, '
      + 'compile there with BibTeX (natbib) instead.' : ''));
}

// "Go to anything" (Ctrl/Cmd+K, or the magnifier above the files).
// `typed` "?" opens it on the keyboard shortcuts (the ? key, the ? in the status bar).
function showGoTo(typed = ''): void {
  if (!project || document.querySelector('dialog[open]')) return;
  openGoTo((text) => (text.trimStart().startsWith('?') ? commandHits(text.trimStart().slice(1))
    : project ? searchProject(project.files, findMainFile(project), text) : []), (hit) => {
    if (hit.kind === 'command') {
      if (hit.command) runCommand(hit.command as CommandId);
      return;
    }
    openFile(hit.file);
    reveal('editor');
    if (hit.line && hit.file === activePath) editor.goTo(hit.line, hit.column, hit.kind === 'text' && hit.match ? hit.match[1] - hit.match[0] : 0);
  }, typed);
}

// The keyboard shortcuts as Go to anything rows (see commands.ts).
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
function commandHits(typed: string): Hit[] {
  return findCommands(typed).map((command) => ({
    kind: 'command', label: command.label, detail: describe(command.where ?? '', IS_MAC), file: '', group: command.group,
    keys: command.keys.map((combo) => keycaps(combo, IS_MAC)), command: command.id,
  }));
}

// A command chosen in the shortcut list: what its keys would do.
function runCommand(id: CommandId): void {
  const keys = COMMANDS.find((c) => c.id === id)?.keys[0] ?? '';
  if (id === 'compile') void compile();
  else if (id === 'showInPdf') showInPdf();
  else if (id === 'goTo') setTimeout(() => showGoTo(), 0); // after this box has closed
  else {
    reveal('editor');
    if (!editor.runKey(keys, IS_MAC)) notify('Open a file in the editor first.', 'info');
  }
}

// A shared project as it is now: the text of its shared file, and its binary
// files from the plain ones (those this account may read).
function sharedSnapshot(doc: Y.Doc, plain: Project): Project {
  const files: ProjectFile[] = [];
  for (const entry of sharedFiles(doc)) {
    if (entry.text) files.push({ path: entry.path, content: entry.text.toString() });
    else {
      const file = plain.files.find((f) => f.driveId === entry.driveId || f.path === entry.path);
      if (file) files.push({ path: entry.path, content: file.content });
    }
  }
  return { ...plain, files };
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

// Edits this browser kept for the project before it became shared (made
// offline on this computer, say): they join it as copies, so nothing is lost
// and nothing written over.
async function keepDraftsFromBeforeSharing(shared: SharedSync): Promise<void> {
  try {
    const old = (await browserDrafts.list()).filter((d) => d.accountId === accountId && d.projectId === shared.ids.folderId);
    for (const draft of old) {
      const now = shared.project.files.find((f) => f.path === draft.path)?.content;
      if (now !== draft.content) {
        const path = draft.path.replace(/(\.[^./]+)?$/, (extension) => ` (not saved before sharing)${extension}`);
        await shared.addFile(path, draft.content);
        notify(`${draft.path} had edits on this computer from before the project was shared. They are kept as ${path}.`, 'info');
      }
      await browserDrafts.remove(draft);
    }
  } catch (error) {
    console.warn('Could not look at the edits kept from before sharing', error);
  }
}

// "Share…" in the project menu: the People panel. The owner sees who has
// access, invites people to edit or to view, changes that, or removes
// someone; everyone else sees the list. The first invitation makes the
// project a shared one (see sharing.ts). Google emails the link to join.
const peopleDialog = element<HTMLDialogElement>('#people-dialog');
const peopleList = element<HTMLUListElement>('#people-list');
const peopleNote = element<HTMLParagraphElement>('#people-note');
const inviteForm = element<HTMLFormElement>('#invite-form');
const inviteEmail = element<HTMLInputElement>('#invite-email');
const inviteRole = element<HTMLSelectElement>('#invite-role');
const copyJoinLinkButton = element<HTMLButtonElement>('#copy-join-link');

// Whether this browser may change the open project's files.
const canChange = (): boolean => sync !== null && !(sync instanceof SharedSync && sync.readOnly);
// Whether this browser's account owns the open project (and so manages who has access).
const ownsProject = (): boolean => sync instanceof ProjectSync || (sync instanceof SharedSync && sync.isOwner);

// A project of one's own in the shared format (see sharing.ts): for sharing
// it, or for comments, which live in the shared document. Its .tex files stay
// as they are; Tilde adds three files of its own to the folder.
async function toSharedFormat(current: ProjectSync): Promise<SharedSync> {
  await current.saveNow();
  if (current.hasUnsaved()) throw new Error('Save the project first: some edits have not reached Google Drive yet.');
  const loaded = await makeShared(googleDrive, current.project);
  showProject(null, { loaded, plain: current.project });
  if (!(sync instanceof SharedSync)) throw new Error('Could not open the project in the shared format.');
  return sync;
}

// The first comment in a project of one's own: comments are kept in the
// shared format, so the project changes to it (nothing else changes for the user).
async function turnOnComments(): Promise<SharedSync | null> {
  const current = sync;
  if (!(current instanceof ProjectSync)) return null;
  const path = activePath;
  showBusy('Turning on comments…');
  try {
    const shared = await toSharedFormat(current);
    if (path) openFile(path);
    hideBusy();
    notify('Comments are on for this project. Tilde keeps them in files of its own that it added to the project\'s folder '
      + '("Tilde shared project.tilde", "Tilde mailbox.tilde" and "Tilde uploads"); your .tex files stay as they are.', 'info');
    return shared;
  } catch (error) {
    showError(error);
    return null;
  }
}

async function openPeople(): Promise<void> {
  const current = sync;
  if (!current?.project.driveId) return;
  element<HTMLElement>('#people-title').textContent = `People in "${current.project.name}"`;
  const owner = ownsProject();
  inviteForm.hidden = !owner;
  copyJoinLinkButton.hidden = !(current instanceof SharedSync);
  peopleNote.textContent = owner
    ? current instanceof SharedSync ? 'Changes here change who may open the project\'s folder in your Google Drive.'
      : 'Inviting someone makes this a shared project: edits from everyone merge by themselves.'
    : 'Only the owner can invite people or change who has access. Ask them.';
  peopleList.replaceChildren();
  inviteEmail.value = '';
  if (!peopleDialog.open) peopleDialog.showModal();
  await renderPeople();
}

async function renderPeople(): Promise<void> {
  const current = sync;
  if (!current?.project.driveId) return;
  const owner = ownsProject();
  const folderId = current.project.driveId;
  let people: Person[];
  try {
    // The owner's Tilde may read the folder's list; others read it on the shared file, which has the same people.
    people = await peopleOf(googleDrive, owner || !(current instanceof SharedSync) ? folderId : current.stateFileId);
  } catch (error) {
    showError(error);
    return;
  }
  if (sync !== current) return;
  peopleList.replaceChildren(...people.map((person) => {
    const item = document.createElement('li');
    const face = avatar(person.name, person.email ?? person.name, person.photo);
    const who = document.createElement('span');
    who.className = 'who';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = person.name;
    who.append(name);
    if (person.email && person.email !== person.name) {
      const email = document.createElement('span');
      email.className = 'email';
      email.textContent = person.email;
      who.append(email);
    }
    item.append(face, who);
    const label = { owner: 'Owner', writer: 'Can edit', commenter: 'Can comment', reader: 'Can view' }[person.role] ?? person.role;
    if (!owner || person.role === 'owner' || !person.user) {
      const role = document.createElement('span');
      role.className = 'role';
      role.textContent = label;
      item.append(role);
    } else {
      const box = document.createElement('span');
      box.className = 'select-box';
      const role = document.createElement('select');
      role.setAttribute('aria-label', `What ${person.name} may do`);
      for (const [value, text] of [['writer', 'Can edit'], ['reader', 'Can view']]) role.add(new Option(text, value, false, value === person.role));
      role.addEventListener('change', () => void changeRole(folderId, person, role.value === 'reader' ? 'reader' : 'writer'));
      box.append(role);
      const remove = document.createElement('button');
      remove.className = 'quiet';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => void removePerson(folderId, person));
      item.append(box, remove);
    }
    return item;
  }));
}

// With drive.file, Google changes who may open a folder only while this Tilde
// may open every file in it. Files co-authors added (images, say) need
// "Allow" first: if Google names one, the user picks them, and the change is
// tried again. Resolves false if the user stops.
async function changeSharing(change: () => Promise<void>): Promise<boolean> {
  try {
    await change();
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const child = /appNotAuthorizedToChild/.test(message) ? /child file ([\w-]+)/.exec(message)?.[1] : undefined;
    if (!child) throw error;
    const ids = new Set([child, ...(sync instanceof SharedSync ? sync.missing.keys() : [])]);
    const count = ids.size === 1 ? 'a file' : `${ids.size} files`;
    if (!await askConfirm(`Google lets Tilde change who may open this project only once you allow ${count} that a co-author added. `
      + 'In the next window, select everything shown and click Select.', 'Allow')) return false;
    peopleDialog.close(); // the picker cannot be used while this window is open
    if (!await readyForPicker()) return false;
    const picked = await openPicker('Select these files, then click Select', true, (view) => view.setFileIds([...ids].join(',')));
    if (sync instanceof SharedSync) void sync.retryMissing();
    void openPeople();
    if (picked.length === 0) return false;
    return changeSharing(change); // a file added another way may still be missing
  }
}

async function changeRole(folderId: string, person: Person, role: Role): Promise<void> {
  try {
    if (!await changeSharing(() => googleDrive.setRole(folderId, person.permissionId, role))) {
      await renderPeople();
      return;
    }
    notify(role === 'reader' ? `${person.name} can view the project now, not change it.` : `${person.name} can edit the project now.`);
  } catch (error) {
    showError(error);
  }
  await renderPeople();
}

async function removePerson(folderId: string, person: Person): Promise<void> {
  if (!await askConfirm(`Remove ${person.name}? Their Tilde can no longer open the project. What they wrote stays in it.`, 'Remove')) return;
  try {
    if (await changeSharing(() => googleDrive.removePermission(folderId, person.permissionId))) notify(`Removed ${person.name}.`);
  } catch (error) {
    showError(error);
  }
  await renderPeople();
}

async function inviteFromPanel(): Promise<void> {
  const current = sync;
  const email = inviteEmail.value.trim();
  const role: Role = inviteRole.value === 'reader' ? 'reader' : 'writer';
  if (!current?.project.driveId || !email) return;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    notify(`"${email}" is not an email address.`, 'error');
    return;
  }
  try {
    const count = peopleCount(await peopleOf(googleDrive, current.project.driveId));
    if (count >= MAX_PEOPLE && !await askConfirm(`${count} people have access already. Tilde is made for up to ${MAX_PEOPLE} people in one project; `
      + 'with more, edits may take longer to reach everyone. Invite them anyway?', 'Invite')) return;
    if (current instanceof ProjectSync) {
      if (!await askConfirm(`Sharing makes "${current.project.name}" a shared project: Tilde adds three of its own files to the project's folder `
        + 'in your Drive, and edits from everyone merge by themselves. Your .tex files stay in the folder as before.', 'Share')) return;
      showBusy(`Sharing ${current.project.name}…`);
      await toSharedFormat(current);
    } else {
      showBusy('Sharing…');
    }
    const shared = project;
    if (!shared?.driveId) return;
    const driveId = shared.driveId;
    hideBusy();
    if (!await changeSharing(() => invite(googleDrive, shared, email, myName, joinLink(driveId), role))) return;
    inviteEmail.value = '';
    notify(`Shared with ${email}${role === 'reader' ? ', to view' : ''}. Google emails them a link to join.`);
    await openPeople();
  } catch (error) {
    showError(error);
  }
}

// Opening a join link: the user chooses the shared project's files once in
// the Picker, which is what lets their Tilde read them (drive.file).
async function joinProject(folderId: string): Promise<void> {
  if (!rootId) return;
  const id = rootId;
  if (driveFolders.some((f) => f.id === folderId)) {
    await openProjectById(folderId); // their own project, or one they joined before
    return;
  }
  if (!await askConfirm('A LaTeX project was shared with you. To open it, choose its files once: in the next window, select everything '
    + '(Ctrl+A, or Cmd+A on a Mac), then click Select.', 'Choose the files')) return;
  try {
    if (!await readyForPicker()) return;
    const picked = await openPicker('Select everything in this folder, then click Select', true, (view) => view
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setParent(folderId));
    if (picked.length === 0) return;
    showBusy('Opening the shared project…');
    const { loaded, ids, missing } = await joinFromPicked(googleDrive, picked.map((p) => p.id));
    if (missing.length > 0) {
      notify(`${missing.join(' and ')} ${missing.length === 1 ? 'was' : 'were'} not among the chosen files, so you will not see who else is here `
        + 'or be able to add images. Open the link again and select everything.', 'error');
    }
    const name = loaded.doc.getMap<string>('project').get('name') ?? 'Shared project';
    await rememberJoined(googleDrive, id, { folderId: ids.folderId, stateId: loaded.stateId, name });
    driveFolders = await listAllProjects(id);
    await sync?.saveNow();
    const editable = await googleDrive.canEdit(loaded.stateId);
    showProject(null, { loaded, viewOnly: !editable });
    showProjectsPage(false);
    hideBusy();
    notify(editable ? `Joined ${name}. Edits from everyone show up here within a few seconds.`
      : `Joined ${name}, to view. You can read and compile it; edits from others show up here within a few seconds.`);
  } catch (error) {
    showError(error);
  }
}

// A shared project to open: its document, and for its owner the plain files in its folder.
interface SharedOpen {
  loaded: LoadedShared;
  plain?: Project;
  viewOnly?: boolean; // shared with this account as "can view"
}

// `localId`: a project kept in this browser (see localProjects.ts), not in Drive.
function showProject(plainProject: Project | null, shared?: SharedOpen, localId?: string): void {
  sync?.close();
  facesView.hidden = true;
  // An "Allow" notice belongs to the project it was about.
  missingNotice?.remove();
  missingNotice = null;
  missingShown = '';
  if (shared) {
    sync = new SharedSync(googleDrive, browserShared, accountId, { name: myName, photo: myPhoto }, shared.loaded, {
      stateChanged: showSyncState,
      fileReplaced: () => {},
      filesChanged: showDriveChanges,
      peopleChanged: showPeople,
      missingChanged: showMissing,
      notice: (text) => notify(text, 'info'),
    }, shared.plain, typeof RTCPeerConnection === 'undefined' ? undefined : webrtcLink);
    // A viewer (from the start, or since the owner changed it) may be allowed to edit later.
    const folderId = sync.ids.folderId;
    sync.onCanEdit = () => {
      notify('The owner lets you edit this project now.');
      void openProjectById(folderId);
    };
    if (shared.viewOnly) sync.viewOnly();
    else void keepDraftsFromBeforeSharing(sync);
  } else if (localId && plainProject) {
    sync = new LocalSync(browserLocal, localId, plainProject, showSyncState);
  } else {
    sync = plainProject?.driveId
      ? new ProjectSync(googleDrive, browserDrafts, accountId, plainProject, {
        stateChanged: showSyncState,
        fileReplaced: (path, content) => editor.replace(path, content),
        filesChanged: showDriveChanges,
      })
      : null;
  }
  const newProject = sync?.project ?? plainProject;
  project = newProject;
  collapsedFolders = new Set();
  projectNameLabel.textContent = newProject?.name ?? '';
  projectsButton.hidden = !newProject;
  pdfStamp = null;
  lastCompileFailed = false;
  showFreshness();
  editor.clear();
  editor.setReadOnly(!canChange() && sync !== null);
  activePath = null;
  pdfViewer.clear();
  syncTex = null;
  buildFiles = [];
  buildKey = '';
  showEmptyPdf('Press Update PDF, or Ctrl/Cmd+S, to see the PDF here.');
  cursorPosition.textContent = '';
  showProblems([]);
  showSyncState();
  renderTree();
  commentsUi.attach(sync instanceof SharedSync ? sync : null, { name: myName, account: accountId, photo: myPhoto });
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

// Who else has the shared project open: their faces in the top bar, ringed
// in the colour of their cursor, with a green dot while connected directly.
// A click goes to their cursor.
function showPeople(): void {
  const faces = sync instanceof SharedSync ? sync.faces : [];
  facesView.hidden = faces.length === 0;
  facesView.replaceChildren(...faces.map((face) => {
    const button = document.createElement('button');
    button.className = face.live ? 'face live' : 'face';
    button.style.setProperty('--ring', colorFor(face.account));
    button.title = face.live ? `${face.name}: connected, typing shows at once. Click to go to their cursor.`
      : `${face.name}: here, with edits arriving through Google Drive a few seconds behind.`;
    button.setAttribute('aria-label', button.title);
    button.append(avatar(face.name, face.account, face.photo));
    button.addEventListener('click', () => goToCursorOf(face));
    return button;
  }));
}

function goToCursorOf(face: Face): void {
  const place = sync instanceof SharedSync ? sync.cursorOf(face.account) : null;
  if (!place) {
    notify(face.live ? `${face.name} has no cursor in a file right now.`
      : `${face.name}'s cursor shows once your browsers are connected directly.`, 'info');
    return;
  }
  if (place.path !== activePath) openFile(place.path);
  reveal('editor');
  editor.goToOffset(place.offset);
}

// Images and other files someone else added to the shared project, which
// this browser may only read once the user allows them in the Picker.
let missingShown = '';
let missingNotice: HTMLElement | null = null;
function showMissing(): void {
  renderTree();
  const shared = sync instanceof SharedSync ? sync : null;
  const key = shared ? [...shared.missing.keys()].sort().join(',') : '';
  if (key === missingShown) return; // asked already
  // Files that arrived meanwhile (from a co-author's browser, say) need no asking any more.
  missingNotice?.remove();
  missingNotice = null;
  missingShown = key;
  if (!shared || shared.missing.size === 0) return;
  const paths = [...shared.missing.values()];
  missingNotice = notify(`${paths.join(', ')} ${paths.length === 1 ? 'was' : 'were'} added by someone else. Google lets Tilde read ${paths.length === 1 ? 'it' : 'them'} once you allow it, here or next to ${paths.length === 1 ? 'it' : 'them'} under Files.`,
    'info', { label: 'Allow', run: () => void allowMissing(shared) });
}

async function allowMissing(shared: SharedSync): Promise<void> {
  try {
    if (!await readyForPicker()) return;
    const ids = [...shared.missing.keys()];
    const picked = await openPicker('Select these files, then click Select', true, (view) => view.setFileIds(ids.join(',')));
    if (picked.length === 0) return;
    missingShown = '';
    await shared.retryMissing();
    if (shared.missing.size === 0) notify('Allowed. The files are in the project now.');
  } catch (error) {
    showError(error);
  }
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
  commentsUi.refresh();
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
  showFreshness(); // others' edits may have arrived
  syncButton.hidden = !sync;
  if (!sync) return;
  if (sync instanceof LocalSync) {
    // Not in Drive: the button offers to put it there.
    const failed = sync.state === 'error';
    syncButton.textContent = failed ? 'Not kept in this browser' : 'Only in this browser · Save to Google Drive';
    syncButton.className = failed ? 'error' : 'local';
    syncButton.title = failed ? sync.errorMessage : 'This project is kept only in this browser, which may clear it '
      + '(Safari does after seven days without a visit). Save it to your Google Drive to keep it safe and open it on other computers.';
    syncButton.disabled = false;
    return;
  }
  const viewOnly = sync instanceof SharedSync && sync.readOnly;
  if (viewOnly !== editor.isReadOnly) {
    editor.setReadOnly(viewOnly); // the owner changed this account's access meanwhile
    renderTree();
  }
  syncButton.textContent = viewOnly ? 'View only' : SYNC_TEXT[sync.state];
  syncButton.className = viewOnly ? 'viewonly' : sync.state;
  syncButton.title = viewOnly ? 'You may read and compile this project. To change it, ask its owner to let you edit.'
    : sync.state === 'error' ? sync.errorMessage : '';
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
  if (!file || !sync || sync instanceof LocalSync) return;
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
    let profile;
    [accountId, profile] = await Promise.all([googleDrive.whoAmI(), googleDrive.myProfile()]);
    myName = profile.name;
    myPhoto = profile.photo;
    // Unsaved edits left in this browser by another Google account are deleted.
    await forgetOtherAccounts(browserDrafts, accountId)
      .catch((error: unknown) => console.warn('Could not clean up the copies kept in the browser', error));
    for (const copy of await browserShared.list().catch(() => [])) {
      if (copy.accountId !== accountId) await browserShared.remove(copy.accountId, copy.projectId).catch(() => {});
    }
    const folder = await projectsFolder(googleDrive);
    rootId = folder.id;
    rootName = folder.name;
    showAccount('signed-in');
    await showDriveProjects();
    hideBusy();
    const join = pendingJoin();
    if (join) await joinProject(join);
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
    const shared = await Promise.all((await browserShared.list()).map(sharedDrafts));
    unsavedAtSignOut = [...await browserDrafts.list(), ...shared.flat()];
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

// The text files of a shared project's unsaved copy, to offer for download like drafts.
// Only the files whose text Drive's shared file does not have yet (all of
// them if Drive cannot be asked, offline say).
async function sharedDrafts(copy: SharedCopy): Promise<Draft[]> {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, copy.update);
  let inDrive: Map<string, string> | null = null;
  try {
    const stateId = joinedById.get(copy.projectId)?.stateId ?? await sharedStateIn(googleDrive, copy.projectId);
    if (stateId) inDrive = new Map(sharedFiles((await loadShared(googleDrive, stateId)).doc).map((e) => [e.path, e.text?.toString() ?? '']));
  } catch {
    // Not reachable: list them all.
  }
  return sharedFiles(doc).flatMap((entry) => (entry.text && inDrive?.get(entry.path) !== entry.text.toString()
    ? [{ accountId: copy.accountId, projectId: copy.projectId, projectName: copy.projectName, path: entry.path, content: entry.text.toString() }]
    : []));
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
    await browserShared.clear();
    localStorage.removeItem(LAST_PROJECT_KEY);
  } catch (error) {
    console.warn('Could not clean up the copies kept in the browser', error);
  }
  notify(localProjects.length > 0 ? 'Signed out. Nothing of your Google account is kept in this browser; the projects you started '
    + 'without signing in stay here.' : 'Signed out. Nothing of yours is kept in this browser.');
}

// Runs when the "New project" dialog closes with the Create button.
async function createFromDialog(): Promise<void> {
  if (!rootId) return;
  const name = newProjectName.value.trim();
  const [kind, id] = chosenTemplate.split(':');
  const own = kind === 'own' ? starterList.find((s) => s.id === id) : undefined;
  if (own) {
    try {
      showBusy(`Reading the starter ${own.name}…`);
      await createAndOpen(name, await starterFiles(googleDrive, own), own.mainFile);
    } catch (error) {
      showError(error);
    }
    return;
  }
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
  editorPath.textContent = path;
  editorPath.title = path;

  if (isTextFile(path) && typeof file.content === 'string') {
    imagePreview.hidden = true;
    editorElement.hidden = false;
    editor.open(path, file.content);
    if (sync instanceof SharedSync) commentsUi.refresh(); // where the comments are in the text now
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
  // Files someone else added that this browser may not read yet: shown faded, with "Allow".
  const waiting = new Set(sync instanceof SharedSync ? [...sync.missing.values()].filter((path) => !project?.files.some((f) => f.path === path)) : []);
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
        if (canChange()) row.append(moreButton(node.name, () => showFolderMenu(row, node.path)));
        item.append(row);
        if (!collapsed) item.append(toList(node.children));
      } else if (waiting.has(node.path)) {
        // A file someone else added, which this browser may read once allowed.
        const row = document.createElement('div');
        row.className = 'row waiting';
        const name = document.createElement('span');
        name.className = 'open-file';
        name.title = `${node.path} was added by someone else. Google lets Tilde read it once you allow it.`;
        name.append(icon(iconFor(node.path)), node.name);
        const allow = document.createElement('button');
        allow.className = 'allow';
        allow.textContent = 'Allow';
        allow.title = name.title;
        allow.addEventListener('click', () => { if (sync instanceof SharedSync) void allowMissing(sync); });
        row.append(name, allow);
        item.append(row);
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
        if (canChange()) {
          const more = moreButton(node.name, () => showFileMenu(more, node.path));
          row.append(more);
        }
        item.append(row);
      }
      list.append(item);
    }
    return list;
  };
  treeView.replaceChildren(toList(buildTree([...(project?.files.map((f) => f.path) ?? []), ...waiting])));

  // Adding files is for Drive projects; the examples stay as they are.
  addFilesButton.hidden = !canChange();
  projectActionsButton.hidden = !project;
  goToButton.hidden = !project;
  sharePdfButton.hidden = !project?.driveId;
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
  showFreshness();
  // The browser's spell checker follows the document's language (babel, polyglossia).
  const language = project ? documentLanguage(project.files) : null;
  if (language) editorElement.lang = language;
  else editorElement.removeAttribute('lang');
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
  setIcon(more, 'more');
  more.title = `Actions for ${name}`;
  more.setAttribute('aria-label', more.title); // screen readers would read only "⋯"
  more.setAttribute('aria-haspopup', 'menu');
  more.addEventListener('click', onClick);
  return more;
}

// The "⋯" menu of a folder in the tree.
function showFolderMenu(anchor: HTMLElement, dir: string): void {
  openMenu(anchor.querySelector('.file-menu') ?? anchor, [
    { label: 'New file here…', action: () => void newFile(dir) },
    { label: 'Upload here…', action: () => chooseUploads(dir) },
    ...(project?.driveId ? [{ label: 'Add from Google Drive here…', action: () => void addFromDrive(dir) }] : []),
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
  if (!projectSync || projectSync instanceof LocalSync || !file?.safeCopy || typeof file.content !== 'string') return;
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

async function addLocalFont(wanted = ''): Promise<void> {
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
  fontSearch.value = wanted; // from a "font cannot be found" problem: that font
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
    ...(project?.driveId ? [{ label: 'Add from Google Drive…', action: () => void addFromDrive() }] : []),
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
  if (!projectSync || projectSync instanceof LocalSync) return;
  try {
    let picked = await pickUsableFiles('Pick files to add to this project', projectSync.project.driveId);
    if (picked.length === 0) return;
    if (projectSync instanceof SharedSync) {
      // The plain files in a shared project's folder are copies of its text, kept by the owner's Tilde: not new files.
      const already = picked.filter((f) => projectSync.belongs(f.id));
      if (already.length > 0) notify(`${already.map((f) => f.name).join(', ')} ${already.length === 1 ? 'is' : 'are'} part of this shared project already.`, 'info');
      await addFiles(picked.filter((f) => !projectSync.belongs(f.id)).map((file) => ({ name: file.name, read: () => googleDrive.download(file.id) })), folder);
      return;
    }
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
  // A shared project's file is deleted for everyone, into "Recently deleted" for 30 days.
  const shared = projectSync instanceof SharedSync;
  const question = shared ? `Delete ${path}? It waits in ⋯ → Recently deleted for 30 days, where anyone in the project can bring it back.`
    : `Delete ${path}? It goes to the trash in your Google Drive, where you can restore it for 30 days.`;
  const done = shared ? `Deleted ${path}.` : `Deleted ${path}. You can restore it from the trash in Google Drive for 30 days.`;
  if (!await askConfirm(question, 'Delete')) return;
  if (await runFileAction(`Deleting ${path}`, done, () => projectSync.deleteFile(path))) {
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
    if (pdfContainer.querySelector('.engine')) showEmptyPdf('The TeX engine is ready. Press Update PDF, or Ctrl/Cmd+S, to see the PDF here.');
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
  if (compiling) {
    // Compile button or Ctrl/Cmd+S during a compile: a full one follows.
    if (kind === 'full') {
      compileAgain = 'full';
      againIsFollowUp = false;
    }
    return;
  }
  if (!project) return;
  // The project being compiled. If another one is opened meanwhile, this
  // compile's PDF, log and build files are thrown away.
  const compiled = project;
  const stale = (): boolean => project !== compiled;
  const mainPath = findMainFile(compiled);
  const main = compiled.files.find((f) => f.path === mainPath);
  if (!main || typeof main.content !== 'string') {
    notify('This project has no .tex file with \\documentclass to compile.', 'error');
    return;
  }

  compiling = true;
  await engineFree; // a formula being typeset for the maths preview finishes first
  const stamp = sourceStamp(compiled.files); // what this compile's PDF is made from
  compileButton.setAttribute('aria-busy', 'true');
  compileLabel.textContent = 'Updating…';
  showFreshness();
  preview.classList.add('compiling');
  try {
    const currentRunner = await getRunner();
    if (pdfContainer.querySelector('.engine')) showEmptyPdf('');
    // XeLaTeX for fontspec and Unicode fonts, pdfLaTeX for everything else.
    const engineName = texEngine(compiled.files, main.path);
    const engine = engineName === 'xelatex' ? new XeLatex(currentRunner)
      : engineName === 'lualatex' ? new LuaLatex(currentRunner) : new PdfLatex(currentRunner);
    const withEngine = { pdflatex: '', xelatex: ' with XeLaTeX', lualatex: ' with LuaLaTeX' }[engineName];
    const key = `${main.path}|${engineName}`;
    const quick = kind === 'quick' && buildFiles.length > 0 && buildKey === key;
    setStatus(`Compiling${withEngine}…`);
    const started = performance.now();
    // EPS images as PDFs (XeLaTeX converts them another way, which cannot run here).
    let epsPdfs: ProjectFile[] = [];
    if (convertEps && engineName !== 'xelatex' && compiled.files.some((f) => isEps(f.path))) {
      setStatus('Converting EPS images…');
      const converted = await convertEpsImages(compiled.files);
      epsPdfs = converted.files;
      if (converted.failed.length > 0) notify(`Could not convert ${converted.failed.join(', ')}.`, 'error');
      setStatus(`Compiling${withEngine}…`);
    }
    const options = {
      input: main.content,
      mainTexPath: main.path,
      additionalFiles: [...compiled.files.filter((f) => f !== main), ...epsPdfs, ...(quick ? buildFiles : [])],
      // Biber for biblatex, BibTeX for natbib and \bibliography.
      bibtex: !quick && bibliographyTool(compiled.files) === 'bibtex',
      biber: !quick && bibliographyTool(compiled.files) === 'biber',
      rerun: !quick, // run LaTeX again so references and citations resolve
      remoteEndpoint: PACKAGE_SERVER,
      shellHandlerScripts: engineScript(keepGoing),
    };
    let result = await engine.compile(options);
    // When LaTeX stops at an error, Biber fails after it, and the engine
    // then keeps only Biber's log (it counts Biber as a LaTeX run), so the
    // error is lost. One LaTeX run without Biber shows it again.
    if (!result.success && options.biber && !lastLatexLog(result.logs)) {
      result = await engine.compile({ ...options, biber: false, rerun: false });
    }
    // After an error, a single LaTeX run (a quick compile) can still report
    // success, with an empty PDF.
    const pdf = result.success && result.pdf && result.pdf.length > 0 ? result.pdf : null;
    const problems = parseLog(lastLatexLog(result.logs), compiled.files);
    const errors = problems.filter((p) => p.level === 'error').length;
    // Keep this compile's build files for the next quick one, if it made a
    // PDF without errors; after an error they may be cut short, so the next
    // compile is a full one.
    try {
      const kept = pdf && errors === 0 ? keptBuildFiles(await currentRunner.readProjectFiles(ENGINE_PROJECT_DIR), new Set(compiled.files.map((f) => f.path))) : [];
      if (stale()) return;
      buildFiles = kept;
      buildKey = key;
    } catch (error) {
      buildFiles = [];
      console.warn('Could not keep the build files', error);
    }
    const next = quick && pdf ? afterQuickCompile(lastLatexLog(result.logs)) : null;
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

    if (stale()) return;
    showProblems(problems);
    const warnings = problems.filter((p) => p.level === 'warning').length;
    if (pdf) {
      try {
        syncTex = result.synctex ? SyncTex.read(result.synctex) : null;
      } catch (error) {
        syncTex = null;
        console.warn('Could not read the SyncTeX file', error);
      }
      await pdfViewer.show(pdf);
      if (stale()) return;
      pdfStamp = stamp;
      // With "Show all errors", a PDF can come with errors: the dot stays red.
      lastCompileFailed = errors > 0;
      setStatus(errors > 0 ? `Compiled${withEngine} in ${seconds} s with ${errors} error${errors > 1 ? 's' : ''}; the PDF may be incomplete`
        : `Compiled${withEngine} in ${seconds} s` + (warnings > 0 ? `, ${warnings} warning${warnings > 1 ? 's' : ''}` : ''));
    } else if (errors > 0) {
      lastCompileFailed = true;
      setStatus(`Compile stopped at an error after ${seconds} s`);
      if (!pdfContainer.querySelector('canvas')) showEmptyPdf('The PDF appears here once the error below is fixed.');
    } else {
      logView.hidden = false;
      setStatus(`Compile failed after ${seconds} s. The log has the details.`);
    }
  } catch (error) {
    if (!stale()) {
      setStatus('');
      showError(error);
    }
  } finally {
    compiling = false;
    compileButton.removeAttribute('aria-busy');
    compileLabel.textContent = 'Update PDF';
    showFreshness();
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
    // A font the browser could not find by name: copy it from this computer (Chrome and Edge).
    const font = /The font "([^"]+)" cannot be found/.exec(problem.message)?.[1];
    if (font && window.queryLocalFonts && canChange()) {
      const add = document.createElement('button');
      add.className = 'problem-action';
      add.textContent = `Add ${font} from this computer`;
      add.addEventListener('click', () => void addLocalFont(font));
      item.append(add);
    }
    // An EPS image LaTeX could not convert: turn on converting EPS images.
    if (/-eps-converted-to\.pdf' not found/.test(problem.message) && !convertEps) {
      const convert = document.createElement('button');
      convert.className = 'problem-action';
      convert.textContent = 'Convert EPS images in this browser';
      convert.addEventListener('click', () => setConvertEps(true));
      item.append(convert);
    }
    return item;
  }));
  problemsPanel.hidden = problems.length === 0;
  problemsTitle.textContent = `Problems (${problems.length})`;
  const errors = problems.filter((p) => p.level === 'error').length;
  const warnings = problems.filter((p) => p.level === 'warning').length;
  const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : word.endsWith('x') ? 'es' : 's'}`;
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
goToButton.addEventListener('click', () => showGoTo());
projectActionsButton.addEventListener('click', () => openMenu(projectActionsButton, [
  ...(project?.driveId ? [{ label: 'Share…', action: () => void openPeople() }] : []),
  // A project kept in this browser: the actions its row has above the Drive projects.
  ...(sync instanceof LocalSync ? [
    { label: 'Save to Google Drive', action: () => void saveLocalToDrive() },
    { label: 'Rename…', action: () => void withOpenLocal(renameLocal) },
    { label: 'Delete…', action: () => void withOpenLocal(deleteLocal), danger: true },
  ] : []),
  { label: 'Download as .zip', action: () => void downloadProjectZip() },
  { label: 'Download for arXiv…', action: () => void downloadForArxiv() },
  ...(sync instanceof SharedSync && canChange() ? [{ label: 'Recently deleted…', action: () => showRecentlyDeleted() }] : []),
  ...(rootId && project?.driveId ? [
    { label: 'Make a copy…', action: () => void copyProject(project?.driveId) },
    { label: 'Save as a starter…', action: () => void saveAsStarter() },
  ] : []),
  { label: 'All projects', action: () => showProjectsPage(true) },
]));
const commentsToggle = element<HTMLButtonElement>('#comments-toggle');
commentsToggle.addEventListener('click', () => {
  const open = commentsToggle.getAttribute('aria-expanded') !== 'true';
  commentsToggle.setAttribute('aria-expanded', String(open));
  element<HTMLElement>('#comment-list').hidden = !open;
});
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
sharePdfButton.addEventListener('click', () => void sharePdfMenu());
showInPdfButton.addEventListener('click', showInPdf);
pageNumber.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  pdfViewer.goToPage(Number(pageNumber.value) || 1);
  pageNumber.blur();
});
pageNumber.addEventListener('focus', () => pageNumber.select());
// The arrow next to Update PDF: compiling as you type, and two options for
// the engine (all errors instead of the first, EPS images).
element<HTMLButtonElement>('#compile-menu').addEventListener('click', (event) => openMenu(event.currentTarget as HTMLElement, [
  { label: 'Update the PDF now (Ctrl/Cmd+S)', action: () => void compile() },
  { label: 'Compile as you type', checked: autoCompile, action: () => {
    autoCompile = !autoCompile;
    try { localStorage.setItem(AUTO_COMPILE_KEY, String(autoCompile)); } catch { /* not remembered */ }
    notify(autoCompile ? 'The PDF now updates a moment after you stop typing.' : 'The PDF updates when you press Update PDF or Ctrl/Cmd+S.');
    if (autoCompile) void compile();
  } },
  { label: 'Show all errors', checked: keepGoing, action: () => {
    keepGoing = !keepGoing;
    remember(KEEP_GOING_KEY, keepGoing);
    notify(keepGoing ? 'LaTeX now goes on after an error, so the problems list shows all of them and the PDF shows how far it got. '
      + 'Fix the first error first: later ones can be caused by it.' : 'LaTeX now stops at the first error.');
    void compile();
  } },
  // Only where it matters: a project with EPS images, or when it is on.
  ...(convertEps || project?.files.some((f) => isEps(f.path)) ? [{ label: 'Convert EPS images', checked: convertEps, action: () => setConvertEps(!convertEps) }] : []),
]));
function remember(key: string, on: boolean): void {
  try { localStorage.setItem(key, String(on)); } catch { /* not remembered */ }
}
function setConvertEps(on: boolean): void {
  convertEps = on;
  remember(CONVERT_EPS_KEY, on);
  notify(on ? 'EPS images are now converted to PDF in this browser (pdfLaTeX and LuaLaTeX). The converter, about 15 MB, '
    + 'downloads the first time it is needed. The converted files are not saved to your Drive.' : 'EPS images are not converted any more.');
  if (on) void compile();
}
try {
  autoCompile = localStorage.getItem(AUTO_COMPILE_KEY) === 'true';
  keepGoing = localStorage.getItem(KEEP_GOING_KEY) === 'true';
  convertEps = localStorage.getItem(CONVERT_EPS_KEY) === 'true';
  const zoom = JSON.parse(localStorage.getItem(ZOOM_KEY) ?? '"width"') as Zoom;
  if (zoom === 'width' || zoom === 'page' || typeof zoom === 'number') pdfViewer.setZoom(zoom);
} catch { /* defaults */ }

// The editor's text size and whether long lines wrap, remembered in this
// browser. Ctrl/Cmd with + or − changes the size while typing in the editor
// (over the PDF, the same keys zoom the PDF); "Aa" in the status bar has both.
const EDITOR_SIZES = [11, 12, 13, 14, 15, 16, 18, 20, 22, 24];
const DEFAULT_EDITOR_SIZE = 14;
const editorLookButton = element<HTMLButtonElement>('#editor-look');
let editorSize = DEFAULT_EDITOR_SIZE;
let wrapLines = true;
try {
  const size = Number(localStorage.getItem('tilde.editorSize'));
  if (EDITOR_SIZES.includes(size)) editorSize = size;
  wrapLines = localStorage.getItem('tilde.wrapLines') !== 'false';
} catch { /* defaults */ }

function applyEditorLook(): void {
  editor.setFontSize(editorSize);
  editor.setWrap(wrapLines);
  editorLookButton.title = `Text size (${editorSize} px) and line wrapping in the editor`;
  try {
    localStorage.setItem('tilde.editorSize', String(editorSize));
    localStorage.setItem('tilde.wrapLines', String(wrapLines));
  } catch { /* not remembered */ }
}

function stepEditorSize(direction: number): void {
  const index = EDITOR_SIZES.indexOf(editorSize);
  editorSize = direction === 0 ? DEFAULT_EDITOR_SIZE : EDITOR_SIZES[Math.min(Math.max(index + direction, 0), EDITOR_SIZES.length - 1)];
  applyEditorLook();
  setStatus(`Editor text: ${editorSize} px`);
}

editorLookButton.addEventListener('click', () => openMenu(editorLookButton, [
  { label: `Text size: ${editorSize} px` },
  { label: 'Larger text (Ctrl/Cmd +)', action: () => stepEditorSize(1), disabled: editorSize === EDITOR_SIZES.at(-1) },
  { label: 'Smaller text (Ctrl/Cmd −)', action: () => stepEditorSize(-1), disabled: editorSize === EDITOR_SIZES[0] },
  { label: `Usual size (${DEFAULT_EDITOR_SIZE} px)`, action: () => stepEditorSize(0), disabled: editorSize === DEFAULT_EDITOR_SIZE },
  { label: 'Wrap long lines', checked: wrapLines, action: () => { wrapLines = !wrapLines; applyEditorLook(); } },
]));
applyEditorLook();
window.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey) || pointerOverPdf || !editorElement.contains(document.activeElement)) return;
  const direction = event.key === '+' || event.key === '=' ? 1 : event.key === '-' ? -1 : event.key === '0' ? 0 : null;
  if (direction === null) return;
  event.preventDefault();
  stepEditorSize(direction);
});

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
  rails: {
    files: element<HTMLButtonElement>('#files-rail'),
    editor: element<HTMLButtonElement>('#editor-rail'),
    pdf: element<HTMLButtonElement>('#pdf-rail'),
  },
  folds: {
    files: element<HTMLButtonElement>('#fold-files'),
    editor: element<HTMLButtonElement>('#fold-editor'),
    pdf: element<HTMLButtonElement>('#fold-pdf'),
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
syncButton.addEventListener('click', () => void (sync instanceof LocalSync ? saveLocalToDrive() : showConflict()));
logButton.addEventListener('click', () => { logView.hidden = !logView.hidden; });
// The project's name: to the project list, or back to the project from there.
projectsButton.addEventListener('click', () => showProjectsPage(projectsPage.hidden === true));
element<HTMLButtonElement>('#home').addEventListener('click', () => showProjectsPage(true));
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
// Signed in there is no footer, so the account menu has its links (the
// privacy policy, and the source code that AGPL section 13 asks to offer).
const openPage = (url: string): void => { window.open(url, '_blank', 'noopener'); };
accountButton.addEventListener('click', () => openMenu(accountButton, [
  { label: myName },
  { label: 'Privacy', action: () => openPage('privacy.html') },
  { label: 'Source code', action: () => openPage('https://github.com/birdortyedi/tilde-latex') },
  { label: 'Licenses', action: () => openPage('licenses/NOTICE.txt') },
  { label: 'Sign out', action: () => void handleSignOut(), danger: true },
]));
newProjectButton.addEventListener('click', () => {
  newProjectName.value = '';
  newProjectProblem.hidden = true;
  starterGroup = 'blank';
  chosenTemplate = 'blank';
  renderTemplateChoices();
  newProjectDialog.returnValue = '';
  newProjectDialog.showModal();
  // The user's own starters, read from Drive each time (another computer may have added one).
  if (rootId) {
    ownStarters(googleDrive, rootId).then((list) => {
      starterList = list;
      renderTemplateChoices();
    }).catch((error: unknown) => console.warn('Could not read your starters', error));
  }
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
  if (sync instanceof LocalSync) return; // never a conflict in this browser's own projects
  if (conflictDialog.returnValue === 'mine') void sync?.keepMine(conflictShown);
  if (conflictDialog.returnValue === 'drive') void sync?.keepDrive(conflictShown);
});
downloadBothButton.addEventListener('click', () => void downloadBoth());
inviteForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void inviteFromPanel();
});
element<HTMLButtonElement>('#people-done').addEventListener('click', () => peopleDialog.close());
copyJoinLinkButton.addEventListener('click', () => {
  if (project?.driveId) void copyLink(joinLink(project.driveId), 'The join link is copied. It opens the project for people who already have access.');
});
signOutDialog.addEventListener('close', () => {
  const choice = signOutDialog.returnValue;
  if (choice === 'download') {
    // One .zip: browsers often block a page's second and later downloads.
    const files = unsavedAtSignOut.map((draft) => ({ path: `${draft.projectName}/${draft.path}`, content: draft.content }));
    downloadFile('Unsaved edits.zip', zipProject('Unsaved edits', files));
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
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k' && project && projectsPage.hidden) {
    event.preventDefault();
    showGoTo();
  }
  // "?" outside the text (and outside any box to type in): the keyboard shortcuts.
  const target = event.target as HTMLElement | null;
  if (event.key === '?' && !event.ctrlKey && !event.metaKey && !event.altKey && project && projectsPage.hidden
    && !target?.closest('input, textarea, select, [contenteditable="true"], .cm-editor')) {
    event.preventDefault();
    showGoTo('?');
  }
});
element<HTMLButtonElement>('#show-shortcuts').addEventListener('click', () => showGoTo('?'));

// Save when the user leaves the tab or closes it; look for changes made
// elsewhere (for example on the other computer) when they come back.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) void sync?.saveNow();
});
window.addEventListener('pagehide', () => {
  void sync?.saveNow();
  if (sync instanceof SharedSync) sync.leave();
});
window.addEventListener('focus', () => {
  if (!(sync instanceof LocalSync)) void sync?.checkDrive();
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

// A join link (see sharing.ts) is kept in this tab until the user is signed
// in, then opens the join steps once.
const JOIN_KEY = 'tilde.join';
const linked = joinTarget(location.hash);
if (linked) {
  try { sessionStorage.setItem(JOIN_KEY, linked); } catch { /* joins only if already signed in */ }
  history.replaceState(null, '', location.pathname + location.search);
}
function pendingJoin(): string | null {
  let folderId = linked;
  try {
    folderId = sessionStorage.getItem(JOIN_KEY) ?? folderId;
    sessionStorage.removeItem(JOIN_KEY);
  } catch { /* storage blocked */ }
  return folderId;
}

void loadExamples().then(() => {
  if (restoreSignIn()) void startDrive(); // still signed in from before a reload
  else {
    showProjectsPage(true); // the welcome page, with the examples
    if (linked) notify('A LaTeX project was shared with you. Sign in with the Google account it was shared with to open it.', 'info');
  }
});
