import Link from "next/link";

import PracticeRunner from "@/components/PracticeRunner";
import { loadPracticeRound } from "@/lib/practice-catalogue";

/**
 * A round of sign practice, named by its seed.
 *
 * Its own address rather than a mode of /test, because it is not that test: the
 * examination is assembled from past papers and marked against the official pass
 * mark, and this is composed from the manual's sign catalogue and marked against
 * nothing. Sharing a URL space would invite exactly the confusion the rest of
 * this app works to avoid.
 */
export const dynamic = "force-dynamic";

export default async function PracticePage({
  params,
}: {
  params: Promise<{ seed: string }>;
}) {
  const { seed } = await params;
  const round = loadPracticeRound(seed);

  if (round.questions.length === 0) {
    return (
      <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 pt-10">
        <h1 className="text-xl font-semibold">No signs to practise</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          The sign catalogue holds {round.catalogueSize} signs, but none of them
          currently carries the name, class and artwork a question needs. Run{" "}
          <span className="font-mono">npm run sync-data</span> to refresh it from the
          extractor project.
        </p>
        <Link href="/" className="mt-6 inline-block text-sm text-accent">
          &larr; Back
        </Link>
      </main>
    );
  }

  return <PracticeRunner round={round} />;
}
