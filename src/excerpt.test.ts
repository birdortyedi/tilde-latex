import { describe, expect, it } from 'vitest';
import { latexTokens } from './excerpt';

describe('the source shown on the welcome page', () => {
  it('colours commands and comments, but not an escaped percent sign', () => {
    expect(latexTokens('As Fig.~\\ref{fig:3} shows, 5\\% % note')).toEqual([
      { text: 'As Fig.~', kind: 'text' },
      { text: '\\ref', kind: 'cmd' },
      { text: '{fig:3} shows, 5', kind: 'text' },
      { text: '\\%', kind: 'text' },
      { text: ' ', kind: 'text' },
      { text: '% note', kind: 'comment' },
    ]);
    expect(latexTokens('\\section*{Hi}')[0]).toEqual({ text: '\\section*', kind: 'cmd' });
  });
});
