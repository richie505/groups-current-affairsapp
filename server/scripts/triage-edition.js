#!/usr/bin/env node
'use strict';

// Classifies every article in one edition for exam relevance, in its own
// process.
//
//   node server/scripts/triage-edition.js <editionId> [options]
//
//     --model <id>    override OPENAI_SHORTLIST_MODEL / OPENAI_MODEL
//     --batch N       articles per call (default 12)
//     --redo          re-classify articles that already carry a verdict
//     --plan          print what would be sent and stop — no calls, no cost
//     --limit N       stop after N articles, for a cheap first look
//
// WHY A SEPARATE PROCESS
//
// The same two reasons as drafting and salvage. Eight sequential model calls is
// under a minute but well past what a browser will wait on, so the route starts
// this and returns 202 and the screen polls. And an in-memory job is a job the
// server forgets on restart — a run that has already been paid for is exactly
// the thing that must survive one.
//
// WHY THE LOCK IS A ca_runs ROW
//
// Because it already is, everywhere else here. `triage-<id>` sits alongside
// `edition-<id>` and `salvage-<id>`, and the unique index on
// ca_runs(mode) WHERE status='running' is what stops two of these racing — which
// matters more here than elsewhere, since two triage runs would each write a
// verdict onto the same rows and the loser's would win at random.

const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const L = require(path.join(ROOT, 'content-pipeline', 'ca-daily', 'lib'));
L.loadEnv();

const db = require(path.join(__dirname, '..', 'src', 'db'));
const T = require(path.join(__dirname, '..', 'src', 'lib', 'triage'));

const editionId = Number(process.argv[2]);
if (!editionId) {
  console.error('Usage: node server/scripts/triage-edition.js <editionId> [--plan] [--redo]');
  process.exit(2);
}

const arg = (n, d = null) => {
  const i = process.argv.indexOf(`--${n}`);
  return i === -1 ? d : process.argv[i + 1];
};

const args = {
  plan: process.argv.includes('--plan'),
  redo: process.argv.includes('--redo'),
  runId: Number(arg('run-id', 0)) || null,
  batch: Number(arg('batch', 0)) || T.BATCH_SIZE,
  limit: Number(arg('limit', 0)) || 0,
  // The CHEAP model by default, and that is the point of the stage.
  //
  // Triage reads supplied text and returns a label. It recalls nothing, writes
  // nothing a student will read, and a wrong call costs one article out of a
  // hundred. Drafting recalls Articles, sections and landmark cases from memory
  // and a wrong call teaches a candidate something false. The two jobs have
  // opposite requirements, and the shortlist model exists in .env precisely to
  // let the cheap one have the cheap model.
  model: arg('model', null) || process.env.OPENAI_SHORTLIST_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini',
};

// A row left at 'running' IS the lock, so whatever kills this process it is
// closed on the way out — otherwise every later triage on this edition is
// refused as already in progress and nothing can say otherwise.
let openRunId = null;

const log = [];
const say = (m) => {
  console.log(`[triage ${editionId}] ${m}`);
  log.push(m);
};

async function main() {
  const edition = db
    .prepare('SELECT id, date, publication, status, articles_found FROM np_editions WHERE id = ?')
    .get(editionId);
  if (!edition) throw new Error(`No edition ${editionId}`);
  if (edition.status !== 'processed') {
    throw new Error(`Edition ${editionId} is '${edition.status}' — process it first.`);
  }

  if (args.plan) {
    const rows = T.pendingRows(db, editionId, { redo: args.redo });
    const vetoed = T.vetoedRows(db, editionId);
    say(`${rows.length} article(s) would be classified in ${Math.ceil(rows.length / args.batch)} call(s).`);
    say(`${vetoed.length} already dropped by the processing veto — those cost nothing.`);
    if (rows.length) {
      say('');
      say('The first article, exactly as the model would receive it:');
      say('');
      say(T.renderArticle(rows[0]));
    }
    say('');
    say('PLAN ONLY — nothing was called and nothing was written.');
    return;
  }

  openRunId =
    args.runId ||
    L.startRun(db, {
      windowStart: edition.date,
      windowEnd: edition.date,
      mode: `triage-${editionId}`,
      model: args.model,
    });

  say(`${edition.publication} ${edition.date} — ${edition.articles_found} article(s) stored`);

  const result = await T.classify(db, {
    editionId,
    model: args.model,
    batchSize: args.batch,
    onLog: say,
    redo: args.redo,
  });

  // `candidates` is what was looked at and `drafted` is what survived into a
  // lane that spends money, which is what these two columns mean on every other
  // run in this table. `discarded` is the drop pile.
  L.finishRun(db, openRunId, {
    status: 'done',
    candidates: result.articles,
    drafted: result.high + result.partial,
    discarded: result.drop,
    log: log.join('\n').slice(0, 20000),
  });
  openRunId = null;

  say(
    `Done. ${result.high} article(s) go to full drafting, ${result.partial} to short entries, ` +
      `${result.drop} dropped and kept in the log.`
  );
  if (result.problems.length) {
    say(`${result.problems.length} problem(s) during classification — see the log above.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    if (openRunId != null) {
      try {
        L.finishRun(db, openRunId, {
          status: 'failed',
          candidates: 0,
          drafted: 0,
          discarded: 0,
          log: `${log.join('\n')}\n\n${String(e && e.stack ? e.stack : e)}`.slice(0, 20000),
        });
      } catch {
        // Nothing further to do — the original error has already been printed.
      }
    }
    process.exit(1);
  });
