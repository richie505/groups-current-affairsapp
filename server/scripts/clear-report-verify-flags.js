#!/usr/bin/env node
'use strict';

// Clears `needs_verify` on items drafted from a NEWS REPORT, leaving it on the
// opinion sources it was designed for.
//
//   node server/scripts/clear-report-verify-flags.js [--apply]
//
// Dry by default.
//
// WHY THESE ARE WRONG AND THE OPINION ONES ARE NOT
//
// The badge exists so a reviewer checks a claim against the record before it is
// published, and for an op-ed, an editorial, an interview or a column that is a
// real instruction: the evaluations and projections in the piece are the
// author's, and the record may say something else.
//
// For a news report it became boilerplate. 165 of 236 published report items on
// the live database carried it, on notes of the form "as this is based on a
// single print report, verify the date" — which is true of every newspaper
// story ever written. Seven items in ten wearing a warning is not a warning;
// it is furniture, and it trains a reviewer to click past the three that
// matter.
//
// draft.js now refuses the model's answer on a non-opinion item, so this does
// not come back. This script is for the rows written before that.
//
// THE NOTE IS KEPT. It sometimes names something specific and checkable — "the
// 19 August 2026 MHA order", "the Bench composition" — and nothing renders it
// unless the flag is set, so there is no cost to leaving it and a real cost to
// destroying it.

const path = require('path');

const db = require(path.join(__dirname, '..', 'src', 'db'));
const G = require(path.join(__dirname, '..', '..', 'content-pipeline', 'np-daily', 'genre'));

const apply = process.argv.includes('--apply');

const rows = db
  .prepare(
    `SELECT id, status, source_genre, headline, verify_note
       FROM ca_items WHERE needs_verify = 1 ORDER BY id`
  )
  .all();

const clear = rows.filter((r) => !G.isOpinion(r.source_genre));
const keep = rows.filter((r) => G.isOpinion(r.source_genre));

const upd = db.prepare('UPDATE ca_items SET needs_verify = 0 WHERE id = ?');
if (apply && clear.length) {
  db.transaction(() => {
    for (const r of clear) upd.run(r.id);
  })();
}

const byGenre = new Map();
for (const r of clear) {
  const g = r.source_genre || '(none)';
  byGenre.set(g, (byGenre.get(g) || 0) + 1);
}

console.log(`${rows.length} item(s) carry the verify flag.`);
console.log(`${apply ? 'CLEARED' : 'WOULD CLEAR'} ${clear.length} — drafted from a news report:`);
for (const [g, n] of byGenre) console.log(`    ${String(g).padEnd(12)} ${n}`);
console.log(`KEPT ${keep.length} — drafted from opinion, where the badge means something:`);
const keptBy = new Map();
for (const r of keep) keptBy.set(r.source_genre, (keptBy.get(r.source_genre) || 0) + 1);
for (const [g, n] of keptBy) console.log(`    ${String(g).padEnd(12)} ${n}`);

const left = db
  .prepare(
    `SELECT COUNT(*) AS n FROM ca_items
      WHERE status = 'published' AND needs_verify = 1`
  )
  .get().n;
console.log(`\npublished items still flagged: ${left}`);

if (!apply) console.log('\nDRY RUN — nothing written. Re-run with --apply.');
