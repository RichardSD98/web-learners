import { TOPIC_LABELS, TOPIC_QUOTAS } from "./blueprint";
import { makeRng, sample, shuffle } from "./random";
import { OPTION_KEYS, type OptionKey, type Sign, type TopicKey } from "./schema";

/**
 * Sign practice, built from the manual's own sign catalogue.
 *
 * A second kind of test, and deliberately not the examination. The examination
 * is assembled from questions a past paper printed, with the answer that paper
 * stated; nothing here comes from a paper. These questions are composed - a sign
 * from the catalogue, asked about - which is exactly what `assemble.ts` refuses
 * to do, so it is kept in its own module, at its own address, under its own
 * label, and it is never marked against the official pass mark.
 *
 * What keeps it honest is that no text on the screen is invented. The prompt is
 * a fixed form of words; the correct option is the catalogue's own name or
 * wording for the sign; and every wrong option is another real sign's real name
 * or real wording. There is no "plausible but wrong" text written anywhere,
 * because writing one would be making up road law. The worst this can be is a
 * question about a sign the catalogue has mislabelled, and the answer would be
 * wrong in the manual too.
 *
 * Nothing here touches the disk. Whether a sign's artwork exists is passed in,
 * which keeps this module importable from the browser - the runner needs its
 * types and its labels - and lets the tests build a catalogue that is missing a
 * file without one having to be missing. See practice-catalogue.ts for the half
 * that reads the filesystem.
 */

/** Resolves a sign's artwork to a public URL, or null when the file is absent. */
export type ArtworkResolver = (ref: string) => string | null;

/** The three shapes a question takes. */
export type PracticeShape = "identify" | "select" | "meaning";

export interface PracticeOption {
  key: OptionKey;
  /** The catalogue's name or wording. Empty for a picture option. */
  text: string;
  /** Set when the options are pictures rather than words. */
  artworkUrl: string | null;
  /** Which catalogue sign this option is, for marking and for review. */
  ref: string;
}

export interface PracticeQuestion {
  /** The catalogue ref of the sign being asked about. Unique within a round. */
  ref: string;
  position: number;
  shape: PracticeShape;
  text: string;
  /** The sign itself, shown when the question is about a picture in front of you. */
  stemArtworkUrl: string | null;
  options: PracticeOption[];
  answer: OptionKey;
  /** The manual's own entry, shown after answering. Never paraphrased. */
  sign: {
    ref: string;
    name: string;
    meaning: string | null;
    signClass: string;
    /** Page in the manual this sign is catalogued on. */
    folio: number | null;
    /** True when the name was read off the page rather than the catalogue. */
    nameFromPage: boolean;
  };
}

export interface PracticeRound {
  seed: string;
  questions: PracticeQuestion[];
  /** What each category was asked for, against what it got. */
  categories: { signClass: string; requested: number; filled: number }[];
  /** Signs that can be asked about, after eligibility. */
  poolSize: number;
  /** Signs in the catalogue, eligible or not. */
  catalogueSize: number;
}

/**
 * Signs per round.
 *
 * Sized against the examination's signs section, which is 61 of its 90
 * questions, so a round is a comparable sitting rather than a quick drill.
 */
export const PRACTICE_ROUND_LENGTH = 60;

/**
 * A meaning long enough to be a paragraph is not an option, it is a reading
 * exercise. The longest in the catalogue runs to 918 characters.
 */
const MEANING_OPTION_MAX = 160;

/**
 * The floor that keeps meaning questions answerable.
 *
 * Not every `meaning` in the catalogue is an explanation. For the guidance signs
 * in particular the field holds label text that did not survive extraction
 * intact - "Suburb name" is recorded as meaning "Advance transport 274
 * trailblazer", and a sign named "Railway station" as "Parking 301". Asking what
 * a sign means with three of those as the options is not a hard question, it is
 * an unanswerable one, and one of the options would be wrong in the manual too.
 *
 * A real explanation runs to a clause - "Road is set aside for motor cyclists
 * only", "The entry of all vehicular traffic is prohibited". Eight words is the
 * line that separates them from the labels, and it excludes essentially the
 * whole guidance class, which is where the damage is. Those signs are still
 * asked about by name and by picture.
 */
const MEANING_OPTION_MIN_WORDS = 8;

/**
 * How many near-misses a subject's distractors are drawn from.
 *
 * Taking the two most similar signs every time would make a subject's question
 * identical in every round it appeared in. Taking two from the closest six keeps
 * the difficulty and lets the round vary with the seed.
 */
const SIMILARITY_SHORTLIST = 6;

/**
 * The catalogue's classes against the blueprint's signs topics.
 *
 * They are the same six categories under two vocabularies, which is what lets a
 * round be apportioned the way the paper's signs section is.
 */
const SIGN_CATEGORIES: { signClass: string; topic: TopicKey }[] = [
  { signClass: "regulatory", topic: "regulatory_signs" },
  { signClass: "warning", topic: "warning_signs" },
  { signClass: "guidance", topic: "guidance_signs" },
  { signClass: "information", topic: "information_signs" },
  { signClass: "road_marking", topic: "road_markings" },
  { signClass: "road_signal", topic: "road_signals" },
];

export function signClassLabel(signClass: string): string {
  const category = SIGN_CATEGORIES.find((c) => c.signClass === signClass);
  return category ? TOPIC_LABELS[category.topic] : signClass.replace(/_/g, " ");
}

/**
 * How many of each category a round asks, in the proportions of the paper's
 * signs section.
 *
 * The paper asks 61 signs questions split 20/15/7/4/9/6, and a round of any
 * length is that split scaled by largest remainder. This is not the scaling the
 * blueprint refuses: there, apportioning a short paper let an incomplete bank
 * pose as the examination. Here nothing claims to be the examination, the pool
 * is six times the section it is modelled on, and the proportions are borrowed
 * openly so that practice is weighted the way the marks are.
 */
export function practiceQuotas(
  length: number = PRACTICE_ROUND_LENGTH,
): { signClass: string; topic: TopicKey; count: number }[] {
  const quota = TOPIC_QUOTAS["2+3"];
  if (quota === null) return [];

  const shares = SIGN_CATEGORIES.map((category) => ({
    ...category,
    want: quota[category.topic] ?? 0,
  }));
  const total = shares.reduce((sum, share) => sum + share.want, 0);
  if (total === 0) return [];

  const rows = shares.map((share) => {
    const exact = (share.want / total) * length;
    return { ...share, exact, count: Math.floor(exact) };
  });

  let remaining = length - rows.reduce((sum, row) => sum + row.count, 0);
  for (const row of [...rows].sort(
    (a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)),
  )) {
    if (remaining <= 0) break;
    row.count += 1;
    remaining -= 1;
  }

  return rows.map(({ signClass, topic, count }) => ({ signClass, topic, count }));
}

/** A catalogue sign that has everything a question needs. */
export interface EligibleSign {
  ref: string;
  /** Catalogue order. Neighbours are usually variants of one another. */
  number: number | null;
  name: string;
  /** Lowercased and trimmed, for deciding when two signs share a name. */
  nameKey: string;
  /** Significant words in the name, for deciding when two signs are alike. */
  nameTokens: string[];
  meaning: string | null;
  signClass: string;
  folio: number | null;
  nameFromPage: boolean;
  artworkUrl: string;
}

const NAME_STOPWORDS = new Set([
  "the", "a", "an", "of", "and", "for", "to", "or", "in", "on", "with", "at", "is",
]);

function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !NAME_STOPWORDS.has(word));
}

/**
 * Which signs may be asked about.
 *
 * A sign needs a name to be the answer to anything, and its artwork has to exist
 * on disk - the same rule the question bank applies, and for the same reason: a
 * question about a picture that is not there is not a question.
 *
 * It also needs a class, which is the rule worth explaining. The class is what
 * the wrong options are drawn from, so that "which sign is this?" is a choice
 * between three signs of the same kind rather than a giveaway between a red
 * triangle and a blue rectangle. A sign with no class has no group to be
 * confused with, so it is left out rather than padded with whatever came to
 * hand. That is 77 of the 495, and they are counted rather than hidden.
 */
export function eligibleSigns(signs: Sign[], artworkFor: ArtworkResolver): EligibleSign[] {
  const out: EligibleSign[] = [];
  for (const sign of signs) {
    if (!sign.name || !sign.class) continue;
    const url = artworkFor(sign.ref);
    if (!url) continue;
    const name = sign.name.trim();
    out.push({
      ref: sign.ref,
      number: sign.number,
      name,
      nameKey: name.toLowerCase(),
      nameTokens: nameTokens(name),
      meaning: sign.meaning,
      signClass: sign.class,
      folio: sign.folio ?? null,
      nameFromPage: sign.name_source === "page",
      artworkUrl: url,
    });
  }
  // Stable order so a seed always sees the same pool.
  out.sort((a, b) => a.ref.localeCompare(b.ref));
  return out;
}

/**
 * How easily two signs of the same class could be confused.
 *
 * Every signal here is recorded in the catalogue rather than judged by this
 * code. Sharing a folio means the manual prints them on the same page, which in
 * this catalogue means the same sub-type - the yield family on one page, the
 * prohibitions on another. Sharing a word in the name means they are variants of
 * one idea: Sharp Curve Left against Sharp Curve Right, Minibuses Only against
 * Buses Only. Adjacent catalogue numbers are a weaker version of the same thing.
 *
 * This is what makes the questions hard, and it is the whole difference between
 * "which of these three is the freeway sign" where two are brown and one is
 * blue, and one where all three are blue freeway signs.
 */
export function similarity(a: EligibleSign, b: EligibleSign): number {
  let score = 0;
  if (a.folio != null && a.folio === b.folio) score += 3;

  const mine = new Set(a.nameTokens);
  for (const token of b.nameTokens) if (mine.has(token)) score += 2;

  if (a.number != null && b.number != null && Math.abs(a.number - b.number) <= 3) {
    score += 1;
  }
  return score;
}

export function usableMeaning(sign: EligibleSign): boolean {
  const meaning = sign.meaning?.trim();
  if (!meaning) return false;
  if (meaning.length > MEANING_OPTION_MAX) return false;
  return meaning.split(/\s+/).length >= MEANING_OPTION_MIN_WORDS;
}

function meaningKey(sign: EligibleSign): string {
  return (sign.meaning ?? "").trim().toLowerCase();
}

/**
 * Two wrong options for a subject sign, from its own class and as close to it as
 * the catalogue allows.
 *
 * Deduplicated by name, which is not a nicety. Five different signs are named
 * "Derestriction" and three are "Railway crossing"; an option list built without
 * this check would offer the right answer twice and mark one of them wrong. It
 * also makes the picture question safe: if no option shares the subject's name,
 * only one option can be the sign that was asked for.
 *
 * A meaning question additionally needs its options to be distinct as text -
 * nine pairs of signs in the catalogue carry word-for-word identical meanings,
 * and a question with two identical options has two right answers.
 */
function distractors(
  subject: EligibleSign,
  classPool: readonly EligibleSign[],
  rng: () => number,
  needMeaning: boolean,
): EligibleSign[] {
  const candidates = classPool.filter(
    (sign) => sign.ref !== subject.ref && (!needMeaning || usableMeaning(sign)),
  );

  // Shuffled first, then sorted by similarity. The sort is stable, so equally
  // similar candidates keep the seeded order rather than the catalogue's - which
  // is what stops one subject always drawing the same two distractors.
  const ranked = shuffle(candidates, rng).sort(
    (a, b) => similarity(subject, b) - similarity(subject, a),
  );

  const shortlist: EligibleSign[] = [];
  const names = new Set([subject.nameKey]);
  const meanings = new Set([meaningKey(subject)]);

  for (const candidate of ranked) {
    if (names.has(candidate.nameKey)) continue;
    if (needMeaning && meanings.has(meaningKey(candidate))) continue;
    names.add(candidate.nameKey);
    meanings.add(meaningKey(candidate));
    shortlist.push(candidate);
    if (shortlist.length === SIMILARITY_SHORTLIST) break;
  }

  return sample(shortlist, 2, rng);
}

function buildOfShape(
  subject: EligibleSign,
  shape: PracticeShape,
  classPool: readonly EligibleSign[],
  rng: () => number,
): PracticeQuestion | null {
  if (shape === "meaning" && !usableMeaning(subject)) return null;

  const wrong = distractors(subject, classPool, rng, shape === "meaning");
  // A class with fewer than three usable signs cannot make a three-option
  // question. Skipped rather than filled from another class, which would make
  // the answer obvious from the shape of the sign alone.
  if (wrong.length < 2) return null;

  const ordered = shuffle([subject, ...wrong], rng);
  const answerIndex = ordered.findIndex((sign) => sign.ref === subject.ref);

  const options: PracticeOption[] = ordered.map((sign, index) => ({
    key: OPTION_KEYS[index],
    text:
      shape === "identify"
        ? sign.name
        : shape === "meaning"
          ? (sign.meaning ?? "").trim()
          : "",
    artworkUrl: shape === "select" ? sign.artworkUrl : null,
    ref: sign.ref,
  }));

  const text =
    shape === "identify"
      ? "Which sign is this?"
      : shape === "meaning"
        ? "What does this sign mean?"
        : `Which sign is the ${subject.name.toLowerCase()} sign?`;

  return {
    ref: subject.ref,
    position: 0,
    shape,
    text,
    stemArtworkUrl: shape === "select" ? null : subject.artworkUrl,
    options,
    answer: OPTION_KEYS[answerIndex],
    sign: {
      ref: subject.ref,
      name: subject.name,
      meaning: subject.meaning,
      signClass: subject.signClass,
      folio: subject.folio,
      nameFromPage: subject.nameFromPage,
    },
  };
}

const SHAPES: PracticeShape[] = ["identify", "select", "meaning"];

/**
 * One question about one sign, in whichever shape the catalogue supports.
 *
 * The shape is chosen from the seed and then fallen back through, because not
 * every sign can carry every shape: a sign whose meaning is a 900-character
 * paragraph cannot be asked about by meaning. Falling back keeps the round its
 * stated length rather than silently dropping the sign.
 */
function buildQuestion(
  subject: EligibleSign,
  classPool: readonly EligibleSign[],
  rng: () => number,
): PracticeQuestion | null {
  const first = Math.floor(rng() * SHAPES.length);
  for (let offset = 0; offset < SHAPES.length; offset += 1) {
    const question = buildOfShape(
      subject,
      SHAPES[(first + offset) % SHAPES.length],
      classPool,
      rng,
    );
    if (question) return question;
  }
  return null;
}

/**
 * Build one round, reproducible from its seed.
 *
 * Every category is drawn to its own quota, and the finished round is then
 * shuffled so the categories are mixed rather than marched through in blocks -
 * recognising a warning sign is easier when the last nine were also warning
 * signs, and the examination does not offer that help either.
 *
 * Subjects are sampled without replacement, so a round never asks about the same
 * sign twice.
 */
export function assemblePractice(
  seed: string,
  signs: Sign[],
  artworkFor: ArtworkResolver,
  length: number = PRACTICE_ROUND_LENGTH,
): PracticeRound {
  const pool = eligibleSigns(signs, artworkFor);
  const byClass = new Map<string, EligibleSign[]>();
  for (const sign of pool) {
    byClass.set(sign.signClass, [...(byClass.get(sign.signClass) ?? []), sign]);
  }

  const rng = makeRng(`practice|${seed}`);
  const questions: PracticeQuestion[] = [];
  const categories: PracticeRound["categories"] = [];

  for (const quota of practiceQuotas(length)) {
    const classPool = byClass.get(quota.signClass) ?? [];
    let filled = 0;

    // Oversampled, because a subject can fail to yield a question in any shape.
    // Taking the first `count` that work keeps the category at its quota instead
    // of quietly serving fewer.
    for (const subject of sample(classPool, classPool.length, rng)) {
      if (filled >= quota.count) break;
      const question = buildQuestion(subject, classPool, rng);
      if (!question) continue;
      questions.push(question);
      filled += 1;
    }

    categories.push({
      signClass: quota.signClass,
      requested: quota.count,
      filled,
    });
  }

  const mixed = shuffle(questions, rng);
  mixed.forEach((question, index) => {
    question.position = index + 1;
  });

  return {
    seed,
    questions: mixed,
    categories,
    poolSize: pool.length,
    catalogueSize: signs.length,
  };
}
