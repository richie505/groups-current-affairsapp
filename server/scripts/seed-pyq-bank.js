#!/usr/bin/env node
'use strict';

// Seeds the PYQ layer from a hand-tagged bank in the appsc-group2-tutor skill.
//
//   node server/scripts/seed-pyq-bank.js --file <path to pyq-bank.md>
//   node server/scripts/seed-pyq-bank.js --file ... --dry-run
//
// WHY SEED FROM THE BANK RATHER THAN ONLY FROM THE PDFs
//
// The bank is already what the OCR pipeline is trying to become: 150 questions
// with the blueprint keyword and the format each one tests, tagged by a person
// against the real 2025 paper. For the one job this layer exists to do — "for
// this keyword, which formats has APPSC actually used?" — hand tagging is
// strictly better evidence than anything reconstructed from a scan.
//
// The OCR pipeline is still needed, for papers nobody has tagged yet. The two
// are complementary and are marked apart by `source`, so a distribution can
// always be traced to how it was obtained.
//
// WHAT THE BANK IS NOT
//
// Its Topic column is a gloss ("Andhra newspaper founders/dates"), not the
// question as printed. That is fine for counting formats and useless as a
// practice question, so every row is stored with `stem_kind = 'gloss'` and must
// never be served to a student as a question. Losing that distinction is the one
// way this seeder could do damage.

const fs = require('fs');
const path = require('path');
const db = require(path.join(__dirname, '..', 'src', 'db'));
const P = require(path.join(__dirname, '..', 'src', 'lib', 'pyq'));
const T = require(path.join(__dirname, '..', 'src', 'lib', 'topics'));

const args = process.argv.slice(2);
const fileFlag = args.indexOf('--file');
const dryRun = args.includes('--dry-run');
const file = fileFlag !== -1 ? args[fileFlag + 1] : null;

if (!file) {
  console.error('Usage: node server/scripts/seed-pyq-bank.js --file <pyq-bank.md> [--dry-run]');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// format label normalisation
// ---------------------------------------------------------------------------

// The bank uses richer labels than the eight canonical formats, including three
// hybrids. Mapping them down is a judgement, so it is written out explicitly
// rather than done with a fuzzy match:
//
//   'Negative multi-statement', 'Negative recall', 'Negative match'
//       -> negative_statement
//
// Negation wins over the structure it is applied to. That follows the style
// guide, which treats the negative form as its own category precisely because
// it is where marks are lost — and it means the multi_statement count is a
// count of POSITIVE multi-statement questions. The original label is preserved
// in `raw` so the collapse is never lost.
const FORMAT_MAP = new Map([
  ['direct recall', 'direct_recall'],
  ['direct recall (multi-select)', 'direct_recall'],
  ['list-matching', 'list_matching'],
  ['list matching', 'list_matching'],
  ['multi-statement correctness', 'multi_statement'],
  ['multi statement correctness', 'multi_statement'],
  ['assertion–reason', 'assertion_reason'],
  ['assertion-reason', 'assertion_reason'],
  ['negative statement', 'negative_statement'],
  ['negative multi-statement', 'negative_statement'],
  ['negative recall', 'negative_statement'],
  ['negative match', 'negative_statement'],
  ['chronological ordering', 'chronological'],
  ['statement-based', 'statement_based'],
  ['statement based', 'statement_based'],
  ['count-based', 'count_based'],
  ['count based', 'count_based'],
]);

function normaliseFormat(label) {
  const key = String(label || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return FORMAT_MAP.get(key) || null;
}

// ---------------------------------------------------------------------------
// parse
// ---------------------------------------------------------------------------

// Paper identity comes from the bank's own H1, so a second bank for a different
// paper lands as a different row rather than overwriting this one.
function parseHeader(text) {
  const h1 = /^#\s+(.+)$/m.exec(text);
  const title = h1 ? h1[1].trim() : 'PYQ bank';
  const year = (/(20\d{2})/.exec(title) || [])[1];
  const mains = /mains/i.test(title);
  const paperNo = (/paper\s*-?\s*([IVX0-9]+)/i.exec(title) || [])[1] || '';
  return {
    title,
    year: year ? Number(year) : null,
    stage: mains ? 'mains' : 'prelims',
    paper: paperNo ? `paper-${paperNo.toLowerCase()}` : 'paper-1',
  };
}

function parseRows(text) {
  const rows = [];
  let section = '';
  for (const line of text.split('\n')) {
    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2) {
      section = h2[1].trim();
      continue;
    }
    // | 1 | gloss | keyword, keyword | Format |
    const m = /^\|\s*(\d+)\s*\|(.+?)\|(.+?)\|(.+?)\|\s*$/.exec(line);
    if (!m) continue;
    const [, qNo, gloss, keywords, format] = m;
    rows.push({
      q_no: Number(qNo),
      section,
      gloss: gloss.trim(),
      // Keywords are comma-separated, and some carry a parenthetical note
      // saying which blueprint file they really live in — the bank's own point
      // that a keyword's home subject is not the paper section it appears in.
      keywords: keywords
        .split(',')
        .map((k) => k.replace(/\*\(.*?\)\*/g, '').replace(/[*_]/g, '').trim())
        .filter(Boolean),
      format_label: format.trim(),
      raw: line.trim(),
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const text = fs.readFileSync(file, 'utf8');
const header = parseHeader(text);
const rows = parseRows(text);

console.log(`Bank: ${header.title}`);
console.log(`Parsed ${rows.length} tagged question(s).\n`);

const unmapped = new Map();
for (const r of rows) {
  r.format = normaliseFormat(r.format_label);
  if (!r.format) unmapped.set(r.format_label, (unmapped.get(r.format_label) || 0) + 1);
}
if (unmapped.size) {
  console.log('! format labels with no mapping (stored as unknown, add them to FORMAT_MAP):');
  for (const [k, n] of unmapped) console.log(`    ${n}x ${k}`);
  console.log();
}

// Which of the bank's keywords exist in the seeded blueprint vocabulary. A
// mismatch here is worth seeing rather than silently tolerating: the two lists
// are supposed to be the same vocabulary, and where they differ one of them is
// wrong.
const refKeywords = new Set(
  db.prepare('SELECT keyword FROM ref_keywords').all().map((r) => r.keyword.toLowerCase())
);
const bankKeywords = new Map();
for (const r of rows) {
  for (const k of r.keywords) {
    const low = k.toLowerCase();
    if (!bankKeywords.has(low)) bankKeywords.set(low, { term: k, n: 0, known: refKeywords.has(low) });
    bankKeywords.get(low).n++;
  }
}
const known = [...bankKeywords.values()].filter((k) => k.known);
console.log(
  `Keywords used: ${bankKeywords.size} distinct; ${known.length} already in ref_keywords, ` +
  `${bankKeywords.size - known.length} new.`
);

const fmtCount = new Map();
for (const r of rows) fmtCount.set(r.format || 'unknown', (fmtCount.get(r.format || 'unknown') || 0) + 1);
console.log('\nFormat distribution in this paper:');
for (const [f, n] of [...fmtCount].sort((a, b) => b[1] - a[1])) {
  console.log(`   ${f.padEnd(20)} ${String(n).padStart(3)}  ${(n / rows.length * 100).toFixed(1)}%`);
}

if (dryRun) {
  console.log('\nDry run — nothing written.');
  process.exit(0);
}

// ---- write ----

const slug = `g2-${header.year}-${header.stage}-${header.paper}-bank`;

db.prepare(
  `INSERT INTO pyq_papers (slug, exam, stage, paper, year, source_file, pages, notes)
   VALUES (@slug, 'group2', @stage, @paper, @year, @source_file, NULL, @notes)
   ON CONFLICT(slug) DO UPDATE SET notes = excluded.notes`
).run({
  slug,
  stage: header.stage,
  paper: header.paper,
  year: header.year,
  source_file: path.basename(file),
  notes:
    'Hand-tagged bank from the appsc-group2-tutor skill. Stems are GLOSSES, not ' +
    'verbatim questions — usable as format and keyword evidence only, never as practice questions.',
});
const paperId = db.prepare('SELECT id FROM pyq_papers WHERE slug = ?').get(slug).id;

const insQ = db.prepare(
  `INSERT OR REPLACE INTO pyq_questions
     (paper_id, q_no, page, stem, stem_kind, source, options_json, answer, format,
      subject, ocr_confidence, needs_review, review_note, raw)
   VALUES (@paper_id, @q_no, NULL, @stem, 'gloss', 'bank', '[]', NULL, @format,
           @subject, NULL, 0, '', @raw)`
);
const insQK = db.prepare(
  'INSERT OR IGNORE INTO pyq_question_keywords (question_id, keyword) VALUES (?, ?)'
);
const insQT = db.prepare(
  'INSERT OR IGNORE INTO pyq_question_topics (question_id, topic_id, hits, matched) VALUES (?, ?, ?, ?)'
);

const aliases = T.loadAliases(db);
let stored = 0;
let kwRows = 0;
let topicRows = 0;

db.transaction(() => {
  for (const r of rows) {
    const info = insQ.run({
      paper_id: paperId,
      q_no: r.q_no,
      stem: r.gloss,
      format: r.format || 'unknown',
      subject: r.section,
      raw: `${r.raw}   [format label: ${r.format_label}]`,
    });
    const qid = info.lastInsertRowid;
    stored++;

    // The bank's own tags, kept verbatim. These are a person's judgement about
    // what the question tests and are better than re-deriving them from a gloss.
    for (const k of r.keywords) {
      insQK.run(qid, k);
      kwRows++;
    }

    // Topic linkage from the gloss plus the keywords. Weaker than for a full
    // item — a gloss is a handful of words — so this will match fewer topics
    // than the news items do, which is expected rather than a fault.
    for (const m of T.matchItem(
      { headline: r.gloss, notes_markdown: r.keywords.join(' ') },
      aliases
    )) {
      insQT.run(qid, m.topic_id, m.hits, m.matched);
      topicRows++;
    }
  }
})();

console.log(`\nStored ${stored} question(s), ${kwRows} keyword tag(s), ${topicRows} topic link(s).`);
console.log(`Paper slug: ${slug}`);
