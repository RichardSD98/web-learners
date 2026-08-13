import Link from "next/link";
import { notFound } from "next/navigation";

import TestRunner from "@/components/TestRunner";
import { loadCorpus, servableByTopic } from "@/lib/bank";
import { InsufficientQuestionsError } from "@/lib/assemble";
import { CODE_LABELS, TOPIC_LABELS, type LicenceCode } from "@/lib/blueprint";
import { explain, type Explanation } from "@/lib/explain";
import { resolvePaper } from "@/lib/preview";

export const dynamic = "force-dynamic";

function isLicenceCode(value: string | undefined): value is LicenceCode {
  return value === "1" || value === "2" || value === "3";
}

/**
 * Attempts are unbounded in principle - the rotation keeps cycling - but the
 * number comes out of the address bar, so it is bounded here rather than
 * letting a pasted URL ask for attempt 1e9 and spin through that many shuffles.
 */
const MAX_ATTEMPT = 1000;

function parseAttempt(value: string): number | null {
  if (!/^[1-9][0-9]*$/.test(value)) return null;
  const attempt = Number(value);
  return attempt <= MAX_ATTEMPT ? attempt : null;
}

export default async function TestPage({
  params,
  searchParams,
}: {
  params: Promise<{ seed: string; attempt: string }>;
  searchParams: Promise<{ code?: string }>;
}) {
  const { seed, attempt: rawAttempt } = await params;
  const { code } = await searchParams;

  if (!isLicenceCode(code)) notFound();
  const attempt = parseAttempt(rawAttempt);
  if (attempt === null) notFound();

  const corpus = loadCorpus();
  const pool = servableByTopic(corpus);

  // Whether a short bank refuses or previews is decided in one place, and by
  // default it refuses. See src/lib/preview.ts.
  const resolution = resolvePaper(seed, code, pool, attempt);

  if (resolution.kind === "unavailable") {
    const { error } = resolution;
    return (
      <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 pt-10">
        <h1 className="text-xl font-semibold">
          {CODE_LABELS[code]} cannot be assembled
        </h1>
        {error instanceof InsufficientQuestionsError ? (
          <>
            <ul className="mt-4 flex flex-col gap-1.5 text-sm">
              {error.shortfalls.map((shortfall) => (
                <li
                  key={`${shortfall.topic}-${shortfall.requirement ?? ""}`}
                  className="flex items-baseline justify-between gap-3"
                >
                  <span>
                    {shortfall.requirement
                      ? `${TOPIC_LABELS[shortfall.topic]} — ${shortfall.requirement}`
                      : TOPIC_LABELS[shortfall.topic]}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted">
                    needs {shortfall.requested}, has {shortfall.available}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm leading-relaxed text-muted">
              A shorter paper is deliberately not served in place of a complete one.
            </p>
          </>
        ) : (
          <p className="mt-3 text-sm leading-relaxed text-muted">{error.message}</p>
        )}
        <Link href="/" className="mt-6 inline-block text-sm text-accent">
          &larr; Choose another code
        </Link>
      </main>
    );
  }

  const test = resolution.test;

  // Explanations are looked up once on the server: they read the manual files,
  // which never reach the client.
  const explanations: Record<string, Explanation> = {};
  for (const question of test.questions) {
    explanations[question.uid] = explain(question, corpus.facts, corpus.bookEntries);
  }

  return <TestRunner test={test} explanations={explanations} />;
}
