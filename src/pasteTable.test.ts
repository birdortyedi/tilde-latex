import { describe, expect, it } from 'vitest';
import { cellsFrom, escapeLatex, insideTabular, latexTable } from './pasteTable';

describe('pasting a table', () => {
  it('reads cells copied from a spreadsheet', () => {
    expect(cellsFrom('Model\tBLEU\r\nOurs\t"28.4"\r\nBase\t27.3\r\n')).toEqual([['Model', 'BLEU'], ['Ours', '28.4'], ['Base', '27.3']]);
  });

  it('leaves other text alone', () => {
    expect(cellsFrom('just one line\twith a tab')).toBeNull();
    expect(cellsFrom('\tindented\n\tcode')).toBeNull();
    expect(cellsFrom('a\tb\nc')).toBeNull();
    expect(cellsFrom('a\t& b \\\\\nc\t& d \\\\')).toBeNull();
  });

  it('writes a booktabs table, numbers aligned right, special characters escaped', () => {
    expect(escapeLatex('R&D 50% #1 a_b ~ ^ \\')).toBe('R\\&D 50\\% \\#1 a\\_b \\textasciitilde{} \\textasciicircum{} \\textbackslash{}');
    const { text, cursor } = latexTable([['Model', 'BLEU'], ['Ours', '28.4'], ['Base', '27.3']], '');
    expect(text).toBe([
      '\\begin{table}[htbp]', '  \\centering', '  \\caption{}', '  \\label{tab:}', '  \\begin{tabular}{lr}', '    \\toprule',
      '    Model & BLEU \\\\', '    \\midrule', '    Ours  & 28.4 \\\\', '    Base  & 27.3 \\\\', '    \\bottomrule', '  \\end{tabular}', '\\end{table}',
    ].join('\n'));
    expect(text.slice(cursor, cursor + 1)).toBe('}');
  });

  it('knows when the cursor is inside a tabular', () => {
    expect(insideTabular('\\begin{tabular}{ll}\n\\toprule\n')).toBe(true);
    expect(insideTabular('\\begin{tabular}{ll}\n\\end{tabular}\n')).toBe(false);
  });
});
