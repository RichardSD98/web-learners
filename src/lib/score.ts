import { PASS_MARK_IS_OFFICIAL, PASS_RATIO, TOPIC_ORDER } from "./blueprint";
import type { AssembledTest } from "./assemble";
import type { OptionKey, TopicKey } from "./schema";

/**
 * Marking follows the stated rule and nothing more: 80% of the paper, which is
 * 72 of 90 correct, counted over the whole paper.
 *
 * The previous version failed a candidate who fell below an invented 75% on any
 * one section. That rule was not sourced, and applying an unofficial threshold
 * per section is not a conservative approximation of an official one on the
 * total - it fails people the real test would pass. Per-topic figures are still
 * reported, because "you lost most of your marks on road markings" is the useful
 * thing to know, but they decide nothing.
 *
 * A preview has no pass mark at all, and that is expressed as null rather than
 * left to each screen to remember to hide. 80% of a paper the bank happened to
 * be able to fill is not the 80% the regulation states: it is a threshold on a
 * different, shorter, differently-weighted set of questions. A verdict computed
 * from it would be indistinguishable on screen from the real one, so none is
 * computed.
 */

export interface TopicScore {
  topic: TopicKey;
  correct: number;
  total: number;
  ratio: number;
}

export interface TestResult {
  topics: TopicScore[];
  correct: number;
  total: number;
  ratio: number;
  /** Null on a preview, which is not marked against the official pass mark. */
  passed: boolean | null;
  /** Correct answers still needed to reach the pass mark. 0 once passed. */
  shortBy: number | null;
  /** Topics scoring below the paper's pass ratio. Guidance, not a verdict. */
  weakestTopics: TopicKey[];
  /** Null on a preview: the paper it would apply to is not the examination. */
  passMark: { ratio: number; correct: number; isOfficial: boolean } | null;
}

export type AnswerSheet = Record<string, OptionKey | undefined>;

export function scoreTest(test: AssembledTest, answers: AnswerSheet): TestResult {
  const byTopic = new Map<TopicKey, { correct: number; total: number }>();

  for (const question of test.questions) {
    const entry = byTopic.get(question.topic) ?? { correct: 0, total: 0 };
    entry.total += 1;
    if (answers[question.uid] === question.answer) entry.correct += 1;
    byTopic.set(question.topic, entry);
  }

  const topics: TopicScore[] = TOPIC_ORDER.filter((topic) => byTopic.has(topic)).map((topic) => {
    const { correct, total } = byTopic.get(topic)!;
    return { topic, correct, total, ratio: total === 0 ? 0 : correct / total };
  });

  const correct = topics.reduce((sum, t) => sum + t.correct, 0);
  const total = topics.reduce((sum, t) => sum + t.total, 0);

  // The pass mark is stated both ways, 80% and 72 correct. The ratio decides,
  // because it is the one that survives a paper of any length; on the 90-question
  // paper it yields exactly the stated 72, which a test pins.
  //
  // A preview gets none of this. The same arithmetic on a short paper would
  // produce a plausible-looking number - 59 of 73 - that no regulation states.
  const marked = test.preview === null;
  const required = Math.ceil(total * PASS_RATIO);

  return {
    topics,
    correct,
    total,
    ratio: total === 0 ? 0 : correct / total,
    passed: marked ? correct >= required : null,
    shortBy: marked ? Math.max(0, required - correct) : null,
    // Still reported for a preview: this is study guidance about a topic, not a
    // verdict on the paper, and it means the same thing either way.
    weakestTopics: topics.filter((t) => t.ratio < PASS_RATIO).map((t) => t.topic),
    passMark: marked
      ? { ratio: PASS_RATIO, correct: required, isOfficial: PASS_MARK_IS_OFFICIAL }
      : null,
  };
}
