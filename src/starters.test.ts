import { describe, expect, it } from 'vitest';
import { GROUPS, kitMainFile, STARTERS } from './starters';

describe('starters', () => {
  it('has a folder with a main.tex for every starter that is not a conference kit', () => {
    const mains = Object.keys(import.meta.glob('/starters/*/main.tex'));
    for (const starter of STARTERS.filter((s) => !s.kit)) {
      expect(mains, starter.id).toContain(`/starters/${starter.id}/main.tex`);
    }
  });

  it('puts every starter in a group the dialog shows', () => {
    const groups = new Set(GROUPS.map((g) => g.id));
    for (const starter of STARTERS) expect(groups.has(starter.group), starter.id).toBe(true);
  });

  it('recognises each official kit by its style file, also inside a folder', () => {
    const kit = (id: string) => STARTERS.find((s) => s.id === id)?.kit;
    expect(kit('cvpr')?.styleFile.test('cvpr.sty')).toBe(true);
    expect(kit('neurips')?.styleFile.test('Formatting_Instructions/neurips_2026.sty')).toBe(true);
    expect(kit('icml')?.styleFile.test('icml2026.sty')).toBe(true);
    expect(kit('eccv')?.styleFile.test('llncs.cls')).toBe(true);
    expect(kit('neurips')?.styleFile.test('cvpr.sty')).toBe(false);
  });

  it('opens the kit\'s paper as the main file, when it is not main.tex', () => {
    const neurips = STARTERS.find((s) => s.id === 'neurips')?.kit;
    const icml = STARTERS.find((s) => s.id === 'icml')?.kit;
    const cvpr = STARTERS.find((s) => s.id === 'cvpr')?.kit;
    if (!neurips || !icml || !cvpr) throw new Error('kits missing');
    expect(kitMainFile(neurips, ['checklist.tex', 'neurips_2026.tex', 'neurips_2026.sty'])).toBe('neurips_2026.tex');
    expect(kitMainFile(icml, ['example_paper.tex', 'icml2026.sty'])).toBe('example_paper.tex');
    expect(kitMainFile(cvpr, ['main.tex', 'rebuttal.tex'])).toBeUndefined(); // main.tex is found anyway
  });
});
