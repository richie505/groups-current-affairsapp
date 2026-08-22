#!/usr/bin/env node
'use strict';

// SECTION 3 — promotes scored articles from one edition into drafted knowledge
// items, in its own process.
//
//   node server/scripts/draft-articles.js <editionId> [options]
//
//     --min-score N      only articles scoring at or above this (default 45)
//     --limit N          stop after N articles (default: no limit — draft them all)
//     --model <id>       override OPENAI_MODEL
//     --mcqs-per 4       questions per item (default 4)
//     --no-mcqs          draft the notes only, skip question generation
//     --article ID,ID    redraft these specific articles, whatever they score
//     --redraft          include articles that already produced an item
//     --dry-run          print what would be drafted, write nothing
//
// WHY A SEPARATE PROCESS
//
// Same reason as process-edition.js, but for a different bottleneck. Drafting is
// one model call per article and each takes several seconds, so twenty articles
// is minutes of wall-clock — far past what a browser will wait for. The route
// starts this and returns 202; the client polls the run.
//
// Unlike process-edition.js the work here is network-bound rather than CPU-bound,
// so it would not block the event loop. It still runs out-of-process, because the
// alternative is an in-memory job the server forgets on restart, and a run that
// has already been paid for is exactly the thing that must survive one.
//
// WHY THE LOCK IS A ca_runs ROW
//
// There was no need for a new state column. `ca_runs` already exists to make
// pipeline runs auditable, already has a status machine and an admin screen, and
// a run keyed to this edition is both the lock and the audit record. A second
// request while one is running finds the row and is refused.

const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const L = require(path.join(ROOT, 'content-pipeline', 'ca-daily', 'lib'));
const D = require(path.join(__dirname, '..', 'src', 'lib', 'draft'));

L.loadEnv();

const db = require(path.join(__dirname, '..', 'src', 'db'));
const { checkCorrections, correctionsPromptBlock } = require(
  path.join(__dirname, '..', 'src', 'lib', 'corrections')
);
const { validateItem } = require(path.join(__dirname, '..', 'src', 'routes', 'admin'));

// Held at module scope so the catch at the bottom can close a run that main()
// opened before it threw.
let openRunId = null;

function parseArgs(argv) {
  const args = {
    editionId: Number(argv[2]),
    // 45, not 55.
    //
    // At 55 a whole edition yielded six items and the model discarded NONE of
    // them — and a drafting stage that never discards is one whose input was
    // pre-filtered so hard it had no judgement left to exercise. The band from
    // 45 to 54 is where the examinable Andhra Pradesh material was sitting: a
    // Rs 221-crore medical-infrastructure spend, tenant farmers seeking crop
    // loans, a Supreme Court comment on MGNREGA, an NGT floodplain case.
    //
    // The score gate is a cheap filter, not a judgement. Below 45 the density of
    // local crime and features rises sharply; between 45 and 55 the model's own
    // DISCARD step is a better filter than the score is, and letting it run is
    // what makes the discard rate mean something.
    minScore: 45,
    // No cap by default. A run that silently leaves articles behind means the
    // admin has to notice the remainder and click again, and the whole point of
    // the button is that one press finishes the edition. SQLite reads -1 as no
    // limit.
    limit: -1,
    model: process.env.OPENAI_MODEL || 'gpt-4o',
    redraft: false,
    dryRun: false,
    noMcqs: false,
    mcqsPer: 4,
    // Specific articles, by id. For re-drafting a known-bad item after the
    // segmenter has been corrected: the score gate and the already-drafted
    // filter are both bypassed, because the reason for the run is the article,
    // not its rank.
    articleIds: null,
  };
  for (let i = 3; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--min-score') args.minScore = Number(argv[++i]);
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--model') args.model = argv[++i];
    else if (a === '--mcqs-per') args.mcqsPer = Number(argv[++i]);
    else if (a === '--no-mcqs') args.noMcqs = true;
    else if (a === '--redraft') args.redraft = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--article') args.articleIds = String(argv[++i]).split(',').map(Number).filter(Boolean);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!Number.isInteger(args.editionId) || args.editionId <= 0) {
    console.error('Usage: node server/scripts/draft-articles.js <editionId> [--min-score 55]');
    process.exit(2);
  }

  const edition = db.prepare('SELECT * FROM np_editions WHERE id = ?').get(args.editionId);
  if (!edition) {
    console.error(`No edition ${args.editionId}.`);
    process.exit(2);
  }

  // Ordered by score so that if --limit bites, it takes the best articles and
  // not an arbitrary page-order slice. A limit that silently drops the most
  // examinable story would make the whole score pointless.
  const articles = args.articleIds
    ? db
        .prepare(
          `SELECT * FROM np_articles WHERE edition_id = ? AND id IN (${args.articleIds
            .map(() => '?')
            .join(',')}) ORDER BY page`
        )
        .all(edition.id, ...args.articleIds)
    : db
        .prepare(
          `SELECT * FROM np_articles
            WHERE edition_id = ?
              AND status NOT IN ('duplicate', 'discarded')
              AND (score IS NOT NULL AND score >= ?)
              ${args.redraft ? '' : 'AND item_id IS NULL'}
            ORDER BY score DESC, ap DESC, page
            LIMIT ?`
        )
        .all(edition.id, args.minScore, args.limit);

  const log = [];
  const say = (line) => {
    console.log(`[edition ${edition.id}] ${line}`);
    log.push(line);
  };

  if (!articles.length) {
    say(`No articles at or above ${args.minScore} awaiting drafting.`);
    process.exit(0);
  }

  const runId = args.dryRun
    ? null
    : (openRunId = L.startRun(db, {
        windowStart: edition.date,
        windowEnd: edition.date,
        mode: `edition-${edition.id}`,
        model: args.model,
      }));

  // Roughly 33 seconds per article across every run so far: one call for the
  // note, one for the questions. Printed so a long run is a known wait rather
  // than an open one.
  const eta = Math.max(1, Math.round((articles.length * 33) / 60));
  say(
    `${articles.length} article(s) from ${edition.publication} ${edition.date}` +
      `, model ${args.model}${args.dryRun ? ' — DRY RUN' : ''} — about ${eta} min`
  );

  const prompt = L.readPrompt('prompt-draft.txt');
  const mcqPrompt = L.readPrompt('prompt-mcq.txt');
  // Shared across the whole run and across the whole corpus, so a question
  // already asked of another item is not asked again here.
  const seenHashes = L.existingQuestionHashes(db);
  // The controlled vocabularies the drafting prompt appends. Read from the
  // database rather than a file so the prompt and the canonicaliser in
  // insertDrafted are always looking at the same list — a prompt offering units
  // the checker will reject is how tags go missing.
  const units = db.prepare('SELECT unit_code, label FROM ref_units ORDER BY unit_code').all();
  const keywords = db
    .prepare('SELECT keyword, subject FROM ref_keywords ORDER BY subject, keyword')
    .all();
  const vocabulary = [
    '=== PAPER UNITS (use the CODE only, e.g. "P3-U7") ===',
    ...units.map((u) => `${u.unit_code} — ${u.label}`),
    '',
    // Grouped by subject, matching the web lane, rather than one term per line
    // with its subject beside it. The per-line form invited the model to return
    // "Election [Polity]" as the keyword, and 20 of the first 84 tags came back
    // that way. `insertDrafted` now strips the bracket regardless, but a prompt
    // that does not ask for the fault is better than a repair that removes it.
    '=== BLUEPRINT KEYWORD ANGLES (use the term exactly, without the subject) ===',
    ...Object.entries(
      keywords.reduce((acc, k) => {
        (acc[k.subject || 'Other'] = acc[k.subject || 'Other'] || []).push(k.keyword);
        return acc;
      }, {})
    ).map(([subject, list]) => `${subject}: ${list.join(', ')}`),
    '',
    // Told to the model as well as checked afterwards. The check catches a
    // superseded position; telling it first stops the position being written.
    correctionsPromptBlock(db),
  ].join('\n');

  const drafted = [];
  const discarded = [];

  for (const [i, article] of articles.entries()) {
    const label = `[${i + 1}/${articles.length}] ${Math.round(article.score)} ${article.band}`;
    let record;
    try {
      record = await D.draftArticle(db, {
        article,
        edition,
        model: args.model,
        vocabulary,
        prompt,
      });
    } catch (e) {
      say(`${label} FAILED — ${e.message}: ${(article.headline || '').slice(0, 60)}`);
      continue;
    }

    if (record && record.discard) {
      say(`${label} DISCARD — ${record.discard_reason}`);
      discarded.push({ _articleId: article.id, discard_reason: record.discard_reason });
      continue;
    }
    if (!record || !record.headline) {
      say(`${label} SKIPPED — the model returned no headline`);
      continue;
    }

    D.normaliseTextFields(record);

    // The angle rule, applied before anything else is spent on this item. An
    // item with no argument will never reach an answer, so filing it to the
    // Group-I lane would inflate the bank counts with unusable material.
    if (Number(record.relevance_g1) === 1 && !String(record.g1_angle || '').trim()) {
      const reason =
        'No angle produced — an item that cannot be argued from is not examinable for Group I.';
      say(`${label} DISCARD (no angle) — ${(record.headline || '').slice(0, 55)}`);
      discarded.push({ _articleId: article.id, discard_reason: reason });
      continue;
    }

    // The article is the provenance, and the edition row knows it exactly. The
    // model is told to return no sources at all; anything it returns anyway is
    // dropped here rather than trusted, because a fabricated URL on a print item
    // is worse than no citation.
    record.sources = [
      {
        url: '',
        publisher:
          `${edition.publication}` +
          `${edition.edition ? ` (${edition.edition})` : ''}` +
          `, ${edition.date}, p.${article.page ?? '?'}`,
        // A newspaper report is secondary. PIB, PRS, RBI and department portals
        // are primary, and conflating them would quietly weaken every "rests
        // only on secondary reporting" warning the review queue shows.
        is_primary: 0,
        fetched_at: edition.date,
      },
    ];
    record._articleId = article.id;

    // What KIND of piece this came from, and whose claims these therefore are.
    // Stamped before the verify-note default below, because on an opinion source
    // it writes a specific note where that default would write a generic one.
    D.markProvenance(record, { ...article, publication: edition.publication });

    // The flag is left to the model; only the NOTE is guaranteed.
    //
    // It used to be forced to 1 here, on the reasoning that a single print
    // report is not the cross-check the research discipline requires. True, but
    // it made the flag useless: 100% of bridged items carried it, against 37% on
    // the web lane where the model decides. A warning that fires on everything
    // distinguishes nothing, and the student learns to look past it — so the one
    // item that genuinely could not be confirmed reads exactly like the forty
    // that could.
    //
    // The note is the part that was doing the work anyway. Across the first 49
    // items the generic fallback below never once fired: the model always wrote
    // something specific and checkable ("verify the 19 August MHA order and the
    // Citizenship Rules against the Gazette"). The review queue renders the note
    // whether or not the flag is set, so the reviewer keeps their checklist
    // either way, and the badge goes back to meaning something.
    //
    // The corrections guard below still raises the flag on a hit, which is
    // exactly the case where a reader should be cautioned.
    if (!String(record.verify_note || '').trim()) {
      record.verify_note =
        'Drafted from a single print report. Confirm names, figures and dates ' +
        'against a primary source before publishing.';
    }

    // Section 2's verdict is the fallback for the fields it already computed,
    // so an unanswered field lands on the measured value rather than a default.
    if (!record.bucket && article.bucket) record.bucket = article.bucket;

    // The corrections guard. This is the single most expensive failure mode the
    // app has — a wrong current-affairs fact cannot be caught against a
    // textbook — and a newspaper is no protection against it: a paper reporting
    // on the 16th Finance Commission may still describe the old award period in
    // its background paragraph. A 'high' hit still goes to the queue, flagged,
    // because whether the usage is actually wrong depends on context and only a
    // person can judge that.
    const hits = checkCorrections(db, record).filter((h) => h.severity === 'high');
    if (hits.length) {
      record.needs_verify = 1;
      record.verify_note = [
        record.verify_note || '',
        `Possibly states a superseded position: ${hits
          .map((h) => `${h.topic} — correct position: ${h.correct_position}`)
          .join(' | ')}`,
      ]
        .filter(Boolean)
        .join(' ');
      say(`${label} ⚠ correction hit (${hits.map((h) => h.topic).join(', ')})`);
    }

    // The same validation the admin editor and the web lane apply. Checked here
    // rather than trusted, so a malformed record is reported as a sentence now
    // instead of as a constraint failure that rolls back the whole batch later.
    const itemErrors = validateItem(record);
    if (itemErrors.length) {
      say(`${label} INVALID — ${itemErrors.join(' ')}`);
      continue;
    }

    // Questions, in the formats the PYQ evidence for this item's primary angle
    // actually asks for. Without these the Group-II lane gets notes and no
    // practice, which is half a lane.
    record.mcqs =
      args.noMcqs || Number(record.relevance_g2) === 0
        ? []
        : await D.generateMcqs(db, {
            record,
            index: i,
            count: args.mcqsPer,
            model: args.model,
            mcqPrompt,
            seenHashes,
            fallbackDate: edition.date,
            onLog: say,
          });

    drafted.push(record);
    say(
      `${label} DRAFT — ${record.headline.slice(0, 70)} ` +
        `[${record.bucket}/T${record.importance || 2}] ${record.mcqs.length} question(s)`
    );
  }

  // The discard rate, reported for the same reason the web lane reports it: a
  // run that discards nothing has stopped filtering, and that is invisible
  // unless it is said out loud.
  //
  // This lane will sit lower than the web lane by design — articles arriving
  // here have already passed the relevance score, so the ruthlessness happened
  // upstream and a low rate is expected rather than alarming. A rate of exactly
  // zero across a whole edition is still worth seeing, because it is equally
  // consistent with a threshold set too low.
  const considered = articles.length;
  const rate = considered ? Math.round((discarded.length / considered) * 100) : 0;
  say('');
  say(`Considered ${considered} · drafted ${drafted.length} · discarded ${discarded.length} (${rate}%)`);
  if (!discarded.length && considered >= 5) {
    say(
      'NOTE: nothing was discarded. The score gate upstream does most of the ' +
        'filtering here, but a run that never discards is also what a threshold ' +
        'set too low looks like — check the weakest item that got through.'
    );
  }

  if (args.dryRun) {
    console.log(JSON.stringify({ drafted, discarded }, null, 2));
    say(`DRY RUN: ${drafted.length} would be drafted, ${discarded.length} discarded.`);
    process.exit(0);
  }

  const result = D.insertDrafted(db, {
    date: edition.date,
    drafted,
    discarded,
    onLog: say,
  });

  L.finishRun(db, runId, {
    status: 'done',
    candidates: articles.length,
    drafted: result.itemIds.length,
    discarded: discarded.length,
    log: log.join('\n'),
  });

  say(
    `Done: ${result.itemIds.length} item(s) into the review queue for ${edition.date}, ` +
      `${discarded.length} discarded.`
  );
  say('Nothing is visible to students until you approve it in Admin → Review queue.');
  process.exit(0);
}

// A run row left at 'running' is worse than a failed one: it is the lock, so it
// would refuse every later attempt on this edition with "already running" and
// there would be nothing to tell the admin otherwise. Whatever kills the
// process, the row is closed on the way out.
main().catch((e) => {
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
      // Nothing further to do — the original error is what matters, and it has
      // already been printed.
    }
  }
  process.exit(1);
});
