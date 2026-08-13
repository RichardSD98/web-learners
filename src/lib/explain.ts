import type { AssembledQuestion } from "./assemble";
import type { BookEntry, Fact } from "./schema";

/**
 * Find manual content that supports a question, for review mode.
 *
 * Strictly a lookup: it matches distinctive terms from the question against
 * facts and paragraphs the extractor already cited, and returns them with their
 * page and paragraph. It never writes an explanation, and it returns nothing
 * rather than something loose - an explanation that does not actually support
 * the answer is worse than none, because it looks authoritative.
 */

export interface Explanation {
  fact: Fact | null;
  entry: BookEntry | null;
  citation: { page: number; paragraph: number } | null;
  confidence: "exact-quantity" | "topic-match" | "none";
}

const STOPWORDS = new Set([
  "the", "a", "an", "of", "to", "in", "on", "is", "are", "for", "you", "your",
  "and", "or", "at", "be", "with", "that", "this", "it", "as", "if", "when",
  "what", "which", "how", "may", "not", "must", "should", "can", "do", "does",
  "from", "by", "any", "will", "would", "shall", "has", "have", "was", "were",
  "sign", "signs", "means", "mean", "indicates", "indicate", "following",
  "correct", "statement", "statements", "vehicle", "vehicles", "road", "driver",
]);

function terms(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s.,]/g, " ")
      .split(/\s+/)
      .map((w) => w.replace(/[.,]+$/, ""))
      .filter((w) => w.length > 3 && !STOPWORDS.has(w)),
  );
}

/** Quantities as they appear in an option, e.g. "100 km/h" -> "100|km/h". */
function quantities(text: string): string[] {
  const out: string[] = [];
  const pattern = /(\d+(?:[.,]\d+)?)\s*(km\/h|mm|m\b|kg|t\b|tonnes|hours?|minutes?)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const value = match[1].replace(",", ".");
    const unit = match[2].toLowerCase().replace(/\s/g, "");
    out.push(`${value}|${unit === "metres" ? "m" : unit}`);
  }
  return out;
}

function overlap(a: Set<string>, b: Set<string>): number {
  let hits = 0;
  for (const term of a) if (b.has(term)) hits += 1;
  return hits;
}

export function explain(
  question: AssembledQuestion,
  facts: Fact[],
  entries: BookEntry[],
): Explanation {
  const correct = question.options.find((o) => o.key === question.answer);
  const questionTerms = terms(question.text);
  const answerQuantities = correct ? quantities(correct.text) : [];

  // Strongest evidence: a fact whose value and unit are exactly the correct
  // option's quantity, and whose subject matter overlaps the question.
  if (answerQuantities.length > 0) {
    let best: { fact: Fact; score: number } | null = null;
    for (const fact of facts) {
      if (!fact.unit) continue;
      const key = `${fact.value}|${fact.unit.toLowerCase()}`;
      if (!answerQuantities.includes(key)) continue;
      const score =
        overlap(questionTerms, terms(fact.statement)) +
        overlap(questionTerms, terms(fact.qualifiers.join(" ")));
      if (!best || score > best.score) best = { fact, score };
    }
    if (best && best.score > 0) {
      return {
        fact: best.fact,
        entry:
          entries.find(
            (e) => e.paragraph === best!.fact.source.paragraph && e.kind === "numbered_paragraph",
          ) ?? null,
        citation: best.fact.source,
        confidence: "exact-quantity",
      };
    }
  }

  // Otherwise a paragraph whose wording clearly overlaps the question. The
  // threshold is deliberately high; a weak overlap is reported as no match.
  let bestEntry: { entry: BookEntry; score: number } | null = null;
  for (const entry of entries) {
    if (entry.kind === "sign_entry") continue;
    const score =
      overlap(questionTerms, terms(entry.heading)) * 2 +
      overlap(questionTerms, terms(entry.text.slice(0, 600)));
    if (!bestEntry || score > bestEntry.score) bestEntry = { entry, score };
  }

  if (bestEntry && bestEntry.score >= 6) {
    return {
      fact: null,
      entry: bestEntry.entry,
      citation: {
        page: bestEntry.entry.pages[0] ?? 0,
        paragraph: bestEntry.entry.paragraph,
      },
      confidence: "topic-match",
    };
  }

  return { fact: null, entry: null, citation: null, confidence: "none" };
}
