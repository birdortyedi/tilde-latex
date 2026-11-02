import { describe, expect, it } from 'vitest';
import { figureFor, imageExtension, imageFolder, imagePath } from './figures';

describe('pasted and dropped images', () => {
  it('accepts the image types LaTeX can include', () => {
    expect(imageExtension('plot.PNG', 'image/png')).toBe('png');
    expect(imageExtension('', 'image/jpeg')).toBe('jpg');
    expect(imageExtension('chart.pdf', 'application/pdf')).toBe('pdf');
    expect(imageExtension('anim.gif', 'image/gif')).toBeNull();
    expect(imageExtension('photo.webp', 'image/webp')).toBeNull();
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
