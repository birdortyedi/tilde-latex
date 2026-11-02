import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import './style.css';
import { BusyTexRunner, PdfLatex } from 'texlyre-busytex';
import { findMainFile, groupByProject, pathProblem, type Project, type ProjectFile } from './projects';
import { buildTree, isTextFile, type TreeNode } from './fileTree';
import { Editor, type LineMark } from './editor';
import { PdfViewer } from './pdfViewer';
import { forgetToken, restoreSignIn, signIn, SignInNeededError, signOut } from './auth';
import { googleDrive, type DriveFile } from './drive';
import { createProject, findOrCreateRootFolder, lastEdited, listProjects, openProject } from './driveProjects';
import { browserDrafts, forgetOtherAccounts, type Draft } from './drafts';
import { ProjectSync, type SyncState } from './sync';
import { cachedPackages, REMOTE_DIR, storeNewPackages } from './packageCache';
import { lastLatexLog, parseLog, type LogProblem } from './logParser';
import { unzipProject } from './zipImport';
import { isGoogleDoc, pickDriveFiles, type PickedFile } from './picker';
import { askConfirm, askText } from './ask';
import { initLayout } from './layout';
import { initTheme } from './theme';
import { openMenu } from './menu';

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

const projectsButton = element<HTMLButtonElement>('#show-projects');
const projectNameLabel = element<HTMLSpanElement>('#project-name');
const projectsPage = element<HTMLElement>('#projects-page');
const projectsHint = element<HTMLParagraphElement>('#projects-hint');
const projectRows = element<HTMLTableSectionElement>('#project-rows');
const importZipButton = element<HTMLButtonElement>('#import-zip');
const zipInput = element<HTMLInputElement>('#zip-input');
const closeProjectsButton = element<HTMLButtonElement>('#close-projects');
const importDriveButton = element<HTMLButtonElement>('#import-drive');
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
const newProjectTemplate = element<HTMLSelectElement>('#new-project-template');
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
}, (line, column) => {
  cursorPosition.textContent = `Ln ${line}, Col ${column}`;
});
const pdfViewer = new PdfViewer(pdfContainer);

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
  showProject(examples[0] ?? null);
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
    statusText.textContent = 'Signed in. Open a project or create one.';
  }
}

// The project page lists the Drive projects (newest first) while signed in,
// and the built-in examples while signed out.
function showProjectsPage(visible: boolean): void {
  projectsPage.hidden = !visible;
  mainArea.hidden = visible;
  document.body.classList.toggle('on-projects', visible);
  if (visible) renderProjectsPage();
}

function renderProjectsPage(): void {
  const signedIn = rootId !== null;
  for (const button of [newProjectButton, importZipButton, importDriveButton]) button.hidden = !signedIn;
  closeProjectsButton.hidden = !project;
  projectsHint.textContent = signedIn
    ? (driveFolders.length === 0 ? 'You have no projects yet. Create one or import one.' : 'Your projects in the "LaTeX Projects" folder of your Google Drive.')
    : 'Sign in with Google to keep your own projects in your Drive. Until then, try the examples.';

  const rows = signedIn
    ? [...driveFolders]
      .map((folder) => ({ id: folder.id, name: folder.name, edited: lastEdited(folder) }))
      .sort((a, b) => (b.edited?.getTime() ?? 0) - (a.edited?.getTime() ?? 0))
    : examples.map((example) => ({ id: example.name, name: example.name, edited: undefined }));

  projectRows.replaceChildren(...rows.map((row) => {
    const open = document.createElement('button');
    open.className = 'open-link';
    open.textContent = row.name;
    open.addEventListener('click', () => void openProjectById(row.id));
    const actions = document.createElement('td');
    if (signedIn) {
      const rename = document.createElement('button');
      rename.textContent = 'Rename';
      rename.addEventListener('click', () => void renameProject(row.id, row.name));
      const remove = document.createElement('button');
      remove.textContent = 'Delete';
      remove.addEventListener('click', () => void deleteProject(row.id, row.name));
      actions.append(rename, remove);
    }
    const tableRow = document.createElement('tr');
    const nameCell = document.createElement('td');
    nameCell.append(open);
    const editedCell = document.createElement('td');
    editedCell.textContent = row.edited?.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) ?? '';
    tableRow.append(nameCell, editedCell, actions);
    return tableRow;
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
  statusText.textContent = `Opening ${folder.name} from Drive…`;
  try {
    // Save the project we leave. Whatever cannot be saved now stays in the
    // browser and is saved the next time that project is opened.
    await sync?.saveNow();
    showProject(await openProject(googleDrive, folder));
    showProjectsPage(false);
  } catch (error) {
    showError(error);
  }
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
    const problem = !answer ? 'Type a name.'
      : answer.includes('/') ? 'A project name cannot contain "/".'
        : driveFolders.some((f) => f.name === answer) ? `A project called "${answer}" already exists.`
          : null;
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
    statusText.textContent = `Renamed "${name}" to "${newName}".`;
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
    statusText.textContent = `Deleted "${name}". You can restore it from the trash in Google Drive.`;
  } catch (error) {
    showError(error);
  }
}

// Creates a project in Drive from files, shows upload progress, and opens it.
async function createAndOpen(name: string, files: ProjectFile[]): Promise<void> {
  if (!rootId) return;
  try {
    await sync?.saveNow();
    const created = await createProject(googleDrive, rootId, name, files, (done, total) => {
      statusText.textContent = `Creating ${name} in Drive… (${done} of ${total} files)`;
    });
    await refreshProjects();
    showProject(created);
    showProjectsPage(false);
  } catch (error) {
    showError(error);
  }
}

// Lets the user pick files in their Drive. Google Docs and the like are left
// out (with a message), since they have no file content Tilde can use.
async function pickUsableFiles(title: string): Promise<PickedFile[]> {
  const picked = await pickDriveFiles(title);
  const skipped = picked.filter(isGoogleDoc);
  if (skipped.length > 0) {
    statusText.textContent = `Left out (Google Docs, Sheets etc. cannot be used): ${skipped.map((f) => f.name).join(', ')}`;
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
      statusText.textContent = `Reading ${file.name} from Drive… (${index + 1} of ${picked.length})`;
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
  projectNameLabel.textContent = newProject?.name ?? 'Tilde';
  editor.clear();
  activePath = null;
  pdfViewer.clear();
  const empty = document.createElement('p');
  empty.className = 'empty';
  empty.textContent = 'Compile to see the PDF here. Ctrl/Cmd+S saves and compiles.';
  pdfContainer.replaceChildren(empty);
  cursorPosition.textContent = '';
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
  showProject(examples[0] ?? null); // also stops saving the Drive project
  if (!projectsPage.hidden) renderProjectsPage();
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
        const row = document.createElement('div');
        row.className = 'row';
        row.classList.toggle('active', node.path === activePath);
        const open = document.createElement('button');
        open.className = 'open-file';
        open.textContent = node.name;
        if (project && node.path === findMainFile(project)) {
          const label = document.createElement('span');
          label.className = 'main-file';
          label.textContent = ' (main)';
          open.append(label);
        }
        open.addEventListener('click', () => openFile(node.path));
        row.append(open);
        if (sync) {
          const more = document.createElement('button');
          more.className = 'file-menu';
          more.textContent = '⋯';
          more.title = `Actions for ${node.name}`;
          more.setAttribute('aria-haspopup', 'menu');
          more.addEventListener('click', () => showFileMenu(more, node.path));
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
    { label: 'Upload from this computer…', action: () => { uploadInput.value = ''; uploadInput.click(); } },
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
  const path = await askForPath('Name of the new file, e.g. method.tex or chapters/method.tex:', folder ? `${folder}/` : '');
  if (path && await runFileAction(`Creating ${path}`, () => projectSync.addFile(path, ''))) openFile(path);
}

// Files to add to the open project, from the computer or from Drive.
interface IncomingFile {
  name: string;
  read: () => Promise<Uint8Array>;
}

async function uploadFiles(files: File[]): Promise<void> {
  await addFiles(files.map((file) => ({ name: file.name, read: async () => new Uint8Array(await file.arrayBuffer()) })));
}

// "Add from Google Drive" in the "+" menu: copies picked files into the open project.
async function addFromDrive(): Promise<void> {
  try {
    const picked = await pickUsableFiles('Pick files to add to this project');
    await addFiles(picked.map((file) => ({ name: file.name, read: () => googleDrive.download(file.id) })));
  } catch (error) {
    showError(error);
  }
}

async function addFiles(files: IncomingFile[]): Promise<void> {
  const projectSync = sync;
  if (!projectSync || files.length === 0) return;
  const answer = await askText('Add the files to which folder? Leave empty for the top level.', folderOf(activePath));
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
    if (!await runFileAction(`Adding ${path}`, () => projectSync.addFile(path, content))) return;
  }
}

async function renameFile(from: string): Promise<void> {
  const projectSync = sync;
  if (!projectSync) return;
  const to = await askForPath(`New name for ${from}. Change the folder part to move it, e.g. chapters/${from.split('/').pop()}:`, from, from);
  if (!to) return;
  if (await runFileAction(`Renaming ${from}`, () => projectSync.moveFile(from, to))) {
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
  if (path && await runFileAction(`Duplicating ${file.path}`, () => projectSync.addFile(path, content))) openFile(path);
}

async function deleteFile(path: string): Promise<void> {
  const projectSync = sync;
  if (!projectSync) return;
  if (!await askConfirm(`Delete ${path}? It goes to the trash in your Google Drive, where you can restore it for 30 days.`, 'Delete')) return;
  if (await runFileAction(`Deleting ${path}`, () => projectSync.deleteFile(path))) {
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
  if (projectSync) await runFileAction(`Making ${path} the main file`, () => projectSync.setMainFile(path));
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
  if (problem.line && problem.file === activePath) editor.goTo(problem.line);
}

compileButton.addEventListener('click', () => void compile());
addFilesButton.addEventListener('click', showAddMenu);
problemCount.addEventListener('click', () => { problemList.hidden = !problemList.hidden; });
initTheme(element<HTMLButtonElement>('#theme-toggle'));
initLayout({
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
uploadInput.addEventListener('change', () => void uploadFiles([...(uploadInput.files ?? [])]));
syncButton.addEventListener('click', showConflict);
logButton.addEventListener('click', () => { logView.hidden = !logView.hidden; });
projectsButton.addEventListener('click', () => showProjectsPage(true));
closeProjectsButton.addEventListener('click', () => showProjectsPage(false));
importDriveButton.addEventListener('click', () => void importFromDrive());
importZipButton.addEventListener('click', () => {
  zipInput.value = '';
  zipInput.click();
});
zipInput.addEventListener('change', () => {
  const file = zipInput.files?.[0];
  if (file) void importZip(file);
});
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
