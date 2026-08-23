#!/usr/bin/env node
'use strict';

// How well the syllabus map is covering what the paper actually prints.
//
//   node server/scripts/syllabus-coverage.js [--edition 1] [--min-score 45]
//
// WHY THIS IS A STANDING REPORT AND NOT A ONE-OFF TUNING JOB
//
// The map is a vocabulary, and a vocabulary is never finished. The syllabus is
// fixed — APPSC publishes it and it does not move — but the words a newspaper
// uses for it change every week: a new scheme name, a new commission, a project
// that everybody suddenly calls by its village.
//
// So the useful question is not "is the map complete" but "what did it miss
// TODAY", and the answer is a specific, short list: articles the scorer rated
// highly and the map matched to nothing. Each one is either
//
//   a genuine gap        — "Veligonda Phase-I" is an irrigation project and the
//                          map had 'irrigation project' but not the name, so add
//                          the term to server/scripts/g2-syllabus.js; or
//   the filter working   — "Cultural diversity highlight of gala dinner in
//                          Vizag" scored 70 on AP place names and instrument
//                          words and feeds nothing. That is the point.
//
// Only a person can tell those apart, which is why this prints them rather than
// deciding.

const path = require('path');
const db = require(path.join(__dirname, '..', 'src', 'db'));

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const minScore = Number(arg('min-score', 45));
const editionId = arg('edition', null);

const where = ["a.status NOT IN ('duplicate', 'discarded')", 'a.score >= ?'];
const params = [minScore];
if (editionId) {
  where.push('a.edition_id = ?');
  params.push(Number(editionId));
}

const rows = db
  .prepare(
    `SELECT a.id, a.score, a.headline, a.page, e.date,
            (SELECT GROUP_CONCAT(u.unit_code, ' ') FROM np_article_units u WHERE u.article_id = a.id) AS units
       FROM np_articles a JOIN np_editions e ON e.id = a.edition_id
      WHERE ${where.join(' AND ')}
      ORDER BY a.score DESC`
  )
  .all(...params);

const off = rows.filter((r) => !r.units);
const on = rows.filter((r) => r.units);

console.log(
  `${rows.length} article(s) scoring ${minScore} or more` +
    `${editionId ? ` in edition ${editionId}` : ''}: ` +
    `${on.length} map to a syllabus unit, ${off.length} map to none.`
);

// Which units the day actually fed, and — more usefully — which it did not.
// A unit nothing has ever fed is either genuinely out of season (the Satavahanas
// do not make the news often) or has a vocabulary that never fires.
const units = db
  .prepare(
    `SELECT r.unit_code, r.label, r.paper, r.exam, r.format,
            (SELECT COUNT(*) FROM np_article_units u WHERE u.unit_code = r.unit_code) AS n
       FROM ref_units r
      WHERE r.broad = 0 AND r.unfeedable = 0 AND EXISTS
            (SELECT 1 FROM ref_unit_aliases a WHERE a.unit_code = r.unit_code)
      ORDER BY r.exam, n DESC, r.unit_code`
  )
  .all();

// Grouped by exam, because the three papers are not interchangeable: two are
// answered by ticking a box and one is written, and the same article has to
// yield different material for each.
const EXAM_NAME = {
  g1: 'GROUP-I MAINS — written',
  g1p: 'GROUP-I PRELIMS — objective, 120 questions',
  g2: 'GROUP-II — objective, screening and mains',
};
let lastExam = null;
for (const u of units) {
  if (u.exam !== lastExam) {
    lastExam = u.exam;
    console.log(`\n${EXAM_NAME[u.exam] || u.exam}`);
  }
  const bar = '█'.repeat(Math.min(20, u.n)) || '·';
  console.log(`  ${String(u.n).padStart(3)} ${u.unit_code.padEnd(10)} ${bar}  ${u.label.slice(0, 44)}`);
}
// THE SAME QUESTION ASKED OF THE QUESTIONS.
//
// Which units the paper feeds is about the source. Which units a STUDENT can
// actually practise is about the bank, and the two are not the same number: an
// article can feed a unit and yield no question testing it.
//
// Three of the four papers are objective, so this is the coverage that matters
// most for the majority of what a candidate sits.
const questions = db
  .prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN TRIM(m.unit_code) <> '' THEN 1 ELSE 0 END) AS tagged,
            SUM(CASE WHEN m.status <> 'published' THEN 1 ELSE 0 END) AS pending,
            COUNT(DISTINCT NULLIF(TRIM(m.unit_code), '')) AS units
       FROM ca_mcqs m JOIN ca_items i ON i.id = m.item_id
      WHERE i.status <> 'discarded'`
  )
  .get();

console.log(
  `\nQUESTION BANK: ${questions.total} question(s), ${questions.tagged} tagged to a syllabus ` +
    `unit, covering ${questions.units} unit(s).`
);
if (questions.tagged < questions.total) {
  console.log(
    `  ${questions.total - questions.tagged} carry no unit. Either they were written before ` +
      'questions had one,\n  or the item they belong to feeds no objective unit — the second is ' +
      'a finding, not a gap.\n  Re-tag the first kind with:\n' +
      '    node server/scripts/requestion-items.js --dry-run'
  );
}
// COUNTED SEPARATELY, BECAUSE A QUESTION NOBODY HAS APPROVED IS NOT COVERAGE.
//
// The totals above answer "what has been written". This answers "what can a
// student actually practise", and conflating the two is how a bank reports
// itself complete while the material is still sitting in a queue.
if (questions.pending) {
  console.log(
    `  ${questions.pending} of those are NOT visible to students — they are on published items\n` +
      '  and are waiting on review in Admin → Review queue.'
  );
}
const perUnit = db
  .prepare(
    `SELECT m.unit_code, COUNT(*) AS n FROM ca_mcqs m JOIN ca_items i ON i.id = m.item_id
      WHERE i.status <> 'discarded' AND TRIM(m.unit_code) <> ''
      GROUP BY m.unit_code ORDER BY n DESC`
  )
  .all();
for (const q of perUnit.slice(0, 12)) {
  console.log(`  ${String(q.n).padStart(3)} ${q.unit_code}`);
}

// THE OPPOSITE FAILURE TO A COLD UNIT.
//
// A unit nothing feeds is visible and obviously a gap. A unit that everything
// feeds is invisible and worse: it looks like excellent coverage right up until
// someone asks "show me the items for this unit" and gets a third of the
// corpus. That already happened once in this repo — a generic judiciary topic
// put P3-U7 on 77% of items, and seven unrelated stories ended up with an
// identical twelve-unit set.
//
// The number that catches it is not the count, it is how far the top unit sits
// above the rest, and how much of it rests on a SINGLE weak term. An article
// matched on "Supreme Court" alone is a story that happened to be decided in a
// court; an article matched on "judicial review" is a story about the judiciary.
// The first is where a runaway unit comes from.
// Sorted afresh rather than taking units[0]: the listing above is ordered by
// exam first so that each paper prints as its own block, which means its head
// is the top unit of whichever exam happens to sort first, not the top unit
// overall. Reading position for rank there reported 19 as the maximum while a
// unit sat at 49.
const top = units.filter((u) => u.n > 0).sort((a, b) => b.n - a.n)[0];
const median = (() => {
  const fed = units.filter((u) => u.n > 0).map((u) => u.n).sort((a, b) => a - b);
  return fed.length ? fed[Math.floor(fed.length / 2)] : 0;
})();
if (top && median && top.n >= 3 * median) {
  const evidence = db
    .prepare(
      `SELECT matched FROM np_article_units WHERE unit_code = ?`
    )
    .all(top.unit_code);
  const single = evidence.filter((e) => String(e.matched || '').split(',').length === 1).length;
  console.log(
    `\nCONCENTRATION: ${top.unit_code} is fed by ${top.n} article(s), against a median of ` +
      `${median}.`
  );
  console.log(
    `  ${single} of those rest on a single matched term. A unit that matches a third of the\n` +
      '  paper cannot answer "which items feed it", which is the only question it exists to\n' +
      '  answer. If most of the single-term matches are one generic word, that word belongs\n' +
      '  in server/scripts/g2-syllabus.js as a removal, not as an alias.'
  );
}

const cold = units.filter((u) => !u.n);
if (cold.length) {
  console.log(
    `\n${cold.length} unit(s) have never been fed: ${cold.map((u) => u.unit_code).join(', ')}.`
  );
  console.log(
    '  Some of those are seasonal and some are a vocabulary that never fires. The AP history\n' +
      '  units are genuinely rare in a daily paper; an economy unit at zero is a gap.'
  );
}

console.log(`\nSCORED HIGH, MATCHED NOTHING — ${off.length} to judge:`);
if (!off.length) console.log('  (none)');
for (const r of off.slice(0, 30)) {
  console.log(`  ${String(Math.round(r.score)).padStart(3)}  ${r.date} p${r.page}  ${r.headline.slice(0, 66)}`);
}
if (off.length > 30) console.log(`  … and ${off.length - 30} more.`);

console.log(
  '\nFor each: add the missing term to server/scripts/g2-syllabus.js and re-seed, or leave it\n' +
    'alone because it genuinely feeds nothing. Re-seed and re-score with:\n' +
    '  node server/scripts/seed-g2-syllabus.js\n' +
    '  node server/scripts/process-edition.js <editionId>'
);
