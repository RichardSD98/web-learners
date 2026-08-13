"use client";

import Link from "next/link";
import { useState } from "react";

import type { AssembledQuestion, AssembledTest } from "@/lib/assemble";
import { CODE_LABELS, PASS_RATIO, TOPIC_LABELS } from "@/lib/blueprint";
import type { Explanation } from "@/lib/explain";
import type { AnswerSheet, TestResult } from "@/lib/score";
import Artwork from "./Artwork";
import { PreviewBannerFull } from "./PreviewBanner";

type Filter = "all" | "wrong";

export default function ReviewList({
  test,
  answers,
  result,
  explanations,
}: {
  test: AssembledTest;
  answers: AnswerSheet;
  result: TestResult;
  explanations: Record<string, Explanation>;
}) {
  const [filter, setFilter] = useState<Filter>("all");

  const wrong = test.questions.filter((q) => answers[q.uid] !== q.answer);
  const shown = filter === "wrong" ? wrong : test.questions;

  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 pb-20 pt-6">
      {/* Above the score, not below it: the first thing read on this screen has
          to be what the score is a score of. */}
      {test.preview && (
        <div className="mb-5">
          <PreviewBannerFull notice={test.preview} />
        </div>
      )}

      <header>
        {/* A preview is scored but not judged. There is no pass mark to hold it
            against, so it is given a count and nothing that reads as a verdict. */}
        <h1 className="text-2xl font-semibold tracking-tight">
          {result.passMark === null
            ? `${result.correct} of ${result.total} correct`
            : result.passed
              ? "Passed"
              : "Not passed"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {result.passMark === null ? (
            <>
              {Math.round(result.ratio * 100)}% of this preview &middot; not marked against
              the {Math.round(PASS_RATIO * 100)}% pass mark
            </>
          ) : (
            <>
              {result.correct} of {result.total} correct &middot;{" "}
              {Math.round(result.ratio * 100)}% &middot; pass mark{" "}
              {result.passMark.correct} ({Math.round(result.passMark.ratio * 100)}%)
            </>
          )}
        </p>
        {result.passMark !== null && result.passed === false && (
          <p className="mt-2 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
            {result.shortBy} more correct answer{result.shortBy === 1 ? "" : "s"} would have
            passed.
          </p>
        )}
      </header>

      <section className="mt-5 rounded-xl border border-line bg-surface p-4">
        <h2 className="text-sm font-semibold">By topic</h2>
        <ul className="mt-3 flex flex-col gap-3">
          {result.topics.map((topic) => {
            const weak = result.weakestTopics.includes(topic.topic);
            return (
              <li key={topic.topic}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-medium">{TOPIC_LABELS[topic.topic]}</span>
                  <span
                    className={`tabular-nums font-semibold ${weak ? "text-warn" : "text-correct"}`}
                  >
                    {topic.correct}/{topic.total}
                  </span>
                </div>
                <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-surface-2">
                  <div
                    className={`h-full rounded-full ${weak ? "bg-warn" : "bg-correct"}`}
                    style={{ width: `${topic.ratio * 100}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 border-t border-line pt-3 text-xs leading-relaxed text-muted">
          {result.passMark === null ? (
            <>
              These are the topics as this preview happened to be able to cover them, not
              as the paper weights them — a topic short of its quota is measured over
              fewer questions, so its percentage moves further per answer. Use it to see
              what to study; there is no pass or fail here.
            </>
          ) : (
            <>
              The paper is marked on the total, not per topic: {result.passMark.correct} of{" "}
              {result.total} correct passes. The breakdown above is there to show you what
              to study — a weak topic does not fail you on its own.
            </>
          )}
        </p>
        {!test.labelsReviewed && (
          <p className="mt-2 text-xs leading-relaxed text-muted">
            Which topic each question was counted under was assigned automatically and has
            not been reviewed, so the split between topics may be imperfect. The marking of
            each individual question is not affected.
          </p>
        )}
      </section>

      <div className="mt-6 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Review
        </h2>
        <div className="flex gap-1 rounded-lg border border-line p-1 text-xs">
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={`rounded px-3 py-1.5 font-medium ${filter === "all" ? "bg-accent text-white" : "text-muted"}`}
          >
            All {test.questions.length}
          </button>
          <button
            type="button"
            onClick={() => setFilter("wrong")}
            className={`rounded px-3 py-1.5 font-medium ${filter === "wrong" ? "bg-accent text-white" : "text-muted"}`}
          >
            Wrong {wrong.length}
          </button>
        </div>
      </div>

      <ul className="mt-3 flex flex-col gap-4">
        {shown.map((question) => (
          <ReviewCard
            key={question.uid}
            question={question}
            chosen={answers[question.uid]}
            explanation={explanations[question.uid]}
          />
        ))}
      </ul>

      {shown.length === 0 && (
        <p className="mt-6 rounded-xl border border-line bg-surface p-6 text-center text-sm text-muted">
          Nothing wrong to review.
        </p>
      )}

      <footer className="mt-10 border-t border-line pt-4 text-xs leading-relaxed text-muted">
        <p>
          {CODE_LABELS[test.code]} &middot; attempt {test.attempt} &middot; seed{" "}
          <span className="font-mono">{test.seed}</span>. Opening this address again gives
          the identical paper.
        </p>
        <p className="mt-1">
          {test.attempt < test.freshAttempts
            ? "The next attempt is drawn from the questions this one did not use, so none of the above will come up again."
            : `This seed has served ${test.freshAttempts} attempt${test.freshAttempts === 1 ? "" : "s"} of fresh questions and the bank is now being reused, so some of the above will come round again.`}
        </p>
        <Link
          href={`/test/${encodeURIComponent(test.seed)}/${test.attempt + 1}?code=${test.code}`}
          className="mt-3 inline-block text-sm text-accent"
        >
          Take another test &rarr;
        </Link>
      </footer>
    </main>
  );
}

function ReviewCard({
  question,
  chosen,
  explanation,
}: {
  question: AssembledQuestion;
  chosen: string | undefined;
  explanation: Explanation | undefined;
}) {
  const isCorrect = chosen === question.answer;

  return (
    <li className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex items-start gap-3 border-b border-line px-4 py-3">
        <span
          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
            isCorrect ? "bg-correct-soft text-correct" : "bg-wrong-soft text-wrong"
          }`}
          aria-hidden
        >
          {isCorrect ? "✓" : "✗"}
        </span>
        <div className="min-w-0">
          <p className="text-[15px] font-medium leading-snug">{question.text}</p>
          <p className="mt-1 text-xs text-muted">
            Question {question.officialNumber} &middot; section {question.officialSection}{" "}
            &middot; {TOPIC_LABELS[question.topic]}
          </p>
        </div>
      </div>

      {question.stemArtworkUrl && (
        <div className="px-4 pt-4">
          <Artwork src={question.stemArtworkUrl} alt="Question artwork" large />
        </div>
      )}

      <ul className="flex flex-col gap-2 p-4">
        {question.options.map((option) => {
          const isAnswer = option.key === question.answer;
          const isChosen = option.key === chosen;
          const tone = isAnswer
            ? "border-correct bg-correct-soft"
            : isChosen
              ? "border-wrong bg-wrong-soft"
              : "border-line";
          return (
            <li
              key={option.key}
              className={`flex items-center gap-3 rounded-lg border p-2.5 ${tone}`}
            >
              <span className="w-5 shrink-0 text-sm font-semibold text-muted">
                {option.key}
              </span>
              {option.artworkUrl ? (
                <Artwork src={option.artworkUrl} alt={`Option ${option.key}`} />
              ) : (
                <span className="text-sm leading-snug">{option.text}</span>
              )}
              <span className="ml-auto shrink-0 text-xs font-medium">
                {isAnswer && <span className="text-correct">Correct</span>}
                {!isAnswer && isChosen && <span className="text-wrong">You chose</span>}
              </span>
            </li>
          );
        })}
      </ul>

      {chosen === undefined && (
        <p className="px-4 pb-3 text-xs text-muted">You did not answer this question.</p>
      )}

      {question.catalogueSign && (
        <div className="mx-4 mb-4 rounded-lg bg-surface-2 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            Official sign
          </p>
          {/* 8 of the 495 signs lost their printed name when the page export
              converted that text to outlines. The artwork is still exact, so it
              is shown; the name is not invented to fill the gap. */}
          {question.catalogueSign.name ? (
            <p className="mt-1 text-sm font-medium">{question.catalogueSign.name}</p>
          ) : (
            <p className="mt-1 text-sm font-medium text-muted">
              Sign {question.catalogueSign.number} — name not recorded
            </p>
          )}
          {question.catalogueSign.meaning && (
            <p className="mt-1 text-sm leading-relaxed text-muted">
              {question.catalogueSign.meaning}
            </p>
          )}
          <p className="mt-1.5 text-xs text-muted">
            {question.catalogueSign.class
              ? `${question.catalogueSign.class.replace(/_/g, " ")} sign`
              : "class not recorded"}
            {question.catalogueSign.folio != null &&
              ` · manual page ${question.catalogueSign.folio}`}
            {question.catalogueSign.name_source === "page" && " · name read from the page"}
            {question.catalogueSign.name_source == null && " · not in the earlier catalogue"}
          </p>
        </div>
      )}

      {explanation?.citation && (
        <div className="mx-4 mb-4 rounded-lg bg-accent-soft p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-accent">
            From the manual
          </p>
          {explanation.fact ? (
            <p className="mt-1 text-sm leading-relaxed">{explanation.fact.statement}</p>
          ) : (
            explanation.entry && (
              <p className="mt-1 text-sm leading-relaxed">
                <span className="font-medium">{explanation.entry.heading}</span>
                {" — "}
                {explanation.entry.text.split("\n")[0].slice(0, 240)}
              </p>
            )
          )}
          <p className="mt-1.5 text-xs text-muted">
            Page {explanation.citation.page}, paragraph {explanation.citation.paragraph}
            {explanation.confidence === "topic-match" && " · related paragraph"}
          </p>
        </div>
      )}

      {/* An answer read off a paper and an answer worked out from the manual are
          different claims. The second is shown as such, and as unchecked while
          it is. */}
      {question.source.answerOrigin === "manual" && (
        <div className="mx-4 mb-4 rounded-lg bg-warn-soft p-3 text-sm text-warn">
          <p className="font-medium">
            This answer was derived from the manual, not printed on the paper.
          </p>
          <p className="mt-1 text-xs">
            {question.source.answerReviewed
              ? "Checked by a human."
              : "Not yet checked by a human."}
          </p>
        </div>
      )}

      <div className="border-t border-line px-4 py-2.5 text-xs text-muted">
        Source: {question.source.paper}, question {question.source.originalNumber}
        {question.source.answerSource &&
          ` · answer ${question.source.answerOrigin === "manual" ? "derived from" : "from"} ${question.source.answerSource}`}
      </div>
    </li>
  );
}
