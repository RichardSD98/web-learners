/**
 * Build-time coverage report.
 *
 * Measures the bank against the official topic quotas, not against itself. Prints
 * what each topic needs and has, the general-duties sub-requirement, how many
 * attempts the rotation could serve, and every excluded question with its reason.
 *
 * It does not exit non-zero when no paper can be assembled. That was right when a
 * shortfall meant a bug in the pipeline; now it is the expected state of a bank
 * that holds 69 verified questions against a 90-question paper, and failing the
 * build would only mean the app cannot be deployed to say so.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  loadCorpus,
  servableBySection,
  servableByTopic,
  type ExclusionReason,
} from "../src/lib/bank.ts";
import {
  blueprintLength,
  buildBlueprint,
  CODE_LABELS,
  GENERAL_DUTIES_MINIMUM,
  OFFICIAL_LAYOUT,
  OFFICIAL_TEST_LENGTH,
  PAPER_VARIANTS,
  PASS_MARK_CORRECT,
  TOPIC_LABELS,
  TOPIC_QUOTAS,
} from "../src/lib/blueprint.ts";
import type { SectionKey } from "../src/lib/schema.ts";

const corpus = loadCorpus();
const pool = servableByTopic(corpus);
const bySection = servableBySection(corpus);

console.log("\n=== Question bank coverage ===\n");

console.log(
  `Target: the official paper — ${OFFICIAL_TEST_LENGTH} marked questions, ` +
    `pass at ${PASS_MARK_CORRECT} correct.\n`,
);

console.log("Per bank:");
console.log(
  `  ${"bank".padEnd(28)} ${"total".padStart(6)} ${"servable".padStart(9)} ${"excluded".padStart(9)}`,
);
for (const report of corpus.bankReports) {
  console.log(
    `  ${report.bank.padEnd(28)} ${String(report.total).padStart(6)} ` +
      `${String(report.servable).padStart(9)} ${String(report.excluded).padStart(9)}`,
  );
}

const reasonCounts = new Map<ExclusionReason, number>();
for (const excluded of corpus.excluded) {
  for (const reason of excluded.reasons) {
    reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
  }
}
console.log("\nExclusion reasons (a question may have more than one):");
for (const [reason, count] of [...reasonCounts].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${reason.padEnd(24)} ${String(count).padStart(4)}`);
}

console.log(
  `\nTopic labels: ${corpus.topicLabels.labelledBy}-assigned, ` +
    `${corpus.topicLabels.reviewed ? "reviewed" : "NOT REVIEWED"}` +
    `${corpus.topicLabels.unreviewed > 0 ? ` (${corpus.topicLabels.unreviewed} servable questions carry an unreviewed label)` : ""}`,
);

console.log(
  `Derived answers: ${corpus.derivedAnswers.applied} of ` +
    `${corpus.derivedAnswers.available} applied` +
    `${corpus.derivedAnswers.unreviewed > 0 ? ` (${corpus.derivedAnswers.unreviewed} UNREVIEWED — read from the manual, not printed on a paper)` : ""}`,
);

console.log("\nServable questions by source section letter (provenance only):");
const sections: SectionKey[] = ["B", "C", "D", "E"];
for (const section of sections) {
  console.log(`  section ${section}: ${bySection[section].length}`);
}

const summary: Record<string, unknown> = {};
let blocked = 0;

for (const { variant, code } of PAPER_VARIANTS) {
  console.log(`\n  ${CODE_LABELS[code]}`);

  if (TOPIC_QUOTAS[variant] === null) {
    console.log("    no official topic quotas are recorded for this paper");
    console.log("    => CANNOT ASSEMBLE (blueprint not specified)");
    blocked += 1;
    summary[`paper${variant}`] = {
      codes: variant.split("+"),
      canAssemble: false,
      reason: "blueprint not specified",
    };
    continue;
  }

  for (const section of OFFICIAL_LAYOUT[variant]) {
    console.log(
      `    section ${section.label}${section.printedAs ? ` (printed as ${section.printedAs})` : ""}: ` +
        `q${section.firstNumber}-${section.lastNumber}, ${section.count} ` +
        `${section.marked ? "marked" : "not marked"}`,
    );
  }

  const slots = buildBlueprint(variant);
  const rows = slots.map((slot) => {
    const have = pool[slot.topic].length;
    const duties = pool[slot.topic].filter((q) => q.generalDuties).length;
    return {
      topic: slot.topic,
      needs: slot.count,
      has: have,
      // Kept apart from the sub-requirement: a topic with a surplus of questions
      // and too few of one kind is a different problem from a topic that is short.
      ok: have >= slot.count,
      dutiesNeeded: slot.generalDutiesMinimum,
      dutiesHas: slot.generalDutiesMinimum > 0 ? duties : null,
      dutiesOk: duties >= slot.generalDutiesMinimum,
    };
  });

  const canAssemble = rows.every((r) => r.ok && r.dutiesOk);
  if (!canAssemble) blocked += 1;

  const freshAttempts = canAssemble
    ? Math.min(...rows.map((r) => Math.floor(r.has / r.needs)))
    : 0;

  const line = (mark: boolean, label: string, needs: number, has: number, indent = 4) =>
    console.log(
      `${" ".repeat(indent)}${(mark ? "ok" : "SHORT").padEnd(6)}${label.padEnd(26)}` +
        `${String(needs).padStart(5)} ${String(has).padStart(5)} ` +
        `${(has >= needs ? "-" : String(needs - has)).padStart(6)}`,
    );

  console.log(
    `\n    ${"".padEnd(6)}${"topic".padEnd(26)}${"needs".padStart(5)} ${"has".padStart(5)} ${"short".padStart(6)}`,
  );
  for (const row of rows) {
    line(row.ok, TOPIC_LABELS[row.topic], row.needs, row.has);
    if (row.dutiesNeeded > 0) {
      line(row.dutiesOk, "of which general duties", row.dutiesNeeded, row.dutiesHas ?? 0, 6);
    }
  }

  const needed = blueprintLength(variant);
  const usable = rows.reduce((sum, r) => sum + Math.min(r.needs, r.has), 0);
  console.log(
    `\n    ${usable} of the ${needed} slots can be filled ` +
      `(${needed - usable} short)`,
  );
  console.log(`    => ${canAssemble ? "can assemble" : "CANNOT ASSEMBLE"}`);
  if (canAssemble) {
    console.log(`    => ${freshAttempts} attempts before any question repeats`);
  }

  summary[`paper${variant}`] = {
    codes: variant.split("+"),
    canAssemble,
    freshAttempts,
    slotsNeeded: needed,
    slotsFillable: usable,
    rows,
  };
}

const totalServable = corpus.servable.length;
writeFileSync(
  join(process.cwd(), "data", "coverage-report.json"),
  JSON.stringify(
    {
      target: { length: OFFICIAL_TEST_LENGTH, passMarkCorrect: PASS_MARK_CORRECT },
      topicLabels: corpus.topicLabels,
      generalDutiesMinimum: GENERAL_DUTIES_MINIMUM,
      generatedFrom: corpus.bankReports,
      servableTotal: totalServable,
      // Listed so the extractor's report and this one can be diffed question by
      // question. Two totals that disagree are only useful if you can find out
      // which questions they disagree about.
      servable: corpus.servable.map((q) => ({
        uid: q.uid,
        bank: q.bank,
        number: q.originalNumber,
        topic: q.topic,
        answerOrigin: q.answerOrigin,
        answerReviewed: q.answerReviewed,
        topicReviewed: q.topicReviewed,
      })),
      derivedAnswers: corpus.derivedAnswers,
      byTopic: Object.fromEntries(
        Object.entries(pool).map(([topic, questions]) => [topic, questions.length]),
      ),
      bySourceSection: Object.fromEntries(sections.map((s) => [s, bySection[s].length])),
      byPaper: summary,
      exclusionReasons: Object.fromEntries(reasonCounts),
      excluded: corpus.excluded.map((e) => ({
        uid: e.uid,
        bank: e.bank,
        number: e.originalNumber,
        section: e.section,
        topic: e.topic,
        reasons: e.reasons,
        text: e.text.slice(0, 120),
      })),
    },
    null,
    2,
  ) + "\n",
  "utf8",
);

console.log(`\n  ${totalServable} servable questions in total`);
console.log("  full report written to data/coverage-report.json");

if (blocked === PAPER_VARIANTS.length) {
  console.log(
    "\n  No paper can be assembled. The app builds and reports the shortfall per topic\n" +
      "  rather than serving a shortened paper in its place.\n",
  );
} else if (blocked > 0) {
  console.log(`\n  ${blocked} of ${PAPER_VARIANTS.length} papers cannot be assembled.\n`);
} else {
  console.log("\n  all papers can be assembled\n");
}
