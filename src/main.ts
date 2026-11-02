import { BusyTexRunner, PdfLatex } from 'texlyre-busytex';
import { groupByProject, type Project, type ProjectFile } from './projects';
import { buildTree, isTextFile, type TreeNode } from './fileTree';
import { Editor } from './editor';
import { PdfViewer } from './pdfViewer';
import { forgetToken, restoreSignIn, signIn, SignInNeededError, signOut } from './auth';
import { googleDrive, type DriveFile } from './drive';
import { createProject, findOrCreateRootFolder, listProjects, openProject } from './driveProjects';
import { browserDrafts, forgetOtherAccounts, type Draft } from './drafts';
import { ProjectSync, type SyncState } from './sync';

// Files that TeX Live's basic bundle lacks (TikZ, pgfplots, ...) are fetched
// one at a time from TeXlyre's public package server.
const PACKAGE_SERVER = 'https://texlive2026.texlyre.org';
const MAIN_FILE = 'main.tex';
const LAST_PROJECT_KEY = 'tilde.lastProject'; // reopened after a reload
const BLANK_PROJECT: ProjectFile[] = [{
  path: MAIN_FILE,
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

const projectSelect = element<HTMLSelectElement>('#project');
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
const newProjectTemplate = element<HTMLSelectElement>('#new-project-template');
const logButton = element<HTMLButtonElement>('#toggle-log');
const statusText = element<HTMLSpanElement>('#status');
const treeView = element<HTMLElement>('#tree');
const editorElement = element<HTMLDivElement>('#editor');
const imagePreview = element<HTMLImageElement>('#image-preview');
const logView = element<HTMLPreElement>('#log');

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

const editor = new Editor(editorElement, (path, text) => {
  const file = project?.files.find((f) => f.path === path);
  if (!file) return;
  file.content = text;
  sync?.edited(path);
});
const pdfViewer = new PdfViewer(element<HTMLDivElement>('#pdf'));

function showError(error: unknown): void {
  statusText.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
  if (error instanceof SignInNeededError) signInButton.hidden = false;
}

async function loadExamples(): Promise<void> {
  const binaryFiles: Record<string, Uint8Array> = {};
  for (const [path, url] of Object.entries(binaryFileUrls)) {
    binaryFiles[path] = new Uint8Array(await (await fetch(url)).arrayBuffer());
  }
  examples = groupByProject('/test-docs', { ...textFiles, ...binaryFiles });
  for (const p of examples) newProjectTemplate.add(new Option(`Example: ${p.name}`, p.name));
  showExamples();
}

function showExamples(): void {
  setProjectOptions(examples.map((p) => [p.name, p.name]));
  showProject(examples[0] ?? null);
}

async function showDriveProjects(): Promise<void> {
  if (!rootId) return;
  driveFolders = await listProjects(googleDrive, rootId);
  setProjectOptions(driveFolders.map((f) => [f.id, f.name]));
  if (driveFolders.length === 0) {
    showProject(null);
    statusText.textContent = 'You have no projects in Drive yet. Click "New project".';
    return;
  }
  let last: string | null = null;
  try { last = localStorage.getItem(LAST_PROJECT_KEY); } catch { /* storage blocked */ }
  await selectProject(driveFolders.find((f) => f.id === last)?.id ?? driveFolders[0].id);
}

// Fills the project menu with [value, label] pairs.
function setProjectOptions(options: [string, string][]): void {
  projectSelect.replaceChildren(...options.map(([value, label]) => new Option(label, value)));
}

// Called when the user picks a project in the menu. Examples are already in
// memory; Drive projects are downloaded first.
async function selectProject(value: string): Promise<void> {
  projectSelect.value = value;
  if (!rootId) {
    showProject(examples.find((p) => p.name === value) ?? null);
    return;
  }
  const folder = driveFolders.find((f) => f.id === value);
  if (!folder) return;
  statusText.textContent = `Opening ${folder.name} from Drive…`;
  try {
    // Save the project we leave. Whatever cannot be saved now stays in the
    // browser and is saved the next time that project is opened.
    await sync?.saveNow();
    showProject(await openProject(googleDrive, folder));
  } catch (error) {
    projectSelect.value = project?.driveId ?? '';
    showError(error);
  }
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
  editor.clear();
  activePath = null;
  element<HTMLDivElement>('#pdf').replaceChildren();
  showSyncState();
  renderTree();
  if (!project) return;
  if (project.driveId) {
    try { localStorage.setItem(LAST_PROJECT_KEY, project.driveId); } catch { /* storage blocked */ }
  }
  statusText.textContent = `Opened ${project.name}. Press Compile or Ctrl/Cmd+S.`;
  openFile(MAIN_FILE);
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
        statusText.textContent = 'That is a different Google account. Sign in with the one you used before, or sign out first.';
        return;
      }
    } catch (error) {
      showError(error);
      return;
    }
    signInButton.hidden = true;
    statusText.textContent = 'Signed in again.';
    void sync?.saveNow();
    return;
  }
  await startDrive();
}

// After sign-in, or after a reload while still signed in: show the user's projects.
async function startDrive(): Promise<void> {
  statusText.textContent = 'Loading your projects from Drive…';
  try {
    accountId = await googleDrive.whoAmI();
    // Unsaved edits left in this browser by another Google account are deleted.
    await forgetOtherAccounts(browserDrafts, accountId)
      .catch((error: unknown) => console.warn('Could not clean up the copies kept in the browser', error));
    rootId = await findOrCreateRootFolder(googleDrive);
    signInButton.hidden = true;
    signOutButton.hidden = false;
    newProjectButton.hidden = false;
    await showDriveProjects();
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
  newProjectButton.hidden = true;
  showExamples(); // also stops saving the Drive project
  signOut();
  try {
    await browserDrafts.clear();
    localStorage.removeItem(LAST_PROJECT_KEY);
  } catch (error) {
    console.warn('Could not clean up the copies kept in the browser', error);
  }
  statusText.textContent = 'Signed out. Nothing of yours is kept in this browser.';
}

// Runs when the "New project" dialog closes with the Create button.
async function createFromDialog(): Promise<void> {
  if (!rootId) return;
  const name = newProjectName.value.trim();
  const template = examples.find((p) => p.name === newProjectTemplate.value);
  statusText.textContent = `Creating ${name} in Drive…`;
  try {
    await sync?.saveNow();
    const created = await createProject(googleDrive, rootId, name, template?.files ?? BLANK_PROJECT);
    driveFolders = await listProjects(googleDrive, rootId);
    setProjectOptions(driveFolders.map((f) => [f.id, f.name]));
    projectSelect.value = created.driveId ?? '';
    showProject(created);
  } catch (error) {
    showError(error);
  }
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
    if (imagePreview.src) URL.revokeObjectURL(imagePreview.src);
    const bytes = typeof file.content === 'string' ? new TextEncoder().encode(file.content) : file.content;
    imagePreview.src = URL.createObjectURL(new Blob([bytes.slice()]));
    imagePreview.alt = `No preview for ${path}`;
  }
  renderTree();
}

function renderTree(): void {
  const toList = (nodes: TreeNode[]): HTMLUListElement => {
    const list = document.createElement('ul');
    for (const node of nodes) {
      const item = document.createElement('li');
      if (node.children) {
        const label = document.createElement('div');
        label.className = 'folder';
        label.textContent = `${node.name}/`;
        item.append(label, toList(node.children));
      } else {
        const button = document.createElement('button');
        button.textContent = node.name;
        button.classList.toggle('active', node.path === activePath);
        button.addEventListener('click', () => openFile(node.path));
        item.append(button);
      }
      list.append(item);
    }
    return list;
  };
  treeView.replaceChildren(toList(buildTree(project?.files.map((f) => f.path) ?? [])));
}

// The engine is downloaded and started only once, on the first compile.
async function getRunner(): Promise<BusyTexRunner> {
  if (runner) return runner;
  const newRunner = new BusyTexRunner({
    busytexBasePath: `${import.meta.env.BASE_URL}core/busytex`,
    preloadDataPackages: [`${import.meta.env.BASE_URL}core/busytex/texlive-basic.js`],
    onDownloadProgress: ({ percent }) => {
      statusText.textContent = `Downloading engine… ${Math.round(percent)}%`;
    },
  });
  statusText.textContent = 'Starting engine…';
  await newRunner.initialize(true); // true = run the engine in a Web Worker
  runner = newRunner;
  return runner;
}

async function compile(): Promise<void> {
  if (compiling || !project) return;
  const main = project.files.find((f) => f.path === MAIN_FILE);
  if (!main || typeof main.content !== 'string') {
    statusText.textContent = `This project has no ${MAIN_FILE}.`;
    return;
  }

  compiling = true;
  compileButton.disabled = true;
  try {
    const engine = new PdfLatex(await getRunner());
    statusText.textContent = `Compiling ${project.name}…`;
    const started = performance.now();
    const result = await engine.compile({
      input: main.content,
      mainTexPath: MAIN_FILE,
      additionalFiles: project.files.filter((f) => f !== main),
      bibtex: project.files.some((f) => f.path.endsWith('.bib')),
      rerun: true, // run LaTeX again so references and citations resolve
      remoteEndpoint: PACKAGE_SERVER,
    });
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    logView.textContent = result.log;

    if (result.success && result.pdf) {
      await pdfViewer.show(result.pdf);
      statusText.textContent = `Compiled ${project.name} in ${seconds} s.`;
    } else {
      logView.hidden = false;
      statusText.textContent = `Compile failed after ${seconds} s. See the log.`;
    }
  } catch (error) {
    showError(error);
  } finally {
    compiling = false;
    compileButton.disabled = false;
  }
}

compileButton.addEventListener('click', () => void compile());
syncButton.addEventListener('click', showConflict);
logButton.addEventListener('click', () => { logView.hidden = !logView.hidden; });
projectSelect.addEventListener('change', () => void selectProject(projectSelect.value));
signInButton.addEventListener('click', () => void handleSignIn());
signOutButton.addEventListener('click', () => void handleSignOut());
newProjectButton.addEventListener('click', () => {
  newProjectName.value = '';
  newProjectDialog.returnValue = '';
  newProjectDialog.showModal();
});
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

void loadExamples().then(() => {
  if (restoreSignIn()) void startDrive(); // still signed in from before a reload
});
