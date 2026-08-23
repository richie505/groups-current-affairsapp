#!/usr/bin/env node
'use strict';

// SECTION 3 — promotes scored articles from one edition into drafted knowledge
// items, in its own process.
//
//   node server/scripts/draft-articles.js <editionId> [options]
//
//     --min-score N      flat threshold — only articles scoring at or above
//                        this. Overrides the adaptive selection below.
//     --max N            cap on how many the adaptive selection takes (35)
//     --min N            floor, so a thin edition still yields a digest (12)
//     --limit N          stop after N articles (default: no limit — draft them all)
//     --model <id>       override OPENAI_MODEL
//     --mcqs-per 4       BASE questions per item (default 4). The actual count
//                        rises with how many objective syllabus units the item
//                        feeds — see mcqCountFor in src/lib/draft.js. Three of
//                        the four APPSC papers are answered by ticking a box.
//     --no-mcqs          draft the notes only, skip question generation
//     --article ID,ID    redraft these specific articles, whatever they score
//     --redraft          include articles that already produced an item
//     --plan             print the SELECTION and stop — no model calls, no cost
//     --dry-run          draft everything and print it, but write nothing.
//                        Note this still pays for every model call.
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
const SELECT = require(path.join(__dirname, '..', 'src', 'lib', 'select'));

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
    // null means ADAPTIVE — the syllabus-led selection in src/lib/select.js.
    //
    // The old default was a flat 45, chosen because 55 filtered so hard the
    // model had no judgement left to exercise and the 45-54 band held the
    // examinable AP material. That reasoning was right about the SYMPTOM and
    // wrong about the fix: the problem was never where to put the line, it was
    // that one line over a five-factor blend cannot separate "examinable" from
    // "scored well for other reasons". Measured over 248 articles, a flat 45
    // drafted 10 that feed no syllabus unit and skipped 54 that do.
    //
    // Passing --min-score explicitly restores the flat threshold, which is
    // still the right tool for re-running a known set.
    minScore: null,
    // Bounds on the adaptive selection. A thin paper should still yield a
    // digest; a rich one should not yield ninety items nobody can read.
    maxItems: null,
    minItems: null,
    // No cap by default. A run that silently leaves articles behind means the
    // admin has to notice the remainder and click again, and the whole point of
    // the button is that one press finishes the edition. SQLite reads -1 as no
    // limit.
    limit: -1,
    model: process.env.OPENAI_MODEL || 'gpt-4o',
    redraft: false,
    dryRun: false,
    // Print the selection and stop. Unlike --dry-run this makes NO model call:
    // --dry-run drafts everything and declines to save it, which costs the same
    // money and the same twenty minutes. When the question is "which articles
    // would this pick", paying to find out is the wrong answer.
    plan: false,
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
    else if (a === '--max') args.maxItems = Number(argv[++i]);
    else if (a === '--min') args.minItems = Number(argv[++i]);
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--model') args.model = argv[++i];
    else if (a === '--mcqs-per') args.mcqsPer = Number(argv[++i]);
    else if (a === '--no-mcqs') args.noMcqs = true;
    else if (a === '--redraft') args.redraft = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--plan') args.plan = true;
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

  // WHICH ARTICLES. Three paths, in order of how much the admin asked for.
  //
  //   --article ids   hand-picked; the gate is the person, so no rule applies
  //   --min-score N   the old flat threshold, kept as an explicit override
  //   (neither)       the adaptive, syllabus-led selection — the default
  //
  // The default changed. A flat `score >= 45` is one number over a blend of
  // five factors, so it was wrong in both directions at once: across 248 scored
  // articles it drafted 10 that feed no syllabus unit and skipped 54 that do.
  // See server/src/lib/select.js for the measurement and the rule.
  let selection = null;
  const articles = args.articleIds
    ? db
        .prepare(
          `SELECT * FROM np_articles WHERE edition_id = ? AND id IN (${args.articleIds
            .map(() => '?')
            .join(',')}) ORDER BY page`
        )
        .all(edition.id, ...args.articleIds)
    : args.minScore != null
      ? db
          .prepare(
            `SELECT * FROM np_articles
              WHERE edition_id = ?
                AND status NOT IN ('duplicate', 'discarded')
                AND (score IS NOT NULL AND score >= ?)
                ${args.redraft ? '' : 'AND item_id IS NULL'}
              ORDER BY score DESC, ap DESC, page
              LIMIT ?`
          )
          .all(edition.id, args.minScore, args.limit)
      : (() => {
          const rows = SELECT.candidateRows(db, edition.id).filter(
            (r) => args.redraft || !db.prepare('SELECT item_id FROM np_articles WHERE id = ?').get(r.id).item_id
          );
          selection = SELECT.selectForDrafting(rows, {
            ...(args.maxItems ? { maxItems: args.maxItems } : {}),
            ...(args.minItems ? { minItems: args.minItems } : {}),
          });
          const ids = selection.picked.map((r) => r.id);
          if (!ids.length) return [];
          const full = db
            .prepare(`SELECT * FROM np_articles WHERE id IN (${ids.map(() => '?').join(',')})`)
            .all(...ids);
          // Keep the ranked order: if anything is going to be cut short, the
          // syllabus-anchored ones must be the ones already drafted.
          const rank = new Map(selection.picked.map((r) => [r.id, r]));
          return full
            .sort((a, b) => rank.get(b.id).rank - rank.get(a.id).rank)
            .slice(0, args.limit > 0 ? args.limit : undefined);
        })();

  const log = [];
  const say = (line) => {
    console.log(`[edition ${edition.id}] ${line}`);
    log.push(line);
  };

  if (!articles.length) {
    say(
      args.minScore != null
        ? `No articles at or above ${args.minScore} awaiting drafting.`
        : 'Nothing selected — every article either feeds no syllabus unit or is already drafted.'
    );
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

  // WHY THESE, AND WHAT IT COST TO LEAVE THE REST.
  //
  // An automatic selection that does not explain itself is one nobody can
  // correct. The two numbers that matter are how many of the chosen articles
  // actually connect to the syllabus, and — more usefully — which high-scoring
  // articles were turned down for connecting to nothing. That second list is
  // not a list of mistakes: it is the vocabulary's to-do list. Four of the ten
  // it currently rejects are genuinely examinable and unmatched only because
  // the syllabus map has a gap (a named Act, an inter-state water dispute).
  if (selection) {
    const anchored = selection.picked.filter((r) => r.units).length;
    say(
      `  selected adaptively: ${anchored} of ${selection.picked.length} feed a syllabus unit` +
        ` (rank = 55% syllabus leverage + 45% score)`
    );
    const nearMiss = selection.rejected
      .filter((r) => !r.units && r.score >= 45)
      .slice(0, 6);
    if (nearMiss.length) {
      say(`  turned down, scored 45+ but match NO syllabus unit — check the map for gaps:`);
      for (const r of nearMiss) {
        say(`    ${String(Math.round(r.score)).padStart(3)}  ${(r.headline || '').slice(0, 58)}`);
      }
    }
  }

  // --plan stops here, before the first model call.
  if (args.plan) {
    if (selection) {
      say('');
      say('rank  score  units  headline');
      for (const r of selection.picked) {
        say(
          `${String(r.rank).padStart(4)}   ${String(Math.round(r.score)).padStart(3)}` +
            `    ${String(r.units).padStart(2)}   ${(r.headline || '').slice(0, 62)}`
        );
      }
    } else {
      for (const a of articles) {
        say(`  ${String(Math.round(a.score)).padStart(3)}  ${(a.headline || '').slice(0, 66)}`);
      }
    }
    say('');
    say(`PLAN ONLY — ${articles.length} article(s) would be drafted. Nothing was called or written.`);
    process.exit(0);
  }

  const prompt = L.readPrompt('prompt-draft.txt');
  const mcqPrompt = L.readPrompt('prompt-mcq.txt');
  // Shared across the whole run and across the whole corpus, so a question
  // already asked of another item is not asked again here.
  const seenHashes = L.existingQuestionHashes(db);
  // The controlled vocabularies the drafting prompt appends. Read from the
  // database rather than a file so the prompt and the canonicaliser in
  // insertDrafted are always looking at the same list — a prompt offering units
  // the checker will reject is how tags go missing.
  // DESCRIPTIVE units only.
  //
  // The listing used to be every row in ref_units, which quietly put the
  // objective syllabus units — Group-II and Group-I Prelims — in front of the
  // model as things to choose. They are not: Section 2 matched them against the
  // published syllabus before this ran, and insertDrafted attaches them itself.
  //
  // Offering them anyway did real damage in both directions. Told nothing, the
  // model returned fourteen units for one story, half of them objective codes
  // it had copied back from the findings; told not to copy them, it returned
  // three objective codes and no descriptive ones at all. Both are the same
  // fault — a prompt that says one thing in the instructions and the opposite
  // in the vocabulary, and the vocabulary wins.
  //
  // So the contradiction is removed at source. What is left is the one question
  // that is genuinely the model's: which of the five WRITTEN papers this story
  // serves.
  const units = db
    .prepare(
      `SELECT unit_code, label FROM ref_units
        WHERE format = 'descriptive' AND unfeedable = 0
        ORDER BY unit_code`
    )
    .all();
  const keywords = db
    .prepare('SELECT keyword, subject FROM ref_keywords ORDER BY subject, keyword')
    .all();
  const vocabulary = [
    '=== GROUP-I MAINS PAPER UNITS — the WRITTEN papers (use the CODE only, e.g. "P3-U7") ===',
    'The objective syllabus units are settled elsewhere and are not chosen here.',
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
  const failed = [];
  const itemIds = [];

  // A QUEUE, NOT A LIST, SO THAT AN OUTAGE COSTS TIME RATHER THAN ARTICLES.
  //
  // The 23 August run drafted 72 hand-picked articles and lost 29 of them to
  // "fetch failed" in two bursts — including everything scoring 61, 61, 58, 57,
  // 57, 54, 52, 50 and 48. The call layer now retries a dropped connection
  // (see isTransient in ca-daily/lib.js), which handles a blip. It does not
  // handle a two-minute outage, because four retries at 1.5s doubling is about
  // twenty seconds.
  //
  // So a failure goes to the back of the queue and is tried once more after
  // every other article has had its turn. By then several minutes have passed
  // without a fixed sleep, and the second pass costs nothing when the first one
  // was clean. Only ONE re-queue: an article that fails twice, minutes apart, is
  // failing for a reason a third attempt will not fix.
  const queue = articles.map((a) => ({ article: a, pass: 1 }));
  for (let i = 0; i < queue.length; i += 1) {
    const { article, pass } = queue[i];
    const label =
      `[${Math.min(i + 1, articles.length)}/${articles.length}]` +
      `${pass > 1 ? ' RETRY' : ''} ${Math.round(article.score)} ${article.band}`;
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
      if (pass === 1) {
        say(`${label} failed (${e.message.slice(0, 80)}) — re-queued for a second pass`);
        queue.push({ article, pass: 2 });
      } else {
        say(`${label} FAILED TWICE — ${e.message}: ${(article.headline || '').slice(0, 60)}`);
        failed.push({ article, error: e.message });
      }
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

    // WRITTEN NOW, NOT AT THE END.
    //
    // This used to accumulate every record in memory and insert once, after the
    // last article. A 30-article run is about twenty minutes and a 70-article
    // run is nearly an hour, and for that whole time everything already paid for
    // lived only in a variable. Killing the process at article 13 of 30 — a
    // timeout, a closed laptop, Ctrl-C on a run that looked stuck — threw away
    // thirteen drafts and their questions and left nothing behind but the API
    // charge. That is not hypothetical: it happened on the 23 August recovery
    // run and cost the lot.
    //
    // One transaction per item instead of one for the batch. SQLite does not
    // care at this scale, and a run can now be interrupted at any point with
    // everything before that point already safe on disk. `--redraft` is the
    // resume: articles that produced an item are skipped.
    if (!args.dryRun) {
      const written = D.insertDrafted(db, { date: edition.date, drafted: [record], onLog: say });
      itemIds.push(...written.itemIds);
    }
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
  say(
    `Considered ${considered} · drafted ${drafted.length} · discarded ${discarded.length} (${rate}%)` +
      `${failed.length ? ` · FAILED ${failed.length}` : ''}`
  );

  // A LOSS IS REPORTED AS A LOSS, WITH THE COMMAND THAT UNDOES IT.
  //
  // The old summary counted only what was drafted and what was discarded, so a
  // run that lost 29 of 72 articles printed "drafted 33 · discarded 9" and
  // called itself done. The two numbers did not add up to the input and nothing
  // said so. Anything that failed is named here, with the exact re-run, because
  // an admin who has to reconstruct an article list from a scrolled log will
  // not do it.
  if (failed.length) {
    say('');
    say(`${failed.length} article(s) could not be drafted after two passes:`);
    for (const f of failed) {
      say(`  ${f.article.id}  ${Math.round(f.article.score)}  ${(f.article.headline || '').slice(0, 58)}`);
    }
    say('Re-run just those with:');
    say(
      `  node server/scripts/draft-articles.js ${edition.id} ` +
        `--article ${failed.map((f) => f.article.id).join(',')} --min-score 0`
    );
  }
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

  // Only the discards are left to write — every draft was persisted as it was
  // produced. A discard is one UPDATE against an article that is already on
  // disk, so batching those costs nothing to lose.
  D.insertDrafted(db, { date: edition.date, drafted: [], discarded, onLog: say });

  L.finishRun(db, runId, {
    status: 'done',
    candidates: articles.length,
    drafted: itemIds.length,
    discarded: discarded.length,
    log: log.join('\n'),
  });

  say(
    `Done: ${itemIds.length} item(s) into the review queue for ${edition.date}, ` +
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
