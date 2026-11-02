import { describe, expect, it } from 'vitest';
import { notProse } from './spellcheck';

// The text of each range that spell checking leaves out.
const skipped = (text: string) => notProse(text).map(([from, to]) => text.slice(from, to));

describe('notProse', () => {
  it('leaves out file names, labels and their options', () => {
    expect(skipped('\\includegraphics[width=3cm]{figures/tilde}')).toEqual(['figures/tilde', '[width=3cm]', '[width=3cm]']);
    expect(skipped('see \\ref{fig:tilde} and \\citep[p.~3]{knuth1984}')).toEqual(
      expect.arrayContaining(['fig:tilde', 'knuth1984', '[p.~3]']));
    expect(skipped('\\usepackage{amsmath,graphicx}')).toEqual(['amsmath,graphicx']);
  });

  it('leaves out the options of an environment', () => {
    expect(skipped('\\begin{figure}[htbp]')).toEqual(['[htbp]']);
  });

  it('leaves out display maths over several lines', () => {
    const text = 'Before.\n\\begin{align*}\n  y &= mx + c\n\\end{align*}\nAfter.';
    expect(skipped(text)).toEqual(['\\begin{align*}\n  y &= mx + c\n\\end{align*}']);
  });

  it('checks ordinary text and headings', () => {
    expect(skipped('\\section{Introduction} Some text here.')).toEqual([]);
  });
});
