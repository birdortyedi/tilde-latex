import { BusyTexRunner, PdfLatex } from 'texlyre-busytex';
import { groupByProject, type Project, type ProjectFile } from './projects';
import { buildTree, isTextFile, type TreeNode } from './fileTree';
import { Editor } from './editor';
import { PdfViewer } from './pdfViewer';
import { signIn, signOut } from './auth';
import { googleDrive, type DriveFile } from './drive';
import { createProject, findOrCreateRootFolder, listProjects, openProject, saveProject } from './driveProjects';

// Files that TeX Live's basic bundle lacks (TikZ, pgfplots, ...) are fetched
// one at a time from TeXlyre's public package server.
const PACKAGE_SERVER = 'https://texlive2026.texlyre.org';
const MAIN_FILE = 'main.tex';
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
const saveButton = element<HTMLButtonElement>('#save');
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
let project: Project | null = null; // the open project; edits change its files in memory
let activePath: string | null = null;
let runner: BusyTexRunner | null = null;
let compiling = false;
let saving = false;

const editor = new Editor(editorElement, (path, text) => {
  const file = project?.files.find((f) => f.path === path);
  if (file) {
    file.content = text;
    file.changed = true;
  }
});
const pdfViewer = new PdfViewer(element<HTMLDivElement>('#pdf'));

function showError(error: unknown): void {
  statusText.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
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
  await selectProject(driveFolders[0].id);
}

// Fills the project menu with [value, label] pairs.
function setProjectOptions(options: [string, string][]): void {
  projectSelect.replaceChildren(...options.map(([value, label]) => new Option(label, value)));
}

// Called when the user picks a project in the menu. Examples are already in
// memory; Drive projects are downloaded first.
async function selectProject(value: string): Promise<void> {
  if (!confirmDiscard()) {
    projectSelect.value = project?.driveId ?? project?.name ?? '';
    return;
  }
  projectSelect.value = value;
  if (!rootId) {
    showProject(examples.find((p) => p.name === value) ?? null);
    return;
  }
  const folder = driveFolders.find((f) => f.id === value);
  if (!folder) return;
  statusText.textContent = `Opening ${folder.name} from Drive…`;
  try {
    showProject(await openProject(googleDrive, folder));
  } catch (error) {
    showError(error);
  }
}

function showProject(newProject: Project | null): void {
  project = newProject;
  editor.clear();
  activePath = null;
  element<HTMLDivElement>('#pdf').replaceChildren();
  saveButton.hidden = !project?.driveId;
  renderTree();
  if (!project) return;
  statusText.textContent = `Opened ${project.name}. Press Compile or Ctrl/Cmd+S.`;
  openFile(MAIN_FILE);
}

// Paths of files edited since the last save to Drive.
function unsavedPaths(): string[] {
  return project?.driveId ? project.files.filter((f) => f.changed).map((f) => f.path) : [];
}

// True if there is nothing unsaved, or the user agrees to lose it.
function confirmDiscard(): boolean {
  const unsaved = unsavedPaths();
  return unsaved.length === 0
    || confirm(`These files have changes that are not saved to Drive:\n${unsaved.join('\n')}\n\nDiscard the changes?`);
}

async function handleSignIn(): Promise<void> {
  try {
    await signIn();
    statusText.textContent = 'Signed in. Loading your projects…';
    rootId = await findOrCreateRootFolder(googleDrive);
    signInButton.hidden = true;
    signOutButton.hidden = false;
    newProjectButton.hidden = false;
    await showDriveProjects();
  } catch (error) {
    showError(error);
  }
}

function handleSignOut(): void {
  if (!confirmDiscard()) return;
  signOut();
  rootId = null;
  driveFolders = [];
  signInButton.hidden = false;
  signOutButton.hidden = true;
  newProjectButton.hidden = true;
  showExamples();
}

// Runs when the "New project" dialog closes with the Create button.
async function createFromDialog(): Promise<void> {
  if (!rootId || !confirmDiscard()) return;
  const name = newProjectName.value.trim();
  const template = examples.find((p) => p.name === newProjectTemplate.value);
  statusText.textContent = `Creating ${name} in Drive…`;
  try {
    const created = await createProject(googleDrive, rootId, name, template?.files ?? BLANK_PROJECT);
    driveFolders = await listProjects(googleDrive, rootId);
    setProjectOptions(driveFolders.map((f) => [f.id, f.name]));
    projectSelect.value = created.driveId ?? '';
    showProject(created);
  } catch (error) {
    showError(error);
  }
}

// Saves the changed files to Drive. Returns false if something was not saved.
async function save(): Promise<boolean> {
  if (!project?.driveId) return true; // examples are not saved anywhere
  if (saving) return false;
  saving = true;
  saveButton.disabled = true;
  statusText.textContent = 'Saving…';
  try {
    const conflicts = await saveProject(googleDrive, project);
    if (conflicts.length > 0) {
      statusText.textContent = `Not saved: ${conflicts.join(', ')} changed in Drive since you opened this project `
        + '(maybe on another computer). Copy your edits somewhere safe, then reopen the project.';
      return false;
    }
    statusText.textContent = 'Saved to Drive.';
    return true;
  } catch (error) {
    showError(error);
    return false;
  } finally {
    saving = false;
    saveButton.disabled = false;
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
saveButton.addEventListener('click', () => void save());
logButton.addEventListener('click', () => { logView.hidden = !logView.hidden; });
projectSelect.addEventListener('change', () => void selectProject(projectSelect.value));
signInButton.addEventListener('click', () => void handleSignIn());
signOutButton.addEventListener('click', handleSignOut);
newProjectButton.addEventListener('click', () => {
  newProjectName.value = '';
  newProjectDialog.returnValue = '';
  newProjectDialog.showModal();
});
newProjectDialog.addEventListener('close', () => {
  if (newProjectDialog.returnValue === 'create') void createFromDialog();
});

// Ctrl+S (Cmd+S on a Mac) saves to Drive and then compiles, instead of
// opening the browser's "Save page" dialog. If saving fails, it does not
// compile, so the message about the failed save stays visible.
window.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    void save().then((saved) => { if (saved) void compile(); });
  }
});

// The browser asks "Leave site?" when closing the tab with unsaved changes.
window.addEventListener('beforeunload', (event) => {
  if (unsavedPaths().length > 0) event.preventDefault();
});

void loadExamples();
