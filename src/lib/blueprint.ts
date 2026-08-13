import { GENERAL_DUTIES, SIGNS_TOPIC_KEYS, type SectionKey, type TopicKey } from "./schema";

/**
 * The shape of the official theoretical test, as specified rather than as
 * measured.
 *
 * This used to apportion a 30-question test across the section letters printed
 * in one scanned paper, in the proportions that paper happened to use. That was
 * a description of a document. The test is defined by subject-topic quotas, and
 * those are what this file now holds: a paper either meets them or it is not the
 * test it claims to be.
 *
 * A section letter is provenance and nothing more. The letters do not agree
 * between documents - the regulation's Section D is the Code 2/3 vehicle block
 * while the papers print that same block as Section E - so no quota keys off one.
 */

export type LicenceCode = "1" | "2" | "3";

export const CODE_LABELS: Record<LicenceCode, string> = {
  "1": "Code 1 — Motorcycles",
  "2": "Code 2 & 3 — Light and heavy motor vehicles",
  "3": "Code 2 & 3 — Light and heavy motor vehicles",
};

/**
 * Which codes sit the same paper.
 *
 * Codes 2 and 3 answer one shared block - the papers title it "Light And Heavy
 * Vehicles Only" - and no question in the bank is answered by one and not the
 * other, so they are not two tests. Assembly keys off the variant rather than the
 * code, which makes the same seed give them the identical paper.
 */
export type PaperVariant = "1" | "2+3";

export const PAPER_VARIANT_BY_CODE: Record<LicenceCode, PaperVariant> = {
  "1": "1",
  "2": "2+3",
  "3": "2+3",
};

/** The distinct papers on offer, with the code used to assemble each. */
export const PAPER_VARIANTS: { variant: PaperVariant; code: LicenceCode }[] = [
  { variant: "1", code: "1" },
  { variant: "2+3", code: "2" },
];

/** Marked questions in a full paper. Not a target to aim at - the length. */
export const OFFICIAL_TEST_LENGTH = 90;

/** Minutes allowed. */
export const TEST_DURATION_MINUTES = 60;

/**
 * Pass mark: 80% of the paper, which is 72 of 90 correct.
 *
 * Marked on the total, not per section. An earlier version of this file applied
 * an invented 75% threshold to each section and failed a candidate on any one of
 * them; that threshold had no source and the rule it implemented was not the real
 * one. Both are gone. Per-topic scores are still reported after the test, but as
 * study guidance - they decide nothing.
 */
export const PASS_RATIO = 0.8;
export const PASS_MARK_CORRECT = 72;
export const PASS_MARK_IS_OFFICIAL = true;

/**
 * Question numbers as the paper prints them.
 *
 * Section A is worked examples the examiner uses to show a candidate how to mark
 * the answer sheet. They are numbered but not marked, which is why they sit
 * outside the 90 and why the bank refuses to serve them.
 *
 * The gap between B and D is Section C, the motorcycle block, which a Code 2 or 3
 * candidate does not answer. The numbering is therefore not contiguous for this
 * variant, and the paper is still 90 marked questions.
 */
export interface OfficialSection {
  /** The letter the regulation uses. */
  label: string;
  firstNumber: number;
  lastNumber: number;
  count: number;
  title: string;
  marked: boolean;
  /** Where the papers disagree with the regulation about the letter. */
  printedAs?: string;
}

export const OFFICIAL_LAYOUT: Record<PaperVariant, OfficialSection[]> = {
  "2+3": [
    {
      label: "A",
      firstNumber: 1,
      lastNumber: 4,
      count: 4,
      title: "Worked examples, marked by the examiner as a demonstration",
      marked: false,
    },
    {
      label: "B",
      firstNumber: 5,
      lastNumber: 65,
      count: 61,
      title: "Road traffic signs and signals — compulsory for every code",
      marked: true,
    },
    {
      label: "D",
      firstNumber: 95,
      lastNumber: 123,
      count: 29,
      title: "Vehicle controls, rules of the road and traffic legislation",
      marked: true,
      printedAs: "E",
    },
  ],
  // Code 1 answers the motorcycle block, Section C, in place of Section D. Its
  // per-topic counts have not been sourced, so no layout is stated for it either:
  // a made-up range would look exactly as authoritative as the sourced one above.
  "1": [],
};

/**
 * Questions per subject topic in a full paper.
 *
 * The six signs topics sum to 61, which is the compulsory signs section; the
 * remaining three sum to 29, which is the Code 2/3 block. 90 in total.
 */
export type TopicQuota = Record<TopicKey, number>;

const QUOTA_2_3: Partial<TopicQuota> = {
  regulatory_signs: 20,
  warning_signs: 15,
  guidance_signs: 7,
  information_signs: 4,
  road_markings: 9,
  road_signals: 6,

  rules_of_the_road: 15,
  traffic_legislation: 10,
  vehicle_controls: 4,
};

/**
 * Quotas by variant, or null where the official counts are not sourced.
 *
 * Code 1 is null on purpose. Its signs section is the same 61 compulsory
 * questions, but the split of its own 29-question motorcycle block across rules,
 * legislation and controls is not stated in any source this project holds. The
 * app reports that rather than reusing the Code 2/3 numbers, which would be a
 * guess wearing the same clothes as a measurement.
 */
export const TOPIC_QUOTAS: Record<PaperVariant, Partial<TopicQuota> | null> = {
  "2+3": QUOTA_2_3,
  "1": null,
};

/**
 * Of the 15 Rules of the Road questions, at least 5 must be on the general
 * duties of a driver of a motor vehicle. A quota inside a quota, so it is
 * enforced separately during assembly.
 */
export const GENERAL_DUTIES_MINIMUM = 5;
export const GENERAL_DUTIES_TOPIC: TopicKey = "rules_of_the_road";
export { GENERAL_DUTIES };

/** Display names, in the wording the syllabus uses. */
export const TOPIC_LABELS: Record<TopicKey, string> = {
  regulatory_signs: "Regulatory signs",
  warning_signs: "Warning signs",
  guidance_signs: "Guidance signs",
  information_signs: "Information signs",
  road_markings: "Road markings",
  road_signals: "Road signals",
  rules_of_the_road: "Rules of the road",
  traffic_legislation: "Traffic legislation",
  vehicle_controls: "Vehicle controls",
  motorcycles: "Motorcycles",
};

/** Which official section a topic is asked in, for numbering and for display. */
export function sectionLabelForTopic(variant: PaperVariant, topic: TopicKey): string | null {
  if (TOPIC_QUOTAS[variant] === null) return null;
  return (SIGNS_TOPIC_KEYS as readonly string[]).includes(topic) ? "B" : "D";
}

export interface TopicSlot {
  topic: TopicKey;
  count: number;
  /** The minimum that must come from the general-duties sub-requirement. */
  generalDutiesMinimum: number;
}

/**
 * The paper's topic slots, in the order the paper asks them.
 *
 * Fixed, not apportioned: there is one official paper and it is 90 questions.
 * The previous largest-remainder split existed to scale the paper down to what
 * the bank could fill, which is precisely the silent degradation this now
 * refuses - a 30-question paper with 5 signs questions is not a shortened
 * version of a test whose signs section is two thirds of the marks.
 */
export const TOPIC_ORDER: TopicKey[] = [
  ...SIGNS_TOPIC_KEYS,
  "rules_of_the_road",
  "traffic_legislation",
  "vehicle_controls",
  "motorcycles",
];

export function buildBlueprint(variant: PaperVariant): TopicSlot[] {
  const quota = TOPIC_QUOTAS[variant];
  if (quota === null) return [];

  return TOPIC_ORDER.filter((topic) => (quota[topic] ?? 0) > 0).map((topic) => ({
    topic,
    count: quota[topic]!,
    generalDutiesMinimum: topic === GENERAL_DUTIES_TOPIC ? GENERAL_DUTIES_MINIMUM : 0,
  }));
}

export function blueprintLength(variant: PaperVariant): number {
  return buildBlueprint(variant).reduce((sum, slot) => sum + slot.count, 0);
}

/**
 * Section letters each code answers in the source papers.
 *
 * Retained only to read the banks: a bank question carries the letter its own
 * document printed. Nothing in the blueprint keys off this.
 */
export const SECTIONS_BY_CODE: Record<LicenceCode, SectionKey[]> = {
  "1": ["B", "C", "D"],
  "2": ["B", "C", "E"],
  "3": ["B", "C", "E"],
};
