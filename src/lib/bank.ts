import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  answersFromFactsSchema,
  bookFileSchema,
  disputedSchema,
  factsFileSchema,
  paperSchema,
  parseOrThrow,
  signCatalogueSchema,
  TOPIC_KEYS,
  topicCurationSchema,
  type AnswersFromFacts,
  type BookEntry,
  type Disputed,
  type Fact,
  type OptionKey,
  type Paper,
  type RawQuestion,
  type SectionKey,
  type Sign,
  type TopicCuration,
  type TopicKey,
} from "./schema";
import { buildTopicIndex, type TopicIndex, type TopicSource } from "./topics";

const DATA_DIR = join(process.cwd(), "data");
const PUBLIC_DIR = join(process.cwd(), "public");

/**
 * Question banks, in the order they are preferred.
 *
 * Only banks that actually carry answers can contribute. The OCR banks are
 * loaded anyway so the coverage report can state why they contribute nothing,
 * rather than leaving their absence unexplained.
 */
export const BANK_FILES = [
  "paper-a-answers.json",
  "paper-a-markup.json",
  "paper-a.json",
  "test1-answered.json",
  "questions-test1.json",
  "test1-ocr.json",
  "test3-ocr.json",
] as const;

/**
 * The papers, and the banks that read each, best-informed first.
 *
 * Several banks read the same document: Test 1 has a hand-verified
 * transcription and two OCR passes of the same 90 printed questions. They are
 * not 270 questions, and treating them as independent meant a question whose
 * answer sat in one reading and whose topic sat in another was served by
 * neither. Readings are merged per printed number, each field taken from the
 * first bank that has it — which is what the extractor does, and why the two
 * projects now agree.
 */
const PAPER_SPECS: { key: string; banks: string[] }[] = [
  {
    key: "test_1",
    banks: ["test1-answered.json", "questions-test1.json", "test1-ocr.json"],
  },
  { key: "test_3", banks: ["test3-ocr.json"] },
  {
    key: "paper_a",
    banks: ["paper-a-answers.json", "paper-a-markup.json", "paper-a.json"],
  },
];

/** Where a bank's per-question artwork was exported, by the PDF it came from. */
const ARTWORK_DIR_BY_SCAN: Record<string, string> = {
  "Test_paper_with_answers.pdf": "Test_paper_with_answers",
  "TEST_PAPER_A-1-1.pdf": "TEST_PAPER_A-1-1",
  "TEST_PAPER_A-1.pdf": "TEST_PAPER_A-1",
};

/** Which paper a bank reads, derived from {@link PAPER_SPECS}. */
const PAPER_KEY_BY_BANK: Record<string, string> = Object.fromEntries(
  PAPER_SPECS.flatMap((spec) => spec.banks.map((bank) => [bank, spec.key])),
);

/** A manual-derived answer, indexed by the extractor's `paper#number` uid. */
export interface DerivedAnswer {
  answer: OptionKey;
  answerSource: string;
  reviewed: boolean;
  basis: string;
}

export type ExclusionReason =
  | "no answer stated"
  | "status is blocked"
  | "disputed answer"
  | "artwork file missing"
  | "practice section"
  | "no topic label";

export interface ServableQuestion {
  /** Unique across banks: a question number alone collides between papers. */
  uid: string;
  bank: string;
  sourcePaper: string;
  originalNumber: number;
  /** The letter the source document printed. Provenance; no quota uses it. */
  section: SectionKey;
  /** The subject topic, which is what the blueprint's quotas are counted in. */
  topic: TopicKey;
  topicSource: TopicSource;
  /** False while the label is machine-assigned and nobody has checked it. */
  topicReviewed: boolean;
  /** Counts toward the "general duties of a driver" sub-requirement. */
  generalDuties: boolean;
  text: string;
  options: Record<OptionKey, string>;
  answer: OptionKey;
  answerSource: string | null;
  /**
   * "paper" when a document stated the answer, "manual" when it was derived
   * from a fact in the manual instead. Carried to the screen: a derived answer
   * is a weaker claim than a printed one and must not be shown as the same.
   */
  answerOrigin: "paper" | "manual";
  /** False while the answer is derived and nobody has checked that entry. */
  answerReviewed: boolean;
  /** Public URLs of the artwork for this question, in A/B/C order if per-option. */
  artwork: { url: string; label: string | null }[];
  imageType: "single" | "options" | "labelled_diagram" | null;
  /** Catalogue entry, only where the ref matches a real sign. Usually absent. */
  catalogueSign: Sign | null;
  labels: string[];
}

export interface ExcludedQuestion {
  uid: string;
  bank: string;
  originalNumber: number;
  section: SectionKey;
  topic: TopicKey | null;
  text: string;
  reasons: ExclusionReason[];
}

export interface BankReport {
  bank: string;
  scanFile: string;
  total: number;
  servable: number;
  excluded: number;
}

export interface Corpus {
  servable: ServableQuestion[];
  excluded: ExcludedQuestion[];
  bankReports: BankReport[];
  signsByRef: Map<string, Sign>;
  facts: Fact[];
  bookEntries: BookEntry[];
  disputed: Disputed;
  /** What the topic labels are and whether anyone has checked them. */
  topicLabels: TopicIndex["curation"] & { unreviewed: number };
  /** How much of what is served rests on something nobody has checked. */
  derivedAnswers: { available: number; applied: number; unreviewed: number };
}

function readJson(file: string): unknown {
  const path = join(DATA_DIR, file);
  if (!existsSync(path)) {
    throw new Error(
      `data/${file} is missing. Run \`npm run sync-data\` to copy it from the extractor project.`,
    );
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Refs in the banks are file names ("q009.png"); compare on the stem. */
function refStem(ref: string): string {
  const base = ref.split("/").pop() ?? ref;
  return base.replace(/\.(png|svg|jpg|jpeg)$/i, "");
}

function artworkUrl(scanFile: string, ref: string): string | null {
  const dir = ARTWORK_DIR_BY_SCAN[scanFile];
  if (!dir) return null;
  const url = `/artwork/${dir}/${refStem(ref)}.svg`;
  return existsSync(join(PUBLIC_DIR, url)) ? url : null;
}

function signUrl(ref: string): string | null {
  const url = `/signs/${refStem(ref)}.svg`;
  return existsSync(join(PUBLIC_DIR, url)) ? url : null;
}

/** Every artwork reference a question makes, with its option label if per-option. */
function referencedArtwork(question: RawQuestion): { ref: string; label: string | null }[] {
  const image = question.image;
  if (!image) return [];
  if (image.type === "options") {
    const refs = image.refs ?? {};
    const out: { ref: string; label: string | null }[] = [];
    for (const key of ["A", "B", "C"] as const) {
      const ref = refs[key];
      if (ref) out.push({ ref, label: key });
    }
    return out;
  }
  return image.ref ? [{ ref: image.ref, label: null }] : [];
}

function disputedNumbers(disputed: Disputed, bank: string): Set<number> {
  const out = new Set<number>();
  for (const entry of disputed.entries) {
    if (entry.cleared) continue;
    if (entry.bank !== bank) continue;
    for (const n of entry.question_numbers) out.add(n);
  }
  return out;
}

/**
 * Decide whether one question may be served, and why not if it may not.
 *
 * A question is served only when its answer is stated, its status is ok, it is
 * not disputed, it carries a topic label, and every picture it refers to exists
 * on disk. There is no placeholder path: a question shown next to the wrong
 * artwork is worse than a question not shown at all.
 *
 * The topic requirement is new with the topic-quota blueprint. An unlabelled
 * question belongs to no quota, so serving it would mean a paper that satisfies
 * its own arithmetic while saying nothing about which subjects it covered.
 */
export function assessQuestion(
  question: RawQuestion,
  bank: string,
  scanFile: string,
  disputed: Set<number>,
  signsByRef: Map<string, Sign>,
  topics: TopicIndex,
  derivedAnswers: Map<string, DerivedAnswer> = new Map(),
): { servable: ServableQuestion | null; reasons: ExclusionReason[] } {
  const reasons: ExclusionReason[] = [];

  // A paper that states the answer always wins. Only where none does is the
  // manual-derived answer consulted, and it is flagged for the rest of its life.
  const paperKey = PAPER_KEY_BY_BANK[bank];
  const derived = question.answer
    ? undefined
    : derivedAnswers.get(`${paperKey}#${question.number}`);
  const answer = question.answer ?? derived?.answer ?? null;

  if (question.section === "A") reasons.push("practice section");
  if (!answer) reasons.push("no answer stated");
  if (question.status !== "ok") reasons.push("status is blocked");
  if (disputed.has(question.number)) reasons.push("disputed answer");

  const topic = topics.resolve(bank, question);
  if (!topic.topic) reasons.push("no topic label");

  const referenced = referencedArtwork(question);
  let resolved: { url: string; label: string | null }[] = [];
  for (const { ref, label } of referenced) {
    const url = artworkUrl(scanFile, ref) ?? signUrl(ref);
    if (!url) {
      if (!reasons.includes("artwork file missing")) reasons.push("artwork file missing");
    } else {
      resolved.push({ url, label });
    }
  }

  // A picture-option question exports as ONE crop covering all three pictures
  // side by side - the extractor points A, B and C at the same file and says so
  // in the image note. Rendering that file beside each option would show the
  // learner three identical pictures, each containing all three signs. Collapse
  // it to a single unlabelled image, which is how the paper itself prints it.
  const distinctUrls = new Set(resolved.map((r) => r.url));
  if (resolved.length > 1 && distinctUrls.size === 1) {
    resolved = [{ url: resolved[0].url, label: null }];
  }
  // A picture question whose image node exists but names no file at all cannot
  // be rendered either.
  if (question.image && referenced.length === 0) {
    if (!reasons.includes("artwork file missing")) reasons.push("artwork file missing");
  }

  if (reasons.length > 0) return { servable: null, reasons };

  const options = question.options as Record<OptionKey, string>;
  const catalogueRef = referenced
    .map((r) => refStem(r.ref))
    .find((stem) => signsByRef.has(stem));

  return {
    servable: {
      uid: `${bank}:${question.id}`,
      bank,
      sourcePaper: scanFile,
      originalNumber: question.number,
      section: question.section,
      topic: topic.topic!,
      topicSource: topic.source!,
      topicReviewed: topic.reviewed,
      generalDuties: topic.generalDuties,
      text: question.text,
      options,
      answer: answer as OptionKey,
      // The citation follows the answer. Taking the question's own
      // `answer_source` here would attribute a manual-derived answer to the
      // paper, which is the one thing this field exists to prevent.
      answerSource: derived ? derived.answerSource : (question.answer_source ?? null),
      answerOrigin: derived ? "manual" : "paper",
      answerReviewed: derived ? derived.reviewed : true,
      artwork: resolved,
      imageType: question.image?.type ?? null,
      catalogueSign: catalogueRef ? (signsByRef.get(catalogueRef) ?? null) : null,
      labels: question.image?.type === "labelled_diagram" ? (question.image.labels ?? []) : [],
    },
    reasons: [],
  };
}

/** One bank's reading of a printed question. */
interface Reading {
  bank: string;
  scanFile: string;
  question: RawQuestion;
}

/**
 * One printed question, and every bank reading that contributed to it.
 *
 * Each field is taken from the first reading that supplies it. A question
 * blocked in one reading but read cleanly in a later one is not blocked: it was
 * lost to that reading, not to the paper.
 */
interface MergedQuestion {
  paper: string;
  number: number;
  /** Supplies the text and options: the best-informed reading that has them. */
  primary: Reading;
  /** Supplies the artwork refs, which may come from a different reading. */
  imageFrom: Reading | null;
  answer: OptionKey | null;
  answerSource: string | null;
  status: "ok" | "blocked";
  disputed: boolean;
  topicFrom: Reading | null;
  banks: string[];
}

function mergeReadings(
  paperKey: string,
  readings: Reading[],
  disputedByBank: Map<string, Set<number>>,
  topics: TopicIndex,
): MergedQuestion[] {
  const byNumber = new Map<number, MergedQuestion>();

  for (const reading of readings) {
    const { bank, question } = reading;
    const isDisputed = disputedByBank.get(bank)?.has(question.number) ?? false;
    const hasRefs = referencedArtwork(question).length > 0;
    const hasTopic = topics.resolve(bank, question).topic !== null;

    const existing = byNumber.get(question.number);
    if (!existing) {
      byNumber.set(question.number, {
        paper: paperKey,
        number: question.number,
        primary: reading,
        imageFrom: hasRefs ? reading : null,
        answer: (question.answer as OptionKey | null) ?? null,
        answerSource: question.answer ? (question.answer_source ?? null) : null,
        status: question.status ?? "ok",
        disputed: isDisputed,
        topicFrom: hasTopic ? reading : null,
        banks: [bank],
      });
      continue;
    }

    existing.banks.push(bank);
    if (!existing.answer && question.answer) {
      existing.answer = question.answer as OptionKey;
      existing.answerSource = question.answer_source ?? null;
    }
    if (question.status !== "blocked" && existing.status === "blocked") {
      existing.status = "ok";
    }
    if (!existing.imageFrom && hasRefs) existing.imageFrom = reading;
    if (!existing.topicFrom && hasTopic) existing.topicFrom = reading;
    if (isDisputed) existing.disputed = true;
  }

  return [...byNumber.values()].sort((a, b) => a.number - b.number);
}

/**
 * Flatten a merged question back into the shape the eligibility filter reads.
 *
 * The image comes from whichever reading carried one, so the scan file that
 * names its artwork directory travels with it.
 */
function flatten(merged: MergedQuestion): { question: RawQuestion; bank: string; scanFile: string } {
  const source = merged.topicFrom ?? merged.primary;
  return {
    question: {
      ...merged.primary.question,
      answer: merged.answer,
      answer_source: merged.answerSource,
      status: merged.status,
      image: merged.imageFrom?.question.image ?? null,
      topic: source.question.topic,
      category: source.question.category,
    },
    bank: source.bank,
    scanFile: merged.imageFrom?.scanFile ?? merged.primary.scanFile,
  };
}

function normaliseText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * A question whose options are just "A", "B", "C" — the words are in the
 * pictures. Such a question has no comparable text at all: a dozen unrelated
 * ones share a key.
 */
function isPictureOptionSet(options: Record<OptionKey, string>): boolean {
  return (["A", "B", "C"] as const).every(
    (key) => normaliseText(options[key] ?? "") === key.toLowerCase(),
  );
}

/**
 * What makes two servable questions the same question, or null when they cannot
 * be compared and so must never be merged.
 *
 * Wording plus the option set, which is the extractor's rule and is right for a
 * question made of words: Paper A asks "Which statement is correct?" twice with
 * different options, and a text-only key deleted one of them. Where a question
 * also carries pictures, those join the key — the same stem beside a different
 * sign is a different question.
 */
export function identityKey(question: ServableQuestion): string | null {
  if (isPictureOptionSet(question.options)) return null;
  const text = normaliseText(question.text);
  const options = (["A", "B", "C"] as const)
    .map((key) => normaliseText(question.options[key] ?? ""))
    .sort()
    .join("|");
  const base = `${text}::${options}`;
  if (question.artwork.length === 0) return base;
  const art = question.artwork
    .map((a) => a.url.split("/").pop() ?? a.url)
    .sort()
    .join(",");
  return `${base}::${art}`;
}

let cached: Corpus | null = null;

/** Load, validate and filter every bank. Cached: the data never changes at runtime. */
export function loadCorpus(): Corpus {
  if (cached) return cached;

  const disputed = parseOrThrow<Disputed>(
    disputedSchema,
    readJson("disputed.json"),
    "data/disputed.json",
  );

  const catalogue = parseOrThrow(
    signCatalogueSchema,
    readJson("signs.json"),
    "data/signs.json",
  );
  const signsByRef = new Map<string, Sign>(catalogue.signs.map((s) => [s.ref, s]));

  const facts = parseOrThrow(factsFileSchema, readJson("facts.json"), "data/facts.json").facts;
  const bookEntries = parseOrThrow(bookFileSchema, readJson("book.json"), "data/book.json").entries;

  const topics = buildTopicIndex(
    parseOrThrow<TopicCuration>(
      topicCurationSchema,
      readJson("topics.json"),
      "data/topics.json",
    ),
  );

  const derivedAnswers = new Map<string, DerivedAnswer>();
  if (existsSync(join(DATA_DIR, "answers-from-facts.json"))) {
    const fromFacts = parseOrThrow<AnswersFromFacts>(
      answersFromFactsSchema,
      readJson("answers-from-facts.json"),
      "data/answers-from-facts.json",
    );
    for (const entry of fromFacts.answers) {
      derivedAnswers.set(entry.uid, {
        answer: entry.answer,
        answerSource: entry.answer_source,
        reviewed: entry.reviewed,
        basis: entry.basis,
      });
    }
  }

  const servable: ServableQuestion[] = [];
  const excluded: ExcludedQuestion[] = [];
  const bankReports: BankReport[] = [];
  const seenText = new Set<string>();

  const disputedByBank = new Map<string, Set<number>>();
  const loaded = new Map<string, Paper>();
  for (const bank of BANK_FILES) {
    if (!existsSync(join(DATA_DIR, bank))) continue;
    loaded.set(bank, parseOrThrow<Paper>(paperSchema, readJson(bank), `data/${bank}`));
    disputedByBank.set(bank, disputedNumbers(disputed, bank));
  }

  const servedByBank = new Map<string, number>();

  for (const spec of PAPER_SPECS) {
    const readings: Reading[] = [];
    for (const bank of spec.banks) {
      const paper = loaded.get(bank);
      if (!paper) continue;
      for (const question of paper.questions) {
        readings.push({ bank, scanFile: paper.source.scan_file, question });
      }
    }
    if (readings.length === 0) continue;

    for (const merged of mergeReadings(spec.key, readings, disputedByBank, topics)) {
      const { question, bank, scanFile } = flatten(merged);
      const { servable: ok, reasons } = assessQuestion(
        question,
        bank,
        scanFile,
        merged.disputed ? new Set([merged.number]) : new Set<number>(),
        signsByRef,
        topics,
        derivedAnswers,
      );

      const uid = `${merged.paper}#${merged.number}`;
      if (ok) {
        // Papers overlap: the same question is printed in more than one, and
        // serving it twice in one test would be obvious. But identical wording
        // is not identical question — "This sign indicates?" is asked of a
        // different sign each time, and a text-only key silently collapsed
        // three information-signs questions into one. The artwork is part of
        // what makes the question, so it is part of the key.
        const key = identityKey(ok);
        if (key !== null) {
          if (seenText.has(key)) continue;
          seenText.add(key);
        }
        servable.push({ ...ok, uid });
        servedByBank.set(bank, (servedByBank.get(bank) ?? 0) + 1);
      } else {
        excluded.push({
          uid,
          bank,
          originalNumber: merged.number,
          section: question.section,
          topic: topics.resolve(bank, question).topic,
          text: question.text,
          reasons,
        });
      }
    }
  }

  for (const [bank, paper] of loaded) {
    const served = servedByBank.get(bank) ?? 0;
    bankReports.push({
      bank,
      scanFile: paper.source.scan_file,
      total: paper.questions.length,
      servable: served,
      excluded: paper.questions.length - served,
    });
  }

  // Stable order so a given seed always sees the same pool.
  servable.sort((a, b) => a.uid.localeCompare(b.uid));

  cached = {
    servable,
    excluded,
    bankReports,
    signsByRef,
    facts,
    bookEntries,
    disputed,
    topicLabels: {
      ...topics.curation,
      unreviewed: servable.filter((q) => !q.topicReviewed).length,
    },
    derivedAnswers: {
      available: derivedAnswers.size,
      applied: servable.filter((q) => q.answerOrigin === "manual").length,
      unreviewed: servable.filter(
        (q) => q.answerOrigin === "manual" && !q.answerReviewed,
      ).length,
    },
  };
  return cached;
}

/** Pool by subject topic. This is what assembly draws from. */
export function servableByTopic(corpus: Corpus): Record<TopicKey, ServableQuestion[]> {
  const out = {} as Record<TopicKey, ServableQuestion[]>;
  for (const topic of TOPIC_KEYS) out[topic] = [];
  for (const question of corpus.servable) out[question.topic].push(question);
  return out;
}

/** Pool by the section letter the source document printed. Provenance only. */
export function servableBySection(corpus: Corpus): Record<SectionKey, ServableQuestion[]> {
  const out: Record<SectionKey, ServableQuestion[]> = { A: [], B: [], C: [], D: [], E: [] };
  for (const question of corpus.servable) out[question.section].push(question);
  return out;
}
