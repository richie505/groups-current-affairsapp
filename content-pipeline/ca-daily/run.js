#!/usr/bin/env node
'use strict';

// The daily pipeline: candidates → triage → draft → MCQs → review queue.
//
//   node content-pipeline/ca-daily/run.js --candidates cands.json --date 2026-08-21 --dry-run
//   node content-pipeline/ca-daily/run.js --candidates cands.json --date 2026-08-21
//   node content-pipeline/ca-daily/run.js --candidates cands.json --date 2026-08-21 --no-mcqs
//
// WHY CANDIDATES ARE AN INPUT, NOT SOMETHING THIS SCRIPT FETCHES
//
// The research step — sweeping PIB, PRS, RBI, ISRO, MoSPI, MoEFCC and the AP
// department portals, then cross-checking names and figures against a second
// source — needs live web access with judgement applied to what comes back.
// A cron job scraping RSS feeds cannot tell a superseded figure from a current
// one, and this is precisely the material where getting that wrong is
// unrecoverable: there is no textbook to check a current-affairs claim against.
//
// So the sweep is run by an agent (or by hand) and handed to this script as a
// candidates file. See README.md for the sweep brief and the file shape. What
// this script owns is everything downstream and deterministic: discard
// discipline, dual-lane routing, the corrections guard, MCQ generation in the
// eight real formats, validation, dedupe, and writing to the review queue as
// drafts.
//
// Nothing here publishes. Publishing is a person's decision, in the admin.

const fs = require('fs');
const path = require('path');
const L = require('./lib');

L.loadEnv();

// ---- CLI ----------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    candidates: null,
    date: null,
    dryRun: false,
    noMcqs: false,
    mcqsPer: 4,
    limit: Infinity,
    model: process.env.OPENAI_MODEL || 'gpt-4o',
    fresh: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--candidates') args.candidates = argv[++i];
    else if (a === '--date') args.date = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--no-mcqs') args.noMcqs = true;
    else if (a === '--mcqs-per') args.mcqsPer = Number(argv[++i]);
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--model') args.model = argv[++i];
    // Ignores the resume state file, so a run can be redone from scratch after
    // the prompts change.
    else if (a === '--fresh') args.fresh = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

const args = parseArgs(process.argv);

if (args.help || !args.candidates) {
  console.log(fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8'));
  process.exit(args.help ? 0 : 1);
}

if (!/^\d{4}-\d{2}-\d{2}$/.test(String(args.date || ''))) {
  console.error('--date YYYY-MM-DD is required (which digest these items belong to).');
  process.exit(1);
}

// ---- the format mix -----------------------------------------------------

// Weighted to the formats that suit current-affairs facts — single events,
// several claims about one event, natural pairings — while cycling in
// assertion-reason and negative-statement, which the real paper leans on
// heavily and which are where marks are actually lost. A bank served as 90%
// plain recall trains the wrong reflex.
const FORMAT_CYCLE = [
  'direct_recall',
  'multi_statement',
  'list_matching',
  'assertion_reason',
  'direct_recall',
  'negative_statement',
  'multi_statement',
  'statement_based',
  'list_matching',
  'count_based',
];

function formatsFor(index, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(FORMAT_CYCLE[(index * n + i) % FORMAT_CYCLE.length]);
  return out;
}

// PYQ-driven format selection, with the rotation as the fallback.
//
// The keyword chosen is the item's first, which is the drafting prompt's
// primary angle. Trying to blend the distributions of four keywords at once
// would produce a mush that matches none of them; imitating the primary angle
// is both simpler and closer to how a paper-setter works.
//
// Reported per item rather than silently applied, because "these formats came
// from 46 real questions" and "these came from a rotation" are very different
// claims about a practice paper, and the difference should be visible in the run
// log rather than buried.
let _pyq = null;
function plannedFormatsFor(record, index, n) {
  const fallback = formatsFor(index, n);
  const keyword = (record.keywords || [])[0];
  if (!keyword) return fallback;

  try {
    if (!_pyq) {
      _pyq = {
        db: L.db(),
        lib: require(path.join(L.ROOT, 'server', 'src', 'lib', 'pyq')),
      };
    }
    const plan = _pyq.lib.plannedFormats(_pyq.db, keyword, n, fallback);
    if (plan.source === 'pyq') {
      say(`      formats from ${plan.evidence} PYQ(s) on "${keyword}": ${plan.formats.join(', ')}`);
    }
    return plan.formats;
  } catch (e) {
    // The PYQ tables may not exist yet in an older database. A missing evidence
    // base is a reason to fall back, not to fail a run.
    return fallback;
  }
}

// ---- model output shape -------------------------------------------------

// Columns that are TEXT in the schema. A model is asked for prose in each, and
// mostly returns prose - but not always: gpt-5.6-luna returned `g1_bridges` and
// `g1_linked` as JSON arrays of strings on 3 of 28 items in one run, which
// better-sqlite3 refuses to bind ("can only bind numbers, strings, bigints,
// buffers, and null") and which therefore rolled back the entire insert
// transaction *after* every draft had been paid for.
//
// gpt-4o happened to always return strings, so the pipeline had never needed
// this. That is exactly why it belongs here rather than in a prompt: the prompt
// can ask for a string, but only code can guarantee one, and the cost of being
// wrong is a whole run's drafting discarded at the last step.
const TEXT_FIELDS = [
  'headline', 'event_date', 'bucket', 'subject_tag', 'notes_markdown',
  'static_linkage', 'prelims_facts', 'g1_bank', 'g1_fact', 'g1_angle',
  'g1_theme', 'g1_sub_theme', 'g1_why_news', 'g1_background', 'g1_ap_angle',
  'g1_linked', 'g1_bridges', 'g1_way_forward', 'verify_note', 'discard_reason',
];

// An array of bullet strings becomes newline-separated bullets, which is how
// every one of these fields is rendered anyway. Anything else object-shaped is
// JSON-stringified rather than silently emptied, so a surprise is visible in
// the review queue instead of vanishing.
function toText(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === 'string' ? v.trim() : JSON.stringify(v)))
      .filter(Boolean)
      .map((line) => (/^[-*•]/.test(line) ? line : `- ${line}`))
      .join('\n');
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function normaliseTextFields(record) {
  if (!record || typeof record !== 'object') return record;
  for (const f of TEXT_FIELDS) {
    if (f in record) record[f] = toText(record[f]);
  }
  return record;
}

// ---- main ---------------------------------------------------------------

async function main() {
  const database = L.db();
  const { validateMcq, validateItem } = L.serverValidators();
  const { DIMENSIONS } = require(path.join(L.ROOT, 'server', 'src', 'routes', 'admin'));
  const { correctionsPromptBlock, checkCorrections } = require(
    path.join(L.ROOT, 'server', 'src', 'lib', 'corrections')
  );

  const candidates = JSON.parse(fs.readFileSync(args.candidates, 'utf8'));
  if (!Array.isArray(candidates)) {
    throw new Error('The candidates file must be a JSON array.');
  }

  const state = args.fresh ? new Map() : L.loadState();
  const seenHashes = L.existingQuestionHashes(database);
  const outDir = L.ensureOutDir();

  const draftPrompt = L.readPrompt('prompt-draft.txt');
  const mcqPrompt = L.readPrompt('prompt-mcq.txt');

  // Reference vocabularies and the corrections, appended to the drafting
  // prompt. Stating the current position up front is cheaper and more reliable
  // than catching a superseded one afterwards — though both happen, because a
  // model that ignores the instruction still has to get past the guard.
  const keywords = database
    .prepare(`SELECT keyword, subject FROM ref_keywords ORDER BY subject, order_index`)
    .all();
  const units = database.prepare('SELECT unit_code, label FROM ref_units ORDER BY order_index').all();

  const vocabulary = [
    '=== BLUEPRINT KEYWORD ANGLES (choose from these exactly) ===',
    ...Object.entries(
      keywords.reduce((acc, k) => {
        (acc[k.subject] = acc[k.subject] || []).push(k.keyword);
        return acc;
      }, {})
    ).map(([subject, list]) => `${subject}: ${list.join(', ')}`),
    '',
    '=== PAPER UNITS (choose from these exactly) ===',
    ...units.map((u) => `${u.unit_code} — ${u.label}`),
    '',
    correctionsPromptBlock(database),
  ].join('\n');

  const runId = L.startRun(database, {
    windowStart: args.date,
    windowEnd: args.date,
    mode: 'daily',
    model: args.model,
  });

  const log = [];
  function say(line) {
    console.log(line);
    log.push(line);
  }

  say(`Run #${runId} — ${candidates.length} candidate(s) for ${args.date}, model ${args.model}`);
  if (args.dryRun) say('DRY RUN — nothing will be written to the database.');

  const drafted = [];
  const discarded = [];
  let processed = 0;

  for (const [index, cand] of candidates.entries()) {
    if (processed >= args.limit) break;
    processed++;

    const key = `${args.date}:${cand.headline || cand.url || index}`;
    const cached = state.get(key);
    if (cached) {
      say(`[${processed}] cached — ${cached.outcome}: ${cand.headline?.slice(0, 70)}`);
      if (cached.outcome === 'discard') discarded.push({ ...cand, discard_reason: cached.reason });
      // Normalised on the way out as well as on the way in, because the state
      // file holds whatever the model returned at the time it was written -
      // including the array-shaped fields this guard exists for. Resuming a run
      // recorded before the guard existed must not reintroduce the fault.
      else if (cached.item) drafted.push(normaliseTextFields(cached.item));
      continue;
    }

    const sourceText = [
      `HEADLINE: ${cand.headline || ''}`,
      `DATE: ${cand.date || args.date}`,
      `SOURCES: ${(cand.sources || []).map((s) => `${s.publisher || ''} ${s.url}`).join(' | ')}`,
      '',
      'SOURCE TEXT:',
      cand.text || cand.summary || '(no body text supplied)',
    ].join('\n');

    let record;
    try {
      const raw = await L.complete({
        system: `${draftPrompt}\n\n${vocabulary}`,
        user: sourceText,
        model: args.model,
      });
      record = L.parseJson(raw);
      normaliseTextFields(record);
    } catch (e) {
      say(`[${processed}] FAILED to draft: ${e.message}`);
      L.recordState({ key, outcome: 'error', error: e.message });
      continue;
    }

    // Discard is a first-class outcome, and the reason is kept. A run that
    // discards nothing is a run that was not being ruthless enough, and that is
    // only visible if the discards are recorded rather than dropped.
    if (record.discard) {
      say(`[${processed}] DISCARD — ${record.discard_reason}`);
      discarded.push({ ...cand, discard_reason: record.discard_reason });
      L.recordState({ key, outcome: 'discard', reason: record.discard_reason });
      continue;
    }

    // The angle rule, enforced here as well as in the database. An item with no
    // argument will never reach an answer, so filing it to the G1 lane would
    // inflate the bank counts with material that cannot be used.
    if (Number(record.relevance_g1) === 1 && !String(record.g1_angle || '').trim()) {
      const reason = 'No angle produced — an item that cannot be argued from is not examinable for Group I.';
      say(`[${processed}] DISCARD (no angle) — ${record.headline?.slice(0, 60)}`);
      discarded.push({ ...cand, discard_reason: reason });
      L.recordState({ key, outcome: 'discard', reason });
      continue;
    }

    record.sources = (cand.sources || []).map((s) => ({
      url: s.url,
      publisher: s.publisher || '',
      is_primary: s.is_primary ? 1 : 0,
      fetched_at: s.fetched_at || null,
    }));

    // The corrections guard, run over the drafted text. A 'high' hit means the
    // draft carries a phrase associated with the superseded position — it still
    // goes to the queue, but flagged, because whether the usage is wrong depends
    // on context and only a person can judge that.
    const hits = checkCorrections(database, record);
    const high = hits.filter((h) => h.severity === 'high');
    if (high.length) {
      record.needs_verify = 1;
      record.verify_note = [
        record.verify_note || '',
        `Possibly states a superseded position: ${high
          .map((h) => `${h.topic} — correct position: ${h.correct_position}`)
          .join(' | ')}`,
      ]
        .filter(Boolean)
        .join(' ');
      say(`[${processed}] ⚠ correction hit (${high.map((h) => h.topic).join(', ')})`);
    }

    const itemErrors = validateItem(record);
    if (itemErrors.length) {
      say(`[${processed}] INVALID — ${itemErrors.join(' ')}`);
      L.recordState({ key, outcome: 'error', error: itemErrors.join(' ') });
      continue;
    }

    // ---- MCQs ----
    record.mcqs = [];
    if (!args.noMcqs && Number(record.relevance_g2) === 1) {
      // Formats from what APPSC has actually asked about this item's keyword,
      // falling back to the rotation where the evidence is too thin.
      //
      // This is the difference the PYQ layer exists to make. Measured against
      // the hand-tagged 2025 Mains Paper I, the rotation below under-produced
      // plain recall by more than half (20% against an observed 47%),
      // over-produced count-based questions sixteenfold, and never generated a
      // chronological question at all — a format that is 4% of the real paper.
      const wanted = plannedFormatsFor(record, index, args.mcqsPer);
      const brief = [
        `NOTES:\n${record.notes_markdown}`,
        `PRELIMS FACTS:\n${record.prelims_facts}`,
        `KEYWORD ANGLES: ${(record.keywords || []).join(', ')}`,
        `FACTS TRUE AS OF: ${record.event_date || args.date}`,
        '',
        `Write exactly ${wanted.length} questions, in these formats, in this order:`,
        ...wanted.map((f, i) => `${i + 1}. ${f}`),
      ].join('\n');

      try {
        const raw = await L.complete({ system: mcqPrompt, user: brief, model: args.model });
        const list = L.parseJson(raw, { array: true });
        for (const m of list) {
          const errors = validateMcq(m);
          if (errors.length) {
            say(`    dropped a question — ${errors.join(' ')}`);
            continue;
          }
          const hash = L.questionHash(m.question);
          if (seenHashes.has(hash)) {
            say('    dropped a duplicate question');
            continue;
          }
          seenHashes.add(hash);
          record.mcqs.push({ ...m, fact_as_of: m.fact_as_of || record.event_date || args.date });
        }
      } catch (e) {
        say(`    MCQ generation failed (${e.message}) — item kept without questions`);
      }
    }

    say(
      `[${processed}] drafted — ${record.headline?.slice(0, 60)} ` +
        `[${record.bucket}/T${record.importance}] ${record.mcqs.length} question(s)`
    );
    drafted.push(record);
    L.recordState({ key, outcome: 'drafted', item: record });
  }

  // ---- report -----------------------------------------------------------

  const discardRate = processed ? Math.round((discarded.length / processed) * 100) : 0;
  say('');
  say(`Processed ${processed} · drafted ${drafted.length} · discarded ${discarded.length} (${discardRate}%)`);
  if (discardRate < 20 && processed >= 5) {
    // Not an error — a note. If almost nothing is being discarded, the sweep is
    // probably feeding in pre-filtered material, or the triage has gone soft.
    say('NOTE: a discard rate under 20% is unusually low. Check the triage is still being applied.');
  }

  const outFile = path.join(outDir, `${args.date}-drafts.json`);
  fs.writeFileSync(outFile, JSON.stringify({ date: args.date, drafted, discarded }, null, 2));
  say(`Wrote ${outFile}`);

  if (args.dryRun) {
    L.finishRun(database, runId, {
      status: 'done',
      candidates: processed,
      drafted: drafted.length,
      discarded: discarded.length,
      log: log.join('\n'),
    });
    say('Dry run — nothing inserted. Review the JSON, then re-run without --dry-run.');
    return;
  }

  // ---- insert ----------------------------------------------------------

  const insert = database.transaction(() => {
    let day = database.prepare('SELECT id FROM ca_days WHERE date = ?').get(args.date);
    if (!day) {
      const info = database
        .prepare(`INSERT INTO ca_days (date, status) VALUES (?, 'draft')`)
        .run(args.date);
      day = { id: info.lastInsertRowid };
    }

    const insItem = database.prepare(
      `INSERT INTO ca_items (day_id, headline, event_date, bucket, subject_tag,
         notes_markdown, static_linkage, prelims_facts, g1_bank, g1_fact, g1_angle,
         g1_theme, g1_sub_theme, g1_why_news, g1_background, g1_ap_angle,
         g1_linked, g1_bridges, g1_way_forward,
         importance, relevance_g1, relevance_g2, needs_verify, verify_note,
         order_index, status)
       VALUES (@day_id, @headline, @event_date, @bucket, @subject_tag,
         @notes_markdown, @static_linkage, @prelims_facts, @g1_bank, @g1_fact, @g1_angle,
         @g1_theme, @g1_sub_theme, @g1_why_news, @g1_background, @g1_ap_angle,
         @g1_linked, @g1_bridges, @g1_way_forward,
         @importance, @relevance_g1, @relevance_g2, @needs_verify, @verify_note,
         @order_index, 'draft')`
    );
    // Vocabulary drift, surfaced at the end of the run rather than swallowed.
    const offVocabKeywords = new Set();
    const droppedUnits = [];

    const insKeyword = database.prepare(
      'INSERT OR IGNORE INTO ca_item_keywords (item_id, keyword) VALUES (?, ?)'
    );
    const insUnit = database.prepare(
      'INSERT OR IGNORE INTO ca_item_units (item_id, unit_code) VALUES (?, ?)'
    );
    const insTheme = database.prepare(
      'INSERT OR IGNORE INTO ca_item_themes (item_id, theme) VALUES (?, ?)'
    );

    // The controlled vocabularies, loaded so that what gets written can be
    // checked against them.
    //
    // WHY THIS IS NEEDED
    //
    // The drafting prompt supplies the vocabulary as "P3-U7 — Policy process,
    // implementation, scheme design and failure" lines, and the model sometimes
    // echoes the whole line back instead of just the code. Unchecked, that
    // string goes into ca_item_units.unit_code, where it can never match a
    // query for 'P3-U7' - so the tag is not wrong so much as invisible, which
    // is worse. On one 28-item run this silently lost 25 of 159 unit tags, and
    // unit tags are exactly what the cross-paper reuse view is built on.
    const refUnits = new Set(
      database.prepare('SELECT unit_code FROM ref_units').all().map((r) => r.unit_code)
    );
    const refKeywords = new Set(
      database.prepare('SELECT keyword FROM ref_keywords').all().map((r) => r.keyword)
    );

    // Takes the code off the front of an echoed vocabulary line. Splits only on
    // a *space-delimited* dash, so that the hyphen inside a real code (P3-U7)
    // is never touched.
    const codeOf = (value) => String(value ?? '').trim().split(/\s+[—–-]\s+/)[0].trim();
    const canonical = (value, valid) => {
      const raw = String(value ?? '').trim();
      if (!raw) return null;
      if (valid.has(raw)) return raw;
      const head = codeOf(raw);
      return valid.has(head) ? head : null;
    };
    const insSource = database.prepare(
      `INSERT INTO ca_item_sources (item_id, url, publisher, is_primary, fetched_at)
       VALUES (?, ?, ?, ?, ?)`
    );
    const insDimension = database.prepare(
      'INSERT OR IGNORE INTO ca_item_dimensions (item_id, dimension, note) VALUES (?, ?, ?)'
    );
    const insEssay = database.prepare(
      'INSERT INTO ca_essay_questions (item_id, question, kind, note) VALUES (?, ?, ?, ?)'
    );
    const insMcq = database.prepare(
      `INSERT INTO ca_mcqs (item_id, question, option_a, option_b, option_c, option_d,
         correct_option, explanation, format, keyword, difficulty, fact_as_of)
       VALUES (@item_id, @question, @option_a, @option_b, @option_c, @option_d,
         @correct_option, @explanation, @format, @keyword, @difficulty, @fact_as_of)`
    );

    // Discarded candidates are written as rows too, not dropped. The record of
    // what was rejected and why is the only way to audit whether the triage is
    // working.
    const insDiscarded = database.prepare(
      `INSERT INTO ca_items (day_id, headline, bucket, status, discard_reason,
         relevance_g1, relevance_g2)
       VALUES (?, ?, 'national', 'discarded', ?, 0, 0)`
    );

    let order = database
      .prepare('SELECT COALESCE(MAX(order_index), 0) AS m FROM ca_items WHERE day_id = ?')
      .get(day.id).m;

    for (const r of drafted) {
      order += 1;
      const info = insItem.run({
        day_id: day.id,
        headline: r.headline,
        event_date: r.event_date || null,
        bucket: r.bucket || 'national',
        subject_tag: r.subject_tag || '',
        notes_markdown: r.notes_markdown || '',
        static_linkage: r.static_linkage || '',
        prelims_facts: r.prelims_facts || '',
        g1_bank: r.g1_bank || null,
        g1_fact: r.g1_fact || '',
        g1_angle: r.g1_angle || '',
        g1_theme: r.g1_theme || '',
        g1_sub_theme: r.g1_sub_theme || '',
        g1_why_news: r.g1_why_news || '',
        g1_background: r.g1_background || '',
        g1_ap_angle: r.g1_ap_angle || '',
        g1_linked: r.g1_linked || '',
        g1_bridges: r.g1_bridges || '',
        g1_way_forward: r.g1_way_forward || '',
        importance: Number(r.importance) || 2,
        relevance_g1: Number(r.relevance_g1) === 0 ? 0 : 1,
        relevance_g2: Number(r.relevance_g2) === 0 ? 0 : 1,
        needs_verify: Number(r.needs_verify) ? 1 : 0,
        verify_note: r.verify_note || '',
        order_index: order,
      });
      const itemId = info.lastInsertRowid;
      // A keyword is a tag rather than a join key, so an off-vocabulary one is
      // kept (trimmed to its head) and merely counted - losing "Federalism"
      // because it is not in the seeded list would be worse than recording it.
      for (const k of r.keywords || []) {
        const kw = canonical(k, refKeywords) || codeOf(k);
        if (!kw) continue;
        insKeyword.run(itemId, kw);
        if (!refKeywords.has(kw)) offVocabKeywords.add(kw);
      }
      // A unit code IS a join key, so an unresolvable one is dropped and
      // reported rather than written. A code nothing can match is not a tag.
      for (const u of r.units || []) {
        const code = canonical(u, refUnits);
        if (code) insUnit.run(itemId, code);
        else if (String(u || '').trim()) droppedUnits.push(String(u).trim().slice(0, 70));
      }
      for (const t of r.themes || []) insTheme.run(itemId, String(t).toLowerCase());
      for (const s of r.sources || []) {
        insSource.run(itemId, s.url, s.publisher || '', s.is_primary ? 1 : 0, s.fetched_at || null);
      }
      for (const d of r.dimensions || []) {
        if (!DIMENSIONS.includes(String(d.dimension || '').toLowerCase())) continue;
        insDimension.run(itemId, String(d.dimension).toLowerCase(), String(d.note || ''));
      }
      for (const q of r.essay_questions || []) {
        const text = String(q.question || '').trim();
        if (!text) continue;
        insEssay.run(itemId, text, q.kind === 'indirect' ? 'indirect' : 'direct', String(q.note || ''));
      }
      for (const m of r.mcqs || []) {
        insMcq.run({
          item_id: itemId,
          question: m.question,
          option_a: m.option_a,
          option_b: m.option_b,
          option_c: m.option_c,
          option_d: m.option_d,
          correct_option: m.correct_option,
          explanation: m.explanation || '',
          format: m.format || 'direct_recall',
          keyword: m.keyword || '',
          difficulty: Number(m.difficulty) || 2,
          fact_as_of: m.fact_as_of || null,
        });
      }
    }

    for (const d of discarded) {
      insDiscarded.run(day.id, d.headline || '(untitled candidate)', d.discard_reason || '');
    }
  });

  insert();

  L.finishRun(database, runId, {
    status: 'done',
    candidates: processed,
    drafted: drafted.length,
    discarded: discarded.length,
    log: log.join('\n'),
  });

  say('');
  say(`Inserted ${drafted.length} draft item(s) into the review queue for ${args.date}.`);
  say('Nothing is visible to students until you approve it in Admin → Review queue.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

  if (droppedUnits.length) {
    const counts = new Map();
    for (const u of droppedUnits) counts.set(u, (counts.get(u) || 0) + 1);
    console.log(`
${droppedUnits.length} unit tag(s) dropped as unresolvable against ref_units:`);
    for (const [u, n] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
      console.log(`   ${n}x ${u}`);
    }
    console.log('   (a code nothing can match is not a tag; fix the drafting prompt if this recurs)');
  }
  if (offVocabKeywords.size) {
    console.log(`
${offVocabKeywords.size} keyword(s) outside ref_keywords, kept as free tags:`);
    console.log(`   ${[...offVocabKeywords].slice(0, 10).join(', ')}`);
  }