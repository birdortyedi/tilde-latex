import { describe, expect, it } from 'vitest';
import { pageScale, stepZoom, zoomPercent } from './pdfZoom';

const a4 = { width: 595, height: 842 }; // points
const pane = { width: 595, height: 421 }; // as wide as the page, half as tall

describe('PDF zoom', () => {
  it('fits the width, a whole page, or a fixed size', () => {
    expect(pageScale('width', a4, pane)).toBe(1);
    expect(pageScale('page', a4, pane)).toBe(0.5);
    expect(pageScale(1, a4, pane)).toBeCloseTo(96 / 72);
  });

  it('shows the size as a percentage of the printed page', () => {
    expect(zoomPercent(1.25, a4, pane)).toBe(125);
    expect(zoomPercent('width', a4, pane)).toBe(75); // 595 pixels for a 595-point page
  });

  it('steps from the current size, whatever the mode', () => {
    expect(stepZoom('width', 1, a4, pane)).toBe(0.9); // from 75%
    expect(stepZoom('width', -1, a4, pane)).toBe(0.67);
    expect(stepZoom(1, 1, a4, pane)).toBe(1.1);
    expect(stepZoom(3, 1, a4, pane)).toBe(3); // the largest step
    expect(stepZoom(0.5, -1, a4, pane)).toBe(0.5); // the smallest step
    // From 49% (a narrow pane), the next step is 67%, not a barely bigger 50%.
    expect(stepZoom('width', 1, a4, { width: 392, height: 700 })).toBe(0.67);
  });
});
