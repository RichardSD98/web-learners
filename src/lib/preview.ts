import {
  assemblePreview,
  assembleTest,
  BlueprintNotSpecifiedError,
  InsufficientQuestionsError,
  type AssembledTest,
} from "./assemble";
import type { ServableQuestion } from "./bank";
import type { LicenceCode } from "./blueprint";
import type { TopicKey } from "./schema";

/**
 * Preview mode: serve a paper the bank cannot fill, labelled as not the test.
 *
 * On by default, because a learner who opens this app should be able to sit
 * something. A bank that cannot fill the official quotas used to mean a dead
 * end, and a dead end helps nobody: the questions in it are real questions with
 * real answers, and working through them is worth doing even when there are not
 * yet 90 of them.
 *
 * What that costs is the guarantee that anything served is the examination, and
 * the labelling is what pays for it. A preview says so on every question and on
 * the results, states its real length and which topics are short, and is never
 * marked against the official pass mark - `scoreTest` returns a null pass mark
 * rather than applying 80% to a paper the regulation says nothing about. None of
 * that is optional or dismissible, and none of it is affected by this flag.
 *
 * `NEXT_PUBLIC_PREVIEW_MODE=false` restores the strict build, which refuses a
 * short bank outright. That is the right setting for anyone who needs the app to
 * serve the examination or nothing at all.
 */

/**
 * Read at call time rather than captured at import, so a test can toggle it.
 *
 * The expression is written out literally because Next substitutes
 * `process.env.NEXT_PUBLIC_*` textually at build time, so the value is compiled
 * in rather than looked up at runtime. Only the exact string "false" turns this
 * off: an unset, empty or misspelled variable leaves the app usable rather than
 * silently returning it to a dead end.
 */
export function previewModeEnabled(): boolean {
  return process.env.NEXT_PUBLIC_PREVIEW_MODE !== "false";
}

/**
 * What to put on screen for a requested paper.
 *
 * The decision is here, apart from the page that renders it, so that "does the
 * flag being off still refuse?" is a question about a function rather than about
 * a React tree.
 */
export type PaperResolution =
  | { kind: "paper"; test: AssembledTest }
  | { kind: "preview"; test: AssembledTest }
  | { kind: "unavailable"; error: InsufficientQuestionsError | BlueprintNotSpecifiedError };

export function resolvePaper(
  seed: string,
  code: LicenceCode,
  pool: Record<TopicKey, ServableQuestion[]>,
  attempt: number = 1,
): PaperResolution {
  try {
    return { kind: "paper", test: assembleTest(seed, code, pool, attempt) };
  } catch (error) {
    if (
      !(error instanceof InsufficientQuestionsError) &&
      !(error instanceof BlueprintNotSpecifiedError)
    ) {
      throw error;
    }

    // A shortfall is a bank that is too small, which a preview can work around.
    // An unspecified blueprint is nobody knowing what the paper contains, which
    // it cannot: there is no set of quotas to fall short of. Preview mode does
    // not turn that into a guess.
    if (previewModeEnabled() && error instanceof InsufficientQuestionsError) {
      const test = assemblePreview(seed, code, pool, attempt);
      // An empty bank previews as nothing at all, which is a blank screen rather
      // than a preview. Fall through to the refusal, which at least explains it.
      if (test.questions.length > 0) return { kind: "preview", test };
    }

    return { kind: "unavailable", error };
  }
}
