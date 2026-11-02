// What the New project dialog offers, in groups. Most starters are small
// projects in the starters/ folder. The conference starters are different:
// their style files have no license that lets Tilde ship them, so the user
// downloads the official kit (a .zip) and Tilde makes the project from it.

export type StarterGroup = 'blank' | 'papers' | 'conferences' | 'thesis' | 'letters' | 'examples';

export const GROUPS: { id: StarterGroup; label: string }[] = [
  { id: 'blank', label: 'Blank' },
  { id: 'papers', label: 'Papers' },
  { id: 'conferences', label: 'Conferences' },
  { id: 'thesis', label: 'Thesis and slides' },
  { id: 'letters', label: 'Letter and CV' },
  { id: 'examples', label: 'Examples' },
];

// An official author kit, downloaded by the user from the conference's own page.
export interface Kit {
  page: string; // where the kit is; update these each year
  find: string; // what the link is called on that page
  styleFile: RegExp; // a file the kit's .zip must have, to tell it is the right one
  main?: RegExp; // the paper's .tex file, when it is not main.tex
}

export interface Starter {
  id: string; // a folder in starters/, or a test-docs example
  name: string;
  note: string;
  group: StarterGroup;
  kit?: Kit;
}

export const STARTERS: Starter[] = [
  { id: 'ieee', name: 'IEEE', note: 'Conference paper, two columns (IEEEtran)', group: 'papers' },
  { id: 'acm', name: 'ACM', note: 'Conference paper, sigconf (acmart)', group: 'papers' },
  { id: 'lncs', name: 'Springer LNCS', note: 'Proceedings paper (llncs)', group: 'papers' },
  {
    id: 'cvpr', name: 'CVPR', note: 'From the official author kit', group: 'conferences',
    kit: { page: 'https://github.com/cvpr-org/author-kit', find: '“Code”, then “Download ZIP”', styleFile: /(^|\/)cvpr\.sty$/ },
  },
  {
    id: 'neurips', name: 'NeurIPS 2026', note: 'From the official author kit', group: 'conferences',
    kit: { page: 'https://neurips.cc/Conferences/2026/CallForPapers', find: '“Paper template”', styleFile: /(^|\/)neurips_\d{4}\.sty$/, main: /^neurips_\d{4}\.tex$/ },
  },
  {
    id: 'icml', name: 'ICML 2026', note: 'From the official author kit', group: 'conferences',
    kit: { page: 'https://icml.cc/Conferences/2026/AuthorInstructions', find: '“LaTeX style files”', styleFile: /(^|\/)icml\d{4}\.sty$/, main: /^example_paper\.tex$/ },
  },
  {
    id: 'eccv', name: 'ECCV 2026', note: 'From the official author kit', group: 'conferences',
    kit: { page: 'https://eccv2024.ecva.net/Conferences/2026/SubmissionPolicies', find: 'the author kit’s “ZIP file”', styleFile: /(^|\/)(eccv\.sty|llncs\.cls)$/ },
  },
  { id: 'thesis', name: 'Thesis', note: 'Report with a file per chapter, front matter and appendix', group: 'thesis' },
  { id: 'beamer', name: 'Slides', note: 'A talk with beamer, 16:9', group: 'thesis' },
  { id: 'letter', name: 'Letter', note: 'Cover letter (KOMA-Script)', group: 'letters' },
  { id: 'cv', name: 'CV', note: 'Curriculum vitae (moderncv)', group: 'letters' },
];

// The main file of a project made from a kit: the kit's paper, if it is
// named in the list above and is there.
export function kitMainFile(kit: Kit, paths: string[]): string | undefined {
  return kit.main ? paths.find((path) => kit.main?.test(path)) : undefined;
}
