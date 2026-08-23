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
// The shared insert, so this lane and the in-app newspaper lane write items
// through one implementation rather than two that agree until they don't.
const D = require(path.join(__dirname, '..', '..', 'server', 'src', 'lib', 'draft'));

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
//
// Both the rotation and the PYQ-driven selection now live in
// `server/src/lib/draft.js`, shared with the in-app newspaper lane.
//
// They moved because the copy that used to be here was BROKEN and looked fine.
// `plannedFormatsFor` sat at module scope and called `say()`, which is defined
// inside `main()`. So the moment the PYQ layer actually had evidence for a
// keyword, the log line threw a ReferenceError into its own catch, and the
// catch returned the rotation. The fallback is a legitimate answer, so nothing
// ever looked wrong — and the entire PYQ format engine was inert.
//
// The shared version takes `db` and `onLog` as parameters, where a missing one
// is a TypeError at the call site instead of a silently swallowed miss.

// ---- model output shape -------------------------------------------------

// Columns that are TEXT in the schema. A model is asked for prose in each, and
// mostly returns prose — but not always: gpt-5.6-luna returned `g1_bridges` and
// `g1_linked` as JSON arrays of strings on 3 of 28 items in one run, which
// better-sqlite3 refuses to bind ("can only bind numbers, strings, bigints,
// buffers, and null") and which therefore rolled back the entire insert
// transaction *after* every draft had been paid for.
//
// gpt-4o happened to always return strings, so the pipeline had never needed
// this. That is exactly why it belongs in code rather than in a prompt: the
// prompt can ask for a string, but only code can guarantee one, and the cost of
// being wrong is a whole run's drafting discarded at the last step.
//
// The implementation now lives in `server/src/lib/draft.js` and is re-exported
// here, so this lane and the in-app newspaper lane normalise identically.
const { normaliseTextFields } = D;

// ---- main ---------------------------------------------------------------

async function main() {
  const database = L.db();
  // `validateMcq` is applied inside `D.generateMcqs`, which owns question
  // acceptance now; only the item check is still made here.
  const { validateItem } = L.serverValidators();
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
  const units = database
    .prepare(
      `SELECT unit_code, label FROM ref_units
        WHERE format = 'descriptive' AND unfeedable = 0
        ORDER BY order_index`
    )
    .all();

  const vocabulary = [
    '=== BLUEPRINT KEYWORD ANGLES (choose from these exactly) ===',
    ...Object.entries(
      keywords.reduce((acc, k) => {
        (acc[k.subject] = acc[k.subject] || []).push(k.keyword);
        return acc;
      }, {})
    ).map(([subject, list]) => `${subject}: ${list.join(', ')}`),
    '',
    // The WRITTEN papers only. The objective syllabus units belong to the
    // newspaper lane's deterministic match and are not the model's to choose;
    // offering them here would reintroduce the contradiction removed from
    // server/scripts/draft-articles.js — instructions saying one thing and the
    // vocabulary saying another.
    '=== GROUP-I MAINS PAPER UNITS — the WRITTEN papers (choose from these exactly) ===',
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
    //
    // Formats from what APPSC has actually asked about this item's keyword,
    // falling back to the rotation where the evidence is too thin.
    //
    // This is the difference the PYQ layer exists to make. Measured against the
    // hand-tagged 2025 Mains Paper I, the rotation under-produced plain recall
    // by more than half (20% against an observed 47%), over-produced count-based
    // questions sixteenfold, and never generated a chronological question at all
    // — a format that is 4% of the real paper.
    record.mcqs =
      !args.noMcqs && Number(record.relevance_g2) === 1
        ? await D.generateMcqs(database, {
            record,
            index,
            count: args.mcqsPer,
            model: args.model,
            mcqPrompt,
            seenHashes,
            fallbackDate: args.date,
            onLog: say,
          })
        : [];

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
  //
  // The write itself lives in `server/src/lib/draft.js`, shared with the in-app
  // newspaper lane rather than duplicated into it.
  //
  // WHAT USED TO BE HERE
  //
  // A second copy of the vocabulary canonicalisation — the code that turns an
  // echoed "P3-U7 — Policy process" line back into "P3-U7" before it is written.
  // A unit code nothing can match is not a wrong tag, it is an INVISIBLE one, and
  // unit tags are what the cross-paper reuse map is built on. Two copies of that
  // rule would have drifted, and the drift would have been silent — which is the
  // failure mode this repo keeps meeting.

  D.insertDrafted(database, {
    date: args.date,
    drafted,
    discarded,
    onLog: (line) => console.log(line),
  });

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
