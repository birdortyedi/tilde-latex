// One thing at a time in the TeX engine: a compile, or a formula the maths
// preview typesets. The engine's worker takes one job at a time (each new job
// replaces the message handler of the one before), so they queue here, in
// the order they asked. Waiting is for the turn before, never for a flag, so
// two jobs can never wait for each other.

export type Release = () => void;

export function engineQueue(): () => Promise<Release> {
  let tail: Promise<void> = Promise.resolve();
  // Resolves when it is this job's turn; call the release when the job is done.
  return async () => {
    let release: Release = () => {};
    const done = new Promise<void>((resolve) => { release = resolve; });
    const before = tail;
    tail = before.then(() => done);
    await before;
    return release;
  };
}
