import { BusyTexRunner, PdfLatex } from 'texlyre-busytex';
import { findMainFile, groupByProject, pathProblem, type Project, type ProjectFile } from './projects';
import { buildTree, isTextFile, type TreeNode } from './fileTree';
import { Editor, type LineMark } from './editor';
import { PdfViewer } from './pdfViewer';
import { forgetToken, restoreSignIn, signIn, SignInNeededError, signOut } from './auth';
import { googleDrive, type DriveFile } from './drive';
import { createProject, findOrCreateRootFolder, listProjects, openProject } from './driveProjects';
import { browserDrafts, forgetOtherAccounts, type Draft } from './drafts';
import { ProjectSync, type SyncState } from './sync';
import { cachedPackages, REMOTE_DIR, storeNewPackages } from './packageCache';
import { lastLatexLog, parseLog, type LogProblem } from './logParser';

// Files that TeX Live's basic bundle lacks (TikZ, pgfplots, ...) are fetched
// one at a time from TeXlyre's public package server.
const PACKAGE_SERVER = 'https://texlive2026.texlyre.org';
const LAST_PROJECT_KEY = 'tilde.lastProject'; // reopened after a reload
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
const fileActions = element<HTMLDivElement>('#file-actions');
const newFileButton = element<HTMLButtonElement>('#new-file');
const uploadButton = element<HTMLButtonElement>('#upload-files');
const uploadInput = element<HTMLInputElement>('#upload-input');
const renameButton = element<HTMLButtonElement>('#rename-file');
const duplicateButton = element<HTMLButtonElement>('#duplicate-file');
const deleteButton = element<HTMLButtonElement>('#delete-file');
const setMainButton = element<HTMLButtonElement>('#set-main-file');
const problemList = element<HTMLUListElement>('#problems');

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
  showProblems([]);
  showSyncState();
  renderTree();
  if (!project) return;
  if (project.driveId) {
    try { localStorage.setItem(LAST_PROJECT_KEY, project.driveId); } catch { /* storage blocked */ }
  }
  statusText.textContent = `Opened ${project.name}. Press Compile or Ctrl/Cmd+S.`;
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
        if (project && node.path === findMainFile(project)) {
          const label = document.createElement('span');
          label.className = 'main-file';
          label.textContent = ' (main)';
          button.append(label);
        }
        button.classList.toggle('active', node.path === activePath);
        button.addEventListener('click', () => openFile(node.path));
        item.append(button);
      }
      list.append(item);
    }
    return list;
  };
  treeView.replaceChildren(toList(buildTree(project?.files.map((f) => f.path) ?? [])));

  // File actions are for Drive projects; most of them act on the open file.
  fileActions.hidden = !sync;
  for (const button of [renameButton, duplicateButton, deleteButton]) button.disabled = !activePath;
  setMainButton.disabled = !activePath || !activePath.endsWith('.tex') || activePath === findMainFile(project ?? { name: '', files: [] });
}

// The folder of a path: "chapters/intro.tex" → "chapters", "main.tex" → "".
const folderOf = (path: string | null): string => path?.split('/').slice(0, -1).join('/') ?? '';

// Asks for a file path until it is usable. Returns null if the user cancels
// or keeps the path unchanged.
function askForPath(question: string, suggestion: string, unchanged?: string): string | null {
  let message = question;
  let answer = suggestion;
  for (;;) {
    const typed = prompt(message, answer);
    if (typed === null) return null;
    answer = typed.trim();
    if (answer === unchanged) return null;
    const problem = project ? pathProblem(project, answer) : null;
    if (!problem) return answer;
    message = `${problem}\n\n${question}`;
  }
}

// Runs a file action with a status message. Returns false if it failed.
async function runFileAction(description: string, action: () => Promise<void>): Promise<boolean> {
  statusText.textContent = `${description}…`;
  try {
    await action();
    statusText.textContent = `${description}: done.`;
    return true;
  } catch (error) {
    showError(error);
    return false;
  } finally {
    renderTree();
  }
}

async function newFile(): Promise<void> {
  const projectSync = sync;
  if (!projectSync) return;
  const folder = folderOf(activePath);
  const path = askForPath('Name of the new file, e.g. method.tex or chapters/method.tex:', folder ? `${folder}/` : '');
  if (path && await runFileAction(`Creating ${path}`, () => projectSync.addFile(path, ''))) openFile(path);
}

async function uploadFiles(files: File[]): Promise<void> {
  const projectSync = sync;
  if (!projectSync || files.length === 0) return;
  const answer = prompt('Upload into which folder? Leave empty for the top level.', folderOf(activePath));
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
    if (exists && !confirm(`${path} already exists. Replace it? Drive keeps the old version in its version history.`)) continue;
    const bytes = new Uint8Array(await upload.arrayBuffer());
    const content = isTextFile(path) ? new TextDecoder().decode(bytes) : bytes;
    if (!await runFileAction(`Uploading ${path}`, () => projectSync.addFile(path, content))) return;
  }
}

async function renameFile(): Promise<void> {
  const projectSync = sync;
  const from = activePath;
  if (!projectSync || !from) return;
  const to = askForPath(`New name for ${from}. Change the folder part to move it, e.g. chapters/${from.split('/').pop()}:`, from, from);
  if (!to) return;
  if (await runFileAction(`Renaming ${from}`, () => projectSync.moveFile(from, to))) {
    editor.rename(from, to);
    openFile(to);
  }
}

async function duplicateFile(): Promise<void> {
  const projectSync = sync;
  const file = projectSync?.project.files.find((f) => f.path === activePath);
  if (!projectSync || !file) return;
  // "chapters/intro.tex" → "chapters/intro-copy.tex" (no spaces: LaTeX dislikes them in file names)
  const suggestion = file.path.replace(/(\.[^./]+)?$/, (extension) => `-copy${extension}`);
  const path = askForPath(`Name for the copy of ${file.path}:`, suggestion);
  const content = typeof file.content === 'string' ? file.content : file.content.slice();
  if (path && await runFileAction(`Duplicating ${file.path}`, () => projectSync.addFile(path, content))) openFile(path);
}

async function deleteFile(): Promise<void> {
  const projectSync = sync;
  const path = activePath;
  if (!projectSync || !path) return;
  if (!confirm(`Delete ${path}? It goes to the trash in your Google Drive, where you can restore it for 30 days.`)) return;
  if (await runFileAction(`Deleting ${path}`, () => projectSync.deleteFile(path))) {
    editor.forget(path);
    activePath = null;
    const next = findMainFile(projectSync.project) ?? projectSync.project.files[0]?.path;
    if (next) openFile(next);
    else editor.clear();
  }
}

async function setMainFile(): Promise<void> {
  const projectSync = sync;
  const path = activePath;
  if (projectSync && path) await runFileAction(`Making ${path} the main file`, () => projectSync.setMainFile(path));
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
    statusText.textContent = 'This project has no .tex file with \\documentclass to compile.';
    return;
  }

  compiling = true;
  compileButton.disabled = true;
  try {
    const currentRunner = await getRunner();
    const engine = new PdfLatex(currentRunner);
    statusText.textContent = `Compiling ${project.name}…`;
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
      statusText.textContent = `Compiled ${project.name} in ${seconds} s`
        + (warnings > 0 ? `, ${warnings} warning${warnings > 1 ? 's' : ''}.` : '.');
    } else if (problems.some((p) => p.level === 'error')) {
      statusText.textContent = `Compile failed after ${seconds} s. Click the error below to go to it.`;
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
    button.append(level, where, problem.message);
    button.disabled = !problem.file;
    button.addEventListener('click', () => jumpTo(problem));
    const item = document.createElement('li');
    item.append(button);
    return item;
  }));
  problemList.hidden = problems.length === 0;

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
  if (problem.line && problem.file === activePath) editor.goTo(problem.line);
}

compileButton.addEventListener('click', () => void compile());
newFileButton.addEventListener('click', () => void newFile());
uploadButton.addEventListener('click', () => {
  uploadInput.value = '';
  uploadInput.click();
});
uploadInput.addEventListener('change', () => void uploadFiles([...(uploadInput.files ?? [])]));
renameButton.addEventListener('click', () => void renameFile());
duplicateButton.addEventListener('click', () => void duplicateFile());
deleteButton.addEventListener('click', () => void deleteFile());
setMainButton.addEventListener('click', () => void setMainFile());
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
