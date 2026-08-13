/**
 * Where a learner has got to in a seed's rotation.
 *
 * A seed names a sequence of papers, and the point of the sequence is that
 * attempt 2 shares nothing with attempt 1. That only helps if coming back to the
 * app continues the sequence instead of starting a fresh one, so the position is
 * kept in the browser. It is a convenience, not a source of truth: the address
 * alone still determines the paper, and losing this only costs the learner some
 * repeated questions.
 */

const KEY = "learners:cursor";

export interface Cursor {
  seed: string;
  /** The attempt to serve next. 1-based, so a fresh learner starts at 1. */
  nextAttempt: number;
}

/**
 * localStorage throws rather than returning null in a few real situations -
 * Safari private browsing, storage disabled by policy - and none of them are
 * worth failing a page over.
 */
export function readCursor(): Cursor | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { seed, nextAttempt } = parsed as Partial<Cursor>;
    if (typeof seed !== "string" || seed.length === 0) return null;
    if (typeof nextAttempt !== "number" || !Number.isInteger(nextAttempt)) return null;
    if (nextAttempt < 1) return null;
    return { seed, nextAttempt };
  } catch {
    return null;
  }
}

export function writeCursor(cursor: Cursor): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cursor));
  } catch {
    // Not being able to remember the position is not worth surfacing.
  }
}
