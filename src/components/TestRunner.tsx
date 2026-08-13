"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AssembledTest } from "@/lib/assemble";
import { CODE_LABELS, TOPIC_LABELS } from "@/lib/blueprint";
import type { Explanation } from "@/lib/explain";
import { writeCursor } from "@/lib/cursor";
import { scoreTest, type AnswerSheet } from "@/lib/score";
import type { OptionKey } from "@/lib/schema";
import Artwork from "./Artwork";
import { PreviewBannerCompact } from "./PreviewBanner";
import ReviewList from "./ReviewList";

function formatTime(totalSeconds: number): string {
  const clamped = Math.max(0, totalSeconds);
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function TestRunner({
  test,
  explanations,
}: {
  test: AssembledTest;
  explanations: Record<string, Explanation>;
}) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<AnswerSheet>({});
  const [submitted, setSubmitted] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(test.durationMinutes * 60);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const questionRef = useRef<HTMLDivElement>(null);
  const total = test.questions.length;
  const question = test.questions[index];
  const answeredCount = Object.keys(answers).length;

  const submit = useCallback(() => {
    setSubmitted(true);
    setConfirmOpen(false);
    window.scrollTo({ top: 0 });
  }, []);

  // Move the rotation on as soon as the paper is opened, not when it is marked:
  // an abandoned attempt has still been read, and serving it again as the "next"
  // test is exactly the repetition the rotation exists to prevent.
  useEffect(() => {
    writeCursor({ seed: test.seed, nextAttempt: test.attempt + 1 });
  }, [test.seed, test.attempt]);

  useEffect(() => {
    if (submitted) return;
    const timer = window.setInterval(() => {
      setSecondsLeft((current) => {
        if (current <= 1) {
          window.clearInterval(timer);
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [submitted]);

  // Time is up: submit whatever has been answered, as the real test would.
  useEffect(() => {
    if (secondsLeft === 0 && !submitted) submit();
  }, [secondsLeft, submitted, submit]);

  const result = useMemo(
    () => (submitted ? scoreTest(test, answers) : null),
    [submitted, test, answers],
  );

  function choose(key: OptionKey) {
    setAnswers((current) => ({ ...current, [question.uid]: key }));
  }

  function go(nextIndex: number) {
    setIndex(Math.min(Math.max(nextIndex, 0), total - 1));
    questionRef.current?.scrollIntoView({ block: "start" });
  }

  if (submitted && result) {
    return (
      <ReviewList
        test={test}
        answers={answers}
        result={result}
        explanations={explanations}
      />
    );
  }

  const timeLow = secondsLeft <= 5 * 60;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-4 pb-28">
      <header className="sticky top-0 z-10 -mx-4 border-b border-line bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3 text-sm">
          {/* The number the paper prints, not the position in the run. They differ:
              the signs section starts at 5 and the vehicle block at 95. */}
          <span className="font-medium">
            Question {question.officialNumber}
            <span className="text-muted">
              {" "}
              &middot; {index + 1} of {total}
            </span>
          </span>
          <span
            className={`tabular-nums font-semibold ${timeLow ? "text-wrong" : "text-muted"}`}
            aria-live="off"
          >
            {formatTime(secondsLeft)}
          </span>
        </div>
        {/* Fixed-height track: the bar must not change the layout as it fills. */}
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-200"
            style={{ width: `${((index + 1) / total) * 100}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-muted">
          Section {question.officialSection} &middot; {TOPIC_LABELS[question.topic]} &middot;{" "}
          {answeredCount} of {total} answered
        </p>
        {/* Inside the sticky header on purpose: a preview must be labelled on
            every question, not on the one the learner happened to start at. */}
        {test.preview && <PreviewBannerCompact notice={test.preview} />}
      </header>

      <div ref={questionRef} className="scroll-mt-28 pt-5">
        <h1 className="text-lg font-medium leading-snug">{question.text}</h1>

        {question.stemArtworkUrl && (
          <div className="mt-4">
            <Artwork
              src={question.stemArtworkUrl}
              alt={`Artwork for question ${question.officialNumber}`}
              large
            />
            {question.imageType === "labelled_diagram" && question.labels.length > 0 && (
              <p className="mt-2 text-xs text-muted">
                Labelled {question.labels.join(", ")}
              </p>
            )}
          </div>
        )}

        <ul className="mt-5 flex flex-col gap-2.5">
          {question.options.map((option) => {
            const selected = answers[question.uid] === option.key;
            return (
              <li key={option.key}>
                <button
                  type="button"
                  onClick={() => choose(option.key)}
                  aria-pressed={selected}
                  className={`flex w-full items-center gap-3 rounded-xl border p-3.5 text-left transition-colors min-h-14 ${
                    selected
                      ? "border-accent bg-accent-soft"
                      : "border-line bg-surface hover:border-accent/60"
                  }`}
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold ${
                      selected
                        ? "border-accent bg-accent text-white"
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
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <nav className="fixed inset-x-0 bottom-0 border-t border-line bg-background/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-3 px-4 py-3">
          <button
            type="button"
            onClick={() => go(index - 1)}
            disabled={index === 0}
            className="min-h-12 rounded-lg border border-line px-4 text-sm font-medium disabled:opacity-40"
          >
            Back
          </button>
          {index === total - 1 ? (
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className="min-h-12 flex-1 rounded-lg bg-accent px-4 text-sm font-semibold text-white"
            >
              Finish and mark
            </button>
          ) : (
            <button
              type="button"
              onClick={() => go(index + 1)}
              className="min-h-12 flex-1 rounded-lg bg-accent px-4 text-sm font-semibold text-white"
            >
              Next
            </button>
          )}
        </div>
      </nav>

      {confirmOpen && (
        <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5">
            <h2 className="text-base font-semibold">Finish the test?</h2>
            <p className="mt-2 text-sm text-muted">
              {answeredCount === total
                ? "All questions answered."
                : `${total - answeredCount} question${total - answeredCount === 1 ? "" : "s"} still unanswered. Unanswered questions are marked wrong.`}
            </p>
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="min-h-12 flex-1 rounded-lg border border-line text-sm font-medium"
              >
                Keep going
              </button>
              <button
                type="button"
                onClick={submit}
                className="min-h-12 flex-1 rounded-lg bg-accent text-sm font-semibold text-white"
              >
                Finish
              </button>
            </div>
          </div>
        </div>
      )}

      <p className="mt-8 text-xs text-muted">
        {CODE_LABELS[test.code]} &middot; attempt {test.attempt} &middot; seed{" "}
        <span className="font-mono">{test.seed}</span> &middot;{" "}
        <Link href="/" className="text-accent">
          start over
        </Link>
      </p>
    </main>
  );
}
