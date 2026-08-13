import Link from "next/link";

import StartTest from "@/components/StartTest";
import { loadCorpus, servableByTopic } from "@/lib/bank";
import {
  blueprintLength,
  buildBlueprint,
  CODE_LABELS,
  GENERAL_DUTIES_MINIMUM,
  OFFICIAL_LAYOUT,
  OFFICIAL_TEST_LENGTH,
  PASS_MARK_CORRECT,
  PASS_RATIO,
  PAPER_VARIANTS,
  TEST_DURATION_MINUTES,
  TOPIC_LABELS,
  TOPIC_QUOTAS,
  type LicenceCode,
  type PaperVariant,
} from "@/lib/blueprint";
import { PRACTICE_ROUND_LENGTH } from "@/lib/practice";
import { practicePool } from "@/lib/practice-catalogue";
import { previewModeEnabled } from "@/lib/preview";
import { generateSeed, makeRng } from "@/lib/random";
import { isSignsTopic } from "@/lib/schema";

export const dynamic = "force-dynamic";

interface QuotaRow {
  label: string;
  needs: number;
  has: number;
  subRequirement: boolean;
}

/**
 * Measure the bank against one paper's quotas.
 *
 * Every row is reported, met or not. A page that listed only the gaps would let a
 * reader assume the rest was comfortable, when most of it is met by a margin of
 * one or two questions.
 */
function paperAvailability(variant: PaperVariant, code: LicenceCode) {
  if (TOPIC_QUOTAS[variant] === null) {
    return { specified: false as const, code };
  }

  const pool = servableByTopic(loadCorpus());
  const rows: QuotaRow[] = [];
  // Eligible questions and quota slots, split the way the paper's two marked
  // sections are, because a preview is capped section by section.
  const bySection = new Map<string, { has: number; quota: number }>();

  for (const slot of buildBlueprint(variant)) {
    const questions = pool[slot.topic];
    const section = isSignsTopic(slot.topic) ? "B" : "D";
    const tally = bySection.get(section) ?? { has: 0, quota: 0 };
    bySection.set(section, {
      has: tally.has + questions.length,
      quota: tally.quota + slot.count,
    });

    rows.push({
      label: TOPIC_LABELS[slot.topic],
      needs: slot.count,
      has: questions.length,
      subRequirement: false,
    });
    if (slot.generalDutiesMinimum > 0) {
      rows.push({
        label: "of which general duties of a driver",
        needs: slot.generalDutiesMinimum,
        has: questions.filter((q) => q.generalDuties).length,
        subRequirement: true,
      });
    }
  }

  const needed = blueprintLength(variant);
  const fillable = rows
    .filter((row) => !row.subRequirement)
    .reduce((sum, row) => sum + Math.min(row.needs, row.has), 0);

  // What a preview would come to: per section, every eligible question in that
  // section's topics, capped at the section's real length. Higher than
  // `fillable` because a preview also takes the surplus a quota has no room for,
  // and that is what makes it a preview rather than a shorter test. It matches
  // what assemblePreview actually draws — a section's padding stops at the same
  // cap — so this figure is a promise the start screen can keep.
  const previewLength = [...bySection.values()].reduce(
    (sum, section) => sum + Math.min(section.quota, section.has),
    0,
  );

  return {
    specified: true as const,
    code,
    rows,
    needed,
    fillable,
    previewLength,
    available: rows.every((row) => row.has >= row.needs),
  };
}

export default async function HomePage() {
  const corpus = loadCorpus();
  // Codes 2 and 3 are one entry, not two. They answer the same block from the
  // same pool, so offering them separately would promise a choice that does not
  // exist and hand out two papers made of the same questions.
  const papers = PAPER_VARIANTS.map(({ variant, code }) => ({
    variant,
    code,
    availability: paperAvailability(variant, code),
  }));

  // Seed generated per render so a first-time learner gets a fresh sequence.
  // Anyone part-way through one keeps theirs: StartTest overrides this with the
  // position stored in the browser.
  const seed = generateSeed(makeRng(String(Date.now())));

  const previewMode = previewModeEnabled();
  const layout = OFFICIAL_LAYOUT["2+3"];

  // How much of the catalogue sign practice can actually ask about. Counted here
  // rather than asserted, so the card cannot promise more signs than exist.
  const signPractice = {
    catalogueSize: corpus.signsByRef.size,
    poolSize: practicePool().length,
  };

  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 pb-16 pt-8">
      <header className="mb-8">
        <p className="text-sm font-medium text-accent">Namibia</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
          Learner&apos;s Licence practice test
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Two different things to work through: the examination itself, assembled from
          past papers, and sign practice drawn from the manual&apos;s own catalogue. They
          are kept apart on purpose — only the first is the test.
        </p>
      </header>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
        The examination
      </h2>
      <p className="mb-4 text-sm leading-relaxed text-muted">
        The full paper: {OFFICIAL_TEST_LENGTH} questions in {TEST_DURATION_MINUTES}{" "}
        minutes, pass at {Math.round(PASS_RATIO * 100)}% — {PASS_MARK_CORRECT} correct.
        Every question comes from a past paper and is shown with its source.
      </p>

      <section className="mb-8 rounded-xl border border-line bg-surface-2 p-4">
        <h2 className="text-sm font-semibold">How the paper is laid out</h2>
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {layout.map((section) => (
            <li key={section.label} className="flex items-baseline justify-between gap-3">
              <span>
                <span className="font-medium">Section {section.label}</span>
                {section.printedAs && (
                  <span className="text-muted"> (printed as {section.printedAs})</span>
                )}{" "}
                <span className="text-muted">{section.title}</span>
              </span>
              <span className="shrink-0 tabular-nums text-muted">
                q{section.firstNumber}&ndash;{section.lastNumber}
                {!section.marked && " · not marked"}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 border-t border-line pt-3 text-xs leading-relaxed text-muted">
          The numbering jumps from 65 to 95 because questions 66&ndash;94 are the
          motorcycle section, which a Code 2 or 3 candidate does not answer. Of the 15
          rules questions, at least {GENERAL_DUTIES_MINIMUM} are on the general duties of
          a driver.
        </p>
      </section>

      <h3 className="mb-3 text-sm font-semibold">Choose your licence code</h3>

      <ul className="flex flex-col gap-3">
        {papers.map(({ variant, code, availability }) => {
          if (!availability.specified) {
            return (
              <li key={variant}>
                <div className="rounded-xl border border-line bg-surface-2 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-medium">{CODE_LABELS[code]}</span>
                    <span className="shrink-0 rounded-full bg-warn-soft px-2.5 py-1 text-xs font-semibold text-warn">
                      Unavailable
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-muted">
                    The signs section is the same 61 compulsory questions, but the split
                    of this code&apos;s own 29-question block across rules, legislation and
                    controls is not stated in any source this project holds. Reusing the
                    Code 2/3 numbers would be a guess that looked exactly like a
                    measurement, so no paper is offered.
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-muted">
                    Separately, the answer key for the source paper left the motorcycle
                    section unmarked, so no motorcycle question has a verified answer
                    either.
                  </p>
                </div>
              </li>
            );
          }

          const { rows, needed, fillable, previewLength, available } = availability;

          if (!available) {
            return (
              <li key={variant}>
                <div className="rounded-xl border border-line bg-surface-2 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-medium">{CODE_LABELS[code]}</span>
                    <span className="shrink-0 rounded-full bg-warn-soft px-2.5 py-1 text-xs font-semibold text-warn">
                      {previewMode ? "Preview" : "Unavailable"}
                    </span>
                  </div>

                  {previewMode ? (
                    <>
                      <p className="mt-2 text-sm leading-relaxed text-muted">
                        The bank can fill {fillable} of the {needed} slots in a full
                        paper, so this serves a {previewLength}-question preview rather
                        than nothing at all. Every question in it was printed on a real
                        paper with the answer that paper gave — there are not yet enough
                        of them to make the examination, which is what the table below
                        shows.
                      </p>

                      <StartTest
                        code={code}
                        seed={seed}
                        className="mt-4 block rounded-xl border border-line bg-surface p-4 transition-colors hover:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <span className="font-medium">Sit the preview</span>
                          <span className="shrink-0 text-sm text-accent">Start &rarr;</span>
                        </div>
                        <p className="mt-2 text-sm text-muted">
                          {previewLength} questions &middot; {TEST_DURATION_MINUTES}{" "}
                          minutes &middot; no pass mark
                        </p>
                      </StartTest>

                      <p className="mt-3 text-xs leading-relaxed text-muted">
                        It is labelled a preview on every question and on the results,
                        and it is not marked against the {PASS_MARK_CORRECT}-correct pass
                        mark — a score on {previewLength} questions says nothing about
                        whether you would pass a paper of {needed}. Treat it as practice,
                        not as a mock.
                      </p>

                      <h4 className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted">
                        Where the bank falls short
                      </h4>
                    </>
                  ) : (
                    <p className="mt-2 text-sm leading-relaxed text-muted">
                      The bank can fill {fillable} of the {needed} slots in a full paper.
                      A shortened paper is deliberately not offered in its place — the
                      quotas below are the test, and {fillable} questions drawn in the
                      same proportions would be a different examination presented as this
                      one.
                    </p>
                  )}

                  <table className="mt-4 w-full text-sm">
                    <thead>
                      <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                        <th className="pb-1.5 text-left font-semibold">Topic</th>
                        <th className="pb-1.5 text-right font-semibold">Needs</th>
                        <th className="pb-1.5 text-right font-semibold">Has</th>
                        <th className="pb-1.5 text-right font-semibold">Short</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => {
                        const short = Math.max(0, row.needs - row.has);
                        return (
                          <tr
                            key={row.label}
                            className="border-b border-line/60 last:border-0"
                          >
                            <td
                              className={`py-1.5 ${row.subRequirement ? "pl-4 text-muted" : ""}`}
                            >
                              {row.label}
                            </td>
                            <td className="py-1.5 text-right tabular-nums text-muted">
                              {row.needs}
                            </td>
                            <td className="py-1.5 text-right tabular-nums text-muted">
                              {row.has}
                            </td>
                            <td
                              className={`py-1.5 text-right tabular-nums font-medium ${short > 0 ? "text-warn" : "text-muted"}`}
                            >
                              {short > 0 ? short : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                </div>
              </li>
            );
          }

          return (
            <li key={variant}>
              <StartTest
                code={code}
                seed={seed}
                className="block rounded-xl border border-line bg-surface p-4 transition-colors hover:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="font-medium">{CODE_LABELS[code]}</span>
                  <span className="shrink-0 text-sm text-accent">Start &rarr;</span>
                </div>
                <p className="mt-2 text-sm text-muted">
                  {needed} questions &middot; {TEST_DURATION_MINUTES} minutes &middot; pass
                  at {PASS_MARK_CORRECT}
                </p>
              </StartTest>
            </li>
          );
        })}
      </ul>

      {/* The second kind of test. Separate heading, separate address, and its own
          statement of what it is: it is composed from the catalogue rather than
          taken from a paper, which the examination above never does. */}
      <h2 className="mb-3 mt-10 text-sm font-semibold uppercase tracking-wide text-muted">
        Sign practice
      </h2>
      <p className="mb-4 text-sm leading-relaxed text-muted">
        The manual catalogues {signPractice.catalogueSize} road signs with their names and
        meanings. This asks you about {signPractice.poolSize} of them —{" "}
        {PRACTICE_ROUND_LENGTH} a round, mixed across the six categories in the
        proportions the paper&apos;s signs section uses, marked as you answer, each one
        followed by the manual&apos;s own wording and the page it is on.
      </p>
      <p className="mb-4 text-sm leading-relaxed text-muted">
        The wrong answers are near misses on purpose: they are drawn from the same page
        of the manual as the sign in question and from its own family of names, so a
        round is a choice between Stop, Stop/Yield and 4-Way Stop rather than between
        three signs that look nothing alike.
      </p>

      <Link
        href={`/practice/${encodeURIComponent(seed)}`}
        className="block rounded-xl border border-line bg-surface p-4 transition-colors hover:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <div className="flex items-start justify-between gap-3">
          <span className="font-medium">Road signs from the manual</span>
          <span className="shrink-0 text-sm text-accent">Practise &rarr;</span>
        </div>
        <p className="mt-2 text-sm text-muted">
          {PRACTICE_ROUND_LENGTH} signs &middot; all six categories &middot; no time limit
          &middot; answers shown as you go
        </p>
      </Link>

      <p className="mt-3 text-xs leading-relaxed text-muted">
        These questions are composed from the catalogue, not taken from a past paper, so
        they are not examination questions and carry no pass mark. Nothing in them is
        written by this app: the right answer is the manual&apos;s name for the sign and
        every wrong answer is another real sign&apos;s name.
      </p>

      <section className="mt-10 rounded-xl border border-line bg-surface-2 p-4">
        <h2 className="text-sm font-semibold">Where these questions come from</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {corpus.servable.length} questions are verified and servable, drawn from past
          papers whose answer key could be read directly from the document. Questions with
          no stated answer, with unreadable artwork, or whose answer is disputed are
          excluded — {corpus.excluded.length} in total. No examination question is
          generated: each one was printed on a paper, with the answer that paper gave.
          Sign practice is the exception and says so — its questions are composed from the
          catalogue above, which is why it is kept out of the examination entirely.
        </p>
        {!corpus.topicLabels.reviewed && (
          <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-xs leading-relaxed text-warn">
            Which topic each question belongs to was assigned automatically and has not
            been reviewed by a person — {corpus.topicLabels.unreviewed} of{" "}
            {corpus.servable.length} servable questions. A label decides only which quota a
            question counts toward; it cannot change a question or its answer. The counts
            above should be checked before they are relied on.
          </p>
        )}
      </section>
    </main>
  );
}
