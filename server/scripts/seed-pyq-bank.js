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
  if (FORMAT_MAP.has(key)) return FORMAT_MAP.get(key);
  // A trailing parenthetical annotates the same format rather than naming a
  // different one — "Multi-statement correctness (list I-VI)" is a
  // multi-statement question that happens to carry six statements. Stripping it
  // and retrying handles the whole family instead of one spelling at a time.
  const bare = key.replace(/\s*\([^)]*\)\s*$/, '');
  return FORMAT_MAP.get(bare) || null;
}

// ---------------------------------------------------------------------------
// parse
// ---------------------------------------------------------------------------

// A bank file holds MORE THAN ONE PAPER. The first version of this seeder took
// its identity from the H1 alone, which was true of the 150-question bank it was
// written against and false of the 1,127-question one that replaced it. Reading
// the larger file with the old parser would have put all eight papers under a
// single paper_id, where UNIQUE (paper_id, q_no) plus INSERT OR REPLACE means Q1
// of each paper overwrites the last — 1,127 rows collapsing to about 150,
// silently, and looking like a successful seed.
//
// So papers are split out here. Structure of the file:
//
//   # PYQ Bank — ... Paper I, 2025     <- H1: the first paper
//   ## Section A: ...                  <- a SUBSECTION of it
//   ## Duplicate uploads — not appended  <- prose; must not become a paper
//   ## Section: APPSC Group II Screening Test ...   <- a NEW paper
//   *Source: `SomePaper.pdf`*          <- ties the paper to the scanned PDF
//   ### Section A: Indian History      <- a subsection again
//
// The distinguishing mark of a paper heading is the colon straight after
// "Section", which the subsection headings ("Section A:") do not have.
const PAPER_HEAD = /^##\s+Section:\s*(.+)$/;
const IGNORE_HEAD = /^##\s+Duplicate/i;
const SOURCE_LINE = /^\*Source:\s*`([^`]+)`/;
const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5 };

// Two headings can describe one paper — 2018 Mains Paper I arrives as "AP
// History (Q1-75)" and "Indian Polity & Governance (Q76-150)" — so identity is
// derived and rows are grouped by it rather than by heading.
function identity(title) {
  const year = (/(20\d{2})/.exec(title) || [])[1];
  const mains = /mains/i.test(title);
  const raw = ((/paper\s*[-–]?\s*([IVXivx]+|\d+)/i.exec(title) || [])[1] || '').toLowerCase();
  const num = ROMAN[raw] || (/^\d+$/.test(raw) ? Number(raw) : null);
  return {
    year: year ? Number(year) : null,
    stage: mains ? 'mains' : 'prelims',
    // Roman numerals are normalised to digits, and a screening paper is called
    // 'screening' — both so these slugs line up with the ones the OCR pipeline
    // uses in content-pipeline/pyq/extract.js for the very same papers.
    paper: mains ? `paper-${num || 1}` : 'screening',
  };
}

function parseRow(line, section) {
  // | 1 | gloss | keyword, keyword | Format |
  const m = /^\|\s*(\d+)\s*\|(.+?)\|(.+?)\|(.+?)\|\s*$/.exec(line);
  if (!m) return null;
  const [, qNo, gloss, keywords, format] = m;
  return {
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
  };
}

function parsePapers(text) {
  const blocks = [];
  let cur = null;
  let section = '';
  let ignoring = false;

  for (const line of text.split('\n')) {
    const h1 = /^#\s+([^#].*)$/.exec(line);
    const paperHead = PAPER_HEAD.exec(line);
    const h2 = /^##\s+([^#].*)$/.exec(line);
    const h3 = /^###\s+(.+)$/.exec(line);

    if (paperHead) {
      cur = { title: paperHead[1].trim(), sourceFile: '', rows: [] };
      blocks.push(cur);
      section = '';
      ignoring = false;
      continue;
    }
    if (h1 && !h2) {
      cur = { title: h1[1].trim(), sourceFile: '', rows: [] };
      blocks.push(cur);
      section = '';
      ignoring = false;
      continue;
    }
    if (h2) {
      ignoring = IGNORE_HEAD.test(line);
      if (!ignoring) section = h2[1].trim();
      continue;
    }
    if (h3) {
      section = h3[1].trim();
      continue;
    }

    const src = SOURCE_LINE.exec(line.trim());
    if (src && cur && !cur.sourceFile) cur.sourceFile = src[1];

    if (ignoring || !cur) continue;
    const row = parseRow(line, section);
    if (row) cur.rows.push(row);
  }

  // Group the blocks into papers by derived identity.
  const papers = new Map();
  for (const b of blocks) {
    const id = identity(b.title);
    const slug = `g2-${id.year}-${id.stage}-${id.paper}-bank`;
    if (!papers.has(slug)) {
      papers.set(slug, { slug, ...id, titles: [], sourceFiles: [], rows: [] });
    }
    const p = papers.get(slug);
    p.titles.push(b.title);
    if (b.sourceFile && !p.sourceFiles.includes(b.sourceFile)) p.sourceFiles.push(b.sourceFile);
    p.rows.push(...b.rows);
  }
  return [...papers.values()].filter((p) => p.rows.length);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const text = fs.readFileSync(file, 'utf8');
const papers = parsePapers(text);
const rows = papers.flatMap((p) => p.rows);

if (!papers.length) {
  console.error('No tagged rows found. Is this a PYQ bank file?');
  process.exit(1);
}

console.log(`Parsed ${rows.length} tagged question(s) across ${papers.length} paper(s):\n`);
for (const p of papers) {
  const nos = p.rows.map((r) => r.q_no);
  const dupes = [...new Set(nos.filter((n, i) => nos.indexOf(n) !== i))];
  console.log(
    `   ${p.slug.padEnd(32)} ${String(p.rows.length).padStart(4)} rows  ` +
    `q${Math.min(...nos)}-${Math.max(...nos)}` +
    (p.sourceFiles.length ? `  <- ${p.sourceFiles.join(', ')}` : '')
  );
  for (const t of p.titles) console.log(`       ${t}`);
  // Two rows sharing a q_no within one paper would silently overwrite each
  // other on write, so it is reported rather than discovered later as a
  // shortfall in the counts.
  if (dupes.length) console.log(`       !! duplicate q_no, one of each pair will be lost: ${dupes.join(', ')}`);
}
console.log();

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
console.log('\nFormat distribution across the whole bank:');
for (const [f, n] of [...fmtCount].sort((a, b) => b[1] - a[1])) {
  console.log(`   ${f.padEnd(20)} ${String(n).padStart(4)}  ${(n / rows.length * 100).toFixed(1)}%`);
}

if (dryRun) {
  console.log('\nDry run — nothing written.');
  process.exit(0);
}

// ---- write ----

const upsertPaper = db.prepare(
  `INSERT INTO pyq_papers (slug, exam, stage, paper, year, source_file, pages, notes)
   VALUES (@slug, 'group2', @stage, @paper, @year, @source_file, NULL, @notes)
   ON CONFLICT(slug) DO UPDATE SET
     source_file = excluded.source_file, notes = excluded.notes`
);

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

// Bank papers are rebuilt wholesale rather than merged into. A re-seed from a
// corrected or extended bank must be able to REMOVE a row, and an upsert alone
// never can — the same trap that made bad topic aliases un-deletable until the
// topic seeder learned to prune. The delete is confined to '%-bank' slugs so
// that questions extracted from the scanned PDFs, which live under their own
// slugs and carry source='extracted', are never touched.
const priorBank = db.prepare("SELECT id, slug FROM pyq_papers WHERE slug LIKE '%-bank'").all();

db.transaction(() => {
  if (priorBank.length) {
    db.prepare("DELETE FROM pyq_papers WHERE slug LIKE '%-bank'").run();
    console.log(
      `Replaced ${priorBank.length} existing bank paper(s): ${priorBank.map((p) => p.slug).join(', ')}`
    );
  }

  for (const p of papers) {
    upsertPaper.run({
      slug: p.slug,
      stage: p.stage,
      paper: p.paper,
      year: p.year,
      // The PDF the tagging was done from, where the bank names one, so a row
      // can be traced back to a scan. Falls back to the bank file itself.
      source_file: p.sourceFiles[0] || path.basename(file),
      notes:
        `Hand-tagged bank (${path.basename(file)}): ${p.titles.join(' + ')}. ` +
        'Stems are GLOSSES, not verbatim questions — usable as format and keyword ' +
        'evidence only, never as practice questions.',
    });
    const paperId = db.prepare('SELECT id FROM pyq_papers WHERE slug = ?').get(p.slug).id;

    for (const r of p.rows) {
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
  }
})();

console.log(`\nStored ${stored} question(s), ${kwRows} keyword tag(s), ${topicRows} topic link(s).`);
console.log(`Across ${papers.length} paper(s): ${papers.map((p) => p.slug).join(', ')}`);

// Every row parsed must reach the database. Anything short means rows collided
// on (paper_id, q_no) and overwrote each other, which is exactly the failure
// the multi-paper split exists to prevent, so it is checked rather than assumed.
if (stored !== rows.length) {
  console.error(`\n! Parsed ${rows.length} rows but stored ${stored}. Rows were lost to a collision.`);
  process.exit(1);
}
