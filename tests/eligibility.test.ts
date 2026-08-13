import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { assembleTest, InsufficientQuestionsError } from "@/lib/assemble";
import { assessQuestion, identityKey, loadCorpus, servableByTopic } from "@/lib/bank";
import { buildBlueprint, GENERAL_DUTIES_MINIMUM, TOPIC_QUOTAS } from "@/lib/blueprint";
import { buildTopicIndex } from "@/lib/topics";
import { isSignsTopic, type RawQuestion, type Sign, type TopicCuration } from "@/lib/schema";

const corpus = loadCorpus();
const pool = servableByTopic(corpus);

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

const NO_SIGNS = new Map<string, Sign>();

/** A curation index that labels question 1 of bank.json and nothing else. */
function topicIndex(overrides: Partial<TopicCuration> = {}) {
  return buildTopicIndex({
    note: "test",
    labelled_by: "machine",
    reviewed: false,
    entries: [
      {
        bank: "bank.json",
        question: 1,
        topic: "rules_of_the_road",
        basis: "test fixture",
        reviewed: false,
      },
    ],
    ...overrides,
  } as TopicCuration);
}

describe("eligibility filter", () => {
  it("accepts a complete, answered, undisputed, labelled question", () => {
    const { servable, reasons } = assessQuestion(
      raw(),
      "bank.json",
      "Paper.pdf",
      new Set(),
      NO_SIGNS,
      topicIndex(),
    );
    expect(reasons).toEqual([]);
    expect(servable).not.toBeNull();
    expect(servable!.topic).toBe("rules_of_the_road");
    expect(servable!.topicSource).toBe("curation");
    expect(servable!.topicReviewed).toBe(false);
  });

  it("rejects a question with no stated answer", () => {
    const { servable, reasons } = assessQuestion(
      raw({ answer: null }),
      "bank.json",
      "Paper.pdf",
      new Set(),
      NO_SIGNS,
      topicIndex(),
    );
    expect(reasons).toContain("no answer stated");
    expect(servable).toBeNull();
  });

  it("rejects a blocked question", () => {
    const { reasons } = assessQuestion(
      raw({ status: "blocked", blocked_reason: "OCR lost option B" }),
      "bank.json",
      "Paper.pdf",
      new Set(),
      NO_SIGNS,
      topicIndex(),
    );
    expect(reasons).toContain("status is blocked");
  });

  it("rejects a disputed question", () => {
    const { reasons } = assessQuestion(
      raw({ number: 5 }),
      "bank.json",
      "Paper.pdf",
      new Set([5]),
      NO_SIGNS,
      topicIndex(),
    );
    expect(reasons).toContain("disputed answer");
  });

  it("rejects a question whose artwork file does not exist", () => {
    const { reasons } = assessQuestion(
      raw({ image: { type: "single", ref: "does-not-exist.png" } }),
      "bank.json",
      "Paper.pdf",
      new Set(),
      NO_SIGNS,
      topicIndex(),
    );
    expect(reasons).toContain("artwork file missing");
  });

  it("rejects a picture question that names no artwork at all", () => {
    const { reasons } = assessQuestion(
      raw({ image: { type: "options", refs: null } }),
      "bank.json",
      "Paper.pdf",
      new Set(),
      NO_SIGNS,
      topicIndex(),
    );
    expect(reasons).toContain("artwork file missing");
  });

  it("rejects section A practice questions", () => {
    const { reasons } = assessQuestion(
      raw({ section: "A" }),
      "bank.json",
      "Paper.pdf",
      new Set(),
      NO_SIGNS,
      topicIndex(),
    );
    expect(reasons).toContain("practice section");
  });

  it("rejects a question with no topic label", () => {
    // An unlabelled question belongs to no quota, so a paper containing it would
    // satisfy its own arithmetic while saying nothing about what it covered.
    const { servable, reasons } = assessQuestion(
      raw({ number: 999 }),
      "bank.json",
      "Paper.pdf",
      new Set(),
      NO_SIGNS,
      topicIndex(),
    );
    expect(reasons).toContain("no topic label");
    expect(servable).toBeNull();
  });
});

describe("topic labels", () => {
  it("prefers a label stated in the bank over the curation file", () => {
    const { servable } = assessQuestion(
      raw({ topic: "warning_signs" }),
      "bank.json",
      "Paper.pdf",
      new Set(),
      NO_SIGNS,
      topicIndex(),
    );
    expect(servable!.topic).toBe("warning_signs");
    expect(servable!.topicSource).toBe("bank");
    expect(servable!.topicReviewed).toBe(true);
  });

  it("accepts the spelling variants a curator is likely to use", () => {
    for (const spelling of ["road marking", "Road Markings", "marking"]) {
      const { servable } = assessQuestion(
        raw({ topic: spelling }),
        "bank.json",
        "Paper.pdf",
        new Set(),
        NO_SIGNS,
        topicIndex(),
      );
      expect(servable!.topic, spelling).toBe("road_markings");
    }
  });

  it("treats a machine label as unreviewed until its own entry says otherwise", () => {
    // Not the file-level flag alone: that would let one edit vouch for labels
    // nobody looked at.
    const index = buildTopicIndex({
      note: "test",
      labelled_by: "machine",
      reviewed: true,
      entries: [
        {
          bank: "bank.json",
          question: 1,
          topic: "rules_of_the_road",
          basis: "test fixture",
          reviewed: false,
        },
      ],
    } as TopicCuration);
    const { servable } = assessQuestion(
      raw(),
      "bank.json",
      "Paper.pdf",
      new Set(),
      NO_SIGNS,
      index,
    );
    expect(servable!.topicReviewed).toBe(false);
  });

  it("carries the general-duties category through", () => {
    const index = buildTopicIndex({
      note: "test",
      labelled_by: "machine",
      reviewed: false,
      entries: [
        {
          bank: "bank.json",
          question: 1,
          topic: "rules_of_the_road",
          category: "general_duties",
          basis: "test fixture",
          reviewed: false,
        },
      ],
    } as TopicCuration);
    const { servable } = assessQuestion(
      raw(),
      "bank.json",
      "Paper.pdf",
      new Set(),
      NO_SIGNS,
      index,
    );
    expect(servable!.generalDuties).toBe(true);
  });
});

describe("the loaded corpus", () => {
  it("has questions to serve", () => {
    expect(corpus.servable.length).toBeGreaterThan(0);
  });

  it("gives every servable question a non-null answer that is one of its options", () => {
    for (const question of corpus.servable) {
      expect(["A", "B", "C"]).toContain(question.answer);
      expect(question.options[question.answer]).toBeTruthy();
    }
  });

  it("gives every servable question a topic", () => {
    for (const question of corpus.servable) {
      expect(question.topic, question.uid).toBeTruthy();
    }
  });

  it("resolves every served artwork url to a file that exists", () => {
    for (const question of corpus.servable) {
      for (const art of question.artwork) {
        expect(
          existsSync(join(process.cwd(), "public", art.url)),
          `${question.uid} references ${art.url}, which is not on disk`,
        ).toBe(true);
      }
    }
  });

  it("never serves a question from section A", () => {
    expect(corpus.servable.some((q) => q.section === "A")).toBe(false);
  });

  it("excludes every disputed question number", () => {
    for (const entry of corpus.disputed.entries) {
      if (entry.cleared) continue;
      for (const number of entry.question_numbers) {
        const leaked = corpus.servable.find(
          (q) => q.bank === entry.bank && q.originalNumber === number,
        );
        expect(leaked, `${entry.bank} q${number} is disputed but was servable`).toBeUndefined();
      }
    }
  });

  it("serves no duplicate question", () => {
    // Identity is the wording, the options and the artwork together. It used to
    // be the wording alone, which collapsed three different information-signs
    // questions ("This sign indicates?") into one and deleted a second "Which
    // statement is correct?" that had entirely different options.
    const seen = new Set<string>();
    for (const question of corpus.servable) {
      const key = identityKey(question);
      if (key === null) continue;
      expect(seen.has(key), `duplicate question: ${question.uid}`).toBe(false);
      seen.add(key);
    }
  });

  it("serves questions that share a stem but differ in artwork or options", () => {
    // The other side of the same rule: collapsing these is what made the app
    // and the extractor disagree about how many questions exist.
    const byText = new Map<string, number>();
    for (const question of corpus.servable) {
      const text = question.text.toLowerCase().replace(/\s+/g, " ").trim();
      byText.set(text, (byText.get(text) ?? 0) + 1);
    }
    expect([...byText.values()].some((n) => n > 1)).toBe(true);
  });

  it("only labels a signs question from a signs-section paper question", () => {
    // A cross-check on the curation, not on the code: a question the paper printed
    // in its rules section should not have been given a signs topic without a
    // stated reason. Road signals are the known exception - the papers ask about
    // traffic lights in their rules section - so they are allowed either way.
    for (const question of corpus.servable) {
      if (!isSignsTopic(question.topic) || question.topic === "road_signals") continue;
      expect(question.section, `${question.uid} (${question.topic})`).toBe("B");
    }
  });
});

describe("assembly against the real corpus", () => {
  it("cannot build any paper yet, and says which topics are short", () => {
    // The current state of the bank, recorded rather than worked around: 69
    // verified questions against a 90-question paper. This test is expected to
    // change when the bank grows, and it should be changed deliberately.
    expect(() => assembleTest("real", "2", pool)).toThrow(InsufficientQuestionsError);

    try {
      assembleTest("real", "2", pool);
      expect.unreachable("should have thrown");
    } catch (error) {
      const shortfalls = (error as InsufficientQuestionsError).shortfalls;
      expect(shortfalls.length).toBeGreaterThan(0);
      for (const shortfall of shortfalls) {
        expect(shortfall.available).toBeLessThan(shortfall.requested);
      }
    }
  });

  it("refuses a Code 1 paper too, for a different and stated reason", () => {
    expect(TOPIC_QUOTAS["1"]).toBeNull();
    expect(() => assembleTest("real", "1", pool)).toThrow(
      /No official topic quotas are recorded/,
    );
  });

  it("has the general-duties sub-requirement as one of its shortfalls", () => {
    const duties = pool.rules_of_the_road.filter((q) => q.generalDuties).length;
    expect(duties).toBeLessThan(GENERAL_DUTIES_MINIMUM);
  });

  it("never claims a topic has more questions than the bank holds", () => {
    const counted = Object.values(pool).reduce((sum, list) => sum + list.length, 0);
    expect(counted).toBe(corpus.servable.length);
  });

  it("would fill a quota from the pool if the pool were large enough", () => {
    // Assembly is exercised against the real questions by padding the pool with
    // copies of what the bank has, so the wiring is covered even while no paper can
    // be served. Nothing about a question is changed but its uid.
    const padded = servableByTopic(corpus);
    for (const slot of buildBlueprint("2+3")) {
      const source = padded[slot.topic];
      if (source.length === 0) continue;
      let copy = 0;
      while (
        padded[slot.topic].length < slot.count ||
        padded[slot.topic].filter((q) => q.generalDuties).length < slot.generalDutiesMinimum ||
        padded[slot.topic].filter((q) => !q.generalDuties).length <
          slot.count - slot.generalDutiesMinimum
      ) {
        const original = source[copy % source.length];
        padded[slot.topic].push({
          ...original,
          uid: `${original.uid}#pad${copy}`,
          // Enough of the padding is marked as general duties to satisfy the
          // sub-quota; the flag is the only field touched.
          generalDuties:
            slot.generalDutiesMinimum > 0
              ? padded[slot.topic].filter((q) => q.generalDuties).length <
                slot.generalDutiesMinimum
              : original.generalDuties,
        });
        copy += 1;
      }
    }

    const test = assembleTest("padded", "2", padded);
    expect(test.questions).toHaveLength(90);
    for (const slot of buildBlueprint("2+3")) {
      expect(test.questions.filter((q) => q.topic === slot.topic).length).toBe(slot.count);
    }
    expect(
      test.questions.filter((q) => q.topic === "rules_of_the_road" && q.generalDuties).length,
    ).toBeGreaterThanOrEqual(GENERAL_DUTIES_MINIMUM);
    expect(test.labelsReviewed).toBe(false);
  });
});

describe("picture-option questions", () => {
  it("collapse their three identical refs into one stem image", () => {
    // The extractor exports one crop covering all three pictures. Serving it
    // per option would show three identical images, each containing all three
    // signs.
    const pictorial = corpus.servable.filter((q) => q.imageType === "options");
    expect(pictorial.length).toBeGreaterThan(0);
    for (const question of pictorial) {
      expect(question.artwork).toHaveLength(1);
      expect(question.artwork[0].label).toBeNull();
    }
  });
});
