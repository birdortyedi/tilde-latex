import { BusyTexRunner, PdfLatex } from 'texlyre-busytex';
import { groupByProject, type Project } from './projects';

// Files that TeX Live's basic bundle lacks (TikZ, pgfplots, ...) are fetched
// one at a time from TeXlyre's public package server.
const PACKAGE_SERVER = 'https://texlive2026.texlyre.org';

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
const statusText = element<HTMLSpanElement>('#status');
const pdfFrame = element<HTMLIFrameElement>('#pdf');
const logView = element<HTMLPreElement>('#log');

let projects: Project[] = [];
let runner: BusyTexRunner | null = null;
let pdfUrl: string | null = null;

async function loadProjects(): Promise<void> {
  const binaryFiles: Record<string, Uint8Array> = {};
  for (const [path, url] of Object.entries(binaryFileUrls)) {
    binaryFiles[path] = new Uint8Array(await (await fetch(url)).arrayBuffer());
  }
  projects = groupByProject('/test-docs', { ...textFiles, ...binaryFiles });
  for (const project of projects) {
    projectSelect.add(new Option(project.name, project.name));
  }
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
  const project = projects.find((p) => p.name === projectSelect.value);
  const main = project?.files.find((f) => f.path === 'main.tex');
  if (!project || !main || typeof main.content !== 'string') {
    statusText.textContent = 'This project has no main.tex.';
    return;
  }

  compileButton.disabled = true;
  logView.textContent = '';
  try {
    const engine = new PdfLatex(await getRunner());
    statusText.textContent = `Compiling ${project.name}…`;
    const started = performance.now();
    const result = await engine.compile({
      input: main.content,
      mainTexPath: 'main.tex',
      additionalFiles: project.files.filter((f) => f !== main),
      bibtex: project.files.some((f) => f.path.endsWith('.bib')),
      rerun: true, // run LaTeX again so references and citations resolve
      remoteEndpoint: PACKAGE_SERVER,
    });
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    logView.textContent = result.log;

    if (result.success && result.pdf) {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      pdfUrl = URL.createObjectURL(new Blob([result.pdf.slice()], { type: 'application/pdf' }));
      pdfFrame.src = pdfUrl;
      statusText.textContent = `Compiled ${project.name} in ${seconds} s.`;
    } else {
      statusText.textContent = `Compile failed after ${seconds} s. See the log on the right.`;
    }
  } catch (error) {
    statusText.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    compileButton.disabled = false;
  }
}

compileButton.addEventListener('click', () => void compile());
void loadProjects();
