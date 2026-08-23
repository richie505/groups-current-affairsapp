#!/usr/bin/env node
'use strict';

// Takes the dateline back off the byline, on rows already in the database.
//
//   node server/scripts/backfill-bylines.js [--dry-run]
//
// The Hindu prints the author and the place on one line — "G.P. Shukla
// TIRUMALA" — and the segmenter stored the whole string as the byline while
// separately extracting TIRUMALA into `dateline`. 193 of 220 bylines carried
// the duplicate.
//
// It is fixed at source in np-daily/segment.js, but a fix at source only helps
// tomorrow's paper. This is the same function applied to what is already
// stored, including `ca_items.source_author`, which is the field a student
// actually reads: an op-ed credited to "N. Sudarshan BENGALURU" looks like a
// bug on the page, because it is one.
//
// Reversible in the only sense that matters: the place is not being deleted,
// it is already in `dateline` on the same row, and the strip only happens when
// `datelineFrom` claims it. Nothing is lost that was not duplicated.
//
// THIS SCRIPT DELIBERATELY DOES NOT TOUCH `dateline`.
//
// An earlier version did, and running it twice destroyed the column: the second
// run re-derived the dateline from a byline the FIRST run had already stripped,
// found no place there, and correctly wrote an empty string over 313 of 314
// rows. Recomputing a derived column from an input that an earlier pass has
// rewritten is the whole shape of that bug, and the safe form is to go back to
// the source rather than to the intermediate.
//
// If a dateline needs fixing, use server/scripts/repair-datelines.js, which
// re-reads the PDF.

const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const { withoutDateline } = require(path.join(ROOT, 'content-pipeline', 'np-daily', 'segment'));
const db = require(path.join(__dirname, '..', 'src', 'db'));

const dryRun = process.argv.includes('--dry-run');

const articles = db
  .prepare(`SELECT id, byline, bylines, dateline FROM np_articles WHERE COALESCE(byline, '') <> ''`)
  .all();

const changes = [];
for (const a of articles) {
  const byline = withoutDateline(a.byline);
  // `bylines` is the co-author list, stored as one string. Each entry is cleaned
  // on its own — an op-ed with two authors has the place on the last of them.
  const bylines = String(a.bylines || '')
    .split(/\s*\|\s*|\s*,(?=\s*[A-Z])/)
    .map((b) => withoutDateline(b))
    .filter(Boolean)
    .join(', ');
  if (byline !== a.byline || (a.bylines && bylines !== a.bylines)) {
    changes.push({ id: a.id, from: a.byline, to: byline, bylines });
  }
}

const items = db
  .prepare(`SELECT id, source_author FROM ca_items WHERE COALESCE(source_author, '') <> ''`)
  .all()
  .map((i) => ({ id: i.id, from: i.source_author, to: withoutDateline(i.source_author) }))
  .filter((i) => i.from !== i.to);

console.log(
  `${changes.length} of ${articles.length} article byline(s) and ${items.length} item author ` +
    'credit(s) carry a duplicated dateline.'
);
for (const c of changes.slice(0, 8)) console.log(`  ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`);
if (changes.length > 8) console.log(`  … and ${changes.length - 8} more.`);
for (const i of items) console.log(`  item ${i.id}: ${JSON.stringify(i.from)} → ${JSON.stringify(i.to)}`);

if (dryRun) {
  console.log('\nDRY RUN — nothing written.');
  process.exit(0);
}

const updateArticle = db.prepare('UPDATE np_articles SET byline = ?, bylines = ? WHERE id = ?');
const updateItem = db.prepare('UPDATE ca_items SET source_author = ? WHERE id = ?');
db.transaction(() => {
  for (const c of changes) updateArticle.run(c.to, c.bylines, c.id);
  for (const i of items) updateItem.run(i.to, i.id);
})();

console.log(`\nDone: ${changes.length} article(s), ${items.length} item(s).`);
