import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { addComment, addReply, resolveThread, threads, unresolve, type Reply, type Thread } from './comments';
import { docFromProject, sharedFileAt } from './sharedDoc';

describe('comments in a shared project', () => {
  const me = (text: string, author = 'Furkan'): Reply => ({ author, account: author, at: 1, text });
  const setup = () => {
    const doc = docFromProject({ name: 'Paper', files: [{ path: 'main.tex', content: 'We train a large model.' }] }, { folderId: 'f', mailboxId: 'm', uploadsId: 'u' });
    const file = sharedFileAt(doc, 'main.tex');
    if (!file?.text) throw new Error('no text');
    return { doc, fileId: file.id, text: file.text };
  };
  const quote = (text: Y.Text, thread: Thread) => text.toString().slice(thread.from, thread.to);

  it('stays on the same words while the text around them changes', () => {
    const { doc, fileId, text } = setup();
    addComment(doc, fileId, 11, 16, me('Which size?')); // "large"
    text.insert(0, 'In short, ');
    text.insert(text.toString().indexOf('large'), 'very '); // just before: not part of it
    text.insert(text.toString().indexOf('large') + 5, ' and slow'); // just after: not part of it
    const [thread] = threads(doc, fileId);
    expect(quote(text, thread)).toBe('large');
    text.delete(thread.from, 5);
    expect(threads(doc, fileId)[0].from).toBe(threads(doc, fileId)[0].to); // its words are gone; the thread stays
  });

  it('keeps replies two people write at the same moment', () => {
    const { doc, fileId } = setup();
    const id = addComment(doc, fileId, 0, 2, me('Start?'));
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    addReply(doc, id, me('Yes', 'Furkan'));
    addReply(other, id, me('No', 'Bora'));
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(other));
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    const texts = (d: Y.Doc) => threads(d)[0].replies.map((r) => r.text);
    expect(texts(doc)).toHaveLength(3);
    expect(texts(doc)).toEqual(texts(other));
  });

  it('can be resolved, and brought back', () => {
    const { doc, fileId, text } = setup();
    const id = addComment(doc, fileId, 3, 8, me('Wording'));
    const resolved = resolveThread(doc, id);
    expect(threads(doc)).toEqual([]);
    if (resolved) unresolve(doc, resolved);
    expect(threads(doc).map((t) => [quote(text, t), t.replies[0].text])).toEqual([['train', 'Wording']]);
  });
});
