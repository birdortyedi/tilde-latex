import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';

// Live editing in a shared project: the browsers of the people who have it
// open connect directly to each other (WebRTC) and send every keystroke and
// cursor move at once. They introduce themselves through the project's
// mailbox file in Drive, so no server of our own is needed; Google's free
// STUN server only tells each browser its public address. Where a network
// blocks direct connections, the shared file in Drive still carries the
// edits, a few seconds behind (see sharedSync.ts).

// One browser's half of a direct connection. The real one wraps
// RTCPeerConnection; tests use an in-memory one.
export interface LinkEnd {
  // The introduction for the other browser (a WebRTC offer), once ready.
  offer(): Promise<string>;
  // Takes the other browser's offer; returns this browser's answer.
  answer(offer: string): Promise<string>;
  // Takes the answer to this browser's offer.
  accept(answer: string): Promise<void>;
  send(data: Uint8Array): void;
  close(): void;
  onOpen: () => void;
  onClose: () => void;
  onMessage: (data: Uint8Array) => void;
}

export type MakeLink = () => LinkEnd;

// What the mailbox says about direct connections: one entry per pair of
// tabs, "from>to", written by the tab that offers and answered by the other.
export interface Signal {
  offer?: string;
  answer?: string;
  at: number; // when the offer was made (Date.now())
}
export type Signals = Record<string, Signal>;

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const MESSAGE_FILE_WANTED = 2; // "send me this binary file" (by Drive id)
const MESSAGE_FILE = 3; // a binary file
const MESSAGE_PART = 4; // a piece of a message too big for one (browsers allow about 256 KB)

const OFFER_TIMEOUT = 30_000; // an offer not answered and connected by then is dropped
const GIVE_UP_AFTER = 3; // failed tries with one tab before it is left to Drive for a while
const GIVE_UP_FOR = 5 * 60_000;
const PIECE = 60_000; // bytes per message at most; bigger ones go in pieces
// A message from another browser in pieces: at most this many pieces (about
// 200 MB), and this many such messages arriving at once, so a peer cannot
// make this browser hold more and more pieces that never add up.
const MAX_PIECES = 3500;
const MAX_IN_PIECES = 16;

interface Peer {
  session: string;
  link: LinkEnd;
  open: boolean;
  since: number; // when the attempt started
  // What this tab wrote for it, written again while the mailbox lacks it
  // (two tabs writing the mailbox at once can wipe out each other's words).
  signal?: { key: string; value: Signal };
  clients: Set<number>; // the Yjs client id of the person behind it, for their cursor
  parts: Map<number, Uint8Array[]>; // messages arriving in pieces, by number
}

export class Live {
  readonly awareness: awarenessProtocol.Awareness;
  private peers = new Map<string, Peer>(); // by the other tab's session
  private failures = new Map<string, { count: number; at: number }>();
  private handled = new Set<string>(); // offers answered already: "from>to@at"
  private firstSeen = new Map<string, number>(); // others' offers: when this tab first saw each (its own clock)
  private nextMessage = 0;
  private closed = false;
  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    // Send this browser's edits, and edits from Drive, to everyone; edits
    // from one peer to the others.
    const message = encode(MESSAGE_SYNC, (encoder) => syncProtocol.writeUpdate(encoder, update));
    for (const peer of this.peers.values()) if (peer.open && peer !== origin) this.send(peer, message);
  };
  private onAwarenessUpdate = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin instanceof Object && 'session' in origin) {
      // A peer's cursor: remember whose it is. Everyone is connected to
      // everyone, so cursors are not passed on.
      const peer = origin as Peer;
      for (const id of [...added, ...updated]) peer.clients.add(id);
      for (const id of removed) peer.clients.delete(id);
      return;
    }
    const changed = [...added, ...updated, ...removed];
    const message = encode(MESSAGE_AWARENESS, (encoder) => encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed)));
    for (const peer of this.peers.values()) if (peer.open) this.send(peer, message);
  };

  constructor(
    private doc: Y.Doc,
    readonly session: string, // this tab
    user: { name: string; color: string; account: string },
    private makeLink: MakeLink,
    private changed: () => void, // the set of connected peers changed
    // Binary files this browser has, for peers that may not read them from Drive yet.
    private fileBytes: (driveId: string) => Uint8Array | undefined,
    private fileArrived: (driveId: string, bytes: Uint8Array) => void,
  ) {
    this.awareness = new awarenessProtocol.Awareness(doc);
    this.awareness.setLocalStateField('user', { name: user.name, color: user.color, colorLight: `${user.color}33`, account: user.account });
    doc.on('update', this.onDocUpdate);
    this.awareness.on('update', this.onAwarenessUpdate);
  }

  // The tabs this one is connected to.
  connected(): string[] {
    return [...this.peers.values()].filter((p) => p.open).map((p) => p.session);
  }

  // Whether a connection is being made right now (the mailbox should be read often).
  connecting(): boolean {
    return [...this.peers.values()].some((p) => !p.open);
  }

  // One look at the mailbox: `here` are the tabs that have the project open
  // (this one included). Starts, answers and completes introductions, and
  // returns the signals this tab wants written, null for one to remove
  // (null if nothing changed).
  async step(here: string[], signals: Signals): Promise<Record<string, Signal | null> | null> {
    if (this.closed) return null;
    const out: Record<string, Signal | null> = {};
    const now = Date.now();
    let wrote = false;
    for (const [key, peer] of this.peers) {
      // Gone from the mailbox, or an attempt that never connected: drop it.
      if (!here.includes(key) || (!peer.open && now - peer.since > OFFER_TIMEOUT)) {
        if (!peer.open) this.failed(key);
        this.drop(key);
      }
    }
    for (const other of here) {
      if (other === this.session || this.peers.has(other) || this.resting(other, now)) continue;
      const mine = `${this.session}>${other}`;
      const theirs = `${other}>${this.session}`;
      const offered = signals[theirs];
      // Another computer's clock may differ, so an offer's age is counted from when this tab first saw it.
      const seenFor = offered ? now - this.seen(`${theirs}@${offered.at}`, now) : 0;
      if (offered?.offer && !offered.answer && !this.handled.has(`${theirs}@${offered.at}`) && seenFor < OFFER_TIMEOUT) {
        // The other tab offers: answer.
        this.handled.add(`${theirs}@${offered.at}`);
        const peer = this.start(other);
        try {
          out[theirs] = { ...offered, answer: await peer.link.answer(offered.offer) };
          if (this.closed) return null;
          peer.signal = { key: theirs, value: out[theirs] };
          wrote = true;
        } catch (error) {
          console.warn('Could not answer a direct connection', error);
          this.drop(other);
        }
      } else if (this.session < other) {
        // The tab with the smaller id offers; the other waits for it.
        const peer = this.start(other);
        try {
          out[mine] = { offer: await peer.link.offer(), at: now };
          if (this.closed) return null;
          peer.signal = { key: mine, value: out[mine] };
          wrote = true;
        } catch (error) {
          console.warn('Could not offer a direct connection', error);
          this.drop(other);
        }
      }
    }
    // Words of this tab's that another tab's write wiped out: written again.
    for (const peer of this.peers.values()) {
      const signal = peer.signal;
      if (peer.open || !signal || out[signal.key]) continue;
      const there = signals[signal.key];
      const lost = signal.value.answer ? there?.at === signal.value.at && !there.answer : there?.at !== signal.value.at;
      if (lost) {
        out[signal.key] = signal.value;
        wrote = true;
      }
    }
    // Introductions that are done or out of date are removed: this tab's
    // own offers (timed by its own clock), and any from a tab that has left.
    for (const [key, signal] of Object.entries(signals)) {
      const [from, to] = key.split('>');
      const mineDone = from === this.session && (this.peers.get(to)?.open || now - signal.at > 2 * OFFER_TIMEOUT);
      const gone = !here.includes(from); // the offering tab left
      if (mineDone || gone) {
        out[key] = null;
        wrote = true;
      }
    }
    // Answers to this tab's offers.
    for (const [other, peer] of this.peers) {
      // Only an answer to this tab's current offer (not to an earlier one that timed out).
      const signal = signals[`${this.session}>${other}`];
      const answer = signal?.at === peer.signal?.value.at ? signal?.answer : undefined;
      if (peer.open || !answer || this.handled.has(`answer:${other}:${peer.since}`)) continue;
      this.handled.add(`answer:${other}:${peer.since}`);
      await peer.link.accept(answer).catch((error: unknown) => {
        console.warn('Could not complete a direct connection', error);
        this.drop(other);
      });
    }
    return wrote ? out : null;
  }

  // Asks the connected peers for binary files this browser may not read from Drive.
  want(driveIds: string[]): void {
    for (const driveId of driveIds) {
      const message = encode(MESSAGE_FILE_WANTED, (encoder) => encoding.writeVarString(encoder, driveId));
      for (const peer of this.peers.values()) if (peer.open) this.send(peer, message);
    }
  }

  close(): void {
    this.closed = true;
    this.doc.off('update', this.onDocUpdate);
    this.awareness.off('update', this.onAwarenessUpdate);
    for (const key of [...this.peers.keys()]) this.drop(key);
    this.awareness.destroy();
  }

  private seen(key: string, now: number): number {
    const at = this.firstSeen.get(key) ?? now;
    this.firstSeen.set(key, at);
    return at;
  }

  // Sends a message, in pieces if it is big. A connection that fails is dropped
  // (edits still go through Drive, and the next look at the mailbox connects again).
  private send(peer: Peer, data: Uint8Array): void {
    try {
      if (data.length <= PIECE) {
        peer.link.send(data);
        return;
      }
      const number = this.nextMessage++;
      const total = Math.ceil(data.length / PIECE);
      for (let index = 0; index < total; index++) {
        peer.link.send(encode(MESSAGE_PART, (encoder) => {
          encoding.writeVarUint(encoder, number);
          encoding.writeVarUint(encoder, index);
          encoding.writeVarUint(encoder, total);
          encoding.writeVarUint8Array(encoder, data.subarray(index * PIECE, (index + 1) * PIECE));
        }));
      }
    } catch (error) {
      console.warn('Could not send to another browser', error);
      this.drop(peer.session);
    }
  }

  private resting(other: string, now: number): boolean {
    const failure = this.failures.get(other);
    return failure !== undefined && failure.count >= GIVE_UP_AFTER && now - failure.at < GIVE_UP_FOR;
  }

  private failed(other: string): void {
    const failure = this.failures.get(other) ?? { count: 0, at: 0 };
    this.failures.set(other, { count: failure.count + 1, at: Date.now() });
  }

  private start(other: string): Peer {
    const link = this.makeLink();
    const peer: Peer = { session: other, link, open: false, since: Date.now(), clients: new Set(), parts: new Map() };
    this.peers.set(other, peer);
    link.onOpen = () => {
      if (this.peers.get(other) !== peer) return;
      peer.open = true;
      this.failures.delete(other);
      // Each side sends what it has; the other answers with what is missing.
      this.send(peer, encode(MESSAGE_SYNC, (encoder) => syncProtocol.writeSyncStep1(encoder, this.doc)));
      this.send(peer, encode(MESSAGE_AWARENESS, (encoder) => encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID]))));
      this.changed();
    };
    link.onClose = () => {
      if (this.peers.get(other) === peer) this.drop(other);
    };
    link.onMessage = (data) => this.receive(peer, data);
    return peer;
  }

  private drop(other: string): void {
    const peer = this.peers.get(other);
    if (!peer) return;
    this.peers.delete(other);
    peer.link.close();
    // Their cursors go away with them.
    awarenessProtocol.removeAwarenessStates(this.awareness, [...peer.clients], 'connection closed');
    if (peer.open) this.changed();
  }

  private receive(peer: Peer, data: Uint8Array): void {
    try {
      const decoder = decoding.createDecoder(data);
      const type = decoding.readVarUint(decoder);
      if (type === MESSAGE_SYNC) {
        const reply = encoding.createEncoder();
        encoding.writeVarUint(reply, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, reply, this.doc, peer);
        if (encoding.length(reply) > 1) this.send(peer, encoding.toUint8Array(reply));
      } else if (type === MESSAGE_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), peer);
      } else if (type === MESSAGE_FILE_WANTED) {
        const driveId = decoding.readVarString(decoder);
        const bytes = this.fileBytes(driveId);
        if (bytes) this.sendFile(peer, driveId, bytes);
      } else if (type === MESSAGE_FILE) {
        const driveId = decoding.readVarString(decoder);
        this.fileArrived(driveId, decoding.readVarUint8Array(decoder));
      } else if (type === MESSAGE_PART) {
        const number = decoding.readVarUint(decoder);
        const index = decoding.readVarUint(decoder);
        const total = decoding.readVarUint(decoder);
        if (total > MAX_PIECES || index >= total || (!peer.parts.has(number) && peer.parts.size >= MAX_IN_PIECES)) return;
        const pieces = peer.parts.get(number) ?? [];
        pieces[index] = decoding.readVarUint8Array(decoder);
        peer.parts.set(number, pieces);
        if (pieces.filter(Boolean).length === total) {
          peer.parts.delete(number);
          const whole = new Uint8Array(pieces.reduce((sum, p) => sum + p.length, 0));
          let at = 0;
          for (const p of pieces) {
            whole.set(p, at);
            at += p.length;
          }
          this.receive(peer, whole);
        }
      }
    } catch (error) {
      console.warn('Could not read a message from another browser', error);
    }
  }

  private sendFile(peer: Peer, driveId: string, bytes: Uint8Array): void {
    this.send(peer, encode(MESSAGE_FILE, (encoder) => {
      encoding.writeVarString(encoder, driveId);
      encoding.writeVarUint8Array(encoder, bytes);
    }));
  }
}

// Whether a change to the document came in from another browser (see Live).
export function fromPeer(origin: unknown): boolean {
  return origin instanceof Object && 'link' in origin && 'session' in origin;
}

function encode(type: number, write: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, type);
  write(encoder);
  return encoding.toUint8Array(encoder);
}

// A colour for a person's cursor, the same on every computer: from their account id.
export function colorFor(account: string): string {
  const colors = ['#2a9d8f', '#e76f51', '#8e6bd6', '#d4a017', '#3a86ff', '#d64f8f', '#4caf50'];
  let hash = 0;
  for (const char of account) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return colors[hash % colors.length];
}

// The real direct connection, between two browsers.
export function webrtcLink(): LinkEnd {
  const connection = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  let channel: RTCDataChannel | null = null;
  const end: LinkEnd = {
    onOpen: () => {},
    onClose: () => {},
    onMessage: () => {},
    async offer() {
      use(connection.createDataChannel('tilde', { ordered: true }));
      await connection.setLocalDescription(await connection.createOffer());
      await gathered(connection);
      return JSON.stringify(connection.localDescription);
    },
    async answer(offer) {
      connection.addEventListener('datachannel', (event) => use(event.channel));
      await connection.setRemoteDescription(JSON.parse(offer) as RTCSessionDescriptionInit);
      await connection.setLocalDescription(await connection.createAnswer());
      await gathered(connection);
      return JSON.stringify(connection.localDescription);
    },
    async accept(answer) {
      await connection.setRemoteDescription(JSON.parse(answer) as RTCSessionDescriptionInit);
    },
    send(data) {
      if (channel?.readyState === 'open') channel.send(data.slice());
    },
    close() {
      channel?.close();
      connection.close();
    },
  };
  function use(made: RTCDataChannel): void {
    channel = made;
    made.binaryType = 'arraybuffer';
    made.addEventListener('open', () => end.onOpen());
    made.addEventListener('close', () => end.onClose());
    made.addEventListener('message', (event: MessageEvent<ArrayBuffer>) => end.onMessage(new Uint8Array(event.data)));
  }
  connection.addEventListener('connectionstatechange', () => {
    if (connection.connectionState === 'failed') end.onClose();
  });
  return end;
}

// Waits until the browser has found every way it can be reached, so one
// introduction holds them all (some networks never finish: then 5 seconds).
function gathered(connection: RTCPeerConnection): Promise<void> {
  return new Promise((resolve) => {
    if (connection.iceGatheringState === 'complete') resolve();
    connection.addEventListener('icegatheringstatechange', () => {
      if (connection.iceGatheringState === 'complete') resolve();
    });
    setTimeout(resolve, 5000);
  });
}
