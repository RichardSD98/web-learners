import {
  blueprintLength,
  buildBlueprint,
  GENERAL_DUTIES_MINIMUM,
  OFFICIAL_LAYOUT,
  PAPER_VARIANT_BY_CODE,
  TEST_DURATION_MINUTES,
  TOPIC_QUOTAS,
  type LicenceCode,
  type PaperVariant,
  type TopicSlot,
} from "./blueprint";
import { makeRng, shuffle } from "./random";
import type { ServableQuestion } from "./bank";
import { isSignsTopic, OPTION_KEYS, type OptionKey, type SectionKey, type TopicKey } from "./schema";

/**
 * Assemble a paper by selecting and arranging existing questions.
 *
 * Nothing here composes a question or decides an answer. The only thing that
 * changes about a question is the order its options are presented in, and the
 * correct key is remapped with them.
 *
 * A paper is either the full 90 questions in the official topic quotas or it is
 * not served. There is no scaled-down mode: the quotas are the test, and a
 * shorter paper drawn in the same proportions would still be a different
 * examination presented as this one.
 *
 * {@link assemblePreview} is the one exception, and it is not a way round that
 * rule. It exists so the flow can be walked through while the bank is being
 * filled, and it is reachable only behind an off-by-default build flag. What it
 * returns carries a {@link PreviewNotice} that every screen showing it is
 * required to display, and a preview is never marked against the pass mark -
 * see the null pass mark in `score.ts`. A preview is a development artefact
 * wearing a label, not a short test.
 */

export interface AssembledOption {
  key: OptionKey;
  text: string;
  /** Which key this option had in the source bank, for review and for auditing. */
  originalKey: OptionKey;
  /** Artwork for this option, when each option is itself a picture. */
  artworkUrl: string | null;
}

export interface AssembledQuestion {
  uid: string;
  /** The subject topic whose quota this question fills. */
  topic: TopicKey;
  /** False while the topic label is machine-assigned and unreviewed. */
  topicReviewed: boolean;
  generalDuties: boolean;
  /** The section letter the source document printed. Provenance. */
  section: SectionKey;
  /** Official section letter this topic is asked under: B for signs, D otherwise. */
  officialSection: string;
  /** The number this question carries on a real paper. Not contiguous: see below. */
  officialNumber: number;
  /** 1-based position in the paper as served. */
  position: number;
  text: string;
  options: AssembledOption[];
  /** The correct key *after* shuffling. */
  answer: OptionKey;
  source: {
    paper: string;
    bank: string;
    originalNumber: number;
    answerSource: string | null;
    /** "manual" when the answer was derived from the book, not printed. */
    answerOrigin: ServableQuestion["answerOrigin"];
    /** False while a derived answer has not been checked by a human. */
    answerReviewed: boolean;
  };
  stemArtworkUrl: string | null;
  imageType: "single" | "options" | "labelled_diagram" | null;
  catalogueSign: ServableQuestion["catalogueSign"];
  labels: string[];
}

/**
 * Set on a paper that is not the examination: what it is missing, in numbers.
 *
 * Present on a preview and null on a real paper, so "is this the test?" is one
 * field rather than an inference from a question count. Everything a screen
 * needs to say so is here, which is why the count is carried rather than left
 * for each screen to derive from the questions array.
 */
export interface PreviewNotice {
  /** Questions actually drawn. */
  length: number;
  /** Questions the real paper has. The preview is short by the difference. */
  officialLength: number;
  /** Topics the bank could not fill to quota, with what was drawn instead. */
  under: { topic: TopicKey; requested: number; filled: number }[];
  /**
   * Each marked section against its real length. A section is never longer than
   * the real one - see the cap in {@link assemblePreview} - so this says which
   * part of the paper is thin, which "66 of 90" on its own does not.
   */
  sections: { section: string; length: number; officialLength: number }[];
  /**
   * Questions the top-up drew: taken with no regard for the quotas at all, to
   * pad the paper back towards its length. They make it longer without making it
   * more representative, since they come from whichever topics happen to have a
   * surplus rather than from the topics that are short.
   */
  extra: number;
}

export interface AssembledTest {
  seed: string;
  code: LicenceCode;
  /** Codes sitting the same paper share a variant; the seed keys off this. */
  variant: PaperVariant;
  /** 1-based. Attempts walk through the pool instead of redrawing from it. */
  attempt: number;
  /** How many attempts this seed can serve before any question comes round again. */
  freshAttempts: number;
  durationMinutes: number;
  questions: AssembledQuestion[];
  blueprint: { topic: TopicKey; requested: number; filled: number }[];
  /** True only when every topic label in the paper has been reviewed by a human. */
  labelsReviewed: boolean;
  /** Null on a real paper. Set, and to be displayed, on a preview. */
  preview: PreviewNotice | null;
}

export interface TopicShortfall {
  topic: TopicKey;
  requested: number;
  available: number;
  /** Set on the general-duties sub-requirement rather than the topic itself. */
  requirement?: "general duties of a driver";
}

export class InsufficientQuestionsError extends Error {
  constructor(
    readonly code: LicenceCode,
    readonly shortfalls: TopicShortfall[],
  ) {
    const detail = shortfalls
      .map(
        (s) =>
          `${s.requirement ?? s.topic}: needs ${s.requested}, has ${s.available}`,
      )
      .join("; ");
    super(`Cannot assemble a Code ${code} paper — ${detail}`);
    this.name = "InsufficientQuestionsError";
  }
}

/**
 * Raised for a variant whose official quotas are not sourced.
 *
 * Distinct from a shortfall on purpose. A shortfall says the bank is too small,
 * which more questions would fix. This says nobody here knows what the paper is
 * supposed to contain, which no amount of questions fixes.
 */
export class BlueprintNotSpecifiedError extends Error {
  constructor(readonly code: LicenceCode) {
    super(
      `No official topic quotas are recorded for a Code ${code} paper, so one cannot be assembled.`,
    );
    this.name = "BlueprintNotSpecifiedError";
  }
}

/**
 * True when the options are bare letters pointing at labels in the artwork,
 * as in "a. A / b. B / c. C" beside three pictures captioned A, B and C.
 */
export function hasPictorialOptions(question: ServableQuestion): boolean {
  return OPTION_KEYS.every((key) => /^[A-Za-z]$/.test((question.options[key] ?? "").trim()));
}

/**
 * Reorder one question's options and move the correct key with them.
 *
 * The remap is the single place where a silent bug would corrupt every score,
 * so the correct option is located by identity after the shuffle rather than by
 * recomputing an index.
 */
export function shuffleOptions(
  question: ServableQuestion,
  rng: () => number,
): { options: AssembledOption[]; answer: OptionKey } {
  // These options must keep their order. Their text is a pointer into the
  // picture, so reordering produces rows like "A. C" - not wrong, but a needless
  // reading puzzle laid on top of the question actually being asked.
  if (hasPictorialOptions(question)) {
    return {
      options: OPTION_KEYS.map((key) => ({
        key,
        text: question.options[key],
        originalKey: key,
        artworkUrl: question.artwork.find((a) => a.label === key)?.url ?? null,
      })),
      answer: question.answer,
    };
  }

  const artworkByLabel = new Map(
    question.artwork.filter((a) => a.label).map((a) => [a.label as string, a.url]),
  );

  const original = OPTION_KEYS.map((key) => ({
    originalKey: key,
    text: question.options[key],
    artworkUrl: artworkByLabel.get(key) ?? null,
    isAnswer: key === question.answer,
  }));

  const reordered = shuffle(original, rng);

  const options: AssembledOption[] = reordered.map((option, index) => ({
    key: OPTION_KEYS[index],
    text: option.text,
    originalKey: option.originalKey,
    artworkUrl: option.artworkUrl,
  }));

  const answerIndex = reordered.findIndex((o) => o.isAnswer);
  if (answerIndex === -1) {
    // Unreachable for a servable question, which always has an answer. Throwing
    // is still right: a scored test with no correct option must never be served.
    throw new Error(`${question.uid}: correct option lost during shuffle`);
  }

  return { options, answer: OPTION_KEYS[answerIndex] };
}

/**
 * Take this attempt's slice of one pool, rotating through it.
 *
 * Drawing each paper independently is what makes the app feel repetitive, and
 * it is not a defect in the shuffle: a pool of 34 that a paper needs 20 of shares
 * about 12 between two independent draws by simple arithmetic. Instead the pool is
 * permuted once per cycle from the seed alone, and attempt k reads the k-th window
 * of that stream. Attempt 2 then shares nothing with attempt 1, and nothing comes
 * round again until the pool is spent.
 *
 * The permutation deliberately does not depend on the attempt - if it did, the
 * windows would be cut from different orderings and could not be disjoint.
 *
 * A window that straddles a cycle boundary would otherwise be able to draw the
 * same question twice in one paper, so items already taken are skipped.
 */
export function rotationWindow<T>(
  pool: readonly T[],
  count: number,
  attempt: number,
  seedForCycle: (cycle: number) => string,
): T[] {
  const start = (attempt - 1) * count;
  let cycle = Math.floor(start / pool.length);
  let offset = start % pool.length;

  const out: T[] = [];
  const taken = new Set<T>();
  while (out.length < count) {
    const permuted = shuffle(pool, makeRng(seedForCycle(cycle)));
    for (const item of permuted.slice(offset)) {
      if (out.length >= count) break;
      if (taken.has(item)) continue;
      taken.add(item);
      out.push(item);
    }
    cycle += 1;
    offset = 0;
  }
  return out;
}

/**
 * Split a slot into the parts drawn independently, with the size wanted from each.
 *
 * Rules of the Road must contain at least 5 questions on the general duties of a
 * driver, so it is filled from two fixed partitions of its pool: 5 from the
 * general-duties questions and 10 from the rest.
 *
 * Both partitions are fixed - neither depends on the attempt - and that is the
 * whole reason for doing it this way. Drawing the balance from "everything not
 * already chosen" seems more natural and is wrong: the 5 excluded questions differ
 * per attempt, so the balance pool differs per attempt, so its permutation differs
 * per attempt, and consecutive attempts stop being disjoint. This is the same
 * hazard rotationWindow's own comment warns about, one level up.
 *
 * The cost is that a paper carries exactly 5 general-duties questions rather than
 * 5 or more. The requirement is a floor, so exactly 5 always satisfies it; what is
 * given up is the chance of a sixth, and a repeat-free rotation is worth more.
 */
function partsForSlot(
  slot: TopicSlot,
  pool: readonly ServableQuestion[],
): { part: string; pool: readonly ServableQuestion[]; count: number }[] {
  if (slot.generalDutiesMinimum === 0) {
    return [{ part: "all", pool, count: slot.count }];
  }
  return [
    {
      part: "duties",
      pool: pool.filter((q) => q.generalDuties),
      count: slot.generalDutiesMinimum,
    },
    {
      part: "balance",
      pool: pool.filter((q) => !q.generalDuties),
      count: slot.count - slot.generalDutiesMinimum,
    },
  ];
}

function fillSlot(
  slot: TopicSlot,
  pool: readonly ServableQuestion[],
  attempt: number,
  seedFor: (part: string, cycle: number) => string,
): ServableQuestion[] {
  return partsForSlot(slot, pool).flatMap((part) =>
    rotationWindow(part.pool, part.count, attempt, (cycle) => seedFor(part.part, cycle)),
  );
}

/**
 * Fill a slot as far as the pool goes, which is only ever the preview's job.
 *
 * The full path never calls this: it checks every slot first and refuses the
 * paper, precisely so that a short topic cannot quietly become a short section.
 */
function fillSlotPartially(
  slot: TopicSlot,
  pool: readonly ServableQuestion[],
  attempt: number,
  seedFor: (part: string, cycle: number) => string,
): ServableQuestion[] {
  return partsForSlot(slot, pool).flatMap((part) => {
    const count = Math.min(part.count, part.pool.length);
    if (count === 0) return [];
    return rotationWindow(part.pool, count, attempt, (cycle) => seedFor(part.part, cycle));
  });
}

/**
 * What a slot needs from the pool, part by part.
 *
 * Reported per part rather than on the total, because a topic can hold more
 * questions than the slot needs and still be unable to fill it: 20 general-duties
 * questions and 2 others cannot make a compliant 15. A check on the total alone
 * would pass that pool and then draw whatever it could.
 */
function shortfallsForSlot(
  slot: TopicSlot,
  pool: readonly ServableQuestion[],
): TopicShortfall[] {
  return partsForSlot(slot, pool)
    .filter((part) => part.pool.length < part.count)
    .map((part) => ({
      topic: slot.topic,
      requested: part.count,
      available: part.pool.length,
      requirement: part.part === "duties" ? ("general duties of a driver" as const) : undefined,
    }));
}

/** Attempts a slot can serve before it starts reusing questions. */
function freshAttemptsForSlot(slot: TopicSlot, pool: readonly ServableQuestion[]): number {
  return Math.min(
    ...partsForSlot(slot, pool).map((part) => Math.floor(part.pool.length / part.count)),
  );
}

/**
 * Number the paper as the examination does.
 *
 * Signs run 5-65 and the Code 2/3 block runs 95-123, so the numbering has a gap
 * where the motorcycle section a Code 2/3 candidate does not answer would be. The
 * gap is real and is shown rather than closed up: a learner comparing the app
 * against a printed paper should find the same numbers on the same questions.
 *
 * A preview is numbered by the same runs and stays inside them, because its
 * padding is capped per section. Every number it shows is therefore a number the
 * printed paper carries: a preview is short, and it is short at the end of a
 * section rather than numbered off the end of one.
 */
function officialNumbers(variant: PaperVariant, signsCount: number, blockCount: number): {
  signs: number[];
  block: number[];
} {
  const layout = OFFICIAL_LAYOUT[variant];
  const marked = layout.filter((section) => section.marked);
  const signsSection = marked.find((section) => section.label === "B");
  const blockSection = marked.find((section) => section.label !== "B");

  const run = (first: number, count: number) =>
    Array.from({ length: count }, (_, index) => first + index);

  return {
    signs: signsSection ? run(signsSection.firstNumber, signsCount) : run(1, signsCount),
    block: blockSection
      ? run(blockSection.firstNumber, blockCount)
      : run(signsCount + 1, blockCount),
  };
}

/** One topic's slot and the questions drawn for it, before they are laid out. */
interface DrawnSlot {
  slot: TopicSlot;
  questions: ServableQuestion[];
}

/**
 * Turn a draw into a paper: order it, number it, shuffle each question's options.
 *
 * Shared by the real paper and the preview so that a preview is laid out,
 * numbered and marked by exactly the same code. The only difference between the
 * two is which questions reach this function, and the notice that says so.
 */
function layOut(
  seed: string,
  code: LicenceCode,
  variant: PaperVariant,
  attempt: number,
  freshAttempts: number,
  drawn: DrawnSlot[],
  rng: () => number,
  preview: PreviewNotice | null,
): AssembledTest {
  const signsDrawn = drawn.filter((d) => isSignsTopic(d.slot.topic));
  const blockDrawn = drawn.filter((d) => !isSignsTopic(d.slot.topic));
  const numbers = officialNumbers(
    variant,
    signsDrawn.reduce((sum, d) => sum + d.questions.length, 0),
    blockDrawn.reduce((sum, d) => sum + d.questions.length, 0),
  );

  const questions: AssembledQuestion[] = [];
  const blueprint: AssembledTest["blueprint"] = [];

  for (const group of [signsDrawn, blockDrawn]) {
    const numberRun = group === signsDrawn ? numbers.signs : numbers.block;
    let cursor = 0;

    for (const { slot, questions: chosen } of group) {
      blueprint.push({ topic: slot.topic, requested: slot.count, filled: chosen.length });

      for (const question of chosen) {
        const { options, answer } = shuffleOptions(question, rng);
        questions.push({
          uid: question.uid,
          topic: question.topic,
          topicReviewed: question.topicReviewed,
          generalDuties: question.generalDuties,
          section: question.section,
          officialSection: group === signsDrawn ? "B" : "D",
          officialNumber: numberRun[cursor],
          position: 0,
          text: question.text,
          options,
          answer,
          source: {
            paper: question.sourcePaper,
            bank: question.bank,
            originalNumber: question.originalNumber,
            answerSource: question.answerSource,
            answerOrigin: question.answerOrigin,
            answerReviewed: question.answerReviewed,
          },
          // Whatever artwork is not attached to a specific option belongs to the
          // stem. For a picture-option question that is the single combined crop.
          stemArtworkUrl: question.artwork.find((a) => !a.label)?.url ?? null,
          imageType: question.imageType,
          catalogueSign: question.catalogueSign,
          labels: question.labels,
        });
        cursor += 1;
      }
    }
  }

  questions.forEach((question, index) => {
    question.position = index + 1;
  });

  return {
    seed,
    code,
    variant,
    attempt,
    freshAttempts,
    durationMinutes: TEST_DURATION_MINUTES,
    questions,
    blueprint,
    labelsReviewed: questions.every((q) => q.topicReviewed),
    preview,
  };
}

/**
 * The RNG for one paper.
 *
 * One stream, consumed in a fixed order, so the same seed and attempt always
 * yield the same paper: the ordering within each topic, then per-question option
 * order. Which questions are drawn is not taken from this stream - that is the
 * rotation's job, and it must not depend on the attempt. Codes sitting the same
 * paper key off the variant, so Code 2 and Code 3 get the identical paper rather
 * than two draws from one pool.
 */
function paperRng(seed: string, variant: PaperVariant, attempt: number): () => number {
  return makeRng(`${seed}|paper${variant}|attempt${attempt}`);
}

function slotSeed(seed: string, variant: PaperVariant, topic: TopicKey) {
  return (part: string, cycle: number) =>
    `${seed}|paper${variant}|topic${topic}|${part}|cycle${cycle}`;
}

export function assembleTest(
  seed: string,
  code: LicenceCode,
  pool: Record<TopicKey, ServableQuestion[]>,
  attempt: number = 1,
): AssembledTest {
  const variant = PAPER_VARIANT_BY_CODE[code];
  if (TOPIC_QUOTAS[variant] === null) throw new BlueprintNotSpecifiedError(code);

  const slots = buildBlueprint(variant);

  const shortfalls = slots.flatMap((slot) => shortfallsForSlot(slot, pool[slot.topic] ?? []));
  if (shortfalls.length > 0) throw new InsufficientQuestionsError(code, shortfalls);

  // How far the rotation gets before a question is seen twice. Reported rather
  // than assumed, because it is a property of the pool: the topic with the least
  // slack decides it for the whole paper.
  const freshAttempts = Math.min(
    ...slots.map((slot) => freshAttemptsForSlot(slot, pool[slot.topic])),
  );

  const rng = paperRng(seed, variant, attempt);

  const drawn: DrawnSlot[] = slots.map((slot) => ({
    slot,
    questions: shuffle(
      fillSlot(slot, pool[slot.topic], attempt, slotSeed(seed, variant, slot.topic)),
      rng,
    ),
  }));

  return layOut(seed, code, variant, attempt, freshAttempts, drawn, rng, null);
}

/**
 * The paper's two marked sections, with the length each really has.
 *
 * Taken from the quotas rather than from OFFICIAL_LAYOUT: the quotas are what
 * the blueprint is built from, and a variant can have quotas without a sourced
 * printed layout. The labels match the ones {@link layOut} puts on a question.
 */
function previewSections(slots: TopicSlot[]) {
  const partition = (signs: boolean) => slots.filter((s) => isSignsTopic(s.topic) === signs);
  return [
    { label: "B", slots: partition(true) },
    { label: "D", slots: partition(false) },
  ].map((section) => ({
    ...section,
    officialLength: section.slots.reduce((sum, slot) => sum + slot.count, 0),
  }));
}

/**
 * Attempts a preview can serve before it starts reusing questions.
 *
 * A slot the bank cannot fill contributes nothing to this: it is already taking
 * every question it has, so it repeats on the second attempt regardless. The
 * caller drops the figure to 1 whenever the top-up ran, which is the honest
 * answer once a paper is padded from whatever happens to be spare.
 */
function previewFreshAttempts(
  slots: TopicSlot[],
  pool: Record<TopicKey, ServableQuestion[]>,
): number {
  const ratios = slots.flatMap((slot) =>
    partsForSlot(slot, pool[slot.topic] ?? []).map((part) => {
      const count = Math.min(part.count, part.pool.length);
      return count === 0 ? Infinity : Math.floor(part.pool.length / count);
    }),
  );
  const fewest = Math.min(...ratios);
  return Number.isFinite(fewest) ? fewest : 1;
}

/**
 * Assemble what the bank can actually serve, and say what is missing.
 *
 * Not a smaller version of the test. Each topic gives up what it has, and the
 * paper is then padded from whichever topics have a surplus - so the proportions
 * are wrong, and wrong in a way that depends on which questions happen to have
 * been transcribed. That is the whole reason {@link assembleTest} refuses this
 * shape, and the reason every caller must display the {@link PreviewNotice}.
 *
 * The padding stops at each section's real length. A topic can therefore be
 * drawn past its own quota, which the notice reports, but a section can never be
 * longer than the section it stands for - that would put question numbers on
 * screen that no paper prints.
 *
 * The rules that decide whether a question may be served at all are untouched:
 * this draws from the same eligible pool, and topics the variant does not ask
 * about stay out of it. A preview shows fewer questions than the test, never
 * questions the test would not contain.
 *
 * A variant with no sourced quotas is still refused. A shortfall means the bank
 * is too small, which this works around; an unspecified blueprint means nobody
 * knows what the paper is, and there is nothing to preview.
 */
export function assemblePreview(
  seed: string,
  code: LicenceCode,
  pool: Record<TopicKey, ServableQuestion[]>,
  attempt: number = 1,
): AssembledTest {
  const variant = PAPER_VARIANT_BY_CODE[code];
  if (TOPIC_QUOTAS[variant] === null) throw new BlueprintNotSpecifiedError(code);

  const slots = buildBlueprint(variant);
  const officialLength = blueprintLength(variant);

  const base = new Map<TopicKey, ServableQuestion[]>(
    slots.map((slot) => [
      slot.topic,
      fillSlotPartially(
        slot,
        pool[slot.topic] ?? [],
        attempt,
        slotSeed(seed, variant, slot.topic),
      ),
    ]),
  );

  const under = slots
    .map((slot) => ({
      topic: slot.topic,
      requested: slot.count,
      filled: base.get(slot.topic)!.length,
    }))
    .filter((row) => row.filled < row.requested);

  // Top up from anything still unused in the topics this paper asks about. This
  // is the part that ignores the quotas, which is why it is counted separately
  // and reported: these questions are the least representative thing here.
  //
  // Capped per section, and that is the one limit the padding does respect. A
  // section longer than the real one has to be numbered past that section's last
  // number, and those are numbers no printed paper carries - indistinguishable on
  // screen from the sourced ones either side of them. Ignoring a topic quota
  // makes the paper unrepresentative, which the notice states; inventing question
  // numbers makes it quietly wrong, which no notice fixes.
  const taken = new Set([...base.values()].flat().map((q) => q.uid));
  let extra = 0;

  for (const section of previewSections(slots)) {
    const drawn = section.slots.reduce(
      (sum, slot) => sum + base.get(slot.topic)!.length,
      0,
    );
    const spare = section.slots
      .flatMap((slot) => pool[slot.topic] ?? [])
      .filter((question) => !taken.has(question.uid));

    const wanted = Math.min(section.officialLength - drawn, spare.length);
    if (wanted <= 0) continue;

    for (const question of rotationWindow(
      spare,
      wanted,
      attempt,
      (cycle) => `${seed}|paper${variant}|preview-topup|${section.label}|cycle${cycle}`,
    )) {
      base.get(question.topic)!.push(question);
      taken.add(question.uid);
      extra += 1;
    }
  }

  const rng = paperRng(seed, variant, attempt);
  const drawn: DrawnSlot[] = slots.map((slot) => ({
    slot,
    questions: shuffle(base.get(slot.topic)!, rng),
  }));

  const freshAttempts = extra > 0 ? 1 : previewFreshAttempts(slots, pool);

  return layOut(seed, code, variant, attempt, freshAttempts, drawn, rng, {
    length: taken.size,
    officialLength,
    under,
    extra,
    sections: previewSections(slots).map((section) => ({
      section: section.label,
      length: section.slots.reduce((sum, slot) => sum + base.get(slot.topic)!.length, 0),
      officialLength: section.officialLength,
    })),
  });
}

export { GENERAL_DUTIES_MINIMUM };
