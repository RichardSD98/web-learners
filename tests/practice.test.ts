import { describe, expect, it } from "vitest";

import { loadCorpus } from "@/lib/bank";
import { TOPIC_QUOTAS } from "@/lib/blueprint";
import {
  assemblePractice,
  eligibleSigns,
  practiceQuotas,
  PRACTICE_ROUND_LENGTH,
  similarity,
  usableMeaning,
  type EligibleSign,
  type PracticeQuestion,
} from "@/lib/practice";
import { signArtwork } from "@/lib/practice-catalogue";
import type { Sign } from "@/lib/schema";

const catalogue = [...loadCorpus().signsByRef.values()];
const pool = eligibleSigns(catalogue, signArtwork);
const byRef = new Map(pool.map((s) => [s.ref, s]));

/** Stands in for the disk when the point of the test is that a file is absent. */
const noArtwork = () => null;

/** A real catalogue entry, so its artwork is genuinely on disk. */
function real(ref: string): Sign {
  const sign = catalogue.find((s) => s.ref === ref);
  if (!sign) throw new Error(`fixture: no catalogue sign "${ref}"`);
  return sign;
}

function withFields(ref: string, overrides: Partial<Sign>): Sign {
  return { ...real(ref), ...overrides };
}

describe("which signs may be asked about", () => {
  it("accepts a named, classed sign whose artwork is on disk", () => {
    const eligible = eligibleSigns([real("stop")], signArtwork);
    expect(eligible).toHaveLength(1);
    expect(eligible[0]).toMatchObject({
      ref: "stop",
      name: "Stop",
      signClass: "regulatory",
      artworkUrl: "/signs/stop.svg",
    });
  });

  it("refuses a sign with no name: there would be nothing to answer", () => {
    expect(eligibleSigns([withFields("stop", { name: null })], signArtwork)).toEqual([]);
  });

  it("refuses a sign with no class, rather than drawing its wrong options from anywhere", () => {
    expect(eligibleSigns([withFields("stop", { class: null })], signArtwork)).toEqual([]);
  });

  it("refuses a sign whose artwork is not on disk", () => {
    expect(eligibleSigns([real("stop")], noArtwork)).toEqual([]);
    expect(
      eligibleSigns([withFields("stop", { ref: "no-such-file" })], signArtwork),
    ).toEqual([]);
  });

  it("takes most of the catalogue and drops the rest for a stated reason", () => {
    expect(catalogue.length).toBe(495);
    expect(pool.length).toBe(418);
    for (const sign of catalogue.filter((s) => !byRef.has(s.ref))) {
      expect(sign.name === null || sign.class === null, sign.ref).toBe(true);
    }
  });
});

describe("how hard the wrong answers are", () => {
  it("scores a sign from the same manual page as similar", () => {
    const [stop, yieldSign] = [byRef.get("stop")!, byRef.get("stop-yield")!];
    expect(stop.folio).toBe(yieldSign.folio);
    expect(similarity(stop, yieldSign)).toBeGreaterThan(0);
  });

  it("scores a shared word in the name higher than nothing in common", () => {
    const stop = byRef.get("stop")!;
    const near = byRef.get("4-way-stop")!;
    const far = pool.find(
      (s) => s.signClass === "regulatory" && s.nameTokens.every((t) => t !== "stop"),
    )!;
    expect(similarity(stop, near)).toBeGreaterThan(similarity(stop, far));
  });

  it("draws distractors that are measurably closer than the class average", () => {
    // The whole point of the change: a wrong option should be a near miss, not
    // any other sign that happens to share a class.
    const round = assemblePractice("hard", catalogue, signArtwork);

    let chosenTotal = 0;
    let chosenCount = 0;
    let classTotal = 0;
    let classCount = 0;

    for (const q of round.questions) {
      const subject = byRef.get(q.ref)!;
      for (const option of q.options) {
        if (option.ref === q.ref) continue;
        chosenTotal += similarity(subject, byRef.get(option.ref)!);
        chosenCount += 1;
      }
      for (const other of pool.filter((s) => s.signClass === subject.signClass)) {
        if (other.ref === subject.ref) continue;
        classTotal += similarity(subject, other);
        classCount += 1;
      }
    }

    const chosenMean = chosenTotal / chosenCount;
    const classMean = classTotal / classCount;
    expect(chosenMean).toBeGreaterThan(classMean * 2);
  });

  it("still varies the wrong options between seeds", () => {
    // Always taking the two closest would make a sign's question identical every
    // time it came up.
    const seen = new Set<string>();
    for (let i = 0; i < 12; i += 1) {
      for (const q of assemblePractice(`vary-${i}`, catalogue, signArtwork).questions) {
        seen.add(`${q.ref}:${q.options.map((o) => o.ref).sort().join(",")}`);
      }
    }
    const refs = new Set([...seen].map((k) => k.split(":")[0]));
    // More distinct option sets than distinct subjects means at least some signs
    // were asked with different distractors on different seeds.
    expect(seen.size).toBeGreaterThan(refs.size);
  });
});

describe("the shape of a round", () => {
  const round = assemblePractice("seed", catalogue, signArtwork);

  it("is 60 questions, the size of the paper's signs section", () => {
    expect(PRACTICE_ROUND_LENGTH).toBe(60);
    expect(round.questions).toHaveLength(60);
  });

  it("splits the categories in the proportions the paper uses", () => {
    const quota = TOPIC_QUOTAS["2+3"]!;
    const paperTotal =
      quota.regulatory_signs! +
      quota.warning_signs! +
      quota.guidance_signs! +
      quota.information_signs! +
      quota.road_markings! +
      quota.road_signals!;
    expect(paperTotal).toBe(61);

    const quotas = practiceQuotas(60);
    expect(quotas.reduce((sum, q) => sum + q.count, 0)).toBe(60);
    expect(Object.fromEntries(quotas.map((q) => [q.signClass, q.count]))).toEqual({
      regulatory: 19,
      warning: 15,
      guidance: 7,
      information: 4,
      road_marking: 9,
      road_signal: 6,
    });
  });

  it("fills every category to its quota", () => {
    for (const category of round.categories) {
      expect(category.filled, category.signClass).toBe(category.requested);
    }
    const asked = new Map<string, number>();
    for (const q of round.questions) {
      asked.set(q.sign.signClass, (asked.get(q.sign.signClass) ?? 0) + 1);
    }
    for (const category of round.categories) {
      expect(asked.get(category.signClass), category.signClass).toBe(category.requested);
    }
  });

  it("mixes the categories rather than serving them in blocks", () => {
    // Nine warning signs in a row make the tenth easy for the wrong reason.
    const classes = round.questions.map((q) => q.sign.signClass);
    const runs = classes.filter((c, i) => i === 0 || classes[i - 1] !== c).length;
    expect(runs).toBeGreaterThan(30);
  });

  it("asks all three shapes", () => {
    const shapes = new Set(round.questions.map((q) => q.shape));
    expect(shapes).toEqual(new Set(["identify", "select", "meaning"]));
  });

  it("never asks about the same sign twice", () => {
    const refs = round.questions.map((q) => q.ref);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it("numbers the questions in the order they are served", () => {
    expect(round.questions.map((q) => q.position)).toEqual(
      Array.from({ length: round.questions.length }, (_, i) => i + 1),
    );
  });
});

describe("every question is answerable and unambiguous", () => {
  const rounds = [0, 1, 2, 3].map((i) =>
    assemblePractice(`check-${i}`, catalogue, signArtwork),
  );
  const questions = rounds.flatMap((r) => r.questions);

  it("has three options with exactly one correct", () => {
    for (const q of questions) {
      expect(q.options.map((o) => o.key)).toEqual(["A", "B", "C"]);
      expect(new Set(q.options.map((o) => o.ref)).size).toBe(3);
      const correct = q.options.filter((o) => o.ref === q.ref);
      expect(correct, q.ref).toHaveLength(1);
      expect(correct[0].key).toBe(q.answer);
    }
  });

  it("never offers two options under the same name", () => {
    // Five signs are called "Derestriction", three "Railway crossing". Two of
    // them in one list would mark a correct answer wrong.
    for (const q of questions) {
      const names = q.options.map((o) => byRef.get(o.ref)!.nameKey);
      expect(new Set(names).size, q.ref).toBe(3);
    }
  });

  it("never offers two options with identical wording", () => {
    // Nine pairs of signs carry word-for-word identical meanings.
    for (const q of questions) {
      const texts = q.options.map((o) => o.text.trim().toLowerCase()).filter(Boolean);
      expect(new Set(texts).size, q.ref).toBe(texts.length);
    }
  });

  it("invents no text: every worded option is some real sign's own wording", () => {
    // The property the whole module rests on.
    const names = new Set(pool.map((s) => s.nameKey));
    const meanings = new Set(
      pool.filter((s) => s.meaning).map((s) => s.meaning!.trim().toLowerCase()),
    );
    for (const q of questions) {
      for (const option of q.options) {
        if (!option.text) continue;
        const text = option.text.trim().toLowerCase();
        expect(names.has(text) || meanings.has(text), option.text).toBe(true);
      }
    }
  });

  it("keeps every option inside the subject's own category", () => {
    for (const q of questions) {
      for (const option of q.options) {
        expect(byRef.get(option.ref)!.signClass, `${q.ref} vs ${option.ref}`).toBe(
          q.sign.signClass,
        );
      }
    }
  });

  it("shows the sign exactly where each shape needs it", () => {
    for (const q of questions) {
      const pictures = q.options.filter((o) => o.artworkUrl !== null).length;
      if (q.shape === "select") {
        expect(q.stemArtworkUrl).toBeNull();
        expect(pictures).toBe(3);
        expect(q.options.every((o) => o.text === "")).toBe(true);
      } else {
        expect(q.stemArtworkUrl).toBe(`/signs/${q.ref}.svg`);
        expect(pictures).toBe(0);
        expect(q.options.every((o) => o.text.length > 0)).toBe(true);
      }
    }
  });

  it("only asks what a sign means where the catalogue actually explains it", () => {
    // The catalogue's `meaning` is not always an explanation: for the guidance
    // signs it holds label text that did not survive extraction, so "Suburb
    // name" is recorded as "Advance transport 274 trailblazer". Three of those
    // as options is an unanswerable question, not a hard one.
    for (const q of questions.filter((q) => q.shape === "meaning")) {
      for (const option of q.options) {
        expect(option.text.length, option.text).toBeLessThanOrEqual(160);
        expect(
          option.text.trim().split(/\s+/).length,
          option.text,
        ).toBeGreaterThanOrEqual(8);
      }
    }
  });

  it("rejects a label-shaped meaning outright", () => {
    const suburb = pool.find((s) => s.ref === "suburb-name");
    if (suburb) {
      expect(suburb.meaning).toBeTruthy();
      expect(usableMeaning(suburb)).toBe(false);
    }
    const noEntry = pool.find((s) => s.nameKey === "no entry")!;
    expect(usableMeaning(noEntry)).toBe(true);
  });

  it("carries the manual's own wording, not a rewrite of it", () => {
    const source = new Map(catalogue.map((s) => [s.ref, s]));
    for (const q of questions) {
      const sign = source.get(q.ref)!;
      expect(q.sign.name).toBe(sign.name!.trim());
      expect(q.sign.meaning).toBe(sign.meaning);
      expect(q.sign.folio).toBe(sign.folio ?? null);
    }
  });
});

describe("seeded rounds", () => {
  const signature = (q: PracticeQuestion) =>
    `${q.ref}|${q.shape}|${q.answer}|${q.options.map((o) => o.ref).join(",")}`;

  it("reproduces a round exactly from its seed", () => {
    const a = assemblePractice("brisk-oryx-1234", catalogue, signArtwork);
    const b = assemblePractice("brisk-oryx-1234", catalogue, signArtwork);
    expect(a.questions.map(signature)).toEqual(b.questions.map(signature));
  });

  it("gives different seeds different rounds", () => {
    const a = assemblePractice("one", catalogue, signArtwork);
    const b = assemblePractice("two", catalogue, signArtwork);
    expect(a.questions.map((q) => q.ref)).not.toEqual(b.questions.map((q) => q.ref));
  });

  it("keeps going for many rounds without running dry", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10; i += 1) {
      for (const q of assemblePractice(`round-${i}`, catalogue, signArtwork).questions) {
        seen.add(q.ref);
      }
    }
    expect(seen.size).toBeGreaterThan(250);
  });

  it("serves what it can when a category is thinner than its quota", () => {
    // Information signs are the thinnest category at 10 eligible. A round that
    // asked for more should report what it got rather than pad from elsewhere.
    const round = assemblePractice("thin", catalogue, signArtwork, 600);
    const information = round.categories.find((c) => c.signClass === "information")!;
    expect(information.filled).toBeLessThanOrEqual(information.requested);
    expect(round.questions.filter((q) => q.sign.signClass === "information")).toHaveLength(
      information.filled,
    );
    const refs = round.questions.map((q) => q.ref);
    expect(new Set(refs).size).toBe(refs.length);
  });
});

describe("eligible signs carry what the ranking needs", () => {
  it("tokenises names into significant words", () => {
    const sign = byRef.get("4-way-stop") as EligibleSign;
    expect(sign.nameTokens).toContain("stop");
    expect(sign.nameTokens).not.toContain("the");
  });
});
