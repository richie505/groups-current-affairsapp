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
// B. Named bodies, schemes, acts, events and places.
// ---------------------------------------------------------------------------
//
// A named thing carries its unit on one mention: an article that says
// "NITI Aayog" or "Forest Rights Act" or "Quit India" is about that thing.
const NAMED = [
  // bodies and institutions
  'Archaeological Survey', 'Competition Commission', 'Comptroller and Auditor General',
  'Election Commission', 'Finance Commission', 'Finance Commission grant', 'Finance Ministry',
  'Human Rights Commission', 'Lok Ayukta', 'Ministry of External Affairs',
  'National Commission for Women', 'National Green Tribunal', 'NITI Aayog',
  'Pollution Control Board', 'Public Service Commission', 'Reserve Bank', 'United Nations',
  'World Bank', 'World Health Organization', 'Mandal Parishad', 'Mandal Praja Parishad',
  'Zilla Parishad', 'Zilla Praja Parishad', 'Panchayati Raj', 'Constituent Assembly',
  // schemes, policies, acts, agreements
  'Bharat Stage', 'Digital India', 'Five Year Plan', 'Forest Rights Act',
  'Human Development Index', 'Make in India', 'National Education Policy', 'Paris Agreement',
  'Project Elephant', 'Project Tiger', 'Reorganisation Act', 'Reorganization Act',
  'Right to Education', 'Right to Information', 'Union Budget', 'Wildlife Protection Act',
  // constitutional furniture
  'Directive Principle', 'Fundamental Duties', 'Fundamental Right', 'State List',
  'Tenth Schedule', 'Union List',
  // history and the Andhra movement
  'Alluri Sitarama Raju', 'Andhra Chola', 'Andhra Mahasabha', 'Andhra Patrika', 'Andhra State',
  'Arya Samaj', 'Ashok Mehta', 'Badami Chalukya', 'Balwant Rai Mehta', 'Battle of Plassey',
  'Brahmo Samaj', 'Civil Disobedience', 'Delhi Sultanate', 'East India Company',
  'Eastern Chalukya', 'Fazal Ali', 'Gandhi Jayanti', "Gentlemen's Agreement",
  'Gentlemen’s Agreement', 'Home Rule', 'Indian National Congress', 'Indus Valley',
  'Jai Andhra', 'Justice Party', 'Kalyani Chalukya', 'Library Movement', 'Nataka Samstha',
  'Potti Sriramulu', 'Quit India', 'Qutb Shahi', 'Self-Respect Movement',
  'States Reorganisation', 'States Reorganisation Commission', 'Taj Mahal', 'Tipu Sultan',
  // geography
  'Eastern Ghats', 'El Nino', 'La Nina', 'Western Ghats',
  // one truncated-looking alias kept because it is unambiguous in this corpus
  'AP Industrial',
];

// ---------------------------------------------------------------------------
// C. Left false on purpose.
// ---------------------------------------------------------------------------
//
// These are the VENUE or the AUTHORITY, not the subject. Every beat cites a
// court, a chamber or a founding figure in passing, and two of the eleven
// audit errors were exactly this shape: `Mahatma Gandhi, Subhas Chandra Bose`
// inside one quoted sentence about the freedom struggle, and
// `Legislative Assembly` as the place a fertiliser stock figure was read out.
//
// Recorded rather than merely omitted, so the decision is visible and can be
// reversed with evidence. Measured cost: audit tag 38 (`High Court`, one body
// mention, judged correct) is lost, because its article headline is "Noise
// annoys India must enforce noise pollution regulations…" and so cannot rescue
// it through the headline clause. One good tag for two bad ones.
const NEVER_STANDALONE = [
  'Supreme Court', 'High Court', 'Chief Justice', 'Constitution Bench',
  'Lok Sabha', 'Rajya Sabha', 'Legislative Council', 'Legislative Assembly',
  'Question Hour', 'Select Committee', 'Council of Ministers', 'President of India',
  'Advocate General', 'Attorney General',
  'Mahatma Gandhi', 'Sardar Patel', 'Subhas Chandra Bose', 'Jawaharlal Nehru', 'B.R. Ambedkar',
  'Scheduled Caste', 'Scheduled Tribe', 'Backward Class',
  // the seven the audit caught firing on one passing mention
  'human rights', 'good governance', 'stock exchange', 'population density',
  'renewable energy', 'artificial intelligence',
];

const lower = (xs) => new Set(xs.map((x) => x.toLowerCase()));
const named = lower(NAMED);
const never = lower(NEVER_STANDALONE);
const extra = lower(EXTRA_ACRONYMS);
const ambiguous = lower(AMBIGUOUS_ACRONYMS);

const rows = db.prepare('SELECT unit_code, alias, strict FROM ref_unit_aliases').all();

const decide = (r) => {
  const a = r.alias.toLowerCase();
  if (never.has(a)) return 0;
  if (ambiguous.has(a)) return 0;
  if (r.strict) return 1;
  if (extra.has(a)) return 1;
  if (named.has(a)) return 1;
  return 0;
};

const wanted = rows.map((r) => ({ ...r, standalone: decide(r) }));
const on = wanted.filter((r) => r.standalone);

// Anything named above that is not actually in the vocabulary is a typo in
// this file, and a silent no-op is how such a list rots.
const present = new Set(rows.map((r) => r.alias.toLowerCase()));
const missing = [...named, ...never, ...extra, ...ambiguous].filter((a) => !present.has(a));

console.log(`aliases: ${rows.length}`);
console.log(`  standalone = 1 : ${on.length}`);
console.log(`  standalone = 0 : ${rows.length - on.length}`);
if (missing.length) {
  console.log(`\n  ${missing.length} name(s) in this script match no alias — check for typos:`);
  for (const m of missing) console.log(`    ${m}`);
}

if (DRY) {
  console.log('\n--dry-run: nothing written.');
  process.exit(missing.length ? 1 : 0);
}

const update = db.prepare('UPDATE ref_unit_aliases SET standalone = ? WHERE unit_code = ? AND alias = ?');
let changed = 0;
db.transaction(() => {
  for (const r of wanted) {
    const info = update.run(r.standalone, r.unit_code, r.alias);
    if (info.changes) changed += 1;
  }
})();

console.log(`\nwrote ${changed} row(s).`);
console.log('Re-run this after any reseed of the syllabus vocabulary.');
process.exit(missing.length ? 1 : 0);
