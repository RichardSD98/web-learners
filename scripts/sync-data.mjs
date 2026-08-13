/**
 * Copy the pipelines' output into this project.
 *
 * Runs at build time, never at request time: the app must not reach across the
 * filesystem into a sibling project while serving. What lands in `data/` and
 * `public/signs/` is a snapshot, and `sync-manifest.json` records where it came
 * from so a stale copy is obvious.
 *
 * TWO SOURCES, ONE DESTINATION
 * ----------------------------
 * `learners/`      the PDF extractor. Question banks, the answers derived from
 *                  the manual, facts, the book text, and the per-paper artwork
 *                  crops. Everything the app knows about *questions*.
 *
 * `learners-svg/`  the SVG pipeline. The sign catalogue and one tight SVG per
 *                  sign, cut from the Illustrator page exports. Everything the
 *                  app knows about *signs*.
 *
 * The split is not arbitrary. The sign artwork the extractor produced was a PDF
 * crop that dragged in the whole page's clip stack — 418 signs, 35.9 MB. The SVG
 * pipeline cuts the same signs from vector page exports and finds 77 more that
 * the PDF pass never read: 495 signs, 2.4 MB. Questions stay with the extractor
 * because that is where the papers are read; signs come from the SVG pipeline
 * because that is where they are legible.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const EXTRACTOR =
  process.env.EXTRACTOR_DIR ?? resolve(process.cwd(), "..", "learners");
const SIGN_PIPELINE =
  process.env.SIGNS_DIR ?? resolve(process.cwd(), "..", "learners-svg");
const DEST = resolve(process.cwd(), "data");
const SIGNS_OUT = resolve(process.cwd(), "public", "signs");
const ARTWORK_OUT = resolve(process.cwd(), "public", "artwork");

/** Question banks worth copying. Banks with no answers are copied too, so the
 *  coverage report can say *why* they contribute nothing. */
const BANKS = [
  "data/paper-a-answers.json",
  "data/paper-a-markup.json",
  "data/paper-a.json",
  "data/test1-answered.json",
  "data/test1-ocr.json",
  "data/test3-ocr.json",
  "questions-test1.json",
];

/**
 * Knowledge files from the extractor.
 *
 * `answers-from-facts.json` holds answers derived from the manual rather than
 * read off a paper. It is copied so the app can apply them *and say that it
 * did*; it was previously left behind, which is why this project and the
 * extractor reported different servable totals.
 */
const KNOWLEDGE = [
  "data/facts.json",
  "data/book.json",
  "data/answers-from-facts.json",
];

/** Per-question artwork, keyed by the paper it came from. The `scan_file` of a
 *  bank names the PDF; the artwork directory is named after the PDF stem. */
const ARTWORK_DIRS = [
  "data/artwork/Test_paper_with_answers",
  "data/artwork/TEST_PAPER_A-1-1",
];

/** From the SVG pipeline: the catalogue, and the per-sign SVGs it indexes. */
const SIGN_CATALOGUE = "data/signs.json";
const SIGN_SVG_DIR = "data/signs";

function fail(message) {
  console.error(`\n  sync-data failed: ${message}\n`);
  process.exit(1);
}

if (!existsSync(EXTRACTOR)) {
  fail(
    `extractor project not found at ${EXTRACTOR}\n` +
      `  set EXTRACTOR_DIR to its path, e.g. EXTRACTOR_DIR=C:/Users/you/Projects/learners npm run sync-data`,
  );
}
if (!existsSync(SIGN_PIPELINE)) {
  fail(
    `sign pipeline not found at ${SIGN_PIPELINE}\n` +
      `  set SIGNS_DIR to its path, e.g. SIGNS_DIR=C:/Users/you/Projects/learners-svg npm run sync-data`,
  );
}

mkdirSync(DEST, { recursive: true });
rmSync(SIGNS_OUT, { recursive: true, force: true });
mkdirSync(SIGNS_OUT, { recursive: true });
rmSync(ARTWORK_OUT, { recursive: true, force: true });
mkdirSync(ARTWORK_OUT, { recursive: true });

const manifest = {
  sources: {
    questions: EXTRACTOR,
    signs: SIGN_PIPELINE,
  },
  banks: [],
  knowledge: [],
  signCatalogue: null,
  signSvgCount: 0,
  signSvgBytes: 0,
  artwork: {},
};

for (const relative of [...BANKS, ...KNOWLEDGE]) {
  const from = join(EXTRACTOR, relative);
  if (!existsSync(from)) {
    console.warn(`  skipped (not found): ${relative}`);
    continue;
  }
  const name = basename(relative);
  cpSync(from, join(DEST, name));
  const bytes = readFileSync(from, "utf8").length;
  const entry = { file: name, from: relative, source: "extractor", bytes };
  (BANKS.includes(relative) ? manifest.banks : manifest.knowledge).push(entry);
  console.log(`  learners/${relative}  ->  data/${name}`);
}

// ---------------------------------------------------------------------------
// signs, from the SVG pipeline
// ---------------------------------------------------------------------------

const catalogueFrom = join(SIGN_PIPELINE, SIGN_CATALOGUE);
if (!existsSync(catalogueFrom)) {
  fail(
    `sign catalogue not found at ${catalogueFrom}\n` +
      `  run \`python scripts/step5_run.py\` in ${SIGN_PIPELINE} first`,
  );
}
cpSync(catalogueFrom, join(DEST, "signs.json"));
const catalogue = JSON.parse(readFileSync(catalogueFrom, "utf8"));
manifest.signCatalogue = {
  file: "signs.json",
  from: SIGN_CATALOGUE,
  source: "sign pipeline",
  signs: catalogue.signs.length,
};
console.log(`  learners-svg/${SIGN_CATALOGUE}  ->  data/signs.json  (${catalogue.signs.length} signs)`);

// Copy only the SVGs the catalogue actually indexes, under the catalogue slug.
// Copying the directory wholesale would ship files nothing can reach, and a
// slug with no file must stay missing so the eligibility rule can see it.
const signSource = join(SIGN_PIPELINE, SIGN_SVG_DIR);
if (!existsSync(signSource)) {
  fail(`sign SVGs not found at ${signSource}`);
}
const available = new Set(readdirSync(signSource).filter((f) => f.endsWith(".svg")));
const missing = [];
for (const sign of catalogue.signs) {
  const file = `${sign.ref}.svg`;
  if (!available.has(file)) {
    missing.push(sign.ref);
    continue;
  }
  cpSync(join(signSource, file), join(SIGNS_OUT, file));
  manifest.signSvgCount += 1;
  manifest.signSvgBytes += readFileSync(join(signSource, file), "utf8").length;
}
manifest.signSvgMissing = missing;
console.log(
  `  learners-svg/${SIGN_SVG_DIR}/*.svg  ->  public/signs/  ` +
    `(${manifest.signSvgCount} files, ${(manifest.signSvgBytes / 1024 / 1024).toFixed(2)} MB)`,
);
if (missing.length > 0) {
  console.warn(`  warning: ${missing.length} catalogue entries have no SVG: ${missing.slice(0, 5).join(", ")}`);
}

for (const relative of ARTWORK_DIRS) {
  const from = join(EXTRACTOR, relative);
  if (!existsSync(from)) continue;
  const paper = basename(relative);
  const out = join(ARTWORK_OUT, paper);
  mkdirSync(out, { recursive: true });
  let count = 0;
  for (const file of readdirSync(from)) {
    if (file.endsWith(".svg")) {
      cpSync(join(from, file), join(out, file));
      count += 1;
    }
  }
  manifest.artwork[paper] = count;
  console.log(`  learners/${relative}/*.svg  ->  public/artwork/${paper}/  (${count} files)`);
}

writeFileSync(
  join(DEST, "sync-manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
  "utf8",
);

if (manifest.banks.length === 0) fail("no question banks were copied");
if (manifest.signSvgCount === 0) fail("no sign SVGs were copied");

console.log(
  `\n  synced ${manifest.banks.length} banks and ${manifest.knowledge.length} knowledge files from the extractor,` +
    `\n  ${manifest.signSvgCount} sign SVGs and a ${catalogue.signs.length}-sign catalogue from the SVG pipeline\n`,
);
