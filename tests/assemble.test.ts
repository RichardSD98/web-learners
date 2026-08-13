import { describe, expect, it } from "vitest";

import {
  assembleTest,
  BlueprintNotSpecifiedError,
  InsufficientQuestionsError,
  shuffleOptions,
} from "@/lib/assemble";
import type { ServableQuestion } from "@/lib/bank";
import {
  blueprintLength,
  buildBlueprint,
  GENERAL_DUTIES_MINIMUM,
  OFFICIAL_LAYOUT,
  OFFICIAL_TEST_LENGTH,
  PASS_MARK_CORRECT,
  PASS_RATIO,
  TOPIC_QUOTAS,
} from "@/lib/blueprint";
import { makeRng } from "@/lib/random";
import { isSignsTopic, TOPIC_KEYS, type OptionKey, type TopicKey } from "@/lib/schema";

const QUOTA = TOPIC_QUOTAS["2+3"]!;

function question(
  n: number,
  topic: TopicKey,
  answer: OptionKey = "A",
  withOptionArtwork = false,
  generalDuties = false,
): ServableQuestion {
  return {
    uid: `bank:q${String(n).padStart(3, "0")}`,
    bank: "bank.json",
    sourcePaper: "Paper.pdf",
    originalNumber: n,
    section: isSignsTopic(topic) ? "B" : "E",
    topic,
    topicSource: "curation",
    topicReviewed: true,
    answerOrigin: "paper",
    answerReviewed: true,
    generalDuties,
    text: `Question ${n}?`,
    options: { A: `alpha ${n}`, B: `beta ${n}`, C: `gamma ${n}` },
    answer,
    answerSource: `Paper.pdf#q${n}`,
    artwork: withOptionArtwork
      ? [
          { url: "/a.svg", label: "A" },
          { url: "/b.svg", label: "B" },
          { url: "/c.svg", label: "C" },
        ]
      : [],
    imageType: withOptionArtwork ? "options" : null,
    catalogueSign: null,
    labels: [],
  };
}

function emptyPool(): Record<TopicKey, ServableQuestion[]> {
  const out = {} as Record<TopicKey, ServableQuestion[]>;
  for (const topic of TOPIC_KEYS) out[topic] = [];
  return out;
}

/**
 * A pool holding `multiple` times each topic's quota.
 *
 * Built from the quotas rather than from fixed numbers so that changing a quota
 * cannot leave a test silently exercising a pool that no longer matches it.
 */
function pool(
  multiple = 2,
  overrides: Partial<Record<TopicKey, number>> = {},
): Record<TopicKey, ServableQuestion[]> {
  const out = emptyPool();
  let n = 1;
  for (const topic of TOPIC_KEYS) {
    const quota = QUOTA[topic] ?? 0;
    const count = overrides[topic] ?? quota * multiple;
    // Enough general-duties questions to satisfy the sub-requirement at the same
    // multiple, so a rotation test is not tripped by the sub-quota instead.
    const dutiesWanted =
      topic === "rules_of_the_road" ? GENERAL_DUTIES_MINIMUM * multiple : 0;
    for (let i = 0; i < count; i += 1) {
      out[topic].push(
        question(n, topic, (["A", "B", "C"] as const)[n % 3], false, i < dutiesWanted),
      );
      n += 1;
    }
  }
  return out;
}

describe("option shuffling", () => {
  it("moves the correct key with the option it belongs to", () => {
    // Every seed, not one lucky one: a silent remap bug corrupts every score.
    for (let s = 0; s < 400; s += 1) {
      const source = question(1, "rules_of_the_road", "B");
      const rng = makeRng(`seed-${s}`);
      const { options, answer } = shuffleOptions(source, rng);

      const correct = options.find((o) => o.key === answer);
      expect(correct, `seed ${s}: no option carries the answer key`).toBeDefined();
      expect(correct!.text).toBe(source.options[source.answer]);
      expect(correct!.originalKey).toBe("B");
    }
  });

  it("keeps all three options, exactly once each", () => {
    const source = question(2, "rules_of_the_road", "C");
    const { options } = shuffleOptions(source, makeRng("x"));
    expect(options.map((o) => o.key).sort()).toEqual(["A", "B", "C"]);
    expect(options.map((o) => o.text).sort()).toEqual(
      Object.values(source.options).sort(),
    );
    expect(new Set(options.map((o) => o.originalKey)).size).toBe(3);
  });

  it("carries per-option artwork with its option", () => {
    const source = question(3, "regulatory_signs", "A", true);
    const { options } = shuffleOptions(source, makeRng("y"));
    for (const option of options) {
      expect(option.artworkUrl).toBe(`/${option.originalKey.toLowerCase()}.svg`);
    }
  });

  it("leaves pictorial options in place", () => {
    // "a. A / b. B / c. C" points into the artwork. Reordering these would make
    // rows like "A. C", which is a reading puzzle on top of the real question.
    const source: ServableQuestion = {
      ...question(9, "regulatory_signs", "B"),
      options: { A: "A", B: "B", C: "C" },
    };
    for (let s = 0; s < 30; s += 1) {
      const { options, answer } = shuffleOptions(source, makeRng(`p${s}`));
      expect(options.map((o) => o.text)).toEqual(["A", "B", "C"]);
      expect(options.map((o) => o.key)).toEqual(["A", "B", "C"]);
      expect(answer).toBe("B");
    }
  });

  it("actually reorders across seeds rather than always returning A,B,C", () => {
    const source = question(4, "rules_of_the_road", "A");
    const firstTexts = new Set<string>();
    for (let s = 0; s < 40; s += 1) {
      firstTexts.add(shuffleOptions(source, makeRng(`s${s}`)).options[0].text);
    }
    expect(firstTexts.size).toBeGreaterThan(1);
  });
});

describe("the official blueprint", () => {
  it("is 90 marked questions", () => {
    expect(blueprintLength("2+3")).toBe(OFFICIAL_TEST_LENGTH);
    expect(OFFICIAL_TEST_LENGTH).toBe(90);
  });

  it("puts 61 of them on road traffic signs", () => {
    const signs = buildBlueprint("2+3")
      .filter((slot) => isSignsTopic(slot.topic))
      .reduce((sum, slot) => sum + slot.count, 0);
    expect(signs).toBe(61);
  });

  it("splits the signs section exactly as the syllabus states", () => {
    expect(QUOTA.regulatory_signs).toBe(20);
    expect(QUOTA.warning_signs).toBe(15);
    expect(QUOTA.guidance_signs).toBe(7);
    expect(QUOTA.information_signs).toBe(4);
    expect(QUOTA.road_markings).toBe(9);
    expect(QUOTA.road_signals).toBe(6);
  });

  it("puts 29 on the Code 2/3 block", () => {
    const block = buildBlueprint("2+3")
      .filter((slot) => !isSignsTopic(slot.topic))
      .reduce((sum, slot) => sum + slot.count, 0);
    expect(block).toBe(29);
    expect(QUOTA.rules_of_the_road).toBe(15);
    expect(QUOTA.traffic_legislation).toBe(10);
    expect(QUOTA.vehicle_controls).toBe(4);
  });

  it("requires at least 5 of the rules questions on general duties", () => {
    const rules = buildBlueprint("2+3").find((s) => s.topic === "rules_of_the_road")!;
    expect(rules.generalDutiesMinimum).toBe(5);
    expect(rules.generalDutiesMinimum).toBeLessThanOrEqual(rules.count);
  });

  it("asks for no motorcycle questions on a Code 2/3 paper", () => {
    expect(buildBlueprint("2+3").some((slot) => slot.topic === "motorcycles")).toBe(false);
  });

  it("states no quotas for Code 1, rather than reusing the Code 2/3 ones", () => {
    // The signs section is shared, but the split of Code 1's own 29-question block
    // is not sourced. A copied quota would be indistinguishable from a measured one.
    expect(TOPIC_QUOTAS["1"]).toBeNull();
    expect(buildBlueprint("1")).toEqual([]);
  });

  it("agrees with the pass mark: 80% of 90 is 72", () => {
    expect(Math.round(OFFICIAL_TEST_LENGTH * PASS_RATIO)).toBe(PASS_MARK_CORRECT);
  });

  it("numbers the sections as the paper prints them", () => {
    const layout = OFFICIAL_LAYOUT["2+3"];
    const marked = layout.filter((s) => s.marked);
    expect(marked.reduce((sum, s) => sum + s.count, 0)).toBe(OFFICIAL_TEST_LENGTH);

    for (const section of layout) {
      expect(section.lastNumber - section.firstNumber + 1).toBe(section.count);
    }

    // The practice section is numbered but not marked, which is why it sits
    // outside the 90.
    expect(layout.find((s) => s.label === "A")!.marked).toBe(false);
    // The papers print the Code 2/3 block as E while the regulation calls it D.
    expect(layout.find((s) => s.label === "D")!.printedAs).toBe("E");
  });
});

describe("assembled papers", () => {
  it("is the full 90 questions or nothing", () => {
    const test = assembleTest("full", "2", pool());
    expect(test.questions).toHaveLength(OFFICIAL_TEST_LENGTH);
  });

  it("meets every topic quota exactly", () => {
    const test = assembleTest("quotas", "2", pool());
    for (const slot of buildBlueprint("2+3")) {
      const actual = test.questions.filter((q) => q.topic === slot.topic).length;
      expect(actual, slot.topic).toBe(slot.count);
    }
  });

  it("meets the general-duties minimum inside rules of the road", () => {
    for (let s = 0; s < 20; s += 1) {
      const test = assembleTest(`gd${s}`, "2", pool());
      const duties = test.questions.filter(
        (q) => q.topic === "rules_of_the_road" && q.generalDuties,
      ).length;
      expect(duties, `seed ${s}`).toBeGreaterThanOrEqual(GENERAL_DUTIES_MINIMUM);
    }
  });

  it("numbers signs 5-65 and the vehicle block 95-123", () => {
    const test = assembleTest("numbers", "2", pool());
    const signs = test.questions.filter((q) => isSignsTopic(q.topic));
    const block = test.questions.filter((q) => !isSignsTopic(q.topic));

    expect(signs.map((q) => q.officialNumber).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 61 }, (_, i) => 5 + i),
    );
    expect(block.map((q) => q.officialNumber).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 29 }, (_, i) => 95 + i),
    );
  });

  it("gives every question a distinct official number", () => {
    const test = assembleTest("distinct", "2", pool());
    const numbers = test.questions.map((q) => q.officialNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("asks the signs section first, as the paper does", () => {
    const test = assembleTest("order", "2", pool());
    const lastSigns = test.questions.findLastIndex((q) => isSignsTopic(q.topic));
    const firstBlock = test.questions.findIndex((q) => !isSignsTopic(q.topic));
    expect(lastSigns).toBeLessThan(firstBlock);
  });

  it("labels each question with the official section it is asked under", () => {
    const test = assembleTest("sections", "2", pool());
    for (const question of test.questions) {
      expect(question.officialSection).toBe(isSignsTopic(question.topic) ? "B" : "D");
    }
  });

  it("reports whether its topic labels have been reviewed", () => {
    const reviewed = assembleTest("rev", "2", pool());
    expect(reviewed.labelsReviewed).toBe(true);

    const unreviewedPool = pool();
    unreviewedPool.warning_signs[0] = {
      ...unreviewedPool.warning_signs[0],
      topicReviewed: false,
    };
    // One unreviewed label is enough: the claim is about the whole paper.
    expect(assembleTest("rev", "2", unreviewedPool).labelsReviewed).toBe(false);
  });
});

describe("seeded reproducibility", () => {
  it("produces an identical paper for the same seed", () => {
    const p = pool();
    const a = assembleTest("brisk-otter-4821", "2", p);
    const b = assembleTest("brisk-otter-4821", "2", p);

    expect(a.questions.map((q) => q.uid)).toEqual(b.questions.map((q) => q.uid));
    expect(a.questions.map((q) => q.answer)).toEqual(b.questions.map((q) => q.answer));
    expect(a.questions.map((q) => q.options.map((o) => o.text).join("|"))).toEqual(
      b.questions.map((q) => q.options.map((o) => o.text).join("|")),
    );
  });

  it("produces different papers for different seeds", () => {
    const p = pool();
    const a = assembleTest("seed-one", "2", p);
    const b = assembleTest("seed-two", "2", p);
    expect(a.questions.map((q) => q.uid)).not.toEqual(b.questions.map((q) => q.uid));
  });

  it("varies the paper between seeds when the pool has surplus", () => {
    const p = pool();
    const seen = new Set<string>();
    for (let s = 0; s < 25; s += 1) {
      seen.add(
        assembleTest(`v${s}`, "2", p)
          .questions.map((q) => q.uid)
          .join(","),
      );
    }
    expect(seen.size).toBeGreaterThan(20);
  });
});

describe("attempt rotation", () => {
  it("shares nothing between consecutive attempts while the pool allows it", () => {
    // The whole point. An independent draw would repeat a large share of the paper.
    const p = pool(2);
    const first = assembleTest("rot", "2", p, 1);
    const second = assembleTest("rot", "2", p, 2);

    expect(first.freshAttempts).toBe(2);
    const a = new Set(first.questions.map((q) => q.uid));
    expect(second.questions.filter((q) => a.has(q.uid))).toEqual([]);
  });

  it("keeps every attempt reproducible from the address alone", () => {
    const p = pool();
    for (const attempt of [1, 2, 3, 7]) {
      const a = assembleTest("rep", "2", p, attempt);
      const b = assembleTest("rep", "2", p, attempt);
      expect(a.questions.map((q) => q.uid)).toEqual(b.questions.map((q) => q.uid));
      expect(a.questions.map((q) => q.answer)).toEqual(b.questions.map((q) => q.answer));
    }
  });

  it("never repeats a question inside one paper, including across a cycle boundary", () => {
    // Attempt 3 of a pool at twice the quota straddles the wrap, which is where a
    // naive rotation would serve the same question twice.
    const p = pool(2);
    for (let attempt = 1; attempt <= 12; attempt += 1) {
      const uids = assembleTest("cyc", "2", p, attempt).questions.map((q) => q.uid);
      expect(new Set(uids).size, `attempt ${attempt}`).toBe(uids.length);
    }
  });

  it("keeps cycling instead of running out", () => {
    const p = pool();
    for (const attempt of [1, 5, 50, 999]) {
      expect(assembleTest("far", "2", p, attempt).questions).toHaveLength(
        OFFICIAL_TEST_LENGTH,
      );
    }
  });

  it("covers the whole eligible pool before repeating any of it", () => {
    const p = pool(2);
    const seen = new Set<string>();
    let total = 0;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      for (const q of assembleTest("cov", "2", p, attempt).questions) {
        seen.add(q.uid);
        total += 1;
      }
    }
    expect(seen.size).toBe(total);
  });

  it("defaults to the first attempt", () => {
    const p = pool();
    expect(assembleTest("d", "2", p).questions.map((q) => q.uid)).toEqual(
      assembleTest("d", "2", p, 1).questions.map((q) => q.uid),
    );
  });
});

describe("licence codes", () => {
  it("gives Code 2 and Code 3 the identical paper", () => {
    // They answer the same block from the same pool, so they are not two tests.
    const p = pool();
    for (const attempt of [1, 2, 5]) {
      const two = assembleTest("same", "2", p, attempt);
      const three = assembleTest("same", "3", p, attempt);
      expect(three.questions.map((q) => q.uid)).toEqual(two.questions.map((q) => q.uid));
      expect(three.questions.map((q) => q.answer)).toEqual(two.questions.map((q) => q.answer));
      expect(three.variant).toBe(two.variant);
    }
  });

  it("refuses a Code 1 paper because its quotas are not sourced", () => {
    // Not a shortfall: more questions would not fix it. Distinguished so the app
    // does not tell a learner to wait for a bigger bank.
    expect(() => assembleTest("m", "1", pool())).toThrow(BlueprintNotSpecifiedError);
  });
});

describe("insufficient pools", () => {
  it("throws rather than serving a short paper", () => {
    const p = pool(2, { information_signs: 1 });
    expect(() => assembleTest("s", "2", p)).toThrow(InsufficientQuestionsError);
  });

  it("names every topic that is short, not just the first", () => {
    const p = pool(2, { information_signs: 1, road_signals: 2 });
    try {
      assembleTest("s", "2", p);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(InsufficientQuestionsError);
      const shortfalls = (error as InsufficientQuestionsError).shortfalls;
      expect(shortfalls.map((s) => s.topic)).toEqual([
        "information_signs",
        "road_signals",
      ]);
      expect(shortfalls[0].requested).toBe(QUOTA.information_signs);
      expect(shortfalls[0].available).toBe(1);
    }
  });

  it("refuses a paper that cannot meet the general-duties minimum, even with enough rules questions", () => {
    // The failure this is here to catch: a topic with a surplus and too few of one
    // kind. Filling the slot and quietly missing the sub-requirement would give a
    // paper that looks complete and is not.
    const p = pool();
    p.rules_of_the_road = p.rules_of_the_road.map((q) => ({ ...q, generalDuties: false }));

    expect(p.rules_of_the_road.length).toBeGreaterThanOrEqual(QUOTA.rules_of_the_road!);
    try {
      assembleTest("gd", "2", p);
      expect.unreachable("should have thrown");
    } catch (error) {
      const shortfalls = (error as InsufficientQuestionsError).shortfalls;
      expect(shortfalls).toHaveLength(1);
      expect(shortfalls[0].requirement).toBe("general duties of a driver");
      expect(shortfalls[0].requested).toBe(GENERAL_DUTIES_MINIMUM);
      expect(shortfalls[0].available).toBe(0);
    }
  });

  it("refuses a rules pool that is large enough but is all general duties", () => {
    // The mirror of the case above, and the reason the check is per part rather
    // than on the total: 30 questions in the topic, none of which can fill the 10
    // slots that must not be general duties.
    const p = pool();
    p.rules_of_the_road = p.rules_of_the_road.map((q) => ({ ...q, generalDuties: true }));

    try {
      assembleTest("gd-only", "2", p);
      expect.unreachable("should have thrown");
    } catch (error) {
      const shortfalls = (error as InsufficientQuestionsError).shortfalls;
      expect(shortfalls).toHaveLength(1);
      expect(shortfalls[0].requirement).toBeUndefined();
      expect(shortfalls[0].requested).toBe(QUOTA.rules_of_the_road! - GENERAL_DUTIES_MINIMUM);
      expect(shortfalls[0].available).toBe(0);
    }
  });

  it("never repeats a question within one paper", () => {
    const p = pool();
    for (let s = 0; s < 20; s += 1) {
      const uids = assembleTest(`r${s}`, "2", p).questions.map((q) => q.uid);
      expect(new Set(uids).size).toBe(uids.length);
    }
  });

  it("serves a paper when the pool holds exactly the quota and no more", () => {
    const p = pool(1);
    const test = assembleTest("exact", "2", p);
    expect(test.questions).toHaveLength(OFFICIAL_TEST_LENGTH);
    expect(test.freshAttempts).toBe(1);
  });
});
