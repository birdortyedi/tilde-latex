import { describe, expect, it } from 'vitest';
import { canConvertToPng, figureFor, figurePosition, imageExtension, imageFolder, imagePath } from './figures';

describe('pasted and dropped images', () => {
  it('accepts the image types LaTeX can include', () => {
    expect(imageExtension('plot.PNG', 'image/png')).toBe('png');
    expect(imageExtension('', 'image/jpeg')).toBe('jpg');
    expect(imageExtension('chart.pdf', 'application/pdf')).toBe('pdf');
    expect(imageExtension('anim.gif', 'image/gif')).toBeNull();
    expect(imageExtension('photo.webp', 'image/webp')).toBeNull();
  });

  it('turns the images a browser can show, but LaTeX cannot include, into PNG', () => {
    expect(canConvertToPng('anim.gif', 'image/gif')).toBe(true);
    expect(canConvertToPng('', 'image/webp')).toBe(true);
    expect(canConvertToPng('diagram.SVG', '')).toBe(true);
    expect(canConvertToPng('plot.eps', 'application/postscript')).toBe(false); // needs Ghostscript
  });

  it('puts images where the project keeps most of its images', () => {
    expect(imageFolder(['main.tex', 'img/a.png', 'img/b.jpg', 'figures/c.png'])).toBe('img');
    expect(imageFolder(['main.tex', 'logo.png'])).toBe('figures');
  });

  it('makes a name LaTeX reads without trouble, and never one that is taken', () => {
    expect(imagePath('My Plot v2.final.png', 'png', 'figures', new Set())).toBe('figures/My-Plot-v2-final.png');
    expect(imagePath('Ölçüm.jpg', 'jpg', 'figures', new Set())).toBe('figures/Olcum.jpg');
    expect(imagePath('plot.png', 'png', 'figures', new Set(['figures/plot.png', 'figures/plot-2.png']))).toBe('figures/plot-3.png');
  });

  it('names a pasted screenshot after the time', () => {
    expect(imagePath('image.png', 'png', 'figures', new Set(), new Date(2026, 10, 2, 9, 5, 7))).toBe('figures/pasted-20261102-090507.png');
  });

  it('never puts a new figure inside another figure, or after \\end{document}', () => {
    const text = ['Text.', '\\begin{figure}[htbp]', '  \\caption{}', '\\end{figure}', 'More.', '\\end{document}', 'After.'].join('\n');
    const offsetOf = (snippet: string) => text.indexOf(snippet);
    const lineEnd = (snippet: string) => text.indexOf(snippet) + snippet.length;
    expect(figurePosition(text, offsetOf('Text.') + 2)).toBe(offsetOf('Text.') + 2); // fine where it is
    expect(figurePosition(text, offsetOf('\\caption{}') + 9)).toBe(lineEnd('\\end{figure}')); // inside: after its \\end
    expect(figurePosition(text, offsetOf('After.'))).toBe(lineEnd('More.')); // after the end: just before it
  });

  it('writes a figure with the cursor in the caption', () => {
    const { text, cursor } = figureFor('figures/plot.png');
    expect(text).toBe([
      '\\begin{figure}[htbp]',
      '  \\centering',
      '  \\includegraphics[width=0.8\\linewidth]{figures/plot.png}',
      '  \\caption{}',
      '  \\label{fig:plot}',
      '\\end{figure}',
    ].join('\n'));
    expect(text.slice(cursor - 9, cursor + 1)).toBe('\\caption{}');
  });
});
