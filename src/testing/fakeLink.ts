import type { LinkEnd, MakeLink } from '../live';

// In-memory stand-in for direct connections between browsers (WebRTC is not
// available in tests). An offer is a token; answering it pairs the two ends.
export function fakeLinks(): MakeLink {
  const ends = new Map<string, FakeEnd>();
  let next = 0;

  class FakeEnd implements LinkEnd {
    other: FakeEnd | null = null;
    closed = false;
    onOpen = () => {};
    onClose = () => {};
    onMessage: (data: Uint8Array) => void = () => {};

    async offer() {
      const token = `offer-${next++}`;
      ends.set(token, this);
      return token;
    }

    async answer(offer: string) {
      const offerer = ends.get(offer);
      if (!offerer) throw new Error(`Unknown offer ${offer}`);
      this.other = offerer;
      offerer.other = this;
      const token = `answer-${next++}`;
      ends.set(token, this);
      return token;
    }

    async accept(answer: string) {
      if (ends.get(answer) !== this.other) throw new Error(`Unknown answer ${answer}`);
      const other = this.other as FakeEnd;
      queueMicrotask(() => {
        this.onOpen();
        other.onOpen();
      });
    }

    send(data: Uint8Array) {
      // Like a browser's data channel, which refuses messages over about 256 KB.
      if (data.length > 256 * 1024) throw new Error(`Message too big: ${data.length} bytes`);
      const other = this.other;
      if (this.closed || !other || other.closed) return;
      const copy = data.slice();
      queueMicrotask(() => other.onMessage(copy));
    }

    close() {
      if (this.closed) return;
      this.closed = true;
      const other = this.other;
      if (other && !other.closed) queueMicrotask(() => other.onClose());
    }
  }

  return () => new FakeEnd();
}
