import { z } from "zod";

/**
 * Validation for the extractor's output.
 *
 * Written against the actual files, not against a description of them. If the
 * extractor's shape changes, loading fails loudly here rather than producing a
 * test with missing or mis-keyed questions.
 */

export const OPTION_KEYS = ["A", "B", "C"] as const;
export type OptionKey = (typeof OPTION_KEYS)[number];

export const SECTION_KEYS = ["A", "B", "C", "D", "E"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

/**
 * Subject topics, which are what the official paper is actually built from.
 *
 * The letters a scanned paper prints are that paper's own layout and they do not
 * agree between documents - one paper's Section C is rules of the road, the
 * regulation's Section C is motorcycles. The topic is the thing that is stable,
 * so the blueprint is expressed in these and the section letter is kept only as
 * provenance.
 *
 * The first six make up Road Traffic Signs and use the same vocabulary as the
 * sign catalogue's `class` field, so a question linked to a catalogue sign can
 * be classified from it.
 */
export const SIGNS_TOPIC_KEYS = [
  "regulatory_signs",
  "warning_signs",
  "guidance_signs",
  "information_signs",
  "road_markings",
  "road_signals",
] as const;

export const TOPIC_KEYS = [
  ...SIGNS_TOPIC_KEYS,
  "rules_of_the_road",
  "traffic_legislation",
  "vehicle_controls",
  "motorcycles",
] as const;
export type TopicKey = (typeof TOPIC_KEYS)[number];

export function isSignsTopic(topic: TopicKey): boolean {
  return (SIGNS_TOPIC_KEYS as readonly string[]).includes(topic);
}

/**
 * Spellings accepted from the curation fields.
 *
 * The sign catalogue says "road_marking" and the regulation says "Road
 * Markings"; both mean the topic. Accepting the obvious variants keeps a
 * curator's typo from silently dropping a question out of the blueprint, which
 * would show up only as an unexplained shortfall.
 */
const TOPIC_ALIASES: Record<string, TopicKey> = {
  regulatory: "regulatory_signs",
  regulatory_sign: "regulatory_signs",
  regulatory_signs: "regulatory_signs",
  warning: "warning_signs",
  warning_sign: "warning_signs",
  warning_signs: "warning_signs",
  guidance: "guidance_signs",
  guidance_sign: "guidance_signs",
  guidance_signs: "guidance_signs",
  information: "information_signs",
  information_sign: "information_signs",
  information_signs: "information_signs",
  road_marking: "road_markings",
  road_markings: "road_markings",
  marking: "road_markings",
  markings: "road_markings",
  road_signal: "road_signals",
  road_signals: "road_signals",
  signal: "road_signals",
  signals: "road_signals",
  rules: "rules_of_the_road",
  rules_of_the_road: "rules_of_the_road",
  road_rules: "rules_of_the_road",
  legislation: "traffic_legislation",
  traffic_legislation: "traffic_legislation",
  vehicle_controls: "vehicle_controls",
  motorcycle: "motorcycles",
  motorcycles: "motorcycles",
};

/**
 * Labels that name a subject without naming a quota.
 *
 * "controls" is the only one, and it is genuinely ambiguous: eight questions in
 * Test 1 carry it — four in the motorcycle block asking about a motorcycle's
 * rear brake and clutch, four in the light-and-heavy-vehicle block asking about
 * a car's steering wheel and ignition. Mapping the word straight to
 * `vehicle_controls` counted all eight against the Code 2/3 quota of four,
 * filling it with motorcycle questions a Code 2 candidate never sees.
 *
 * These resolve through the question's own `category` instead, which the
 * extraction already states per question. Where category does not settle it the
 * label is dropped rather than guessed: an unlabelled question is visibly short,
 * a misfiled one is not.
 */
const AMBIGUOUS_TOPIC_LABELS: Record<string, true> = { controls: true };

const CATEGORY_ALIASES: Record<string, TopicKey> = {
  motorcycles: "motorcycles",
  motorcycle: "motorcycles",
  vehicle_controls: "vehicle_controls",
  controls: "vehicle_controls",
};

function normaliseLabel(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/** Normalise a curated label. Returns null for anything not recognised. */
export function toTopicKey(value: string | null | undefined): TopicKey | null {
  if (!value) return null;
  return TOPIC_ALIASES[normaliseLabel(value)] ?? null;
}

/**
 * Normalise a label that may need the question's category to disambiguate it.
 *
 * Unambiguous labels ignore the category entirely; only the ones in
 * {@link AMBIGUOUS_TOPIC_LABELS} consult it.
 */
export function toTopicKeyWithCategory(
  value: string | null | undefined,
  category: string | null | undefined,
): TopicKey | null {
  if (!value) return null;
  const normalised = normaliseLabel(value);
  if (!AMBIGUOUS_TOPIC_LABELS[normalised]) {
    return TOPIC_ALIASES[normalised] ?? null;
  }
  return category ? (CATEGORY_ALIASES[normaliseLabel(category)] ?? null) : null;
}

/**
 * The sub-requirement inside Rules of the Road: at least 5 of its 15 questions
 * must be on the general duties of a driver. Carried in `category` because it
 * cuts across the topic rather than replacing it.
 */
export const GENERAL_DUTIES = "general_duties";

export function isGeneralDuties(category: string | null | undefined): boolean {
  if (!category) return false;
  return category.trim().toLowerCase().replace(/[\s-]+/g, "_") === GENERAL_DUTIES;
}

const optionKey = z.enum(OPTION_KEYS);
const bbox = z.array(z.number()).length(4);

/** One picture belonging to the question stem. */
const imageSingle = z.object({
  type: z.literal("single"),
  ref: z.string().nullable().optional(),
  bbox: bbox.nullable().optional(),
  note: z.string().nullable().optional(),
});

/** Each of A/B/C is itself a picture; the option text is just the letter. */
const imageOptions = z.object({
  type: z.literal("options"),
  refs: z.record(z.string(), z.string().nullable()).nullable().optional(),
  bbox: bbox.nullable().optional(),
  note: z.string().nullable().optional(),
});

/** A diagram with lettered callouts that the options refer to. */
const imageLabelledDiagram = z.object({
  type: z.literal("labelled_diagram"),
  ref: z.string().nullable().optional(),
  labels: z.array(z.string()).default([]),
  bbox: bbox.nullable().optional(),
  note: z.string().nullable().optional(),
});

export const imageSchema = z.discriminatedUnion("type", [
  imageSingle,
  imageOptions,
  imageLabelledDiagram,
]);
export type QuestionImage = z.infer<typeof imageSchema>;

export const questionSchema = z.object({
  id: z.string().regex(/^q\d{3}$/),
  number: z.number().int().positive(),
  section: z.enum(SECTION_KEYS),

  // Human-curation fields. Null from the extractor by design.
  category: z.string().nullable().optional(),
  sign_type: z.string().nullable().optional(),
  topic: z.string().nullable().optional(),
  needs_official_source: z.boolean().nullable().optional(),

  is_example: z.boolean().default(false),
  text: z.string(),
  options: z.record(z.string(), z.string()),

  answer: optionKey.nullable(),
  answer_source: z.string().nullable().optional(),

  image: imageSchema.nullable().optional(),
  status: z.enum(["ok", "blocked"]).default("ok"),
  blocked_reason: z.string().nullable().optional(),

  page: z.number().int().nullable().optional(),
  source_bbox: bbox.nullable().optional(),
});
export type RawQuestion = z.infer<typeof questionSchema>;

export const paperSchema = z.object({
  $schema_version: z.string().optional(),
  source: z.object({
    title: z.string(),
    paper: z.string().nullable().optional(),
    scan_file: z.string(),
    answer_key_included: z.boolean().default(false),
  }),
  sections: z
    .record(
      z.string(),
      z.object({
        title: z.string(),
        is_example_section: z.boolean().default(false),
        codes: z.array(z.string()).default([]),
      }),
    )
    .optional(),
  extraction: z.record(z.string(), z.unknown()).optional(),
  questions: z.array(questionSchema),
});
export type Paper = z.infer<typeof paperSchema>;

/**
 * One sign in the catalogue produced by the SVG pipeline.
 *
 * `name`, `class` and `meaning` are nullable, and that is the point. 77 of the
 * 495 signs are ones the earlier PDF pass never read, so they have artwork and a
 * number but no carried-over name or meaning; 8 of those have no name at all
 * because the Illustrator export converted that text to outlines. An empty
 * string would let the app print a blank where a name belongs. Null makes the
 * absence checkable, and `name_source` says where a name that exists came from.
 */
export const signSchema = z.object({
  ref: z.string(),
  number: z.number().int().nullable(),
  name: z.string().nullable(),
  name_source: z.enum(["catalogue", "page"]).nullable().optional(),
  class: z.string().nullable(),
  meaning: z.string().nullable(),
  folio: z.number().int().nullable().optional(),
  artwork: z.string().nullable().optional(),
  catalogue_joined: z.boolean().optional(),
});
export type Sign = z.infer<typeof signSchema>;

export const signCatalogueSchema = z.object({
  counts: z.object({ signs: z.number() }).passthrough(),
  signs: z.array(signSchema),
});

/**
 * Answers derived from the manual rather than read off a paper.
 *
 * These do not come from a document stating the answer; they come from a fact in
 * the manual that settles it. Each carries the fact id and the folio and
 * paragraph it was read from, and `reviewed` is false until a human has checked
 * that one entry. The app applies them so its coverage matches the extractor's,
 * and marks every question that rests on one.
 */
export const answersFromFactsSchema = z.object({
  note: z.string(),
  answers: z.array(
    z.object({
      uid: z.string(),
      answer: z.enum(OPTION_KEYS),
      answer_source: z.string(),
      fact_id: z.string(),
      rule: z.string(),
      manual_page: z.number().int(),
      manual_paragraph: z.number().int(),
      basis: z.string(),
      reviewed: z.boolean().default(false),
    }),
  ),
});
export type AnswersFromFacts = z.infer<typeof answersFromFactsSchema>;

export const factSchema = z.object({
  id: z.string(),
  statement: z.string(),
  subject: z.string(),
  measure: z.string().nullable(),
  relation: z.string().nullable(),
  value: z.string(),
  unit: z.string().nullable(),
  qualifiers: z.array(z.string()),
  source: z.object({ page: z.number().int(), paragraph: z.number().int() }),
  applies_to_codes: z.array(z.string()),
  kind: z.string(),
  verbatim: z.string(),
  extra: z.record(z.string(), z.unknown()).optional(),
});
export type Fact = z.infer<typeof factSchema>;

export const factsFileSchema = z.object({
  counts: z.record(z.string(), z.unknown()),
  facts: z.array(factSchema),
});

export const bookEntrySchema = z.object({
  id: z.string(),
  chapter: z.number().int(),
  chapter_title: z.string(),
  section: z.string().nullable(),
  paragraph: z.number().int(),
  pages: z.array(z.number().int()),
  heading: z.string(),
  text: z.string(),
  applies_to_codes: z.array(z.string()),
  kind: z.string(),
  sign_ref: z.string().optional(),
  sign_number: z.number().int().optional(),
});
export type BookEntry = z.infer<typeof bookEntrySchema>;

export const bookFileSchema = z.object({
  source: z.record(z.string(), z.unknown()),
  entries: z.array(bookEntrySchema),
});

/**
 * Topic labels supplied outside the banks.
 *
 * The extractor emits `topic`, `category` and `sign_type` as null by design, so
 * without this file no question can be placed in a quota and the official paper
 * cannot be built at all. A label decides only which quota a question counts
 * toward; nothing here can change a question, its options or its answer.
 *
 * `reviewed` is carried per entry as well as for the file, because the labels are
 * machine-assigned and the app has to be able to say so.
 */
export const topicCurationSchema = z.object({
  note: z.string(),
  labelled_by: z.enum(["machine", "human"]),
  reviewed: z.boolean().default(false),
  review_warning: z.string().optional(),
  basis_of_labels: z.string().optional(),
  entries: z.array(
    z.object({
      bank: z.string(),
      question: z.number().int().positive(),
      topic: z.enum(TOPIC_KEYS),
      category: z.string().nullable().optional(),
      basis: z.string(),
      reviewed: z.boolean().default(false),
    }),
  ),
});
export type TopicCuration = z.infer<typeof topicCurationSchema>;

export const disputedSchema = z.object({
  note: z.string(),
  entries: z.array(
    z.object({
      bank: z.string(),
      question_numbers: z.array(z.number().int()),
      reason: z.string(),
      cleared: z.boolean().default(false),
    }),
  ),
});
export type Disputed = z.infer<typeof disputedSchema>;

/** Parse with a message that names the file, so a shape change is traceable. */
export function parseOrThrow<T>(
  schema: { safeParse: (value: unknown) => { success: boolean; data?: T; error?: unknown } },
  value: unknown,
  fileName: string,
): T {
  const result = schema.safeParse(value);
  if (!result.success || result.data === undefined) {
    const detail =
      result.error instanceof z.ZodError
        ? result.error.issues
            .slice(0, 8)
            .map((i) => `    ${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("\n")
        : String(result.error);
    throw new Error(
      `${fileName} does not match the expected schema.\n` +
        `The extractor's output shape may have changed. Re-run \`npm run sync-data\`.\n${detail}`,
    );
  }
  return result.data;
}
