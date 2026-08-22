#!/usr/bin/env node
'use strict';

// Seeds the hand-compiled Group-I Mains papers into the PYQ layer.
//
//   node server/scripts/seed-g1-pyq.js [--dry-run] [--tag-keywords]
//
// Source: content-pipeline/pyq/g1-mains-pyq-2017-2025.md — 2017, 2020, 2023 and
// 2025, five papers each, supplied by the user rather than extracted from a
// scan. That makes it the most trustworthy PYQ material in the repo, and worth
// seeding carefully.
//
// WHY GROUP-I QUESTIONS ARE STORED BUT NOT FORMAT-CLASSIFIED
//
// Group-I Mains is written, not ticked, so "which of the eight MCQ formats was
// this asked in" is a category error. Every row here is `format = 'descriptive'`,
// which `formatMix()` already excludes — so seeding 250 Mains questions cannot
// quietly shrink the observed share of any real MCQ format. What Group-I
// contributes instead is RECURRENCE: which topics keep coming back, and across
// how many papers.
//
// WHY ONE ROW PER QUESTION NUMBER, NOT PER ALTERNATIVE
//
// The papers offer internal choice — `1 (a) … OR (b) …` — and Paper I offers
// three essays per section. A candidate answers ONE of them, so the question
// slot is the unit that was actually asked. Counting (a) and (b) separately
// would double every Paper II–V topic count against Paper I, and inflate
// recurrence for topics that merely happened to share a slot with another.
//
// It also sidesteps `UNIQUE (paper_id, q_no)`: three Paper I bullets all
// numbered 1 would otherwise overwrite one another and the run would report
// success — the exact failure that collapsed the Group-II bank to ~150 rows.
// The stem keeps every alternative, so nothing is lost.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const db = require(path.join(__dirname, '..', 'src', 'db'));
const T = require(path.join(__dirname, '..', 'src', 'lib', 'topics'));
const P = require(path.join(__dirname, '..', 'src', 'lib', 'pyq'));

const SOURCE = path.join(ROOT, 'content-pipeline', 'pyq', 'g1-mains-pyq-2017-2025.md');

const args = {
  dryRun: process.argv.includes('--dry-run'),
  // OFF by default. Blueprint angles are a Group-II MCQ vocabulary, and tagging
  // 250 descriptive questions with them raises `pyq_count` for those keywords —
  // which is an input to the Section 2 relevance score. That may well be right
  // (an angle APPSC asks in Mains is still an angle APPSC asks), but it changes
  // what every future article scores, so it is a decision rather than a default.
  tagKeywords: process.argv.includes('--tag-keywords'),
};

// ---------------------------------------------------------------------------
// parse
// ---------------------------------------------------------------------------

// `## 2025 — Paper II: History, Culture and Geography of India and Andhra Pradesh`
const PAPER_RE = /^##\s+(\d{4})\s+—\s+Paper\s+([IVX]+):\s*(.+?)\s*$/;
const SECTION_RE = /^###\s+(.+?)\s*$/;
// `- 1 (a). text …` and `- 1. text …`
const QUESTION_RE = /^-\s+(\d+)\s*(?:\(([a-c])\))?\.\s*(.+)$/;
// 2017 Paper V's comprehension section, which is passages rather than bullets.
const PASSAGE_RE = /^\*\*Passage\s+(\d+):\s*(.+?)\*\*\s*$/;

const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5 };

function parse(text) {
  const lines = text.split(/\r?\n/);
  const papers = [];
  let paper = null;
  let section = '';
  let passage = null;
  // Everything before the first year heading is the file's own how-to preamble.
  let started = false;

  const slotFor = (no) => {
    let s = paper.slots.find((x) => x.q_no === no);
    if (!s) {
      s = { q_no: no, section, parts: [] };
      paper.slots.push(s);
    }
    return s;
  };

  for (const raw of lines) {
    const line = raw.trim();

    const pm = raw.match(PAPER_RE);
    if (pm) {
      started = true;
      passage = null;
      section = '';
      paper = {
        year: Number(pm[1]),
        paperNo: ROMAN[pm[2]],
        roman: pm[2],
        title: pm[3],
        slots: [],
      };
      papers.push(paper);
      continue;
    }
    if (!started || !paper) continue;

    const sm = raw.match(SECTION_RE);
    if (sm) {
      section = sm[1];
      passage = null;
      continue;
    }

    const qm = raw.match(QUESTION_RE);
    if (qm) {
      passage = null;
      const slot = slotFor(Number(qm[1]));
      slot.parts.push(qm[2] ? `(${qm[2]}) ${qm[3]}` : qm[3]);
      continue;
    }

    const pgm = line.match(PASSAGE_RE);
    if (pgm) {
      passage = slotFor(Number(pgm[1]));
      passage.parts.push(`Passage: ${pgm[2]}`);
      continue;
    }

    // A numbered sub-question under an open passage.
    if (passage && /^\d+\.\s+/.test(line)) {
      passage.parts.push(line);
    }
  }

  return papers;
}

const papers = parse(fs.readFileSync(SOURCE, 'utf8'));

if (!papers.length) {
  console.error(`Parsed no papers from ${SOURCE}. The headings may have changed shape.`);
  process.exit(1);
}

// The file is four years of five papers. Anything else means the parser lost a
// heading, and a short seed that reports success is the failure mode this whole
// layer keeps meeting — so it is asserted rather than hoped for.
const EXPECTED_PAPERS = 20;
if (papers.length !== EXPECTED_PAPERS) {
  console.error(
    `Parsed ${papers.length} papers, expected ${EXPECTED_PAPERS}. ` +
      `Found: ${papers.map((p) => `${p.year}-P${p.paperNo}`).join(', ')}`
  );
  process.exit(1);
}

const emptySlots = papers.filter((p) => !p.slots.length);
if (emptySlots.length) {
  console.error(
    `These papers parsed with no questions: ${emptySlots
      .map((p) => `${p.year}-P${p.paperNo}`)
      .join(', ')}`
  );
  process.exit(1);
}

console.log(`Parsed ${papers.length} papers from ${path.basename(SOURCE)}:\n`);
for (const p of papers) {
  const parts = p.slots.reduce((n, s) => n + s.parts.length, 0);
  console.log(
    `  ${p.year} Paper ${p.roman.padEnd(3)} ${String(p.slots.length).padStart(2)} slot(s), ` +
      `${String(parts).padStart(3)} alternative(s) — ${p.title.slice(0, 46)}`
  );
}
const totalSlots = papers.reduce((n, p) => n + p.slots.length, 0);
const totalParts = papers.reduce((n, p) => n + p.slots.reduce((m, s) => m + s.parts.length, 0), 0);
console.log(`\n  TOTAL ${totalSlots} question slot(s), ${totalParts} alternative(s).`);

if (args.dryRun) {
  const sample = papers[0].slots[0];
  console.log('\nDRY RUN — nothing written. Sample slot:');
  console.log(JSON.stringify(sample, null, 2).slice(0, 700));
  process.exit(0);
}

// ---------------------------------------------------------------------------
// seed
// ---------------------------------------------------------------------------

const insPaper = db.prepare(
  `INSERT INTO pyq_papers (slug, exam, stage, paper, year, source_file, notes)
   VALUES (?, 'group1', 'mains', ?, ?, ?, ?)`
);
const insQ = db.prepare(
  `INSERT INTO pyq_questions (paper_id, q_no, stem, format, subject, stem_kind, source, raw)
   VALUES (?, ?, ?, 'descriptive', ?, 'verbatim', 'hand-compiled', ?)`
);
const insQK = db.prepare(
  'INSERT OR IGNORE INTO pyq_question_keywords (question_id, keyword) VALUES (?, ?)'
);
const insQT = db.prepare(
  'INSERT OR IGNORE INTO pyq_question_topics (question_id, topic_id, hits, matched) VALUES (?, ?, ?, ?)'
);

const aliases = T.loadAliases(db);
const keywords = args.tagKeywords ? P.loadKeywords(db) : [];

let stored = 0;
let topicRows = 0;
let kwRows = 0;

db.transaction(() => {
  // Re-runnable: this seeder owns exactly the slugs it creates, so it clears
  // them rather than merging. A merge would leave rows from a previous parse
  // that the current parser no longer produces, with nothing to reveal them.
  const prior = db
    .prepare("SELECT id, slug FROM pyq_papers WHERE exam = 'group1' AND slug LIKE 'g1-mains-%'")
    .all();
  if (prior.length) {
    console.log(`\nReplacing ${prior.length} previously seeded Group-I paper(s).`);
    db.prepare("DELETE FROM pyq_papers WHERE exam = 'group1' AND slug LIKE 'g1-mains-%'").run();
  }

  for (const p of papers) {
    const slug = `g1-mains-${p.year}-paper-${p.paperNo}`;
    const info = insPaper.run(
      slug,
      `paper-${p.paperNo}`,
      p.year,
      path.basename(SOURCE),
      // The 2017 restructuring, recorded on every row it affects rather than
      // only in the source file's header. Paper NUMBERS are not comparable
      // across 2017/2020 — 2017 Paper III is Indian Economy, the modern Paper
      // III is Polity and Ethics — so anything ranking by paper must read this.
      p.year <= 2017
        ? `PRE-2020 SYLLABUS. "${p.title}". Paper numbers do not map to 2020+ papers.`
        : p.title
    );
    const paperId = info.lastInsertRowid;

    for (const slot of p.slots) {
      const stem = slot.parts.join('  OR  ');
      const qid = insQ.run(paperId, slot.q_no, stem, slot.section, stem).lastInsertRowid;
      stored += 1;

      // A Mains stem is a paragraph about its topic, not a passing mention, so
      // it is matched as a headline. The "body-only match needs two hits" rule
      // exists for news items brushing past a phrase; it does not apply here.
      for (const m of T.matchItem({ headline: stem }, aliases)) {
        insQT.run(qid, m.topic_id, m.hits, m.matched);
        topicRows += 1;
      }

      if (args.tagKeywords) {
        for (const k of P.tagKeywords(stem, keywords)) {
          insQK.run(qid, k.term);
          kwRows += 1;
        }
      }
    }
  }
})();

// Every slot parsed must reach the database. Anything short means rows collided
// on (paper_id, q_no) and overwrote each other — which is precisely what the
// one-row-per-slot rule exists to prevent, so it is checked, not assumed.
if (stored !== totalSlots) {
  console.error(`\nFAILED: parsed ${totalSlots} slots but stored ${stored}. Rows collided.`);
  process.exit(1);
}

console.log(
  `\nStored ${stored} question slot(s) across ${papers.length} paper(s), ` +
    `${topicRows} topic link(s)${args.tagKeywords ? `, ${kwRows} keyword tag(s)` : ''}.`
);
if (!args.tagKeywords) {
  console.log('Keyword tagging skipped (pass --tag-keywords to enable; it shifts relevance scores).');
}

// ---------------------------------------------------------------------------
// what it bought
// ---------------------------------------------------------------------------

const top = db
  .prepare(
    `SELECT t.name, t.tier,
            COUNT(DISTINCT qt.question_id) AS questions,
            COUNT(DISTINCT p.year)         AS years,
            COUNT(DISTINCT p.paper)        AS papers,
            GROUP_CONCAT(DISTINCT p.year)  AS year_list
       FROM topics t
       JOIN pyq_question_topics qt ON qt.topic_id = t.id
       JOIN pyq_questions q        ON q.id = qt.question_id
       JOIN pyq_papers p           ON p.id = q.paper_id
      WHERE p.exam = 'group1'
      GROUP BY t.id
      ORDER BY papers DESC, questions DESC
      LIMIT 15`
  )
  .all();

if (top.length) {
  console.log('\nMost-recurring Group-I topics, measured from the real papers:\n');
  console.log('  questions  papers  years  tier  topic');
  for (const r of top) {
    console.log(
      `  ${String(r.questions).padStart(9)}  ${String(r.papers).padStart(6)}  ` +
        `${String(r.years).padStart(5)}  ${String(r.tier ?? '-').padStart(4)}  ` +
        `${r.name}  (${r.year_list})`
    );
  }
  console.log(
    '\nThis is the cross-paper reuse map as a measurement rather than a document.'
  );
} else {
  console.log('\nNo topic matched any question — check that seed-topics.js has been run.');
}
