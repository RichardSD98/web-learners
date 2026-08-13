import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assemblePreview,
  assembleTest,
  BlueprintNotSpecifiedError,
  InsufficientQuestionsError,
} from "@/lib/assemble";
import type { ServableQuestion } from "@/lib/bank";
import {
  blueprintLength,
  buildBlueprint,
  GENERAL_DUTIES_MINIMUM,
  OFFICIAL_LAYOUT,
  OFFICIAL_TEST_LENGTH,
  PASS_RATIO,
  TOPIC_QUOTAS,
} from "@/lib/blueprint";
import { previewModeEnabled, resolvePaper } from "@/lib/preview";
import { scoreTest } from "@/lib/score";
import { isSignsTopic, TOPIC_KEYS, type OptionKey, type TopicKey } from "@/lib/schema";

const QUOTA = TOPIC_QUOTAS["2+3"]!;

function question(
  n: number,
  topic: TopicKey,
  answer: OptionKey = "A",
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
    artwork: [],
    imageType: null,
    catalogueSign: null,
    labels: [],
  };
}

function emptyPool(): Record<TopicKey, ServableQuestion[]> {
  const out = {} as Record<TopicKey, ServableQuestion[]>;
  for (const topic of TOPIC_KEYS) out[topic] = [];
  return out;
}

/** A pool at `multiple` times each quota, before any override is applied. */
function pool(
  multiple = 2,
  overrides: Partial<Record<TopicKey, number>> = {},
): Record<TopicKey, ServableQuestion[]> {
  const out = emptyPool();
  let n = 1;
  for (const topic of TOPIC_KEYS) {
    const quota = QUOTA[topic] ?? 0;
    const count = overrides[topic] ?? quota * multiple;
    const dutiesWanted =
      topic === "rules_of_the_road" ? GENERAL_DUTIES_MINIMUM * multiple : 0;
    for (let i = 0; i < count; i += 1) {
      out[topic].push(
        question(n, topic, (["A", "B", "C"] as const)[n % 3], i < dutiesWanted),
      );
      n += 1;
    }
  }
  return out;
}

/**
 * A bank shaped like the real one: several topics short, one with a surplus.
 *
 * The surplus matters. It is what the top-up draws on, and a short pool with no
 * surplus anywhere would never exercise the padding at all.
 */
function shortPool(): Record<TopicKey, ServableQuestion[]> {
  const p = pool(1, {
    regulatory_signs: 6,
    warning_signs: 11,
    guidance_signs: 6,
    information_signs: 3,
    road_markings: 8,
    road_signals: 3,
    rules_of_the_road: 23,
    traffic_legislation: 9,
  });
  // Rules of the road has more questions than its quota and still cannot fill
  // it: only 2 of them are general duties, where 5 are required. The real bank
  // has exactly this shape, and it is the case a check on the total misses.
  p.rules_of_the_road = p.rules_of_the_road.map((q, i) => ({
    ...q,
    generalDuties: i < 2,
  }));
  return p;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the preview flag", () => {
  it("is on when unset, so a short bank is never a dead end", () => {
    vi.stubEnv("NEXT_PUBLIC_PREVIEW_MODE", undefined);
    expect(previewModeEnabled()).toBe(true);
  });

  it("is turned off only by the exact string false", () => {
    // A misspelled or empty variable leaves the app usable rather than silently
    // returning it to a dead end. Turning it off has to be deliberate.
    for (const value of ["", "0", "no", "FALSE", "False", "true"]) {
      vi.stubEnv("NEXT_PUBLIC_PREVIEW_MODE", value);
      expect(previewModeEnabled(), value).toBe(true);
    }

    vi.stubEnv("NEXT_PUBLIC_PREVIEW_MODE", "false");
    expect(previewModeEnabled()).toBe(false);
  });
});

describe("with the flag off", () => {
  // The strict build: for anyone who needs the app to serve the examination or
  // nothing at all, one variable still restores the refusal in full.
  it("refuses a short bank, and hands back what the unavailable screen prints", () => {
    vi.stubEnv("NEXT_PUBLIC_PREVIEW_MODE", "false");

    const resolution = resolvePaper("seed", "2", shortPool());

    expect(resolution.kind).toBe("unavailable");
    if (resolution.kind !== "unavailable") return;
    expect(resolution.error).toBeInstanceOf(InsufficientQuestionsError);

    // The shortfall rows are the unavailable screen's table.
    const shortfalls = (resolution.error as InsufficientQuestionsError).shortfalls;
    expect(shortfalls.map((s) => s.topic)).toContain("regulatory_signs");
    expect(shortfalls.find((s) => s.topic === "regulatory_signs")).toMatchObject({
      requested: QUOTA.regulatory_signs,
      available: 6,
    });
  });

  it("still serves a full paper when the bank can fill one", () => {
    vi.stubEnv("NEXT_PUBLIC_PREVIEW_MODE", "false");
    const resolution = resolvePaper("seed", "2", pool());
    expect(resolution.kind).toBe("paper");
    if (resolution.kind !== "paper") return;
    expect(resolution.test.questions).toHaveLength(OFFICIAL_TEST_LENGTH);
    expect(resolution.test.preview).toBeNull();
  });
});

describe("by default", () => {
  it("previews a short bank instead of refusing", () => {
    vi.stubEnv("NEXT_PUBLIC_PREVIEW_MODE", undefined);
    const resolution = resolvePaper("seed", "2", shortPool());
    expect(resolution.kind).toBe("preview");
    if (resolution.kind !== "preview") return;
    expect(resolution.test.preview).not.toBeNull();
  });

  it("leaves a fillable bank alone: a real paper stays a real paper", () => {
    vi.stubEnv("NEXT_PUBLIC_PREVIEW_MODE", undefined);
    const resolution = resolvePaper("seed", "2", pool());
    expect(resolution.kind).toBe("paper");
    if (resolution.kind !== "paper") return;
    expect(resolution.test.preview).toBeNull();
    expect(resolution.test.questions.map((q) => q.uid)).toEqual(
      assembleTest("seed", "2", pool()).questions.map((q) => q.uid),
    );
  });

  it("still refuses Code 1, whose quotas are not sourced", () => {
    // A shortfall is a bank too small to fill a known paper. This is not knowing
    // what the paper is, and no flag makes that guessable.
    vi.stubEnv("NEXT_PUBLIC_PREVIEW_MODE", undefined);
    const resolution = resolvePaper("seed", "1", pool());
    expect(resolution.kind).toBe("unavailable");
    if (resolution.kind !== "unavailable") return;
    expect(resolution.error).toBeInstanceOf(BlueprintNotSpecifiedError);
  });

  it("refuses rather than serving an empty screen when the bank holds nothing", () => {
    vi.stubEnv("NEXT_PUBLIC_PREVIEW_MODE", undefined);
    expect(resolvePaper("seed", "2", emptyPool()).kind).toBe("unavailable");
  });
});

describe("an assembled preview", () => {
  it("draws what each section can hold, and no more", () => {
    // Per section: everything eligible in its topics, capped at the section's
    // real length. On this bank that is 37 of the 61 signs questions — nothing
    // spare to pad with — and a full 29 in the block, where rules of the road
    // has a surplus. 66 in all.
    const p = shortPool();
    const expected = [true, false].reduce((sum, signs) => {
      const slots = buildBlueprint("2+3").filter((s) => isSignsTopic(s.topic) === signs);
      const eligible = slots.reduce((n, slot) => n + p[slot.topic].length, 0);
      const quota = slots.reduce((n, slot) => n + slot.count, 0);
      return sum + Math.min(quota, eligible);
    }, 0);

    const test = assemblePreview("seed", "2", p);
    expect(test.questions).toHaveLength(expected);
    expect(test.questions).toHaveLength(66);
    expect(test.questions.length).toBeLessThan(OFFICIAL_TEST_LENGTH);
  });

  it("never numbers a question past the end of its section", () => {
    // The reason the padding is capped. A section longer than the real one has
    // to be numbered off the end of it, and q124 on a paper whose block stops at
    // 123 looks exactly as sourced as the 29 numbers before it.
    const marked = OFFICIAL_LAYOUT["2+3"].filter((section) => section.marked);

    for (const attempt of [1, 2, 3]) {
      for (const q of assemblePreview("range", "2", shortPool(), attempt).questions) {
        const section = marked.find((s) => s.label === q.officialSection)!;
        expect(q.officialNumber, `q${q.officialNumber} in ${q.officialSection}`)
          .toBeGreaterThanOrEqual(section.firstNumber);
        expect(q.officialNumber, `q${q.officialNumber} in ${q.officialSection}`)
          .toBeLessThanOrEqual(section.lastNumber);
      }
    }
  });

  it("reports each section against its real length", () => {
    const notice = assemblePreview("seed", "2", shortPool()).preview!;
    expect(notice.sections).toEqual([
      { section: "B", length: 37, officialLength: 61 },
      { section: "D", length: 29, officialLength: 29 },
    ]);
    // The totals have to agree with the sections, or the banner contradicts
    // itself on the same screen.
    expect(notice.sections.reduce((sum, s) => sum + s.length, 0)).toBe(notice.length);
    expect(notice.sections.reduce((sum, s) => sum + s.officialLength, 0)).toBe(
      notice.officialLength,
    );
  });

  it("never draws a topic the paper does not ask about", () => {
    // Motorcycle questions are eligible in the bank and are not on this paper.
    // Padding is drawn regardless of quota, not regardless of the blueprint.
    const p = shortPool();
    p.motorcycles = [question(900, "motorcycles"), question(901, "motorcycles")];

    const test = assemblePreview("seed", "2", p);
    expect(test.questions.some((q) => q.topic === "motorcycles")).toBe(false);
  });

  it("never repeats a question", () => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const uids = assemblePreview("dup", "2", shortPool(), attempt).questions.map(
        (q) => q.uid,
      );
      expect(new Set(uids).size, `attempt ${attempt}`).toBe(uids.length);
    }
  });

  it("takes what each topic has, up to but never past its quota before padding", () => {
    const p = shortPool();
    const test = assemblePreview("seed", "2", p);
    const notice = test.preview!;

    for (const row of notice.under) {
      // A topic reported as under quota really is: it gave everything it had.
      expect(row.filled).toBeLessThan(row.requested);
    }
    expect(notice.under.map((r) => r.topic)).toEqual([
      "regulatory_signs",
      "warning_signs",
      "guidance_signs",
      "information_signs",
      "road_markings",
      "road_signals",
      "rules_of_the_road",
      "traffic_legislation",
    ]);
    // Rules of the road holds 23 questions for a quota of 15 and is still under
    // quota, because only 2 of them are general duties and 5 are required. The
    // sub-requirement is reported, not quietly filled with the surplus.
    expect(notice.under.find((r) => r.topic === "rules_of_the_road")).toMatchObject({
      requested: QUOTA.rules_of_the_road,
      filled: 12,
    });
  });

  it("states the real question count and what the paper should have been", () => {
    const test = assemblePreview("seed", "2", shortPool());
    const notice = test.preview!;
    expect(notice.length).toBe(test.questions.length);
    expect(notice.officialLength).toBe(blueprintLength("2+3"));
    expect(notice.extra).toBeGreaterThan(0);
  });

  it("pads from whichever topic has a surplus, past that topic's own quota", () => {
    const test = assemblePreview("seed", "2", shortPool());
    const over = test.blueprint.filter((row) => row.filled > row.requested);

    // Rules of the road is the only topic here with anything spare, so the
    // padding all comes from it and the paper ends up weighted towards it. That
    // is the distortion the notice exists to declare.
    expect(over.map((row) => row.topic)).toEqual(["rules_of_the_road"]);
    expect(test.preview!.extra).toBeGreaterThanOrEqual(
      over.reduce((sum, row) => sum + row.filled - row.requested, 0),
    );
  });

  it("is reproducible from the seed and attempt alone", () => {
    for (const attempt of [1, 2, 4]) {
      const a = assemblePreview("repro-seed", "2", shortPool(), attempt);
      const b = assemblePreview("repro-seed", "2", shortPool(), attempt);
      expect(a.questions.map((q) => q.uid)).toEqual(b.questions.map((q) => q.uid));
      expect(a.questions.map((q) => q.answer)).toEqual(b.questions.map((q) => q.answer));
      expect(a.questions.map((q) => q.options.map((o) => o.text).join("|"))).toEqual(
        b.questions.map((q) => q.options.map((o) => o.text).join("|")),
      );
    }
  });

  it("gives different seeds different papers", () => {
    const a = assemblePreview("one", "2", shortPool());
    const b = assemblePreview("two", "2", shortPool());
    expect(a.questions.map((q) => q.uid)).not.toEqual(b.questions.map((q) => q.uid));
  });

  it("asks the signs section first and numbers it as the paper does", () => {
    const test = assemblePreview("order", "2", shortPool());
    const lastSigns = test.questions.findLastIndex((q) => isSignsTopic(q.topic));
    const firstBlock = test.questions.findIndex((q) => !isSignsTopic(q.topic));
    expect(lastSigns).toBeLessThan(firstBlock);

    const signs = test.questions.filter((q) => isSignsTopic(q.topic));
    expect(signs[0].officialNumber).toBe(5);
    expect(test.questions.find((q) => !isSignsTopic(q.topic))!.officialNumber).toBe(95);
    expect(new Set(test.questions.map((q) => q.officialNumber)).size).toBe(
      test.questions.length,
    );
  });

  it("keeps the option shuffle honest, exactly as a real paper does", () => {
    const p = shortPool();
    const byUid = new Map(
      Object.values(p)
        .flat()
        .map((q) => [q.uid, q]),
    );

    for (const q of assemblePreview("opts", "2", p).questions) {
      const source = byUid.get(q.uid)!;
      const correct = q.options.find((o) => o.key === q.answer)!;
      // The correct option is still the source's correct option, carried to
      // wherever the shuffle put it.
      expect(correct.text).toBe(source.options[correct.originalKey]);
      expect(correct.originalKey).toBe(source.answer);
      expect(q.options.map((o) => o.text).sort()).toEqual(
        Object.values(source.options).sort(),
      );
    }
  });

  it("promises no fresh rotation once it has padded the paper", () => {
    const test = assemblePreview("fresh", "2", shortPool());
    expect(test.preview!.extra).toBeGreaterThan(0);
    expect(test.freshAttempts).toBe(1);
  });
});

describe("marking a preview", () => {
  it("has no pass mark and no verdict", () => {
    const test = assemblePreview("mark", "2", shortPool());
    const answers = Object.fromEntries(test.questions.map((q) => [q.uid, q.answer]));

    const result = scoreTest(test, answers);
    expect(result.correct).toBe(test.questions.length);
    // Every answer right, and still not a pass: there is nothing here to pass.
    expect(result.passed).toBeNull();
    expect(result.passMark).toBeNull();
    expect(result.shortBy).toBeNull();
  });

  it("scores and breaks down by topic all the same", () => {
    const test = assemblePreview("mark", "2", shortPool());
    const answers: Record<string, OptionKey> = {};
    test.questions.forEach((q, i) => {
      if (i % 2 === 0) answers[q.uid] = q.answer;
    });

    const result = scoreTest(test, answers);
    expect(result.correct).toBe(Math.ceil(test.questions.length / 2));
    expect(result.total).toBe(test.questions.length);
    expect(result.topics.reduce((sum, t) => sum + t.total, 0)).toBe(test.questions.length);
    // Topic guidance still means what it meant; only the verdict is withheld.
    expect(result.weakestTopics.every((t) => t !== undefined)).toBe(true);
  });

  it("still marks a real paper against the official 80%", () => {
    const test = assembleTest("real", "2", pool());
    const answers = Object.fromEntries(test.questions.map((q) => [q.uid, q.answer]));
    const result = scoreTest(test, answers);
    expect(result.passed).toBe(true);
    expect(result.passMark).toEqual({
      ratio: PASS_RATIO,
      correct: 72,
      isOfficial: true,
    });
  });
});
