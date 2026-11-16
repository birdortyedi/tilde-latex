import * as Y from 'yjs';
import { sharedFiles } from './sharedDoc';

// Comments in a shared project, kept in its shared document (see
// sharedDoc.ts), never in the .tex files. Each is tied to a stretch of a
// file's text by Yjs relative positions, so it stays on the same words while
// anyone edits around them. Replies from two people at once both survive.
//
//   doc.getMap('comments'): one Y.Map per thread, by id:
//     'file'     the id of the file's entry in doc.getMap('files')
//     'from'     where the commented text starts and ends, as relative
//     'to'         positions (Y.relativePositionToJSON)
//     'replies'  a Y.Array of { author, account, at, text }; the first is the comment
// Resolving a thread deletes it.

export interface Reply {
  author: string; // a name, as Google shows it
  account: string; // the Google account's id, for its colour
  at: number; // milliseconds since 1970
  text: string;
  photo?: string; // the author's Google profile photo
}

export interface Thread {
  id: string;
  file: string; // the file entry's id
  from: number; // where the commented text is now; equal when it was deleted
  to: number;
  replies: Reply[];
}

const commentsMap = (doc: Y.Doc): Y.Map<Y.Map<unknown>> => doc.getMap('comments');

// The file entry's text, by its id.
function textOf(doc: Y.Doc, fileId: string): Y.Text | undefined {
  return sharedFiles(doc).find((entry) => entry.id === fileId)?.text;
}

export function addComment(doc: Y.Doc, fileId: string, from: number, to: number, reply: Reply): string {
  const text = textOf(doc, fileId);
  if (!text) throw new Error('Comments can only be made on text files.');
  const id = crypto.randomUUID();
  doc.transact(() => {
    const thread = new Y.Map<unknown>();
    commentsMap(doc).set(id, thread);
    thread.set('file', fileId);
    // The start sticks to the first commented character, the end to the last,
    // so typing just before or after the words does not join the comment.
    thread.set('from', Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, from, 0)));
    thread.set('to', Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, to, -1)));
    const replies = new Y.Array<Reply>();
    thread.set('replies', replies);
    replies.push([reply]);
  });
  return id;
}

export function addReply(doc: Y.Doc, id: string, reply: Reply): void {
  const replies = commentsMap(doc).get(id)?.get('replies');
  if (replies instanceof Y.Array) replies.push([reply]);
}

// What a resolved thread was, so "Undo" can put it back.
export interface Resolved {
  file: string;
  from: unknown;
  to: unknown;
  replies: Reply[];
}

export function resolveThread(doc: Y.Doc, id: string): Resolved | null {
  const thread = commentsMap(doc).get(id);
  const replies = thread?.get('replies');
  if (!thread || !(replies instanceof Y.Array)) return null;
  const resolved = { file: String(thread.get('file')), from: thread.get('from'), to: thread.get('to'), replies: replies.toArray() as Reply[] };
  commentsMap(doc).delete(id);
  return resolved;
}

export function unresolve(doc: Y.Doc, resolved: Resolved): void {
  doc.transact(() => {
    const thread = new Y.Map<unknown>();
    commentsMap(doc).set(crypto.randomUUID(), thread);
    thread.set('file', resolved.file);
    thread.set('from', resolved.from);
    thread.set('to', resolved.to);
    const replies = new Y.Array<Reply>();
    thread.set('replies', replies);
    replies.push(resolved.replies);
  });
}

function absolute(doc: Y.Doc, json: unknown): number | null {
  try {
    return Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(json), doc)?.index ?? null;
  } catch {
    return null;
  }
}

// The threads, where their text is now; with `fileId`, only that file's. In
// the order they appear in the text.
export function threads(doc: Y.Doc, fileId?: string): Thread[] {
  const found: Thread[] = [];
  const live = new Set(sharedFiles(doc).map((entry) => entry.id)); // a deleted file's comments wait with it
  for (const [id, thread] of commentsMap(doc)) {
    const file = String(thread.get('file'));
    if (!live.has(file)) continue;
    const replies = thread.get('replies');
    if ((fileId && file !== fileId) || !(replies instanceof Y.Array) || replies.length === 0) continue;
    const from = absolute(doc, thread.get('from'));
    const to = absolute(doc, thread.get('to'));
    if (from === null || to === null) continue;
    found.push({ id, file, from, to: Math.max(from, to), replies: replies.toArray() as Reply[] });
  }
  return found.sort((a, b) => a.from - b.from || a.id.localeCompare(b.id));
}

// Calls `changed` after every change to the comments (from here or anyone).
export function watchComments(doc: Y.Doc, changed: (transaction: Y.Transaction) => void): () => void {
  const handler = (_events: Y.YEvent<Y.AbstractType<unknown>>[], transaction: Y.Transaction) => changed(transaction);
  commentsMap(doc).observeDeep(handler);
  return () => commentsMap(doc).unobserveDeep(handler);
}
