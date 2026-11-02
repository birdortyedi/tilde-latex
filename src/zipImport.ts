import { unzipSync, zipSync } from 'fflate';
import { isTextFile } from './fileTree';
import type { ProjectFile } from './projects';

// Files LaTeX makes while compiling. Tilde makes them again, so they are not imported.
const BUILD_FILES = /\.(aux|log|out|toc|lof|lot|fls|fdb_latexmk|synctex|synctex\.gz|blg|bcf|run\.xml|nav|snm|vrb)$/i;
// Files that operating systems add to zip files.
const SYSTEM_FILES = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$)/;

// Turns the entries of a zip file (path → bytes) into project files: skips
// folders, build and system files, removes a folder that holds everything
// (a zip of the folder "paper" has "paper/main.tex"), and reads text files as text.
export function filesFromZip(entries: Record<string, Uint8Array>): ProjectFile[] {
  const kept = Object.entries(entries)
    .map(([path, bytes]): [string, Uint8Array] => [path.replaceAll('\\', '/'), bytes])
    .filter(([path]) => !path.endsWith('/') && !BUILD_FILES.test(path) && !SYSTEM_FILES.test(path))
    .filter(([path]) => path.split('/').every((part) => part !== '' && part !== '.' && part !== '..'));

  const top = kept[0]?.[0].split('/')[0];
  const shared = kept.length > 0 && kept.every(([path]) => path.startsWith(`${top}/`)) ? `${top}/` : '';

  return kept.map(([path, bytes]) => {
    const relative = path.slice(shared.length);
    return { path: relative, content: isTextFile(relative) ? new TextDecoder().decode(bytes) : bytes };
  });
}

export function unzipProject(zip: Uint8Array): ProjectFile[] {
  return filesFromZip(unzipSync(zip));
}

// A .zip of a whole project, inside a folder named after it, ready to
// download (and to import again).
export function zipProject(name: string, files: ProjectFile[]): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) {
    entries[`${name}/${file.path}`] = typeof file.content === 'string' ? new TextEncoder().encode(file.content) : file.content;
  }
  return zipSync(entries);
}
