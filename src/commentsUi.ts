import { addComment, addReply, resolveThread, threads, unresolve, watchComments, type Reply, type Thread } from './comments';
import type { CardTarget } from './commentsView';
import type { Editor } from './editor';
import { avatar } from './avatar';
import { notify } from './notices';
import { sharedFiles } from './sharedDoc';
import type { SharedSync } from './sharedSync';
import { timeAgo } from './time';

// Comments, as the user sees them: the thread cards in
// the editor, the "Comments" list under the files, and a notice when someone
// else comments. Kept in the shared document (see comments.ts).

export interface CommentsPage {
  editor: Editor;
  panel: HTMLElement; // the "Comments" section of the side bar
  title: HTMLElement;
  list: HTMLElement;
  openFile(path: string): void; // opens a file in the editor and shows the editor
  // In a project of one's own (not shared yet): whether comments can be added there,
  // and turning comments on, which keeps them in the shared format (see main.ts).
  soloCanComment(): boolean;
  turnOnComments(): Promise<SharedSync | null>;
}

const QUOTE_LENGTH = 70;

export class CommentsUi {
  private sync: SharedSync | null = null;
  private me: { name: string; account: string; photo?: string } = { name: '', account: '' };
  private stopWatching: () => void = () => {};
  private cards = new Set<{ dom: HTMLElement; render: () => void }>(); // open thread cards
  private seen = new Set<string>(); // replies already known, so only new ones are announced

  constructor(private page: CommentsPage) {
    page.editor.commentHooks = {
      canComment: () => (this.sync ? !this.sync.readOnly : page.soloCanComment()),
      card: (target, close) => this.card(target, close),
    };
  }

  // A project was opened. Comments live in the shared format; a project of
  // one's own has none until its first comment (see turnOnComments in main.ts).
  attach(sync: SharedSync | null, me: { name: string; account: string; photo?: string }): void {
    this.stopWatching();
    this.sync = sync;
    this.me = me;
    this.cards.clear();
    this.seen = new Set(sync ? threads(sync.doc).flatMap((t) => t.replies.map((r) => replyKey(t.id, r))) : []);
    this.stopWatching = sync ? watchComments(sync.doc, () => this.refresh()) : () => {};
    this.refresh();
  }

  // Shows the comments where they are now: in the editor, in the list, in open cards.
  refresh(): void {
    const sync = this.sync;
    const all = sync ? threads(sync.doc) : [];
    const files = sync ? sharedFiles(sync.doc) : [];
    const pathOf = new Map(files.map((f) => [f.id, f.path]));
    for (const file of files) {
      if (file.text) this.page.editor.showComments(file.path, all.filter((t) => t.file === file.id).map(({ id, from, to }) => ({ id, from, to })));
    }
    for (const card of [...this.cards]) {
      if (card.dom.isConnected) card.render();
      else this.cards.delete(card);
    }
    this.renderList(all, pathOf);
    this.announce(all, pathOf);
  }

  private renderList(all: Thread[], pathOf: Map<string, string>): void {
    const { panel, title, list } = this.page;
    panel.hidden = all.length === 0;
    title.textContent = `Comments (${all.length})`;
    list.replaceChildren(...all.map((thread) => {
      const path = pathOf.get(thread.file) ?? '';
      const first = thread.replies[0];
      const button = document.createElement('button');
      const quote = document.createElement('span');
      quote.className = 'quote';
      quote.textContent = this.quote(thread);
      const text = document.createElement('span');
      text.className = 'text';
      text.textContent = first.text;
      const meta = document.createElement('span');
      meta.className = 'meta';
      const more = thread.replies.length - 1;
      meta.textContent = `${first.author}${more > 0 ? ` · ${more} ${more === 1 ? 'reply' : 'replies'}` : ''} · ${path.split('/').pop() ?? path}`;
      button.append(quote, text, meta);
      button.title = `${path}: ${first.text}`;
      button.addEventListener('click', () => {
        this.page.openFile(path);
        this.refresh();
        this.page.editor.openComment(thread.id);
      });
      const item = document.createElement('li');
      item.append(button);
      return item;
    }));
  }

  // The commented words, cut short.
  private quote(thread: Thread): string {
    const text = this.sync && sharedFiles(this.sync.doc).find((f) => f.id === thread.file)?.text?.toString();
    if (thread.from === thread.to || !text) return '(the text was deleted)';
    const words = text.slice(thread.from, thread.to).replace(/\s+/g, ' ').trim();
    return words.length > QUOTE_LENGTH ? `${words.slice(0, QUOTE_LENGTH - 1)}…` : words;
  }

  // Someone else's new comment or reply: a notice that takes you there.
  private announce(all: Thread[], pathOf: Map<string, string>): void {
    for (const thread of all) {
      for (const reply of thread.replies) {
        const key = replyKey(thread.id, reply);
        if (this.seen.has(key)) continue;
        this.seen.add(key);
        if (reply.account === this.me.account) continue;
        const path = pathOf.get(thread.file) ?? '';
        const short = reply.text.length > 80 ? `${reply.text.slice(0, 79)}…` : reply.text;
        notify(`${reply.author} ${reply === thread.replies[0] ? 'commented on' : 'replied in'} ${path}: “${short}”`, 'info', {
          label: 'Show',
          run: () => {
            this.page.openFile(path);
            this.refresh();
            this.page.editor.openComment(thread.id);
          },
        });
      }
    }
  }

  // The card under commented text: the thread with a reply box, or the box for a new comment.
  private card(target: () => CardTarget | null, close: () => void): HTMLElement {
    const dom = document.createElement('div');
    dom.className = 'comment-card';
    const first = target();
    if (!first) return dom;
    if ('id' in first) {
      const thread = (): Thread | undefined => (this.sync ? threads(this.sync.doc).find((t) => t.id === first.id) : undefined);
      const replies = document.createElement('ol');
      replies.className = 'replies';
      const render = (): void => {
        replies.replaceChildren(...(thread()?.replies ?? []).map(replyItem));
      };
      render();
      this.cards.add({ dom, render });
      dom.append(replies);
      if (this.sync && !this.sync.readOnly) {
        dom.append(this.writeBox('Reply…', 'Reply', (text) => {
          if (this.sync) addReply(this.sync.doc, first.id, this.reply(text));
        }, [{ label: 'Resolve', run: () => this.resolve(first.id, close) }], close));
      }
    } else {
      dom.append(this.writeBox('Add a comment…', 'Comment', (text) => void (async () => {
        const now = target();
        const path = this.page.editor.path();
        if (!now || !('from' in now) || !path) return;
        // The first comment in a project of one's own turns comments on for it.
        const sync = this.sync ?? await this.page.turnOnComments();
        const file = sync && sharedFiles(sync.doc).find((f) => f.path === path);
        if (!sync || !file?.text) return;
        if (this.page.editor.path() !== path) this.page.openFile(path);
        const id = addComment(sync.doc, file.id, now.from, now.to, this.reply(text));
        this.refresh();
        this.page.editor.openComment(id);
      })(), [{ label: 'Cancel', run: close }], close));
    }
    return dom;
  }

  // A text box with its buttons; Ctrl/Cmd+Enter sends, Escape closes the card.
  private writeBox(placeholder: string, send: string, onSend: (text: string) => void, others: { label: string; run: () => void }[], close: () => void): HTMLElement {
    const box = document.createElement('div');
    box.className = 'write';
    const input = document.createElement('textarea');
    input.rows = 2;
    input.placeholder = placeholder;
    input.setAttribute('aria-label', placeholder.replace('…', ''));
    const actions = document.createElement('div');
    actions.className = 'card-actions';
    const sendButton = document.createElement('button');
    sendButton.className = 'primary';
    sendButton.textContent = send;
    const go = (): void => {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      onSend(text);
    };
    sendButton.addEventListener('click', go);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        go();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    });
    actions.append(sendButton, ...others.map(({ label, run }) => {
      const button = document.createElement('button');
      button.textContent = label;
      button.addEventListener('click', run);
      return button;
    }));
    box.append(input, actions);
    setTimeout(() => input.focus(), 0);
    return box;
  }

  private reply(text: string): Reply {
    return { author: this.me.name, account: this.me.account, at: Date.now(), text, ...(this.me.photo ? { photo: this.me.photo } : {}) };
  }

  private resolve(id: string, close: () => void): void {
    const sync = this.sync;
    if (!sync) return;
    const resolved = resolveThread(sync.doc, id);
    close();
    if (resolved) notify('Resolved. The comment is gone for everyone.', 'success', { label: 'Undo', run: () => unresolve(sync.doc, resolved) });
  }
}

// A reply, recognised again after Undo puts its thread back (under a new id).
const replyKey = (_id: string, reply: Reply): string => `${reply.account}|${reply.at}|${reply.text}`;

function replyItem(reply: Reply): HTMLLIElement {
  const item = document.createElement('li');
  const body = document.createElement('div');
  const head = document.createElement('div');
  head.className = 'head';
  const name = document.createElement('strong');
  name.textContent = reply.author;
  const when = document.createElement('time');
  when.dateTime = new Date(reply.at).toISOString();
  when.textContent = timeAgo(new Date(reply.at));
  when.title = new Date(reply.at).toLocaleString();
  head.append(name, ' ', when);
  const text = document.createElement('p');
  text.textContent = reply.text;
  body.append(head, text);
  item.append(avatar(reply.author, reply.account, reply.photo), body);
  return item;
}
