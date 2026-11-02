// Counts the words in the text of a PDF: runs of letters or digits, with
// apostrophes and hyphens inside a word ("don't", "state-of-the-art") kept
// as one word, and words hyphenated at the end of a line joined again.
export function countWords(text: string): number {
  const joined = text.replace(/(\p{L})-\n(\p{L})/gu, '$1$2');
  return joined.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}
