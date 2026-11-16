import { describe, expect, it } from 'vitest';
import { macrosIn, mathAt } from './mathPreview';

describe('the maths preview', () => {
  const at = (text: string, marker = '|') => mathAt(text.replace(marker, ''), text.indexOf(marker));
  it('finds inline and display maths around the pointer', () => {
    expect(at('Energy $E = m|c^2$ here.')).toEqual({ from: 7, to: 17, tex: 'E = mc^2', display: false });
    expect(at('Costs 5\\$ and $|x$.')?.tex).toBe('x');
    expect(at('$a$ text | $b$')).toBeNull();
    expect(at('see \\[ \\int_0^1 |f \\]')?.display).toBe(true);
    expect(at('a \\\\[2pt] b | c')).toBeNull();
    expect(at('$$ x |+ y $$')?.tex).toBe('x + y');
  });

  it('turns environments into what KaTeX knows, without labels or numbers', () => {
    expect(at('\\begin{align}\n  a &= |b \\label{eq:x}\\\\\n  c &= d % note\n\\end{align}')?.tex).toBe('\\begin{align*}a &= b \\\\\n  c &= d\\end{align*}');
    expect(at('\\begin{equation}\n x |= 1\n\\end{equation}')?.tex).toBe('x = 1');
    expect(at('\\begin{equation} x = 1 \\end{equation} after |')).toBeNull();
  });

  it('collects the document\'s own macros', () => {
    const files = [{ path: 'main.tex', content: '\\newcommand{\\R}{\\mathbb{R}}\n\\newcommand\\norm[1]{\\lVert #1 \\rVert}\n\\DeclareMathOperator*{\\argmax}{arg\\,max}\n% \\newcommand{\\no}{x}' }];
    expect(macrosIn(files)).toEqual({ '\\R': '\\mathbb{R}', '\\norm': '\\lVert #1 \\rVert', '\\argmax': '\\operatorname*{arg\\,max}' });
  });
});
