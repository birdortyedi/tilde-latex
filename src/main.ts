import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import './style.css';
import { BusyTexRunner, PdfLatex } from 'texlyre-busytex';
import { findMainFile, groupByProject, pathProblem, type Project, type ProjectFile } from './projects';
import { buildTree, isTextFile, type TreeNode } from './fileTree';
import { Editor, type LineMark } from './editor';
import { PdfViewer, type PdfViewState } from './pdfViewer';
import type { Zoom } from './pdfZoom';
import { forgetToken, restoreSignIn, signIn, SignInNeededError, signOut } from './auth';
import { googleDrive, type DriveFile } from './drive';
import { createProject, findOrCreateRootFolder, lastEdited, listProjects, openProject } from './driveProjects';
import { browserDrafts, forgetOtherAccounts, type Draft } from './drafts';
import { ProjectSync, type SyncState } from './sync';
import { cachedPackages, REMOTE_DIR, storeNewPackages } from './packageCache';
import { lastLatexLog, parseLog, type LogProblem } from './logParser';
import { unzipProject } from './zipImport';
import { timeAgo } from './time';
import { outline } from './latex';
import { isGoogleDoc, pickDriveFiles, type PickedFile } from './picker';
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
  multifile: '\\input, \\include and an image in a folder',
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

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`index.html is missing ${selector}`);
  return found;
}

const projectsButton = element<HTMLButtonElement>('#show-projects');
const projectNameLabel = element<HTMLSpanElement>('#project-name');
const projectsPage = element<HTMLElement>('#projects-page');
const projectsHint = element<HTMLParagraphElement>('#projects-hint');
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
const exampleList = element<HTMLUListElement>('#example-list');
const backBar = element<HTMLDivElement>('#back-bar');
const backName = element<HTMLSpanElement>('#back-name');
const logButton = element<HTMLButtonElement>('#toggle-log');
const statusText = element<HTMLSpanElement>('#status');
const treeView = element<HTMLElement>('#tree');
const editorElement = element<HTMLDivElement>('#editor');
const imagePreview = element<HTMLImageElement>('#image-preview');
const logView = element<HTMLPreElement>('#log');
const addFilesButton = element<HTMLButtonElement>('#add-files');
const cursorPosition = element<HTMLSpanElement>('#cursor-position');
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
let rootId: string | null = null; // the "LaTeX Projects" folder in Drive; null while signed out
let accountId = ''; // the signed-in Google account; drafts are tagged with it
let unsavedAtSignOut: Draft[] = []; // shown in the sign-out dialog
let project: Project | null = null; // the open project; edits change its files in memory
let activePath: string | null = null;
let runner: BusyTexRunner | null = null;
let compiling = false;
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
const ZOOM_KEY = 'tilde.pdfZoom';
const AUTO_COMPILE_KEY = 'tilde.autoCompile';
const AUTO_COMPILE_DELAY = 1500; // milliseconds after the last edit

function showPdfState(state: PdfViewState): void {
  zoomLabel.textContent = state.zoom === 'width' ? 'Fit width' : state.zoom === 'page' ? 'Fit page' : `${state.percent}%`;
  const hasPdf = state.pages > 0;
  for (const button of [zoomInButton, zoomOutButton, downloadPdfButton]) button.disabled = !hasPdf;
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

function downloadPdf(): void {
  const pdf = pdfViewer.current();
  if (pdf && project) downloadFile(`${project.name}.pdf`, pdf);
}

// Auto-compile: compile by itself a moment after typing stops. A compile
// that is asked for while one runs starts right after it.
let autoCompileTimer: ReturnType<typeof setTimeout> | undefined;
let compileAgain = false;
function scheduleAutoCompile(): void {
  if (!autoCompileBox.checked) return;
  clearTimeout(autoCompileTimer);
  autoCompileTimer = setTimeout(() => {
    if (compiling) compileAgain = true;
    else void compile();
  }, AUTO_COMPILE_DELAY);
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
  if (error instanceof SignInNeededError) signInButton.hidden = false;
}

async function loadExamples(): Promise<void> {
  const binaryFiles: Record<string, Uint8Array> = {};
  for (const [path, url] of Object.entries(binaryFileUrls)) {
    binaryFiles[path] = new Uint8Array(await (await fetch(url)).arrayBuffer());
  }
  examples = groupByProject('/test-docs', { ...textFiles, ...binaryFiles });
  renderTemplateChoices();
}

// The "Start from" choices in the New project dialog: blank, or an example.
function renderTemplateChoices(): void {
  const choice = (value: string, name: string, note: string): HTMLLabelElement => {
    const label = document.createElement('label');
    label.className = 'choice';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'template';
    radio.value = value;
    radio.checked = value === '';
    const title = document.createElement('span');
    title.className = 'name';
    title.textContent = name;
    const detail = document.createElement('span');
    detail.className = 'note';
    detail.textContent = note;
    label.append(radio, title, detail);
    return label;
  };
  templateChoices.replaceChildren(
    choice('', 'Blank', 'One main.tex to start from'),
    ...examples.map((example) => choice(example.name, example.name, EXAMPLE_NOTES[example.name] ?? 'An example')),
  );
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
  if (visible) renderProjectsPage();
}

function renderProjectsPage(): void {
  const signedIn = rootId !== null;
  backBar.hidden = !project;
  backName.textContent = project?.name ?? '';
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
  projectsHint.textContent = count === 0
    ? 'Kept in the "LaTeX Projects" folder of your Google Drive.'
    : `${count} ${count === 1 ? 'project' : 'projects'} in the "LaTeX Projects" folder of your Google Drive.`;
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
      badge.textContent = 'Open now';
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

async function refreshProjects(): Promise<void> {
  if (rootId) driveFolders = await listProjects(googleDrive, rootId);
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
async function createAndOpen(name: string, files: ProjectFile[]): Promise<void> {
  if (!rootId) return;
  showBusy(`Creating ${name}…`);
  try {
    await sync?.saveNow();
    const created = await createProject(googleDrive, rootId, name, files, (done, total) => {
      showBusy(`Creating ${name}… ${done} of ${total} files`);
    });
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
async function pickUsableFiles(title: string): Promise<PickedFile[]> {
  // Brave blocks the cross-site cookies Google's Picker needs; Google then opens
  // the Picker in its own tab, from which the chosen files often never arrive.
  if ('brave' in navigator && !braveHintShown) {
    braveHintShown = true;
    notify('Brave blocks the cookies Google\'s file picker needs. If it opens in a new tab and nothing arrives, '
      + 'click the lion icon in the address bar and allow cross-site cookies for this site, then try again.', 'info');
  }
  const picked = await pickDriveFiles(title);
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
    })
    : null;
  project = newProject;
  collapsedFolders = new Set();
  projectNameLabel.textContent = newProject?.name ?? 'Tilde';
  editor.clear();
  activePath = null;
  pdfViewer.clear();
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
  if (sync.state === 'signin') signInButton.hidden = false;
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
    signInButton.hidden = true;
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
    rootId = await findOrCreateRootFolder(googleDrive);
    signInButton.hidden = true;
    signOutButton.hidden = false;
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
  signInButton.hidden = false;
  signOutButton.hidden = true;
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
  const chosen = templateChoices.querySelector<HTMLInputElement>('input:checked')?.value ?? '';
  const template = examples.find((p) => p.name === chosen);
  await createAndOpen(name, template?.files ?? BLANK_PROJECT);
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
  openMenu(anchor, [
    { label: 'Rename or move…', action: () => void renameFile(path) },
    { label: 'Duplicate…', action: () => void duplicateFile(path) },
    { label: isMain ? 'This is the main file' : 'Set as main file', action: () => void setMainFile(path), disabled: isMain || !path.endsWith('.tex') },
    { label: 'Delete…', action: () => void deleteFile(path), danger: true },
  ]);
}

// The "+" menu above the file tree.
function showAddMenu(): void {
  openMenu(addFilesButton, [
    { label: 'New file…', action: () => void newFile() },
    { label: 'Upload from this computer…', action: () => chooseUploads() },
    { label: 'Add from Google Drive…', action: () => void addFromDrive() },
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
async function addFromDrive(folder?: string): Promise<void> {
  try {
    const picked = await pickUsableFiles('Pick files to add to this project');
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

// The engine is downloaded and started only once, on the first compile.
async function getRunner(): Promise<BusyTexRunner> {
  if (runner) return runner;
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
  runner = newRunner;
  return runner;
}

async function compile(): Promise<void> {
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
    const engine = new PdfLatex(currentRunner);
    setStatus('Compiling…');
    const started = performance.now();
    const result = await engine.compile({
      input: main.content,
      mainTexPath: main.path,
      additionalFiles: project.files.filter((f) => f !== main),
      bibtex: project.files.some((f) => f.path.endsWith('.bib')),
      rerun: true, // run LaTeX again so references and citations resolve
      remoteEndpoint: PACKAGE_SERVER,
    });
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
      await pdfViewer.show(result.pdf);
      setStatus(`Compiled in ${seconds} s` + (warnings > 0 ? `, ${warnings} warning${warnings > 1 ? 's' : ''}` : ''));
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
      compileAgain = false;
      void compile();
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
  }
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
});

// Save when the user leaves the tab or closes it; look for changes made
// elsewhere (for example on the other computer) when they come back.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) void sync?.saveNow();
});
window.addEventListener('pagehide', () => void sync?.saveNow());
window.addEventListener('focus', () => void sync?.checkDrive());
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
