import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  addSharedText, docFromProject, fixDuplicatePaths, moveShared, removeShared, savedLacks, sharedFileAt, sharedFiles,
  sharedIds, sharedMainFile, sharedName,
} from './sharedDoc';

const ids = { folderId: 'folder', mailboxId: 'mailbox', uploadsId: 'uploads' };
const project = {
  name: 'Paper',
  mainFile: 'main.tex',
  files: [
    { path: 'main.tex', content: '\\documentclass{article}' },
    { path: 'figures/plot.png', content: new Uint8Array([1, 2]), driveId: 'png1' },
    { path: 'figures/unsaved.png', content: new Uint8Array([3]) }, // not in Drive: nothing to point to
  ],
};

// Two people's copies of one document, kept apart until `exchange` merges them.
function twoCopies(): [Y.Doc, Y.Doc] {
  const a = docFromProject(project, ids);
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  return [a, b];
}
const exchange = (a: Y.Doc, b: Y.Doc): void => {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
};
const textOf = (doc: Y.Doc, path: string): string | undefined => sharedFileAt(doc, path)?.text?.toString();

describe('a shared project document', () => {
  it('is made from a project: text by content, images by their Drive id', () => {
    const doc = docFromProject(project, ids);
    expect(sharedFiles(doc).map((f) => [f.path, f.text?.toString() ?? f.driveId]))
      .toEqual([['figures/plot.png', 'png1'], ['main.tex', '\\documentclass{article}']]);
    expect([sharedName(doc), sharedMainFile(doc), sharedIds(doc)]).toEqual(['Paper', 'main.tex', ids]);
  });

  it('merges edits two people made at the same time', () => {
    const [a, b] = twoCopies();
    sharedFileAt(a, 'main.tex')?.text?.insert(0, '% A\n');
    sharedFileAt(b, 'main.tex')?.text?.insert(23, '\n% B');
    exchange(a, b);
    expect(textOf(a, 'main.tex')).toBe('% A\n\\documentclass{article}\n% B');
    expect(textOf(b, 'main.tex')).toBe(textOf(a, 'main.tex'));
  });

  it('keeps an edit to a file another person renamed meanwhile', () => {
    const [a, b] = twoCopies();
    moveShared(a, 'main.tex', 'paper.tex');
    sharedFileAt(b, 'main.tex')?.text?.insert(0, '% B\n');
    exchange(a, b);
    expect(textOf(b, 'paper.tex')).toBe('% B\n\\documentclass{article}');
    expect(sharedFileAt(b, 'main.tex')).toBeUndefined();
  });

  it('moves a whole folder', () => {
    const doc = docFromProject(project, ids);
    moveShared(doc, 'figures', 'img');
    expect(sharedFiles(doc).map((f) => f.path)).toEqual(['img/plot.png', 'main.tex']);
    removeShared(doc, 'img/plot.png');
    expect(sharedFiles(doc).map((f) => f.path)).toEqual(['main.tex']);
  });

  it('renames one of two files made with the same name at the same time, the same way everywhere', () => {
    const [a, b] = twoCopies();
    addSharedText(a, 'intro.tex', 'from A');
    addSharedText(b, 'intro.tex', 'from B');
    exchange(a, b);
    expect(fixDuplicatePaths(a)).toBe(true);
    expect(fixDuplicatePaths(b)).toBe(true);
    exchange(a, b);
    const names = (doc: Y.Doc) => sharedFiles(doc).map((f) => `${f.path}: ${f.text?.toString() ?? f.driveId}`);
    expect(names(a)).toEqual(names(b));
    expect(sharedFiles(a).map((f) => f.path)).toEqual(['figures/plot.png', 'intro (2).tex', 'intro.tex', 'main.tex']);
    expect(fixDuplicatePaths(a)).toBe(false);
  });

  it('tells whether the saved copy lacks something of this browser', () => {
    const [a] = twoCopies();
    const saved = Y.encodeStateAsUpdate(a);
    expect(savedLacks(saved, a)).toBe(false);
    sharedFileAt(a, 'main.tex')?.text?.insert(0, 'x');
    expect(savedLacks(saved, a)).toBe(true);
    const withInsert = Y.encodeStateAsUpdate(a);
    sharedFileAt(a, 'main.tex')?.text?.delete(0, 1); // a deletion only
    expect(savedLacks(withInsert, a)).toBe(true);
    expect(savedLacks(new Uint8Array(), a)).toBe(true);
  });

  it('does not ask to save when the saved copy has more than this browser', () => {
    const [a, b] = twoCopies();
    sharedFileAt(b, 'main.tex')?.text?.insert(0, '% B\n');
    expect(savedLacks(Y.encodeStateAsUpdate(b), a)).toBe(false);
  });
});
