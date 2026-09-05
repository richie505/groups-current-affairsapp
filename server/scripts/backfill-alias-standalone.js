#!/usr/bin/env node
'use strict';

// Which aliases are specific enough that ONE mention carries the unit.
//
//   node server/scripts/backfill-alias-standalone.js [--dry-run]
//
// WHY THIS EXISTS AND WHY IT IS RE-RUNNABLE
//
// `ref_unit_aliases` is seeded by g2-syllabus.js and g1-prelims-syllabus.js,
// which own their rows and replace them. A hand-set column would be wiped by
// the next reseed and nobody would notice until precision quietly fell back.
// So the assignment lives here, as data, and is re-applied by running this.
//
// WHAT IT REPLACES
//
// The evidence filter in lib/relevance.js used to read "the alias contains a
// space" as proof of specificity. Audited on 5 Sep 2026 over 40 random tags
// (docs/audits/2026-09-05-paper-mapping/): precision 72.5%, and that clause
// accounted for seven of the eleven errors — `human rights` from a quote about
// an extradition, `good governance` on a SEBI framework, `stock exchange` from
// "New York Stock Exchange" in passing, `population density` on a highway land
// dispute, `renewable energy` on industrial parks, `artificial intelligence`
// on a robotic dog, `Legislative Assembly` on the place a fertiliser figure
// was read out.
//
// It failed the other way at the same time. 415 aliases have no space and so
// could never qualify, including UPSC, SEBI, IRDAI, NHRC, ASEAN, BRICS, SAARC,
// AMRUT and MGNREGA. A report on the BRICS Youth Ministers' Meeting carried no
// unit at all, because `BRICS` is one word.

const path = require('path');
const db = require(path.join(__dirname, '..', 'src', 'db'));

const DRY = process.argv.includes('--dry-run');

// ---------------------------------------------------------------------------
// A. Acronyms — taken from `strict`, not from a pattern.
// ---------------------------------------------------------------------------
//
// `strict` already means "match this case-sensitively", which is the flag a
// person sets on an acronym so it does not fire inside a lowercase word. It is
// hand-maintained and it agrees with a regex for all-caps tokens on 89 of 90
// rows — it also catches `5G` and `6G`, which a leading-letter pattern misses.
// Reusing it means the two flags cannot drift apart, and a new acronym added
// to the vocabulary arrives already standalone.
//
// MGNREGA is the one row `strict` misses; it is unambiguous and is added here
// rather than by changing what `strict` means.
//
// NOTE FOR ANYONE EDITING `strict` LATER: standalone is DERIVED from it for
// acronyms, so setting strict on an alias that is not specific enough to carry
// a unit alone will also make it standalone. If you need case-sensitive
// matching without that, add the alias to NEVER_STANDALONE below.
const EXTRA_ACRONYMS = ['MGNREGA'];

// CPI IS THE ONE ACRONYM LEFT OUT, AND THE COLLISION IS NOT HYPOTHETICAL.
//
// It is an alias of G2-P2-U2 as the Consumer Price Index. In this corpus eight
// articles contain `CPI` and at least four are the Communist Party of India —
// a CPI(M) statement on mayoral elections, a DYFI election, a Voter Protection
// Forum roundtable. Marking it standalone would file party politics under
// money and banking on one mention. It still qualifies through the headline or
// a second term.
const AMBIGUOUS_ACRONYMS = ['CPI'];

// ---------------------------------------------------------------------------
// B. Multi-word aliases — standalone by DEFAULT.
// ---------------------------------------------------------------------------
//
// THIS IS THE CORRECTION THE RE-SCORE FORCED, AND IT IS WORTH RECORDING.
//
// The first version of this script was an ALLOWLIST: about 120 named bodies,
// schemes, acts and places were marked standalone and every other multi-word
// alias was left false. Re-scored across the four editions, that took the
// published items from 30 blanks to 57 and halved the tag count, 378 to 178.
//
// The reason is that the space heuristic it replaced was mostly RIGHT. Of the
// 518 multi-word aliases, the overwhelming majority genuinely name their unit
// on sight — `73rd Amendment`, `Article 21`, `minimum support price`,
// `basic structure`, `balance of payments`, `olive ridley`, `sepoy mutiny`,
// `compensatory afforestation`, `model code of conduct`, `repo rate`. The
// audit found seven that do not. Seven is a blocklist, not a reason to
// re-derive the other five hundred.
//
// So the rule is inverted: a multi-word alias stands alone unless it is named
// below. That keeps the recall the space test had, adds the 92 acronyms it
// could never reach, and removes only what was measured to misfire.
//
// The list below is therefore the reviewable artefact — it is short, every
// entry can be argued about, and a wrong entry costs one alias rather than
// four hundred.

// C. The generic ones, which do NOT stand alone.
//
// Three families, and each was demonstrated rather than guessed:
//
//   1. The seven the audit caught firing on a single passing mention.
//   2. Courts, chambers, offices and procedural boilerplate — the VENUE or the
//      instrument, not the subject. Error 19 was `Legislative Assembly` as the
//      room a fertiliser figure was read out in; every beat cites a court or a
//      Bill's passage in the same way.
//   3. Freedom-movement names and demographic descriptors. Error 17 was
//      `Mahatma Gandhi, Subhas Chandra Bose` inside one quoted sentence about
//      the independence struggle.
//
// Plus a handful of macro-economic words so vague they attach to any story
// that mentions money, and `solar system`, which is an astronomy phrase
// wearing an energy alias.
const NOT_STANDALONE = [
  // 1 — measured misfires
  'human rights', 'good governance', 'stock exchange', 'population density',
  'renewable energy', 'artificial intelligence',
  // the third audit's additions, same family: `skill development` filed a
  // university award and a Blue Economy centre under national income, and
  // `drinking water` filed an education-equity op-ed under geography
  'skill development', 'drinking water',
  // 2 — venue, office, instrument
  'Legislative Assembly', 'Legislative Council', 'Lok Sabha', 'Rajya Sabha',
  'Supreme Court', 'High Court', 'Chief Justice', 'Constitution Bench',
  'constitutional bench', 'Question Hour', 'Select Committee', 'Council of Ministers',
  'President of India', 'Advocate General', 'Attorney General',
  'Assembly election', 'Assembly passed', 'Assembly session',
  'Bill passed', 'Bill was passed', 'Bills passed',
  // Curly apostrophe only — that is how the alias is stored, and the
  // blocklist is compared against the alias text rather than normalised text.
  'Governor’s assent', 'Presidential assent',
  'writ petition', 'joint statement', 'MoU signed', 'investment MoU',
  // 3 — names and descriptors that appear beside any subject
  'Mahatma Gandhi', 'Sardar Patel', 'Subhas Chandra Bose', 'Jawaharlal Nehru',
  'B.R. Ambedkar', 'Scheduled Caste', 'Scheduled Tribe', 'Backward Class',
  // 4 — too vague to place a story
  'economic growth', 'economic development', 'growth rate', 'developing economy',
  'research and development', 'research institute', 'Indian scientist', 'solar system',
];

// ---------------------------------------------------------------------------
// D. Weak terms — common nouns that name a domain but not a topic.
// ---------------------------------------------------------------------------
//
// A weak term still counts towards a tag when a strong term sits beside it,
// and still carries a unit outright from the headline. What it cannot do is be
// BOTH of the two distinct terms: the audits found `monsoon, census` filing a
// story about Adivasi employment under geography, and `lift irrigation, canal`
// filing a school-bus accident there as well.
//
// Chosen on corpus frequency rather than intuition — each of these appears in
// 1-5% of the 411 articles, and a term in that many separates nothing.
//
// Deliberately NOT weak, though just as frequent: Polavaram, Amaravati,
// Srisailam, Tirumala, delimitation, inflation, insurance, quantum, wildlife,
// conservation, dairy, tourism, reservation, tribunal, panchayat, coal. Each
// names a specific thing, and `wildlife` was right twice in the first audit.
const WEAK = [
  'Parliament', 'manufacturing', 'transport', 'regulator', 'monsoon', 'irrigation',
  'agriculture', 'census', 'port', 'railway', 'exports', 'imports', 'logistics',
  'atmosphere', 'soil', 'rainfall', 'corridor', 'canal',
  // the venue-or-name family, in its single-word form
  'Governor', 'Speaker', 'Ambedkar', 'mineral',
  // THE MULTI-WORD VENUE NAMES ARE DELIBERATELY *NOT* WEAK, AND THAT WAS
  // MEASURED RATHER THAN ASSUMED.
  //
  // Marking Supreme Court, High Court, Chief Justice, Lok Sabha, Rajya Sabha,
  // Legislative Assembly / Council and Council of Ministers weak looks right:
  // two of them together filed a CBSE grace-marks row under the judiciary. But
  // a court story usually names ONLY the court, so weakness took the genuine
  // ones with it — "SC lauds scrapped MGNREGA" and "Will strongly oppose FCRA
  // Bill in Parliament" both lost their correct tag, because every term they
  // had was a venue word.
  //
  // Measured over the pooled judged sample: weak gave 82.7% precision on 81
  // surviving tags; leaving them non-weak gave 83.9% on 93. Worse on precision
  // AND on recall, so the single-word forms above stay weak and the named
  // institutions do not. They remain barred from standing alone, which is what
  // stops one passing mention carrying a unit.
  // borderline, decided weak
  'summit', 'electricity', 'ecosystem', 'procurement', 'delta',
];

const lower = (xs) => new Set(xs.map((x) => x.toLowerCase()));
const blocked = lower(NOT_STANDALONE);
const weak = lower(WEAK);
const extra = lower(EXTRA_ACRONYMS);
const ambiguous = lower(AMBIGUOUS_ACRONYMS);

const rows = db.prepare('SELECT unit_code, alias, strict FROM ref_unit_aliases').all();

const decide = (r) => {
  const a = r.alias.toLowerCase();
  if (blocked.has(a) || ambiguous.has(a)) return 0;
  if (r.strict || extra.has(a)) return 1;
  // Multi-word by default; a single common word never carried a unit alone
  // and still does not.
  return a.includes(' ') ? 1 : 0;
};

const wanted = rows.map((r) => ({
  ...r,
  standalone: decide(r),
  weak: weak.has(r.alias.toLowerCase()) ? 1 : 0,
}));
const on = wanted.filter((r) => r.standalone);

// Anything named above that is not actually in the vocabulary is a typo in
// this file, and a silent no-op is how such a list rots.
const present = new Set(rows.map((r) => r.alias.toLowerCase()));
const missing = [...blocked, ...extra, ...ambiguous, ...weak].filter((a) => !present.has(a));

const weakRows = wanted.filter((r) => r.weak);
console.log(`aliases: ${rows.length}`);
console.log(`  standalone = 1 : ${on.length}`);
console.log(`  standalone = 0 : ${rows.length - on.length}`);
console.log(`  weak = 1       : ${weakRows.length}`);
if (missing.length) {
  console.log(`\n  ${missing.length} name(s) in this script match no alias — check for typos:`);
  for (const m of missing) console.log(`    ${m}`);
}

if (DRY) {
  console.log('\n--dry-run: nothing written.');
  process.exit(missing.length ? 1 : 0);
}

const update = db.prepare(
  'UPDATE ref_unit_aliases SET standalone = ?, weak = ? WHERE unit_code = ? AND alias = ?'
);
let changed = 0;
db.transaction(() => {
  for (const r of wanted) {
    const info = update.run(r.standalone, r.weak, r.unit_code, r.alias);
    if (info.changes) changed += 1;
  }
})();

console.log(`\nwrote ${changed} row(s).`);
console.log('Re-run this after any reseed of the syllabus vocabulary.');
process.exit(missing.length ? 1 : 0);
