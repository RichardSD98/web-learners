"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { signClassLabel, type PracticeQuestion, type PracticeRound } from "@/lib/practice";
import type { OptionKey } from "@/lib/schema";
import Artwork from "./Artwork";

/**
 * Sign practice, marked as you go.
 *
 * Deliberately not the examination's flow. There is no clock, no submit step and
 * no pass mark: you answer, you are told immediately, and the manual's own entry
 * for that sign is shown while you are still looking at it. That is what makes
 * this a study tool rather than a second exam, and it is why it does not reuse
 * TestRunner - the timer and the sit-it-then-mark-it shape are the examination's
 * subject matter, not this one's.
 */
export default function PracticeRunner({ round }: { round: PracticeRound }) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, OptionKey>>({});
  const [finished, setFinished] = useState(false);

  const total = round.questions.length;
  const question = round.questions[index];
  const chosen = question ? answers[question.ref] : undefined;

  const correctCount = useMemo(
    () =>
      round.questions.filter((q) => answers[q.ref] === q.answer).length,
    [round.questions, answers],
  );
  const answeredCount = Object.keys(answers).length;

  function choose(key: OptionKey) {
    // One answer per sign: this marks immediately, so changing it afterwards
    // would just be marking your own homework.
    if (chosen !== undefined) return;
    setAnswers((current) => ({ ...current, [question.ref]: key }));
  }

  function next() {
    if (index + 1 >= total) setFinished(true);
    else setIndex(index + 1);
    window.scrollTo({ top: 0 });
  }

  if (finished) {
    return <Summary round={round} answers={answers} correct={correctCount} />;
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-4 pb-28">
      <header className="sticky top-0 z-10 -mx-4 border-b border-line bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="font-medium">
            Sign {index + 1}
            <span className="text-muted"> of {total}</span>
          </span>
          <span className="tabular-nums text-muted">
            {correctCount} correct of {answeredCount}
          </span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-200"
            style={{ width: `${((index + 1) / total) * 100}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-muted">
          {signClassLabel(question.sign.signClass)} &middot; practice from the manual&apos;s
          sign catalogue, not the examination
        </p>
      </header>

      <div className="pt-5">
        <h1 className="text-lg font-medium leading-snug">{question.text}</h1>

        {question.stemArtworkUrl && (
          <div className="mt-4">
            <Artwork src={question.stemArtworkUrl} alt="The sign in question" large />
          </div>
        )}

        <ul className="mt-5 flex flex-col gap-2.5">
          {question.options.map((option) => {
            const isAnswer = option.key === question.answer;
            const isChosen = option.key === chosen;
            const answered = chosen !== undefined;

            const tone = !answered
              ? "border-line bg-surface hover:border-accent/60"
              : isAnswer
                ? "border-correct bg-correct-soft"
                : isChosen
                  ? "border-wrong bg-wrong-soft"
                  : "border-line bg-surface opacity-60";

            return (
              <li key={option.key}>
                <button
                  type="button"
                  onClick={() => choose(option.key)}
                  disabled={answered}
                  aria-pressed={isChosen}
                  className={`flex w-full items-center gap-3 rounded-xl border p-3.5 text-left transition-colors min-h-14 ${tone}`}
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold ${
                      answered && isAnswer
                        ? "border-correct text-correct"
                        : answered && isChosen
                          ? "border-wrong text-wrong"
                          : "border-line text-muted"
                    }`}
                  >
                    {option.key}
                  </span>
                  {option.artworkUrl ? (
                    <Artwork src={option.artworkUrl} alt={`Option ${option.key}`} />
                  ) : (
                    <span className="text-[15px] leading-snug">{option.text}</span>
                  )}
                  {answered && (isAnswer || isChosen) && (
                    <span className="ml-auto shrink-0 text-xs font-semibold">
                      {isAnswer ? (
                        <span className="text-correct">Correct</span>
                      ) : (
                        <span className="text-wrong">You chose</span>
                      )}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        {chosen !== undefined && <FromTheManual question={question} />}
      </div>

      <nav className="fixed inset-x-0 bottom-0 border-t border-line bg-background/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-3 px-4 py-3">
          <Link
            href="/"
            className="flex min-h-12 items-center rounded-lg border border-line px-4 text-sm font-medium"
          >
            Leave
          </Link>
          <button
            type="button"
            onClick={next}
            disabled={chosen === undefined}
            className="min-h-12 flex-1 rounded-lg bg-accent px-4 text-sm font-semibold text-white disabled:opacity-40"
          >
            {chosen === undefined
              ? "Choose an answer"
              : index + 1 >= total
                ? "See how you did"
                : "Next sign"}
          </button>
        </div>
      </nav>
    </main>
  );
}

/**
 * The catalogue entry, shown once the answer is in.
 *
 * Quoted, not summarised, and cited to the page it was read from. Where the
 * catalogue records no meaning for a sign, this says so rather than filling the
 * space with a sentence of its own.
 */
function FromTheManual({ question }: { question: PracticeQuestion }) {
  const { sign } = question;
  return (
    <div className="mt-5 rounded-xl border border-line bg-accent-soft p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-accent">
        From the manual
      </p>
      <p className="mt-1 text-base font-medium">{sign.name}</p>
      {sign.meaning ? (
        <p className="mt-1.5 text-sm leading-relaxed">{sign.meaning}</p>
      ) : (
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          The catalogue records no meaning for this sign.
        </p>
      )}
      <p className="mt-2 text-xs text-muted">
        {signClassLabel(sign.signClass)}
        {sign.folio != null && ` · manual page ${sign.folio}`}
        {sign.nameFromPage && " · name read from the page"}
      </p>
    </div>
  );
}

function Summary({
  round,
  answers,
  correct,
}: {
  round: PracticeRound;
  answers: Record<string, OptionKey>;
  correct: number;
}) {
  const missed = round.questions.filter((q) => answers[q.ref] !== q.answer);

  // Scored per category, in the order the round asked them, so a weak category
  // is visible rather than averaged away into the total.
  const byCategory = round.categories.map((category) => {
    const asked = round.questions.filter((q) => q.sign.signClass === category.signClass);
    return {
      signClass: category.signClass,
      total: asked.length,
      correct: asked.filter((q) => answers[q.ref] === q.answer).length,
    };
  });

  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 pb-20 pt-8">
      <h1 className="text-2xl font-semibold tracking-tight">
        {correct} of {round.questions.length} signs
      </h1>
      <p className="mt-1 text-sm text-muted">
        Practice from the manual&apos;s sign catalogue. There is no pass mark here — this
        is not the examination, and nothing on this screen predicts it.
      </p>

      <section className="mt-5 rounded-xl border border-line bg-surface p-4">
        <h2 className="text-sm font-semibold">By category</h2>
        <ul className="mt-3 flex flex-col gap-3">
          {byCategory.map((category) => (
            <li key={category.signClass}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-medium">{signClassLabel(category.signClass)}</span>
                <span className="tabular-nums font-semibold text-muted">
                  {category.correct}/{category.total}
                </span>
              </div>
              <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-surface-2">
                <div
                  className={`h-full rounded-full ${
                    category.correct * 2 >= category.total ? "bg-correct" : "bg-warn"
                  }`}
                  style={{
                    width: `${category.total === 0 ? 0 : (category.correct / category.total) * 100}%`,
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-3 border-t border-line pt-3 text-xs leading-relaxed text-muted">
          The categories are asked in the proportions the paper&apos;s signs section uses —
          it puts 61 of its 90 questions on signs, weighted this way. That makes the
          practice representative of the signs section; it does not make it the paper.
        </p>
      </section>

      {missed.length > 0 ? (
        <section className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Worth another look ({missed.length})
          </h2>
          <ul className="mt-3 flex flex-col gap-3">
            {missed.map((question) => (
              <li
                key={question.ref}
                className="flex items-start gap-3 rounded-xl border border-line bg-surface p-3"
              >
                <Artwork src={`/signs/${question.ref}.svg`} alt={question.sign.name} />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{question.sign.name}</p>
                  {question.sign.meaning && (
                    <p className="mt-1 text-xs leading-relaxed text-muted">
                      {question.sign.meaning}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-muted">
                    {signClassLabel(question.sign.signClass)}
                    {question.sign.folio != null && ` · manual page ${question.sign.folio}`}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="mt-6 rounded-xl border border-line bg-surface p-6 text-center text-sm text-muted">
          Every one right.
        </p>
      )}

      <footer className="mt-10 border-t border-line pt-4 text-xs leading-relaxed text-muted">
        <p>
          Drawn from {round.poolSize} of the {round.catalogueSize} signs in the manual&apos;s
          catalogue. Seed <span className="font-mono">{round.seed}</span> — opening this
          address again gives the identical round.
        </p>
        <div className="mt-3 flex gap-4">
          <Link href={`/practice/${nextSeed(round.seed)}`} className="text-sm text-accent">
            Another {round.questions.length} signs &rarr;
          </Link>
          <Link href="/" className="text-sm text-accent">
            Home
          </Link>
        </div>
      </footer>
    </main>
  );
}

/**
 * The next round's address, derived from this one.
 *
 * Deliberately not random: the link has to be the same every time this screen
 * renders, or React would produce a different href on the client than the server
 * sent. Walking the seed keeps every round reachable and reproducible.
 */
function nextSeed(seed: string): string {
  const match = /^(.*)-(\d+)$/.exec(seed);
  if (!match) return `${seed}-2`;
  return `${match[1]}-${Number(match[2]) + 1}`;
}
