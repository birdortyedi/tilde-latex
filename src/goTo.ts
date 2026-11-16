import { isTextFile } from './fileTree';
import { outline, withoutComment } from './latex';
import type { ProjectFile } from './projects';

// "Go to anything" (Ctrl/Cmd+K): one search over the project's files,
// headings, labels, citation keys and text. Each result says where to go.

export type HitKind = 'file' | 'heading' | 'label' | 'citation' | 'text';

export interface Hit {
  kind: HitKind;
  label: string; // what is shown, e.g. "sec:method" or "Method"
  detail: string; // where it is, e.g. "chapters/method.tex:12"
  file: string;
  line?: number; // 1 = first line; none for a file
  match?: [number, number]; // for text: where the match is in `label`
  column?: number; // for text: where the match starts in the line (0 = first character)
}

const PER_KIND = 8;
const TEXT_HITS = 40;

const contentOf = (file: ProjectFile): string => (typeof file.content === 'string' ? file.content : '');

// Things whose name matches come first: whole name, then start of the name, then anywhere.
function rank(name: string, query: string): number {
  const lower = name.toLowerCase();
  if (lower === query) return 0;
  if (lower.startsWith(query)) return 1;
  const word = lower.indexOf(query);
  return word < 0 ? -1 : /[^a-z0-9]/.test(lower[word - 1] ?? ' ') ? 2 : 3;
}

function best(hits: Hit[], name: (hit: Hit) => string, query: string): Hit[] {
  return hits
    .map((hit) => ({ hit, rank: query ? rank(name(hit), query) : 0 }))
    .filter((r) => r.rank >= 0)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, PER_KIND)
    .map((r) => r.hit);
}

// Every \label in the project's .tex files, and every key in its .bib files, with where it is.
function places(files: ProjectFile[]): { labels: Hit[]; citations: Hit[] } {
  const labels: Hit[] = [];
  const citations: Hit[] = [];
  for (const file of files) {
    if (!file.path.endsWith('.tex') && !file.path.endsWith('.bib')) continue;
    contentOf(file).split('\n').forEach((raw, index) => {
      const where = `${file.path}:${index + 1}`;
      if (file.path.endsWith('.tex')) {
        for (const match of withoutComment(raw).matchAll(/\\label\{([^}]+)\}/g)) {
          labels.push({ kind: 'label', label: match[1].trim(), detail: where, file: file.path, line: index + 1 });
        }
      } else {
        const entry = /^\s*@(\w+)\s*\{\s*([^,\s]+)\s*,/.exec(raw);
        if (entry && !['comment', 'string', 'preamble'].includes(entry[1].toLowerCase())) {
          citations.push({ kind: 'citation', label: entry[2], detail: where, file: file.path, line: index + 1 });
        }
      }
    });
  }
  return { labels, citations };
}

// Lines of text files that contain the query, with the match marked.
function textHits(files: ProjectFile[], query: string): Hit[] {
  const hits: Hit[] = [];
  for (const file of files) {
    if (!isTextFile(file.path) || typeof file.content !== 'string') continue;
    const lines = file.content.split('\n');
    for (let index = 0; index < lines.length && hits.length < TEXT_HITS; index++) {
      const line = lines[index];
      const at = line.toLowerCase().indexOf(query);
      if (at < 0) continue;
      // Long lines are cut around the match, so it is in view.
      const start = Math.max(0, at - 40);
      const cut = line.slice(start, at + query.length + 60);
      const lead = cut.length - cut.trimStart().length;
      const prefix = start > 0 ? '…' : '';
      const from = prefix.length + at - start - lead;
      hits.push({
        kind: 'text', label: prefix + cut.trim(), detail: `${file.path}:${index + 1}`, file: file.path, line: index + 1,
        match: [from, from + query.length], column: at,
      });
    }
  }
  return hits;
}

// The results for what was typed, in groups: files, headings, labels,
// citations, then lines of text. With nothing typed: the files and headings.
export function searchProject(files: ProjectFile[], mainPath: string | undefined, typed: string): Hit[] {
  const query = typed.trim().toLowerCase();
  const fileHits: Hit[] = files
    .map((f) => ({ kind: 'file' as const, label: f.path.split('/').pop() ?? f.path, detail: f.path, file: f.path }))
    // The main file first, then by path.
    .sort((a, b) => Number(b.file === mainPath) - Number(a.file === mainPath) || a.detail.localeCompare(b.detail));
  const headings: Hit[] = mainPath ? outline(files, mainPath).map((entry) => ({
    kind: 'heading', label: entry.title || '(no title)', detail: `${entry.file}:${entry.line}`, file: entry.file, line: entry.line,
  })) : [];
  const { labels, citations } = places(files);
  return [
    ...best(fileHits, (hit) => (query.includes('/') ? hit.detail : hit.label), query),
    ...best(headings, (hit) => hit.label, query),
    ...(query ? best(labels, (hit) => hit.label, query) : []),
    ...(query ? best(citations, (hit) => hit.label, query) : []),
    ...(query.length >= 2 ? textHits(files, query) : []),
  ];
}
