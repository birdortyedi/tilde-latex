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
