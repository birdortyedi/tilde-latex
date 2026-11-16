import { diff } from '@codemirror/merge';
import { ChangeSet } from '@codemirror/state';

// Edits made to a shared project's plain files outside Tilde (on the Drive
// website, with Drive for desktop, or in another editor): the owner's Tilde
// merges them into the shared text (see sharedSync.ts).
//
// `base` is the file as Tilde last wrote it, `ours` the shared text now
// (which may have others' edits since), `theirs` the file as it is now.
// Returns the changes that bring the outside edit into the shared text, or
// null when the outside edit touches the same place as an edit in Tilde.
export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

export function mergeOutside(base: string, ours: string, theirs: string): TextChange[] | null {
  if (theirs === base || theirs === ours) return [];
  const theirChanges = diff(base, theirs);
  const ourChanges = diff(base, ours);
  // Every outside change is in ours already (Tilde's own earlier write, say): nothing to bring in.
  const included = (t: (typeof theirChanges)[number]) => ourChanges.some((o) => o.fromA === t.fromA && o.toA === t.toA
    && ours.slice(o.fromB, o.toB) === theirs.slice(t.fromB, t.toB));
  if (theirChanges.every(included)) return [];
  // Changes that overlap or touch would need a person to decide.
  for (const t of theirChanges) {
    for (const o of ourChanges) if (t.fromA <= o.toA && o.fromA <= t.toA) return null;
  }
  const changeSet = (text: string, changes: typeof theirChanges) =>
    ChangeSet.of(changes.map((c) => ({ from: c.fromA, to: c.toA, insert: text.slice(c.fromB, c.toB) })), base.length);
  // Their changes, moved to where they belong after ours.
  const mapped = changeSet(theirs, theirChanges).map(changeSet(ours, ourChanges));
  const out: TextChange[] = [];
  mapped.iterChanges((from, to, _fromB, _toB, inserted) => out.push({ from, to, insert: inserted.toString() }));
  return out;
}

// "chapters/intro.tex" → "chapters/intro (changed outside Tilde).tex";
// with n, "… (changed outside Tilde 2).tex" for a further one.
export function outsideCopyPath(path: string, n?: number): string {
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  const label = n ? `(changed outside Tilde ${n})` : '(changed outside Tilde)';
  return dot > slash + 1 ? `${path.slice(0, dot)} ${label}${path.slice(dot)}` : `${path} ${label}`;
}
