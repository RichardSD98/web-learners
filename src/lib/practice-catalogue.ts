import { existsSync } from "node:fs";
import { join } from "node:path";

import { loadCorpus } from "./bank";
import {
  assemblePractice,
  eligibleSigns,
  type EligibleSign,
  type PracticeRound,
} from "./practice";

/**
 * The half of sign practice that reads the disk.
 *
 * Kept apart from practice.ts so that module stays importable from the browser:
 * the runner component needs its types and its class labels, and a single
 * `node:fs` import anywhere in that file's graph would pull the filesystem into
 * the client bundle. Server-side callers use this; the client never imports it.
 */

/**
 * Where a sign's artwork lives, or null when the file is not there.
 *
 * The same rule the question bank applies: a question about a picture that does
 * not exist is not a question, so the sign is dropped rather than shown blank.
 */
export function signArtwork(ref: string): string | null {
  const url = `/signs/${ref}.svg`;
  return existsSync(join(process.cwd(), "public", url)) ? url : null;
}

/** Every catalogue sign, as the app already loads and validates it. */
export function catalogueSigns() {
  return [...loadCorpus().signsByRef.values()];
}

/** Signs that can be asked about, for counting on the home page. */
export function practicePool(): EligibleSign[] {
  return eligibleSigns(catalogueSigns(), signArtwork);
}

export function loadPracticeRound(seed: string, length?: number): PracticeRound {
  return assemblePractice(seed, catalogueSigns(), signArtwork, length);
}
