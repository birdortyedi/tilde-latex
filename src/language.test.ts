import { describe, expect, it } from 'vitest';
import { documentLanguage } from './language';

describe('the document\'s language', () => {
  const tex = (content: string) => [{ path: 'main.tex', content }];
  it('comes from babel, polyglossia or the class options', () => {
    expect(documentLanguage(tex('\\usepackage[english,ngerman]{babel}'))).toBe('de');
    expect(documentLanguage(tex('\\usepackage[main=british,french]{babel}'))).toBe('en-GB');
    expect(documentLanguage(tex('\\documentclass[turkish]{article}\n\\usepackage{babel}'))).toBe('tr');
    expect(documentLanguage(tex('\\setmainlanguage[variant=american]{english}'))).toBe('en-US');
    expect(documentLanguage(tex('\\setdefaultlanguage{french}'))).toBe('fr');
    expect(documentLanguage(tex('% \\usepackage[german]{babel}\n\\documentclass{article}'))).toBeNull();
  });
});
