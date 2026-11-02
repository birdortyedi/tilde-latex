export interface ProjectFile {
  path: string;
  content: string | Uint8Array;
  driveId?: string; // set once the file is in Google Drive
  revision?: string; // the Drive revision we loaded or last saved
  changed?: boolean; // edited since the last save to Drive
}

export interface Project {
  name: string;
  files: ProjectFile[];
  driveId?: string; // the project's folder in Google Drive
  mainFile?: string; // the file to compile, if the user chose one
}

const depth = (path: string): number => path.split('/').length;

// The file to compile: the user's choice, else main.tex, else a .tex file
// with \documentclass (outside a comment), preferring top-level files.
export function findMainFile(project: Project): string | undefined {
  const texFiles = project.files.filter((f) => f.path.endsWith('.tex') && typeof f.content === 'string');
  const paths = texFiles.map((f) => f.path);
  if (project.mainFile && paths.includes(project.mainFile)) return project.mainFile;
  if (paths.includes('main.tex')) return 'main.tex';
  return texFiles
    .filter((f) => /^[^%\n]*\\documentclass/m.test(f.content as string))
    .map((f) => f.path)
    .sort((a, b) => depth(a) - depth(b) || a.localeCompare(b))[0];
}

// Turns a flat map like { "/test-docs/math/main.tex": "..." } into one
// project per top-level folder, with paths relative to that folder
// (so "chapters/intro.tex", not "/test-docs/multifile/chapters/intro.tex").
export function groupByProject(root: string, entries: Record<string, string | Uint8Array>): Project[] {
  const projects = new Map<string, ProjectFile[]>();
  for (const [fullPath, content] of Object.entries(entries)) {
    if (!fullPath.startsWith(root + '/')) continue;
    const [name, ...rest] = fullPath.slice(root.length + 1).split('/');
    if (rest.length === 0) continue; // a loose file directly in root, not in a project folder
    const files = projects.get(name) ?? [];
    files.push({ path: rest.join('/'), content });
    projects.set(name, files);
  }
  return [...projects.entries()]
    .map(([name, files]) => ({ name, files }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
