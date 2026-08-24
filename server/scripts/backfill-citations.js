#!/usr/bin/env node
'use strict';

// Gives a print citation to any item that came from a newspaper article and has
// none.
//
//   node server/scripts/backfill-citations.js [--dry-run]
//
// WHY THIS EXISTS
//
// The salvage pass shipped without writing sources, and the first real day
// produced 24 published fact cards citing nothing — which preflight reported as
// "25 published item(s) cite no source" and which is exactly the warning you
// stop reading once it is always there.
//
// The provenance was never missing, only unwritten: every one of those items is
// linked to an np_articles row, which knows its edition and its page. So this
// derives the citation the same way the two live lanes now do, through
// printCitation, rather than inventing a third format.
//
// Idempotent. An item that already cites something is left alone — including one
// citing something a person typed, which is not for a script to overwrite.

const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
require(path.join(ROOT, 'content-pipeline', 'ca-daily', 'lib')).loadEnv();
const db = require(path.join(__dirname, '..', 'src', 'db'));
const D = require(path.join(__dirname, '..', 'src', 'lib', 'draft'));

const dryRun = process.argv.includes('--dry-run');

const rows = db
  .prepare(
    `SELECT i.id AS item_id, i.headline, i.salvaged,
            a.page, e.publication, e.edition, e.date
       FROM ca_items i
       JOIN np_articles a ON a.item_id = i.id
       JOIN np_editions e ON e.id = a.edition_id
      WHERE i.status <> 'discarded'
        AND NOT EXISTS (SELECT 1 FROM ca_item_sources s WHERE s.item_id = i.id)
      ORDER BY e.date, a.page`
  )
  .all();

if (!rows.length) {
  console.log('Every newspaper-lane item already cites its source.');
  process.exit(0);
}

console.log(`${rows.length} item(s) from a newspaper article cite no source:`);
for (const r of rows.slice(0, 40)) {
  const c = D.printCitation({ publication: r.publication, edition: r.edition, date: r.date }, { page: r.page });
  console.log(`  ${r.salvaged ? 'card' : 'item'}  ${c.publisher}  —  ${(r.headline || '').slice(0, 48)}`);
}
if (rows.length > 40) console.log(`  … and ${rows.length - 40} more`);

if (dryRun) {
  console.log('\nDRY RUN — nothing written.');
  process.exit(0);
}

const ins = db.prepare(
  `INSERT INTO ca_item_sources (item_id, url, publisher, is_primary, fetched_at)
   VALUES (?, ?, ?, ?, ?)`
);
let n = 0;
db.transaction(() => {
  for (const r of rows) {
    const c = D.printCitation(
      { publication: r.publication, edition: r.edition, date: r.date },
      { page: r.page }
    );
    ins.run(r.item_id, c.url, c.publisher, c.is_primary, c.fetched_at);
    n += 1;
  }
})();

console.log(`\nWrote ${n} citation(s).`);
