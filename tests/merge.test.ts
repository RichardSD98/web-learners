import { describe, expect, it } from "vitest";

import { assessQuestion, identityKey, loadCorpus, type ServableQuestion } from "@/lib/bank";
import { buildTopicIndex } from "@/lib/topics";
import {
  toTopicKey,
  toTopicKeyWithCategory,
  type RawQuestion,
  type Sign,
  type TopicCuration,
} from "@/lib/schema";

const NO_SIGNS = new Map<string, Sign>();

function emptyTopics() {
  return buildTopicIndex({
    note: "test",
    labelled_by: "machine",
    reviewed: false,
    entries: [],
  } as unknown as TopicCuration);
}

function raw(overrides: Partial<RawQuestion> = {}): RawQuestion {
  return {
    id: "q001",
    number: 1,
    section: "C",
    is_example: false,
    text: "A question?",
    options: { A: "one", B: "two", C: "three" },
    answer: "A",
    answer_source: "Paper.pdf#q1",
    status: "ok",
    ...overrides,
  } as RawQuestion;
}

function servable(overrides: Partial<ServableQuestion> = {}): ServableQuestion {
  return {
    uid: "test_1#1",
    bank: "bank.json",
    sourcePaper: "Paper.pdf",
    originalNumber: 1,
    section: "C",
    topic: "rules_of_the_road",
    topicSource: "curation",
    topicReviewed: false,
    generalDuties: false,
    text: "Which statement is correct?",
    options: { A: "one", B: "two", C: "three" },
    answer: "A",
    answerSource: null,
    answerOrigin: "paper",
    answerReviewed: true,
    artwork: [],
    imageType: null,
    catalogueSign: null,
    labels: [],
    ...overrides,
  } as ServableQuestion;
}

// ---------------------------------------------------------------------------
// the ambiguous `controls` label
// ---------------------------------------------------------------------------

describe("the controls topic label", () => {
  it("sends a motorcycle controls question to the motorcycles topic", () => {
    // Section D asks about a motorcycle's rear brake. It is not a Code 2/3
    // vehicle-controls question and must not fill that quota.
    expect(toTopicKeyWithCategory("controls", "motorcycles")).toBe("motorcycles");
  });

  it("sends a car controls question to vehicle controls", () => {
    expect(toTopicKeyWithCategory("controls", "vehicle_controls")).toBe("vehicle_controls");
  });

  it("drops the label rather than guessing when category is absent", () => {
    expect(toTopicKeyWithCategory("controls", null)).toBeNull();
    expect(toTopicKeyWithCategory("controls", undefined)).toBeNull();
  });

  it("drops the label when the category does not settle it", () => {
    expect(toTopicKeyWithCategory("controls", "something_else")).toBeNull();
  });

  it("no longer accepts controls as a bare alias", () => {
    expect(toTopicKey("controls")).toBeNull();
  });

  it("leaves unambiguous labels alone whatever the category says", () => {
    expect(toTopicKeyWithCategory("warning_signs", "motorcycles")).toBe("warning_signs");
    expect(toTopicKeyWithCategory("road marking", null)).toBe("road_markings");
  });
});

// ---------------------------------------------------------------------------
// question identity
// ---------------------------------------------------------------------------

describe("question identity", () => {
  it("treats identical wording with identical options as one question", () => {
    expect(identityKey(servable())).toBe(identityKey(servable({ uid: "paper_a#67" })));
  });

  it("treats identical wording with different options as two questions", () => {
    const other = servable({ options: { A: "four", B: "five", C: "six" } });
    expect(identityKey(servable())).not.toBe(identityKey(other));
  });

  it("treats identical wording beside different artwork as two questions", () => {
    const a = servable({ artwork: [{ url: "/signs/stop.svg", label: null }] });
    const b = servable({ artwork: [{ url: "/signs/yield.svg", label: null }] });
    expect(identityKey(a)).not.toBe(identityKey(b));
  });

  it("ignores artwork order", () => {
    const a = servable({
      artwork: [
        { url: "/signs/stop.svg", label: "A" },
        { url: "/signs/yield.svg", label: "B" },
      ],
    });
    const b = servable({
      artwork: [
        { url: "/signs/yield.svg", label: "B" },
        { url: "/signs/stop.svg", label: "A" },
      ],
    });
    expect(identityKey(a)).toBe(identityKey(b));
  });

  it("refuses to compare a picture-option question at all", () => {
    // Its options are the letters A, B and C; the words are in the pictures, so
    // a dozen unrelated questions would share one key.
    expect(identityKey(servable({ options: { A: "A", B: "B", C: "C" } }))).toBeNull();
  });

  it("ignores whitespace and case", () => {
    const a = servable({ text: "Which  statement is CORRECT?" });
    expect(identityKey(a)).toBe(identityKey(servable()));
  });
});

// ---------------------------------------------------------------------------
// answers derived from the manual
// ---------------------------------------------------------------------------

describe("answers derived from the manual", () => {
  const derived = new Map([
    [
      "test_1#75",
      {
        answer: "C" as const,
        answerSource: "LEARNERS_BOOK.pdf folio 14 para 1 (f-vehicle-controls-005)",
        reviewed: false,
        basis: "the manual's entry for 'Clutch lever' states option C",
      },
    ],
  ]);

  it("fills an answer the paper does not state, and marks it derived", () => {
    const { servable: ok } = assessQuestion(
      raw({ number: 75, answer: null, topic: "rules_of_the_road" }),
      "questions-test1.json",
      "Test_1.pdf",
      new Set(),
      NO_SIGNS,
      emptyTopics(),
      derived,
    );
    expect(ok).not.toBeNull();
    expect(ok!.answer).toBe("C");
    expect(ok!.answerOrigin).toBe("manual");
    expect(ok!.answerReviewed).toBe(false);
    expect(ok!.answerSource).toContain("folio 14");
  });

  it("never overrides an answer the paper states", () => {
    const { servable: ok } = assessQuestion(
      raw({ number: 75, answer: "A", topic: "rules_of_the_road" }),
      "questions-test1.json",
      "Test_1.pdf",
      new Set(),
      NO_SIGNS,
      emptyTopics(),
      derived,
    );
    expect(ok!.answer).toBe("A");
    expect(ok!.answerOrigin).toBe("paper");
    expect(ok!.answerReviewed).toBe(true);
  });

  it("does not reach into another paper", () => {
    // The uid names the paper as well as the number; question 75 of Test 3 is a
    // different question.
    const { reasons } = assessQuestion(
      raw({ number: 75, answer: null, topic: "rules_of_the_road" }),
      "test3-ocr.json",
      "Test_3.pdf",
      new Set(),
      NO_SIGNS,
      emptyTopics(),
      derived,
    );
    expect(reasons).toContain("no answer stated");
  });

  it("applies to every bank that reads the same paper", () => {
    for (const bank of ["questions-test1.json", "test1-answered.json", "test1-ocr.json"]) {
      const { servable: ok } = assessQuestion(
        raw({ number: 75, answer: null, topic: "rules_of_the_road" }),
        bank,
        "Test_1.pdf",
        new Set(),
        NO_SIGNS,
        emptyTopics(),
        derived,
      );
      expect(ok, bank).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// what the corpus actually reports
// ---------------------------------------------------------------------------

describe("the corpus after merging bank readings", () => {
  const corpus = loadCorpus();

  it("keys every question by paper and printed number", () => {
    for (const question of corpus.servable) {
      expect(question.uid, question.uid).toMatch(/^(test_1|test_3|paper_a)#\d+$/);
    }
  });

  it("serves no question twice under different uids", () => {
    const uids = new Set(corpus.servable.map((q) => q.uid));
    expect(uids.size).toBe(corpus.servable.length);
  });

  it("counts the derived answers it applied", () => {
    expect(corpus.derivedAnswers.available).toBeGreaterThan(0);
    expect(corpus.derivedAnswers.applied).toBeLessThanOrEqual(
      corpus.derivedAnswers.available,
    );
    expect(corpus.derivedAnswers.unreviewed).toBe(corpus.derivedAnswers.applied);
  });

  it("puts no motorcycle question in the vehicle-controls quota", () => {
    // The bug this replaced filled a Code 2/3 quota of four with motorcycle
    // questions a Code 2 candidate never sees.
    for (const question of corpus.servable) {
      if (question.topic !== "vehicle_controls") continue;
      expect(question.section, `${question.uid}`).not.toBe("D");
    }
  });
});
