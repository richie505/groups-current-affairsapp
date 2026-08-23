#!/usr/bin/env node
'use strict';

// Rewrites the QUESTIONS on existing items against the syllabus map, without
// touching the notes.
//
//   node server/scripts/requestion-items.js [options]
//
//     --item ID,ID     just these items
//     --status s,s     which item statuses to include (default draft,published)
//     --untagged-only  skip items whose questions already carry a unit
//     --limit N        stop after N items
//     --model <id>     override OPENAI_MODEL
//     --mcqs-per 4     BASE count; the real count follows the units fed
//     --dry-run        print the plan and the cost, write nothing
//
// WHY THIS IS NOT "--redraft"
//
// draft-articles.js --redraft already exists and does a different, more
// expensive thing: it re-runs the whole draft, producing a SECOND item that
// supersedes the first. That is right when the note is wrong — a bad
// segmentation, a misread byline.
//
// It is the wrong tool for this. What went stale here is the question bank and
// nothing else: 260 of 270 questions were written before ca_mcqs.unit_code
// existed, so the bank cannot say which syllabus units a student can practise,
// and every item carries a flat four questions where the ground covered calls
// for six to ten. The notes are not stale. Thirty-three of these items have
// been read and approved by a person, and a full redraft would throw that
// review away, pay twice for it, and leave the reviewer with thirty-three
// duplicate items to reconcile against thirty-three live ones.
//
// So this replaces the questions in place. Half the calls, no duplicate items,
// and the reviewed prose stays reviewed.
//
// WHY NEW QUESTIONS ON A PUBLISHED ITEM DO NOT GO LIVE
//
// Because they are unreviewed content and the rule in this project is that
// nothing reaches a student unreviewed. Item status was the only gate, and it
// answers the wrong question here: the item IS reviewed, its new questions are
// not. Questions written onto a published item are inserted with
// status = 'draft' and appear in Admin → Review queue under "Questions waiting
// on review". Questions written onto a draft item go in as normal — the item
// itself is still gating them.
//
// WHAT IS NOT DELETED
//
// A question a student has already answered. Deleting it would cascade away
// their attempt and their Leitner box, which is real work destroyed to tidy a
// tag. Those are kept and counted against the target, so an item with three
// attempted questions and a target of eight gets five new ones rather than
// eight.

const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const L = require(path.join(ROOT, 'content-pipeline', 'ca-daily', 'lib'));
const D = require(path.join(__dirname, '..', 'src', 'lib', 'draft'));

L.loadEnv();

const db = require(path.join(__dirname, '..', 'src', 'db'));

let openRunId = null;

function parseArgs(argv) {
  const args = {
    itemIds: null,
    statuses: ['draft', 'published'],
    untaggedOnly: false,
    limit: -1,
    model: process.env.OPENAI_MODEL || 'gpt-4o',
    mcqsPer: 4,
    dryRun: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--item') args.itemIds = String(argv[++i]).split(',').map(Number).filter(Boolean);
    else if (a === '--status') args.statuses = String(argv[++i]).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--untagged-only') args.untaggedOnly = true;
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--model') args.model = argv[++i];
    else if (a === '--mcqs-per') args.mcqsPer = Number(argv[++i]);
    else if (a === '--dry-run') args.dryRun = true;
  }
  return args;
}

// The item, rebuilt into the shape generateMcqs expects from a fresh draft.
//
// Everything it reads is already on the row except the article id, which comes
// from np_articles — the link is held there rather than on ca_items, so the
// join runs that way round.
function recordFor(row) {
  const article = db.prepare('SELECT id FROM np_articles WHERE item_id = ?').get(row.id);
  const keywords = db
    .prepare('SELECT keyword FROM ca_item_keywords WHERE item_id = ? ORDER BY keyword')
    .all(row.id)
    .map((k) => k.keyword);
  return {
    ...row,
    keywords,
    _articleId: article ? article.id : null,
  };
}

function main() {
  const args = parseArgs(process.argv);

  const where = [`i.status IN (${args.statuses.map(() => '?').join(',')})`];
  const params = [...args.statuses];
  if (args.itemIds) {
    where.push(`i.id IN (${args.itemIds.map(() => '?').join(',')})`);
    params.push(...args.itemIds);
  }
  // Items with no Group-II relevance were never given questions and should not
  // be given them now: that flag is the drafter's judgement that the material
  // is written-paper material only.
  where.push('i.relevance_g2 = 1');
  if (args.untaggedOnly) {
    where.push(
      `NOT EXISTS (SELECT 1 FROM ca_mcqs m WHERE m.item_id = i.id AND TRIM(m.unit_code) <> '')`
    );
  }

  const items = db
    .prepare(
      `SELECT i.*, d.date AS day_date
         FROM ca_items i JOIN ca_days d ON d.id = i.day_id
        WHERE ${where.join(' AND ')}
        ORDER BY d.date DESC, i.importance, i.order_index
        LIMIT ?`
    )
    .all(...params, args.limit);

  if (!items.length) {
    console.log('Nothing matches.');
    process.exit(0);
  }

  // The plan, computed before a single call is paid for.
  //
  // Printed whether or not this is a dry run, because "how many questions is
  // this about to write, and how many of them tag to a unit" is exactly what a
  // person should see before spending money, and burying it behind a flag makes
  // the careful path the extra one.
  const plan = items.map((row) => {
    const record = recordFor(row);
    const units = record._articleId ? D.objectiveUnitsFor(db, record._articleId) : [];
    const existing = db
      .prepare(
        `SELECT COUNT(*) AS n,
                SUM(CASE WHEN TRIM(unit_code) <> '' THEN 1 ELSE 0 END) AS tagged,
                SUM(CASE WHEN EXISTS (SELECT 1 FROM ca_attempts a WHERE a.mcq_id = ca_mcqs.id)
                          OR EXISTS (SELECT 1 FROM ca_mcq_flags f WHERE f.mcq_id = ca_mcqs.id)
                         THEN 1 ELSE 0 END) AS keep
           FROM ca_mcqs WHERE item_id = ?`
      )
      .get(row.id);
    const target = D.mcqCountFor(units, args.mcqsPer);
    const have = existing.n || 0;
    const tagged = existing.tagged || 0;

    // WHEN REGENERATING WOULD BUY NOTHING.
    //
    // An item that feeds no objective syllabus unit produces untagged questions
    // however many times it is asked, because there is no unit to tag them to.
    // If it already has its base four, rewriting them costs a model call and
    // changes one set of untagged questions for another.
    //
    // That is not the same as saying the item is worthless. The 30-mark Group-II
    // Current Affairs paper takes anything in the news, which is precisely why
    // it is excluded from the evidence rules — it matches everything and so
    // proves nothing. Those four questions are real practice. They just cannot
    // be filed against a unit, and paying to rediscover that is the kind of
    // spend that is invisible until someone totals it: 21 of these 67 items.
    const worthDoing = units.length ? tagged < have || have < target : have < target;

    return {
      row,
      record,
      units,
      have,
      tagged,
      keep: existing.keep || 0,
      want: worthDoing ? Math.max(0, target - (existing.keep || 0)) : 0,
      target,
      skipped: !worthDoing,
    };
  });

  const totals = plan.reduce(
    (acc, p) => {
      acc.have += p.have;
      acc.tagged += p.tagged;
      acc.want += p.want;
      acc.kept += p.keep;
      if (p.skipped) acc.skipped += 1;
      if (!p.units.length) acc.noUnits += 1;
      if (!p.record._articleId) acc.noArticle += 1;
      return acc;
    },
    { have: 0, tagged: 0, want: 0, kept: 0, noUnits: 0, noArticle: 0, skipped: 0 }
  );

  console.log(
    `${items.length} item(s): ${totals.have} question(s) now, ${totals.tagged} tagged to a unit.`
  );
  console.log(
    `Writing about ${totals.want}, keeping ${totals.kept} that a student has already ` +
      `answered or flagged.`
  );
  if (totals.skipped) {
    console.log(
      `${totals.skipped} item(s) are left alone: they feed no objective syllabus unit and ` +
        `already carry their base ${args.mcqsPer} questions, so a rewrite would swap one set ` +
        'of untagged questions for another at the price of a model call.'
    );
  }
  if (totals.noUnits) {
    console.log(
      `${totals.noUnits} item(s) in total feed no objective unit. Their questions still count ` +
        'for the 30-mark Group-II Current Affairs paper, which takes anything in the news — ' +
        'they just cannot be filed against a unit.'
    );
  }
  if (totals.noArticle) {
    console.log(`${totals.noArticle} item(s) have no newspaper article behind them.`);
  }
  console.log(`Model ${args.model} · about ${Math.max(1, Math.round(items.length * 20 / 60))} min.`);
  console.log('');

  if (args.dryRun) {
    for (const p of plan) {
      console.log(
        `  ${String(p.row.id).padStart(4)} ${p.row.status.padEnd(9)} ` +
          `${p.skipped ? ' skip ' : `${String(p.have).padStart(2)}→${String(p.target).padStart(2)}`} ` +
          `[${p.units.map((u) => u.unit_code).join(' ') || 'no unit'}] ` +
          `${(p.row.headline || '').slice(0, 46)}`
      );
    }
    console.log('\nDRY RUN — nothing written.');
    process.exit(0);
  }

  return run(args, plan);
}

async function run(args, plan) {
  const log = [];
  const say = (line) => {
    console.log(line);
    log.push(line);
  };

  openRunId = L.startRun(db, {
    windowStart: plan[plan.length - 1].row.day_date,
    windowEnd: plan[0].row.day_date,
    mode: 'requestion',
    model: args.model,
  });

  const mcqPrompt = L.readPrompt('prompt-mcq.txt');
  // The corpus-wide duplicate guard, MINUS the questions this run is about to
  // replace. Left in, every regenerated question that legitimately re-asks the
  // same fact would be dropped as a duplicate of the row we are deleting, and
  // an item could end the run with fewer questions than it started with.
  const replacing = new Set(
    db
      .prepare(
        `SELECT question FROM ca_mcqs
          WHERE NOT EXISTS (SELECT 1 FROM ca_attempts a WHERE a.mcq_id = ca_mcqs.id)
            AND NOT EXISTS (SELECT 1 FROM ca_mcq_flags f WHERE f.mcq_id = ca_mcqs.id)`
      )
      .all()
      .map((r) => L.questionHash(r.question))
  );
  const seenHashes = L.existingQuestionHashes(db);
  for (const h of replacing) seenHashes.delete(h);

  const insert = db.prepare(
    `INSERT INTO ca_mcqs (item_id, question, option_a, option_b, option_c, option_d,
       correct_option, explanation, format, keyword, unit_code, difficulty, fact_as_of, status)
     VALUES (@item_id, @question, @option_a, @option_b, @option_c, @option_d,
       @correct_option, @explanation, @format, @keyword, @unit_code, @difficulty,
       @fact_as_of, @status)`
  );
  const deleteReplaceable = db.prepare(
    `DELETE FROM ca_mcqs
      WHERE item_id = ?
        AND NOT EXISTS (SELECT 1 FROM ca_attempts a WHERE a.mcq_id = ca_mcqs.id)
        AND NOT EXISTS (SELECT 1 FROM ca_mcq_flags f WHERE f.mcq_id = ca_mcqs.id)`
  );

  let written = 0;
  let tagged = 0;
  let failed = 0;
  const coveredUnits = new Set();

  for (const [i, p] of plan.entries()) {
    const label = `[${i + 1}/${plan.length}] item ${p.row.id}`;
    if (!p.want) {
      say(`${label} — already at target, left alone`);
      continue;
    }

    let mcqs;
    try {
      mcqs = await D.generateMcqs(db, {
        record: p.record,
        index: i,
        // generateMcqs re-derives the count from the units; pass the base it
        // should scale from, reduced by whatever is being kept.
        count: Math.max(1, args.mcqsPer - p.keep),
        model: args.model,
        mcqPrompt,
        seenHashes,
        fallbackDate: p.row.day_date,
        onLog: (line) => say(`    ${line.trim()}`),
      });
    } catch (e) {
      say(`${label} FAILED — ${e.message}`);
      failed += 1;
      continue;
    }

    // NOTHING IS DELETED UNTIL THERE IS SOMETHING TO PUT IN ITS PLACE.
    //
    // The obvious order — clear the item, then write — loses every question on
    // the item if the call fails or the model returns an empty array, and does
    // it silently, one item at a time, halfway through a long run.
    if (!mcqs.length) {
      say(`${label} — no usable questions returned, existing ones left untouched`);
      failed += 1;
      continue;
    }

    // A published item's new questions wait for review; a draft item's do not,
    // because the item itself is still holding them back.
    const status = p.row.status === 'published' ? 'draft' : 'published';

    db.transaction(() => {
      deleteReplaceable.run(p.row.id);
      for (const m of mcqs) {
        insert.run({
          item_id: p.row.id,
          question: m.question,
          option_a: m.option_a,
          option_b: m.option_b,
          option_c: m.option_c,
          option_d: m.option_d,
          correct_option: m.correct_option,
          explanation: m.explanation || '',
          format: m.format || 'direct_recall',
          keyword: String(m.keyword || '').replace(/\s*\[[^\]]*\]\s*$/, '').trim(),
          unit_code: m.unit_code || '',
          difficulty: Number(m.difficulty) || 2,
          fact_as_of: m.fact_as_of || null,
          status,
        });
      }
    })();

    written += mcqs.length;
    for (const m of mcqs) {
      if (m.unit_code) {
        tagged += 1;
        coveredUnits.add(m.unit_code);
      }
    }
    say(
      `${label} ${p.have}→${mcqs.length + p.keep} question(s)` +
        `${status === 'draft' ? ' (waiting on review)' : ''} — ` +
        `${(p.row.headline || '').slice(0, 52)}`
    );
  }

  say('');
  say(
    `Wrote ${written} question(s), ${tagged} tagged to a syllabus unit, ` +
      `covering ${coveredUnits.size} unit(s).${failed ? ` ${failed} item(s) unchanged.` : ''}`
  );
  const pending = db
    .prepare(`SELECT COUNT(*) AS n FROM ca_mcqs WHERE status <> 'published'`)
    .get().n;
  if (pending) {
    say(
      `${pending} question(s) are on published items and are NOT visible to students. ` +
        'Approve them in Admin → Review queue → Questions waiting on review.'
    );
  }

  L.finishRun(db, openRunId, {
    status: 'done',
    candidates: plan.length,
    drafted: written,
    discarded: failed,
    log: log.join('\n'),
  });
  process.exit(0);
}

Promise.resolve()
  .then(main)
  .catch((e) => {
    console.error(e);
    if (openRunId != null) {
      try {
        L.finishRun(db, openRunId, {
          status: 'failed',
          candidates: 0,
          drafted: 0,
          discarded: 0,
          log: String(e && e.stack ? e.stack : e).slice(0, 8000),
        });
      } catch {
        // The original error is what matters and it has already been printed.
      }
    }
    process.exit(1);
  });
