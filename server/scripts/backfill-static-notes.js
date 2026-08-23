#!/usr/bin/env node
'use strict';

// Fills — or rewrites — `static_notes`, the standing material behind an item.
//
//   node server/scripts/backfill-static-notes.js [--date YYYY-MM-DD] [--dry-run]
//   node server/scripts/backfill-static-notes.js --rewrite [--date YYYY-MM-DD]
//
// WHAT --rewrite IS FOR
//
// The brief for this field was restructured: five fixed headings, a key-facts
// table, a section on the near-neighbours an objective paper uses as
// distractors, and one governing rule — the news chooses the SCOPE, the news is
// never the CONTENT. The old brief asked for 150-300 words with free-form
// subheadings, and what came back was a short essay: 'Social and environmental
// dimensions' is a heading for a paper that no longer exists in this app.
//
// Without --rewrite this script only touches items whose static notes are
// EMPTY, which is right for a backfill and useless for a restructure. With it,
// items that already have notes are rewritten in the new shape.
//
// It is a rewrite of one column and nothing else. A published item stays
// published, its questions are untouched, and its notes and prelims facts are
// exactly as they were — so this can be run against live material without
// putting anything back through review.
//
// WHY NOT JUST REDRAFT THEM
//
// A redraft rewrites the whole item, supersedes it, and leaves a fresh draft
// needing review and publishing again — for items that are already published and
// already correct. It also costs two model calls each rather than one, and would
// churn every field to fill one.
//
// So this asks for the static material alone, from what the item already says,
// and writes only that column. Nothing else about the item moves, and a
// published item stays published.

const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const L = require(path.join(ROOT, 'content-pipeline', 'ca-daily', 'lib'));
L.loadEnv();
const db = require(path.join(__dirname, '..', 'src', 'db'));

// HEADINGS THAT MEAN THE MODEL WROTE AN ESSAY.
//
// Not a style preference. Every paper this app serves is answered by ticking a
// box, and 'Significance', 'Way forward' and 'Challenges' are the section
// headings of a paper that no longer exists here. Under them the model writes
// the prose that goes with them — 'party mobilisation can improve
// coordination, but excessive party competition may weaken local
// deliberation' — which is an argument, cannot become a question, and cannot
// be the thing a question tests.
//
// Three of a hundred and twenty came back with one of these. That is a low
// enough rate to be invisible in a spot check and high enough to be certain on
// a nine-month corpus, which is exactly the profile of a fault that needs a
// guard rather than an eye.
const ESSAY_HEADING =
  /^#{1,6}\s.*\b(significance|challeng|way forward|critical|evaluation|conclusion|implication|prospects|assessment)/im;

const args = {
  date: null,
  dryRun: process.argv.includes('--dry-run'),
  rewrite: process.argv.includes('--rewrite'),
  limit: 0,
  model: process.env.OPENAI_MODEL || 'gpt-4o',
};
const di = process.argv.indexOf('--date');
if (di !== -1) args.date = process.argv[di + 1];
// --limit N, so a changed brief can be seen on one item before it is spent on
// fifty-six. A prompt edit is not verifiable by reading it; the only way to
// know what a brief produces is to produce something with it, and the cheapest
// version of that should be one command away.
const li = process.argv.indexOf('--limit');
if (li !== -1) args.limit = Math.max(1, Number(process.argv[li + 1]) || 1);

// THE BRIEF IS READ, NOT RESTATED.
//
// It used to be a copy of the drafting prompt's wording, pasted here and
// annotated 'the same brief the drafting prompt carries'. It was not the same
// brief for long. Two copies of an instruction are two instructions, and which
// one an item got depended on which script had last touched it — invisible in
// the output and impossible to reason about afterwards.
//
// Now both read content-pipeline/ca-daily/prompt-static.txt. The only thing
// this file adds is the output format, because the drafting lane wants this
// field inside a whole record and this one wants it alone.
const SYSTEM = `You are preparing material for the Andhra Pradesh Public Service
Commission (APPSC) examinations. Every paper this material serves is answered by
TICKING A BOX: Group-II Screening, Group-II Mains and Group-I Prelims. There is
no written paper and no argument to construct.

You will be given a current-affairs note. Return the STATIC material that sits
underneath it, written to the brief below.

${L.readPrompt('prompt-static.txt')}

Return JSON: {"static_notes": "..."} and nothing else. If the news genuinely
rests on no static syllabus topic, return {"static_notes": ""}.`;

async function main() {
  const rows = db
    .prepare(
      // `prelims_facts` comes along because it is the best statement anywhere
      // of what this item made EXAMINABLE, and the governing rule of the brief
      // is that the news chooses the scope. Handing the model the facts the
      // item will be tested on is how it knows which part of the textbook to
      // write.
      //
      // `g1_angle` used to be selected here too. That column no longer exists —
      // it went with the Group-I Mains material — and this query had been
      // throwing 'no such column' ever since, on a script nobody had rerun.
      `SELECT i.id, i.headline, i.notes_markdown, i.static_linkage,
              i.prelims_facts, i.static_notes, d.date
         FROM ca_items i JOIN ca_days d ON d.id = i.day_id
        WHERE ${args.rewrite ? "TRIM(i.static_notes) <> ''" : "TRIM(i.static_notes) = ''"}
          AND i.status <> 'discarded'
          ${args.date ? 'AND d.date = ?' : ''}
        ORDER BY i.id`
    )
    .all(...(args.date ? [args.date] : []))
    .slice(0, args.limit || undefined);

  if (!rows.length) {
    console.log(args.rewrite ? 'No items have static notes to rewrite.' : 'Nothing to backfill.');
    return;
  }

  console.log(
    `${rows.length} item(s) ${args.rewrite ? 'to REWRITE in the new shape' : 'without static notes'}` +
      `${args.date ? ` on ${args.date}` : ''}` +
      `, model ${args.model} — about ${Math.max(1, Math.round((rows.length * 17) / 60))} min`
  );
  // A rewrite overwrites material that has already been reviewed and
  // published. Said out loud with the command that gets it back, because the
  // undo for this is a backup and the time to hear about a backup is before.
  if (args.rewrite && !args.dryRun) {
    console.log('REWRITING published static notes. Back up first: node server/scripts/backup.js');
  }
  if (args.dryRun) {
    rows.forEach((r) => console.log(`   #${r.id} ${r.headline.slice(0, 62)}`));
    console.log('DRY RUN — nothing written.');
    return;
  }

  const upd = db.prepare(
    "UPDATE ca_items SET static_notes = ?, updated_at = datetime('now') WHERE id = ?"
  );
  let done = 0;
  let empty = 0;
  let retried = 0;

  for (const [i, r] of rows.entries()) {
    const user = [
      `HEADLINE: ${r.headline}`,
      r.static_linkage ? `STATIC TOPICS THIS UPDATES: ${r.static_linkage}` : '',
      '',
      'THE NOTE:',
      r.notes_markdown || '',
      '',
      // What the item is actually tested on — the scope-setter.
      r.prelims_facts ? `WHAT THIS ITEM MADE EXAMINABLE:\n${r.prelims_facts}` : '',
      // On a rewrite the old block is shown and named as superseded. Withheld,
      // the model re-researches the topic from the note alone and loses facts
      // that were correct — a restructure that quietly drops a verified section
      // number is a regression wearing the clothes of an improvement.
      args.rewrite && r.static_notes
        ? '\nTHE EXISTING BLOCK, written to a SUPERSEDED brief. Its structure is\n' +
          'wrong and its argument-shaped sections do not belong. Keep every fact\n' +
          'in it that is correct and in scope; restructure the rest:\n\n' +
          r.static_notes
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    let notes = '';
    try {
      const raw = await L.complete({ system: SYSTEM, user, model: args.model });
      notes = String(L.parseJson(raw).static_notes || '').trim();

      // ONE RETRY, WITH THE VIOLATION NAMED.
      //
      // Told what it did rather than told the rule again: the rule was already
      // in the brief and was already read. Quoting the offending heading back
      // is the difference between a reminder and a correction.
      //
      // One retry and no more. If the second attempt fails too, the block is
      // kept and reported by heading — a loop that keeps paying for the same
      // refusal is worse than a line of output a person can act on.
      const bad = ESSAY_HEADING.exec(notes);
      if (bad) {
        retried += 1;
        const raw2 = await L.complete({
          system: SYSTEM,
          user:
            `${user}\n\nYOUR PREVIOUS ATTEMPT CONTAINED THIS HEADING:\n${bad[0].trim()}\n\n` +
            'That is an argument section, and there is no written paper here. ' +
            'Rewrite using ONLY the five headings the brief names. Any fact ' +
            'underneath it that is recallable belongs in "Key facts" or in ' +
            '"The provisions that get asked"; the rest is not wanted.',
          model: args.model,
        });
        const retryNotes = String(L.parseJson(raw2).static_notes || '').trim();
        if (retryNotes && !ESSAY_HEADING.test(retryNotes)) {
          notes = retryNotes;
        } else {
          console.log(`[${i + 1}/${rows.length}] #${r.id} STILL essay-shaped — kept: ${bad[0].trim()}`);
          if (retryNotes) notes = retryNotes;
        }
      }
    } catch (e) {
      console.log(`[${i + 1}/${rows.length}] FAILED #${r.id} — ${e.message}`);
      continue;
    }

    if (!notes) {
      empty += 1;
      console.log(`[${i + 1}/${rows.length}] #${r.id} rests on no static topic — left blank`);
      continue;
    }
    upd.run(notes, r.id);
    done += 1;
    console.log(`[${i + 1}/${rows.length}] #${r.id} ${notes.length} chars — ${r.headline.slice(0, 50)}`);
  }

  console.log(
    `\nFilled ${done}, left blank ${empty}, of ${rows.length}.` +
      (retried ? ` ${retried} retried for an argument-shaped heading.` : '')
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
