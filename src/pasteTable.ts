// Pasting cells copied from a spreadsheet (Excel, Google Sheets, Numbers,
// LibreOffice) into a .tex file: they arrive as lines of tab-separated
// cells, and become a table with booktabs rules.

// The cells of pasted text, or null if it does not look like spreadsheet
// cells: at least two rows and two columns, the same number of cells in
// every row, and not LaTeX or code indented with tabs.
export function cellsFrom(text: string): string[][] | null {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
  if (lines.length < 2 || !lines.every((line) => line.includes('\t'))) return null;
  if (lines.some((line) => /\\\\\s*$|\\(begin|end)\{/.test(line))) return null;
  const rows = lines.map((line) => line.split('\t').map((cell) => {
    const quoted = /^"([\s\S]*)"$/.exec(cell);
    return (quoted ? quoted[1].replaceAll('""', '"') : cell).trim();
  }));
  if (rows.some((row) => row.length !== rows[0].length)) return null;
  if (rows.every((row) => row[0] === '')) return null; // lines indented with a tab
  return rows;
}

// LaTeX's special characters, written so they print as themselves.
export function escapeLatex(text: string): string {
  return text.replace(/[\\&%$#_{}~^]/g, (char) => ({
    '\\': '\\textbackslash{}', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}',
  } as Record<string, string>)[char] ?? `\\${char}`);
}

const NUMBER = /^[-+−]?(\d[\d,.\s]*|\.\d+)(%|e[-+]?\d+)?$/i;

// The rows as LaTeX lines ("a & b \\"), with the cells lined up so the
// source is easy to read.
export function tableRows(rows: string[][], indent: string): string[] {
  const cells = rows.map((row) => row.map(escapeLatex));
  const widths = cells[0].map((_, column) => Math.max(...cells.map((row) => row[column].length)));
  return cells.map((row) => indent + row.map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths[column]))).join(' & ') + ' \\\\');
}

// A whole table: the first row as its header, numbers aligned right.
// Returns the text and where the cursor goes (inside \caption{}).
export function latexTable(rows: string[][], indent: string): { text: string; cursor: number } {
  const body = rows.slice(1);
  const columns = rows[0].map((_, column) =>
    (body.length > 0 && body.every((row) => row[column] === '' || NUMBER.test(row[column])) ? 'r' : 'l')).join('');
  const inner = `${indent}    `;
  const [header, ...rest] = tableRows(rows, inner);
  const before = `\\begin{table}[htbp]\n${indent}  \\centering\n${indent}  \\caption{`;
  const after = `}\n${indent}  \\label{tab:}\n${indent}  \\begin{tabular}{${columns}}\n${inner}\\toprule\n${header}\n${inner}\\midrule\n`
    + `${rest.map((row) => `${row}\n`).join('')}${inner}\\bottomrule\n${indent}  \\end{tabular}\n${indent}\\end{table}`;
  return { text: before + after, cursor: before.length };
}

// Whether the text before the cursor is inside a tabular (or similar)
// environment, where only the rows should go.
export function insideTabular(before: string): boolean {
  const opened = (before.match(/\\begin\{(tabular\*?|tabularx|longtable|tabulary|array)\}/g) ?? []).length;
  const closed = (before.match(/\\end\{(tabular\*?|tabularx|longtable|tabulary|array)\}/g) ?? []).length;
  return opened > closed;
}
