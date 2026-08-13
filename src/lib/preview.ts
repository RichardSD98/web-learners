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
 * This exists so the flow can be walked through - timer, question order,
 * artwork, review - while the bank is still being transcribed. It is a
 * development affordance, and the build flag is the whole safety property: with
 * the flag unset, which is every build that does not deliberately set it, this
 * module changes nothing and a short bank still refuses.
 *
 * The refusal is the honest default and stays the default. Preview does not
 * relax it for a learner; it steps around it for whoever is building the thing,
 * and it says so on every screen it produces.
 */

/**
 * Read at call time rather than captured at import, so a test can toggle it.
 *
 * The expression is written out literally because Next substitutes
 * `process.env.NEXT_PUBLIC_*` textually at build time. A build without the flag
 * has `false` compiled in, not a lookup that could go the other way at runtime.
 */
export function previewModeEnabled(): boolean {
  return process.env.NEXT_PUBLIC_PREVIEW_MODE === "true";
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
