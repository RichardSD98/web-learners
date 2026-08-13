import {
  isGeneralDuties,
  toTopicKeyWithCategory,
  type RawQuestion,
  type TopicCuration,
  type TopicKey,
} from "./schema";

/**
 * Where a question's topic label came from.
 *
 * Carried all the way to the screen. A quota met with machine labels is not the
 * same claim as a quota met with reviewed ones, and the app must not present them
 * as if they were.
 */
export type TopicSource = "bank" | "curation";

export interface ResolvedTopic {
  topic: TopicKey | null;
  source: TopicSource | null;
  /** True only when the label came from a human, or from a reviewed entry. */
  reviewed: boolean;
  generalDuties: boolean;
  basis: string | null;
}

const UNLABELLED: ResolvedTopic = {
  topic: null,
  source: null,
  reviewed: false,
  generalDuties: false,
  basis: null,
};

export interface TopicIndex {
  resolve: (bank: string, question: RawQuestion) => ResolvedTopic;
  /** The curation file's own claim about itself, for display. */
  curation: { labelledBy: TopicCuration["labelled_by"]; reviewed: boolean; note: string };
  entryCount: number;
}

/**
 * Index the curation file by bank and question number.
 *
 * A bank's own `topic` field wins when it has one: that would be a label the
 * extraction pipeline carried through from the document, and it outranks anything
 * added here. In practice no bank has one - every `topic` in every bank is null -
 * so today every label comes from curation, and the app says so.
 */
export function buildTopicIndex(curation: TopicCuration): TopicIndex {
  const byKey = new Map<string, TopicCuration["entries"][number]>();
  for (const entry of curation.entries) {
    byKey.set(`${entry.bank}#${entry.question}`, entry);
  }

  return {
    curation: {
      labelledBy: curation.labelled_by,
      reviewed: curation.reviewed,
      note: curation.note,
    },
    entryCount: curation.entries.length,

    resolve(bank, question) {
      // The question's own category disambiguates a label like "controls",
      // which names a subject two different quotas both cover.
      const fromBank = toTopicKeyWithCategory(question.topic, question.category);
      if (fromBank) {
        return {
          topic: fromBank,
          source: "bank",
          reviewed: true,
          generalDuties: isGeneralDuties(question.category),
          basis: `stated in ${bank}`,
        };
      }

      const entry = byKey.get(`${bank}#${question.number}`);
      if (!entry) return UNLABELLED;

      return {
        topic: entry.topic,
        source: "curation",
        // A machine-assigned label counts as reviewed only once someone has said
        // so, per entry. The file-level flag alone is not enough: it would let one
        // edit vouch for labels nobody looked at.
        reviewed: curation.labelled_by === "human" || entry.reviewed,
        generalDuties: isGeneralDuties(entry.category),
        basis: entry.basis,
      };
    },
  };
}
