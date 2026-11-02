import { describe, expect, it } from 'vitest';
import { countWords } from './words';

describe('countWords', () => {
  it('counts words, keeping contractions and hyphenated words whole', () => {
    expect(countWords('Hello, world! It\'s a state-of-the-art test, 2026.')).toBe(7);
  });

  it('joins a word hyphenated at the end of a line', () => {
    expect(countWords('an exam-\nple here')).toBe(3);
  });

  it('counts words in other scripts', () => {
    expect(countWords('Привет мир, Γειά σου')).toBe(4);
  });

  it('counts nothing in an empty PDF', () => {
    expect(countWords(' \n ')).toBe(0);
  });
});
