#!/usr/bin/env node
'use strict';

// Fills `static_notes` on items drafted before the field existed.
//
//   node server/scripts/backfill-static-notes.js [--date YYYY-MM-DD] [--dry-run]
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

const args = {
  date: null,
  dryRun: process.argv.includes('--dry-run'),
  model: process.env.OPENAI_MODEL || 'gpt-4o',
};
const di = process.argv.indexOf('--date');
if (di !== -1) args.date = process.argv[di + 1];

// The same brief the drafting prompt carries, so a backfilled item is
// indistinguishable from one drafted with the field in place. Kept here rather
// than imported because prompt-draft.txt describes a whole JSON record and this
// asks for one field of it.
const SYSTEM = `You are preparing material for the Andhra Pradesh Public Service
Commission (APPSC) Group-I and Group-II examinations.

You will be given a current-affairs note. Return the STATIC syllabus material
that sits underneath it — whatever a candidate must already know for this news
to be usable in an answer, set out so they need not go anywhere else.

For a news item about judicial review: what judicial review is, its
constitutional basis (Articles 13, 32, 226, 137), the basic-structure doctrine,
the landmark cases, the limits of the power, and the standing debate about
judicial overreach.

Rules:
- Markdown. 150-300 words. Subheadings where the topic has natural parts.
- Bold every Article, section, case name, year, body and figure. Those are the
  recall targets.
- The settled position ONLY. No "recently", no "currently", no reference to the
  news item itself — this is the part that does not change with the day.
- Where the syllabus topic has an Andhra Pradesh dimension, include it.

Return JSON: {"static_notes": "..."} and nothing else. If the news genuinely
rests on no static syllabus topic, return {"static_notes": ""}.`;

async function main() {
  const rows = db
    .prepare(
      `SELECT i.id, i.headline, i.notes_markdown, i.static_linkage, i.g1_angle, d.date
         FROM ca_items i JOIN ca_days d ON d.id = i.day_id
        WHERE TRIM(i.static_notes) = ''
          AND i.status <> 'discarded'
          ${args.date ? 'AND d.date = ?' : ''}
        ORDER BY i.id`
    )
    .all(...(args.date ? [args.date] : []));

  if (!rows.length) {
    console.log('Nothing to backfill.');
    return;
  }

  console.log(
    `${rows.length} item(s) without static notes${args.date ? ` on ${args.date}` : ''}` +
      `, model ${args.model} — about ${Math.max(1, Math.round((rows.length * 17) / 60))} min`
  );
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

  for (const [i, r] of rows.entries()) {
    const user = [
      `HEADLINE: ${r.headline}`,
      r.static_linkage ? `STATIC TOPICS THIS UPDATES: ${r.static_linkage}` : '',
      r.g1_angle ? `THE ARGUMENT IT SUPPORTS: ${r.g1_angle}` : '',
      '',
      'THE NOTE:',
      r.notes_markdown || '',
    ]
      .filter(Boolean)
      .join('\n');

    let notes = '';
    try {
      const raw = await L.complete({ system: SYSTEM, user, model: args.model });
      notes = String(L.parseJson(raw).static_notes || '').trim();
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

  console.log(`\nFilled ${done}, left blank ${empty}, of ${rows.length}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
