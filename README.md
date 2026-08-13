# learners-web

The practice test for the Namibian Learner's Licence. Next.js app; the data is a
build-time snapshot of two sibling projects, never read across the filesystem at
request time.

## Where the data comes from

`npm run sync-data` copies from **two sources into one destination**, and
`data/sync-manifest.json` records both so a stale copy is obvious.

| what | from | why there |
| --- | --- | --- |
| question banks, answers, `answers-from-facts.json`, facts, book text, per-paper artwork crops | `../learners` (the PDF extractor) | that is where the papers are read |
| `signs.json` and one SVG per sign | `../learners-svg` (the SVG pipeline) | that is where the signs are legible |

Override with `EXTRACTOR_DIR` and `SIGNS_DIR`.

The split is not arbitrary. The extractor's sign artwork was a PDF crop that
dragged in the whole page's clip stack — 418 signs, 35.9 MB. The SVG pipeline
cuts the same signs from vector page exports and finds 77 more the PDF pass
never read: **495 signs, 2.3 MB**.

## Commands

```bash
npm run sync-data   # refresh data/ and public/ from both projects
npm run coverage    # measure the bank against the official quotas
npm test            # vitest
npm run dev
npm run build       # runs coverage first
```

## What the app refuses to do

- **No placeholder artwork.** A question whose `image.ref` does not resolve to a
  file on disk is not served. A question shown beside the wrong picture is worse
  than one not shown.
- **No unlabelled question.** A question with no topic belongs to no quota, so
  serving it would mean a paper that satisfies its own arithmetic while saying
  nothing about what it covered.
- **No shortened paper.** The official test is 90 questions. When the bank
  cannot fill the quotas the app reports the shortfall per topic instead of
  serving a smaller test in its place.
- **No composed examination question.** Every question in the test was printed
  on a paper, with the answer that paper gave. Sign practice, below, is the one
  place questions are composed, and it is not the examination.

## Sign practice

A second kind of test, at `/practice/<seed>`, built from the manual's own sign
catalogue rather than from a past paper. It exists because the catalogue holds
495 signs while the question bank holds 37 signs questions — the examination
shows all 37 every time it is served, and this does not repeat.

It is composed, which the examination never is, so it is kept apart: its own
address, its own screens, its own labelling, and no pass mark. What keeps it
honest is that **no text in it is written by this app**. The prompt is a fixed
form of words, the correct option is the catalogue's name for the sign, and every
wrong option is another real sign's real name. There is no invented
plausible-sounding answer anywhere, because inventing one would mean making up
road law.

- **60 a round**, mixed across the six sign categories in the proportions the
  paper's signs section uses — it puts 61 of its 90 questions on signs, split
  20/15/7/4/9/6, and a round is that split scaled by largest remainder to
  19/15/7/4/9/6. The categories are then shuffled together: nine warning signs in
  a row make the tenth easy for the wrong reason.
- **Eligibility**: a sign needs a name, a class, and artwork on disk — 418 of the
  495. The class is what the wrong options are drawn from, so a sign without one
  has no group to be confused with and is left out rather than padded from
  elsewhere.
- **The wrong options are near misses**, which is what makes it worth sitting.
  They are ranked by a similarity score built only from what the catalogue
  records: same manual page (the manual prints a sub-type per page), shared words
  in the name, adjacent catalogue numbers. So a question is Stop against
  Stop/Yield and 4-Way Stop, not against a sign that looks nothing like it. Two
  are then taken from the closest six, so a sign is not asked the same way twice.
- **Deduplicated by name and by wording.** Five catalogue signs are called
  "Derestriction" and nine pairs share a word-for-word identical meaning; without
  those checks a list could offer the right answer twice and mark one wrong.
- **Three shapes**: name the sign shown, pick the sign from three pictures, or
  say what the sign means.
- **Meanings are used only where the catalogue actually explains a sign.** The
  field is not always an explanation — for the guidance signs it holds label text
  that did not survive extraction, so "Suburb name" is recorded as meaning
  "Advance transport 274 trailblazer". Options must run to eight words, which
  keeps the explanations and drops the labels; those signs are still asked about
  by name and by picture.
- **Marked as you answer**, with the catalogue's own meaning and the manual page
  shown while the sign is still in front of you. No clock, no pass mark, and a
  per-category breakdown at the end.
- Seeded like everything else: the same address gives the same round.

## Preview mode

`NEXT_PUBLIC_PREVIEW_MODE=true` in `.env.local` lets the app assemble a paper the
bank cannot fill, so the flow can be walked through — timer, question order,
artwork, review — while the questions are still being transcribed. It is off in
any build that does not set it, and a build without it refuses a short bank
exactly as before; `tests/preview.test.ts` pins that.

What a preview is, in full:

- Each topic gives up whatever it has, and the paper is then padded from
  whichever topics have a surplus. The proportions are therefore wrong, and
  wrong in a way that depends on which questions happen to have been read.
- Every question and the results screen carry a banner stating the real question
  count and which topics are under quota.
- It is not marked. `scoreTest` returns a null pass mark for a preview rather
  than applying 80% to a paper the regulation says nothing about, so no screen
  can show a pass or a fail. The score and the per-topic breakdown are shown.
- Eligibility is untouched: the same questions are servable, no artwork is
  invented, nothing is generated, and a topic this paper does not ask about stays
  out of it. A preview shows fewer questions than the test, never questions the
  test would not contain.
- A Code 1 paper stays refused. Its quotas are not sourced at all, so there is no
  blueprint to fall short of and nothing to preview.
- Seeded as usual: `/test/<seed>/<attempt>?code=2` reproduces a preview exactly.

## Provenance carried to the screen

Three things are shown rather than smoothed over, because they are weaker claims
than they look:

- **Topic labels** are machine-assigned and unreviewed. The app says so.
- **Derived answers** come from `answers-from-facts.json` — worked out from a
  fact in the manual, not printed on any paper. Review mode marks them and says
  whether a human has checked that one.
- **Signs with no recorded name.** 8 of the 495 lost their printed name when the
  page export converted that text to outlines. Their artwork is exact and is
  shown; the name is not invented to fill the gap.

## Keeping the two coverage reports in agreement

`npm run coverage` here and `python -m extractor coverage --all` in `../learners`
must report the same servable total and the same per-topic shortfall. They drifted
once; the causes were worth recording:

1. `answers-from-facts.json` was never copied here and the app had no path to
   apply it.
2. The `controls` topic alias mapped straight to `vehicle_controls`, so four
   Section D motorcycle questions filled a Code 2/3 quota of four.
3. The app assessed each bank separately while the extractor merged the readings
   of one printed question, so a question whose answer sat in one reading and
   whose topic sat in another was served by neither.
4. The app deduplicated on question text alone, collapsing three different
   "This sign indicates?" questions into one.

Run both after any change to either. Compare with
`learners-svg/scripts/compare_coverage.py`, which diffs them question by question.
