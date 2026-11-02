// Citations from a DOI: doi.org sends the paper's BibTeX entry (from
// Crossref for most journals and conferences, from DataCite for arXiv), and
// Tilde tidies it before adding it to the project's .bib file. Only the DOI
// is sent; doi.org answers browser pages directly, so no server is needed.

// A DOI from what the user pasted: "10.1145/…", "doi:10.1145/…", a doi.org
// link, or an arXiv link or number (arXiv's DOIs are 10.48550/arXiv.<number>).
export function parseDoi(input: string): string | null {
  const text = input.trim().replace(/^doi:\s*/i, '').replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  const arxiv = /^(?:https?:\/\/)?(?:www\.)?(?:arxiv\.org\/(?:abs|pdf)\/|arxiv:)?(\d{4}\.\d{4,5})(?:v\d+)?(?:\.pdf)?$/i.exec(text);
  if (arxiv) return `10.48550/arXiv.${arxiv[1]}`;
  const doi = /^(10\.\d{4,9}\/\S+)$/.exec(text);
  return doi ? decodeURIComponent(doi[1]) : null;
}

export async function fetchBibtex(doi: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`https://doi.org/${encodeURI(doi)}`, { headers: { Accept: 'application/x-bibtex; charset=utf-8' } });
  } catch {
    throw new Error('Tilde could not reach doi.org. Check your internet connection and try again.');
  }
  const text = response.ok ? await response.text() : '';
  if (!text.trim().startsWith('@')) {
    throw new Error(`doi.org has no citation for ${doi}. Check the DOI, or copy the BibTeX from the publisher's page.`);
  }
  return text;
}

interface Entry {
  type: string;
  fields: [string, string][]; // name and raw value: {…}, "…" or a bare word
}

// Reads one BibTeX entry, keeping each value as written.
function parseEntry(text: string): Entry | null {
  const head = /@\s*(\w+)\s*\{\s*[^,\s]*\s*,/.exec(text);
  if (!head) return null;
  const fields: [string, string][] = [];
  let i = head.index + head[0].length;
  const name = /[\s,]*([A-Za-z][\w-]*)\s*=\s*/y;
  while (i < text.length) {
    name.lastIndex = i;
    const field = name.exec(text);
    if (!field) break;
    i = name.lastIndex;
    const start = i;
    if (text[i] === '{') {
      let depth = 0;
      do {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') depth--;
        i++;
      } while (depth > 0 && i < text.length);
    } else if (text[i] === '"') {
      i++;
      while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
      i++;
    } else {
      while (i < text.length && !/[\s,}]/.test(text[i])) i++;
    }
    fields.push([field[1].toLowerCase(), text.slice(start, i)]);
  }
  return { type: head[1].toLowerCase(), fields };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DROPPED = new Set(['copyright', 'keywords']); // DataCite extras nobody cites

// A key like "vaswani2017": the first author's last name and the year,
// with a letter added if that key is taken ("vaswani2017b").
function keyFor(fields: Map<string, string>, taken: Set<string>): string {
  const firstAuthor = (fields.get('author') ?? '').split(/\s+and\s+/)[0] ?? '';
  const last = firstAuthor.includes(',') ? firstAuthor.split(',')[0] : firstAuthor.trim().split(/\s+/).pop() ?? '';
  const name = last.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '') || 'paper';
  const base = name + (/\d{4}/.exec(fields.get('year') ?? '')?.[0] ?? '');
  let key = base;
  for (let n = 1; taken.has(key); n++) key = base + String.fromCharCode(97 + n); // b, c, d…
  return key;
}

// The entry doi.org sent, tidied: one field per line, a short key, LaTeX's
// own way of writing &, page ranges and months.
export function tidyBibtex(raw: string, takenKeys: Set<string>): { key: string; text: string } | null {
  const entry = parseEntry(raw);
  if (!entry) return null;
  const values = new Map<string, string>();
  for (const [name, value] of entry.fields) {
    if (DROPPED.has(name) || values.has(name)) continue;
    let inner = /^[{"]/.test(value) ? value.slice(1, -1).trim() : value;
    inner = inner.replace(/&amp;/g, '\\&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
    if (name === 'pages') inner = inner.replace(/\s*[–—-]+\s*/g, '--');
    values.set(name, inner);
  }
  const key = keyFor(values, takenKeys);
  const lines = [...values].map(([name, value]) => {
    const month = name === 'month' ? MONTHS.find((m) => value.toLowerCase().startsWith(m)) : undefined;
    return `  ${name} = ${month ?? `{${value}}`},`;
  });
  return { key, text: `@${entry.type}{${key},\n${lines.join('\n')}\n}\n` };
}

// The key of an entry in a .bib file that has this DOI, if there is one.
export function keyWithDoi(bib: string, doi: string): string | null {
  const wanted = doi.toLowerCase();
  for (const match of bib.matchAll(/@\w+\s*\{\s*([^,\s]+)\s*,([\s\S]*?)(?=@\w+\s*\{|$)/g)) {
    const found = /\bdoi\s*=\s*[{"]\s*(?:https?:\/\/(?:dx\.)?doi\.org\/)?([^}"\s]+)/i.exec(match[2]);
    if (found?.[1].toLowerCase() === wanted) return match[1];
  }
  return null;
}
