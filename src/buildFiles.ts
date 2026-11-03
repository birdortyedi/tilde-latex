import type { ProjectFile } from './projects';

// Quick compiles: LaTeX writes what it learns about the document (labels,
// page numbers, the bibliography, the table of contents) into build files,
// and needs them from the run before to get references right. Tilde keeps
// them from the last compile, in the browser only (never in Drive), so a
// quick compile is one LaTeX pass instead of three or four.

// The build files worth keeping between compiles.
const KEPT = /\.(aux|bbl|toc|lof|lot|out|nav|snm|ind)$/;

// The build files among what the engine left in its project folder. A file
// of the project itself with the same name (some projects come with their
// own .bbl) is never replaced.
export function keptBuildFiles(files: { path: string; content: string | Uint8Array }[], projectPaths: Set<string>): ProjectFile[] {
  return files
    .filter((file) => KEPT.test(file.path) && !projectPaths.has(file.path))
    .map(({ path, content }) => ({ path, content }));
}

// After a quick compile: what its log asks for. A full compile when the
// bibliography must be made again (a new citation); one more quick pass when
// only references or page numbers moved; nothing when all is in place.
export function afterQuickCompile(log: string): 'full' | 'quick' | null {
  if (/Citation `[^']*'.*undefined|There were undefined citations|Please \(re\)run (Biber|BibTeX)|No file \S+\.bbl/.test(log)) return 'full';
  if (/Rerun to get|Label\(s\) may have changed|There were undefined references|Please rerun LaTeX/.test(log)) return 'quick';
  return null;
}
