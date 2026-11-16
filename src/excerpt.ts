// The parts of a line of LaTeX to colour like the editor does, for the
// source shown on the welcome page.

export interface Token {
  text: string;
  kind: 'cmd' | 'comment' | 'text';
}

// A line split into commands (\section), a comment (% …) and plain text.
export function latexTokens(line: string): Token[] {
  const tokens: Token[] = [];
  const comment = /(?<!\\)%/.exec(line);
  const code = comment ? line.slice(0, comment.index) : line;
  let last = 0;
  for (const match of code.matchAll(/\\([A-Za-z@]+\*?|.)/g)) {
    if (match.index > last) tokens.push({ text: code.slice(last, match.index), kind: 'text' });
    tokens.push({ text: match[0], kind: /^\\[A-Za-z@]/.test(match[0]) ? 'cmd' : 'text' });
    last = match.index + match[0].length;
  }
  if (last < code.length) tokens.push({ text: code.slice(last), kind: 'text' });
  if (comment) tokens.push({ text: line.slice(comment.index), kind: 'comment' });
  return tokens;
}
