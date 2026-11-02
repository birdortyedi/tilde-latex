import { BusyTexRunner, PdfLatex } from 'texlyre-busytex';
import { groupByProject, type Project } from './projects';
import { buildTree, isTextFile, type TreeNode } from './fileTree';
import { Editor } from './editor';
import { PdfViewer } from './pdfViewer';

// Files that TeX Live's basic bundle lacks (TikZ, pgfplots, ...) are fetched
// one at a time from TeXlyre's public package server.
const PACKAGE_SERVER = 'https://texlive2026.texlyre.org';
const MAIN_FILE = 'main.tex';

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
const logButton = element<HTMLButtonElement>('#toggle-log');
const statusText = element<HTMLSpanElement>('#status');
const treeView = element<HTMLElement>('#tree');
const editorElement = element<HTMLDivElement>('#editor');
const imagePreview = element<HTMLImageElement>('#image-preview');
const logView = element<HTMLPreElement>('#log');

let projects: Project[] = [];
let project: Project | null = null; // the open project; edits change its files in memory
let activePath: string | null = null;
let runner: BusyTexRunner | null = null;
let compiling = false;

const editor = new Editor(editorElement, (path, text) => {
  const file = project?.files.find((f) => f.path === path);
  if (file) file.content = text;
});
const pdfViewer = new PdfViewer(element<HTMLDivElement>('#pdf'));

async function loadProjects(): Promise<void> {
  const binaryFiles: Record<string, Uint8Array> = {};
  for (const [path, url] of Object.entries(binaryFileUrls)) {
    binaryFiles[path] = new Uint8Array(await (await fetch(url)).arrayBuffer());
  }
  projects = groupByProject('/test-docs', { ...textFiles, ...binaryFiles });
  for (const p of projects) projectSelect.add(new Option(p.name, p.name));
  openProject(projectSelect.value);
}

function openProject(name: string): void {
  project = projects.find((p) => p.name === name) ?? null;
  if (!project) return;
  editor.clear();
  activePath = null;
  element<HTMLDivElement>('#pdf').replaceChildren();
  statusText.textContent = `Opened ${name}. Press Compile or Ctrl/Cmd+S.`;
  openFile(MAIN_FILE);
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
    statusText.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    compiling = false;
    compileButton.disabled = false;
  }
}

compileButton.addEventListener('click', () => void compile());
logButton.addEventListener('click', () => { logView.hidden = !logView.hidden; });
projectSelect.addEventListener('change', () => openProject(projectSelect.value));

// Ctrl+S (Cmd+S on a Mac) compiles instead of opening the browser's "Save page" dialog.
window.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    void compile();
  }
});

void loadProjects();
