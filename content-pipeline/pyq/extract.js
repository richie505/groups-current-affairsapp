#!/usr/bin/env node
'use strict';

// PYQ paper -> structured questions in the database.
//
//   node content-pipeline/pyq/extract.js --list
//   node content-pipeline/pyq/extract.js --paper g2-2023-screening --pages 5-8 --dry-run
//   node content-pipeline/pyq/extract.js --paper g2-2023-screening
//   node content-pipeline/pyq/extract.js --all
//
// FOUR STAGES
//
//   1. OCR        layout.py --force-ocr, reusing the newspaper lane's extractor.
//   2. FILTER     keep the English, drop the Telugu soup. No model.
//   3. STRUCTURE  one model call per page: scattered OCR lines -> questions.
//   4. CLASSIFY   format, keywords and topics, deterministically. No model.
//
// WHY OCR RATHER THAN THE TEXT LAYER
//
// These PDFs already carry a text layer, and it is bad: somebody else's OCR,
// baked in. On a 2023 question it rendered "Whieh one of the lbllowing books was
// lvritten by Harshavardhana" and — decisively — DROPPED the word "not", which
// inverts the question. Re-OCR at 300 DPI returned "Which one of the following
// books was not written by Harshavardhana ?" at 95% confidence.
//
// A PYQ bank storing the opposite of what was asked would be worse than having
// no bank, so the text layer is ignored on purpose.
//
// WHY A MODEL FOR STAGE 3 ONLY
//
// The pages are bilingual, and the two languages interleave, so English lines
// arrive out of order and split mid-sentence. Reassembling them is the one part
// of this that resisted rules. Unlike a news judgement it has a ground truth
// printed on the page, and the prompt is written to transcribe rather than
// interpret — above all, never to supply an answer key from memory.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { pythonBin, parseJsonStdout } = require(require('path').join(__dirname, '..', 'python-bin'));

const L = require(path.join(__dirname, '..', 'ca-daily', 'lib'));
const PYQ_DIR = process.env.PYQ_DIR ||
  path.join(L.ROOT, '..', '..', '..', 'pyqs');

L.loadEnv();

// ---------------------------------------------------------------------------
// the corpus
// ---------------------------------------------------------------------------

// Declared rather than inferred from filenames, because the filenames disagree
// with each other about naming ("AP-G2-2018-Mains-Paper-1" vs
// "GroupII-Mains-Paper-1-2025") and the exam/stage/year matters for every count.
const PAPERS = [
  { slug: 'g2-2016-screening', file: 'Group-II-Screening-Test-Not.No_.18-2016.pdf',
    exam: 'group2', stage: 'prelims', paper: 'screening', year: 2016,
    notes: 'No text layer at all; fully dependent on OCR.' },
  { slug: 'g2-2018-screening', file: 'AP-G2-2018-screening-test.pdf',
    exam: 'group2', stage: 'prelims', paper: 'screening', year: 2018 },
  { slug: 'g2-2018-mains-1', file: 'AP-G2-2018-Mains-Paper-1.pdf',
    exam: 'group2', stage: 'mains', paper: 'paper-1', year: 2018 },
  { slug: 'g2-2018-mains-2', file: 'AP-G2-2018-Mains-Paper-2.pdf',
    exam: 'group2', stage: 'mains', paper: 'paper-2', year: 2018 },
  { slug: 'g2-2018-mains-3', file: 'AP-G2-2018-Mains-Paper-3.pdf',
    exam: 'group2', stage: 'mains', paper: 'paper-3', year: 2018 },
  { slug: 'g2-2023-screening', file: 'Group-II_ScreeningTest_11_2023_FinalKey.pdf',
    exam: 'group2', stage: 'prelims', paper: 'screening', year: 2023,
    notes: 'Final key edition — may carry printed answers.' },
  { slug: 'g2-2025-mains-1', file: 'GroupII-Mains-Paper-1-2025.pdf',
    exam: 'group2', stage: 'mains', paper: 'paper-1', year: 2025 },
  { slug: 'g2-2025-mains-2', file: 'GroupII-Mains-Paper-II-2025.pdf',
    exam: 'group2', stage: 'mains', paper: 'paper-2', year: 2025 },
];

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const a = {
    paper: null, all: false, list: false, pages: null, dpi: 300,
    dryRun: false, limitPages: Infinity, fresh: false,
    model: process.env.OPENAI_MODEL || 'gpt-4o',
  };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--paper') a.paper = argv[++i];
    else if (k === '--all') a.all = true;
    else if (k === '--list') a.list = true;
    else if (k === '--pages') a.pages = argv[++i];
    else if (k === '--dpi') a.dpi = Number(argv[++i]);
    else if (k === '--dry-run') a.dryRun = true;
    else if (k === '--limit-pages') a.limitPages = Number(argv[++i]);
    else if (k === '--fresh') a.fresh = true;
    else if (k === '--model') a.model = argv[++i];
    else if (k === '--help' || k === '-h') a.help = true;
  }
  return a;
}

const args = parseArgs(process.argv);

if (args.help) {
  console.log(fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8'));
  process.exit(0);
}

if (args.list || (!args.paper && !args.all)) {
  console.log(`PYQ corpus (looking in ${PYQ_DIR}):\n`);
  for (const p of PAPERS) {
    const full = path.join(PYQ_DIR, p.file);
    const ok = fs.existsSync(full);
    console.log(
      `  ${ok ? ' ' : '!'} ${p.slug.padEnd(20)} ${String(p.year).padEnd(6)} ` +
      `${p.stage.padEnd(8)} ${ok ? '' : 'MISSING: '}${p.file}`
    );
  }
  if (!args.list) {
    console.log('\nPass --paper <slug> or --all. Add --dry-run to see what a page yields.');
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// stage 1-2: OCR, then keep the English
// ---------------------------------------------------------------------------

// Resolved, not assumed. See content-pipeline/python-bin.js.
const PYTHON = pythonBin();
const LAYOUT = path.join(L.ROOT, 'content-pipeline', 'np-daily', 'layout.py');

function ocrPages(pdf, { pages, dpi }) {
  const argv = [LAYOUT, pdf, '--force-ocr', '--dpi', String(dpi)];
  if (pages) argv.push('--pages', pages);
  const res = spawnSync(PYTHON, argv, {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`layout.py failed (${res.status}): ${(res.stderr || '').slice(0, 1200)}`);
  }
  return parseJsonStdout(res.stdout, { label: 'the PYQ extractor' });
}

// A run of characters that belongs to a real word or a real number. Single
// stray letters do not count, which is what separates text from OCR debris.
const TOKEN = /[A-Za-z]{2,}|[0-9]+/g;
const ALNUM = /[A-Za-z0-9]/g;

// How English a block looks — deliberately INDEPENDENT of how long it is.
//
// The previous score multiplied by min(words/4, 1), which made shortness look
// like foreignness and cost this pipeline its most valuable lines. Measured
// over 8 pages of three papers, every one of these was dropped while being
// perfectly legible English at 82-97% OCR confidence:
//
//   "(1) Chemistry (2) Mathematics"   the options of Q5, 2023 screening
//   "(4) Medicine"                    the remaining option of the same question
//   "(1) Finance Minister (2)"        option 1 of Q9 — and the correct answer
//   "Osaka"  "Henry"  "Bathymetry"    the printed ANSWER on a key paper
//   "celebrated ?"  "companies ?"     stem tails, silently truncating the stem
//   "11."  "12."  "13."               every question number on the page
//
// A four-option question whose options were dropped is stored as a question
// with no options, and a stem that lost its tail is stored as a shorter
// question — both silently, both the same class of fault as the baked-in text
// layer this stage exists to avoid.
//
// So the length term is gone. What remains asks only whether the characters
// present form words and numbers rather than debris, and OCR confidence is left
// to do the language separation it was already doing better: across those pages
// English blocks ran 78-97% and Telugu soup 33-74%.
function englishScore(text) {
  const t = String(text || '');
  if (!t.trim()) return 0;
  const asciiRatio = [...t].filter((ch) => ch.charCodeAt(0) < 128).length / t.length;
  const alnum = (t.match(ALNUM) || []).length;
  if (!alnum) return 0; // punctuation and rules only
  const inTokens = (t.match(TOKEN) || []).join('').length;
  return asciiRatio * (inTokens / alnum);
}

// Both bars are set for RECALL, because the two kinds of mistake do not cost
// the same. Admitting Telugu soup costs a few tokens and the stage-3 prompt is
// written to discard it — its own examples of soup are lines off these very
// pages. Dropping an English line corrupts a question with no way to notice
// later, and at the old 75% bar the losses included "(4) Kadambari" (61.9%) and
// "(1) Finance Minister" (82.8%), each the correct answer to its question.
//
// 60 is calibrated, not chosen: across the 8 pages measured, the least
// confident genuine English line was that "(4) Kadambari" at 61.9%, while the
// soup this still excludes sat at 33-57% ("wat", "sara", "806 Xo", "PDD").
// It is a two-point margin on a sample of 8 pages, so it is worth re-measuring
// if a paper ever comes out visibly worse than these did.
const MIN_CONF = 60;
const MIN_ENGLISH = 0.35;

// Confidence reported against a question is still measured over the
// confidently-English core, so the stored figure keeps the meaning it had
// before these bars were lowered and stays comparable across runs.
const CORE_CONF = 75;

function englishLines(page) {
  const kept = (page.blocks || []).filter(
    (b) => (b.conf ?? 0) >= MIN_CONF && englishScore(b.text) >= MIN_ENGLISH
  );
  // Column-major, then down: the least-wrong order to hand a model, and it only
  // has to be close, since reassembly is its job.
  kept.sort((a, b) => {
    const ca = Math.round(a.bbox[0] / 240);
    const cb = Math.round(b.bbox[0] / 240);
    return ca - cb || a.bbox[1] - b.bbox[1];
  });
  const core = kept.filter((b) => (b.conf ?? 0) >= CORE_CONF);
  const conf = core.length
    ? core.reduce((s, b) => s + (b.conf || 0), 0) / core.length
    : null;
  return { lines: kept.map((b) => b.text), conf, dropped: (page.blocks || []).length - kept.length };
}

// ---------------------------------------------------------------------------
// stage 3: structure
// ---------------------------------------------------------------------------

async function structurePage(lines, opts) {
  const prompt = fs.readFileSync(path.join(__dirname, 'prompt-extract.txt'), 'utf8');
  const raw = await L.complete({
    system: prompt,
    user: lines.join('\n'),
    model: opts.model,
    temperature: 0,
  });
  const parsed = L.parseJson(raw, { array: true });
  return Array.isArray(parsed) ? parsed : [];
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const db = L.db();
  const P = require(path.join(L.ROOT, 'server', 'src', 'lib', 'pyq'));
  const T = require(path.join(L.ROOT, 'server', 'src', 'lib', 'topics'));

  const targets = args.all ? PAPERS : PAPERS.filter((p) => p.slug === args.paper);
  if (!targets.length) {
    console.error(`No paper with slug '${args.paper}'. Use --list.`);
    process.exit(1);
  }

  const keywords = P.loadKeywords(db);
  const aliases = T.loadAliases(db);
  const state = args.fresh ? new Map() : L.loadState();

  const upsertPaper = db.prepare(
    `INSERT INTO pyq_papers (slug, exam, stage, paper, year, source_file, pages, notes)
     VALUES (@slug, @exam, @stage, @paper, @year, @source_file, @pages, @notes)
     ON CONFLICT(slug) DO UPDATE SET
       pages = excluded.pages, notes = excluded.notes`
  );
  const insQ = db.prepare(
    `INSERT OR REPLACE INTO pyq_questions
       (paper_id, q_no, page, stem, options_json, answer, format, subject,
        ocr_confidence, needs_review, review_note, raw)
     VALUES (@paper_id, @q_no, @page, @stem, @options_json, @answer, @format, @subject,
             @ocr_confidence, @needs_review, @review_note, @raw)`
  );
  const insQK = db.prepare(
    'INSERT OR IGNORE INTO pyq_question_keywords (question_id, keyword) VALUES (?, ?)'
  );
  const insQT = db.prepare(
    'INSERT OR IGNORE INTO pyq_question_topics (question_id, topic_id, hits, matched) VALUES (?, ?, ?, ?)'
  );

  let grandTotal = 0;

  for (const paper of targets) {
    const pdf = path.join(PYQ_DIR, paper.file);
    if (!fs.existsSync(pdf)) {
      console.log(`\n! ${paper.slug}: file not found, skipping (${pdf})`);
      continue;
    }

    console.log(`\n=== ${paper.slug}  (${paper.year} ${paper.stage} ${paper.paper})`);
    const ir = ocrPages(pdf, { pages: args.pages, dpi: args.dpi });
    for (const w of ir.warnings || []) console.log(`    ! ${w}`);

    upsertPaper.run({
      slug: paper.slug, exam: paper.exam, stage: paper.stage, paper: paper.paper,
      year: paper.year, source_file: paper.file, pages: ir.page_count,
      notes: paper.notes || '',
    });
    const paperId = db.prepare('SELECT id FROM pyq_papers WHERE slug = ?').get(paper.slug).id;

    let pageNo = 0;
    let kept = 0;
    let incomplete = 0;

    for (const page of ir.pages) {
      if (pageNo >= args.limitPages) break;
      pageNo++;

      const { lines, conf, dropped } = englishLines(page);
      if (lines.length < 3) {
        console.log(`    p${page.page}: ${lines.length} English line(s) — skipped`);
        continue;
      }

      const key = `pyq:${paper.slug}:p${page.page}`;
      const cached = state.get(key);
      let questions;

      if (cached && cached.questions) {
        questions = cached.questions;
        console.log(`    p${page.page}: cached — ${questions.length} question(s)`);
      } else if (args.dryRun) {
        console.log(
          `    p${page.page}: ${lines.length} English line(s) kept, ${dropped} dropped, ` +
          `conf ${conf ? conf.toFixed(0) : '?'}%`
        );
        console.log(`        ${lines.slice(0, 3).map((l) => l.slice(0, 78)).join('\n        ')}`);
        continue;
      } else {
        try {
          questions = await structurePage(lines, args);
          L.recordState({ key, outcome: 'extracted', questions });
        } catch (e) {
          console.log(`    p${page.page}: FAILED — ${e.message.slice(0, 120)}`);
          continue;
        }
        console.log(`    p${page.page}: ${questions.length} question(s)`);
      }

      if (args.dryRun) continue;

      for (const q of questions) {
        const stem = String(q.stem || '').trim();
        if (stem.length < 15) continue;
        const options = (Array.isArray(q.options) ? q.options : [])
          .map((o) => String(o || '').trim())
          .filter(Boolean);

        const format = P.classifyFormat(stem, options);
        const haystack = [stem, ...options].join(' ');

        // An answer is only ever taken from the page. The prompt forbids
        // supplying one from memory, and this rejects anything out of range in
        // case it does anyway.
        const answer = Number.isInteger(q.answer) && q.answer >= 1 && q.answer <= 4 ? q.answer : null;

        const info = insQ.run({
          paper_id: paperId,
          q_no: Number.isInteger(q.q_no) ? q.q_no : null,
          page: page.page,
          stem,
          options_json: JSON.stringify(options),
          answer,
          format,
          subject: '',
          ocr_confidence: conf != null ? Math.round(conf * 10) / 10 : null,
          needs_review: q.complete === false ? 1 : 0,
          review_note: q.complete === false ? String(q.note || 'marked incomplete by extractor') : '',
          raw: lines.join('\n').slice(0, 4000),
        });
        const qid = info.lastInsertRowid;
        if (q.complete === false) incomplete++;
        kept++;

        for (const k of P.tagKeywords(haystack, keywords)) insQK.run(qid, k.term);
        for (const m of T.matchItem({ headline: stem, notes_markdown: options.join(' ') }, aliases)) {
          insQT.run(qid, m.topic_id, m.hits, m.matched);
        }
      }
    }

    grandTotal += kept;
    console.log(
      `    -> ${kept} question(s) stored` + (incomplete ? `, ${incomplete} marked for review` : '')
    );
  }

  if (args.dryRun) {
    console.log('\nDry run — nothing stored.');
    return;
  }

  console.log(`\nStored ${grandTotal} question(s) in total.`);
  const byFormat = db
    .prepare('SELECT format, COUNT(*) AS n FROM pyq_questions GROUP BY format ORDER BY n DESC')
    .all();
  console.log('\nFormat distribution across the corpus:');
  for (const r of byFormat) console.log(`   ${r.format.padEnd(20)} ${r.n}`);
}

main().catch((e) => {
  console.error(`\n${e.stack || e.message}`);
  process.exit(1);
});
