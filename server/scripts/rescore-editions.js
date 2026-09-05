#!/usr/bin/env node
'use strict';

// Re-runs the scorer over every stored edition and re-syncs item unit tags.
//
//   node server/scripts/rescore-editions.js [--dry-run]
//
// WHEN THIS IS NEEDED
//
// The unit tag on an item is DERIVED — alias match, evidence filter, article
// units, item units. Change the alias vocabulary or the filter and every stored
// tag is stale until this runs. `git pull` does not do it, and neither does a
// restart: the tags live in the database, not in the code.
//
// So this belongs in the deploy sequence for a vocabulary change, after
// seed-g2-syllabus.js and the two backfills.
//
// WHAT IT DOES NOT TOUCH
//
// Articles, items, their text, their status, their questions, the PDF. It
// re-derives np_article_units and ca_item_units and nothing else. An item's
// hand-typed units on an article-less item survive, because the rebuild below
// only touches items that HAVE a linked article.
//
// Delete-and-rebuild rather than insert-only. Insert-only was the earlier
// behaviour and it meant a tag the filter had stopped producing stayed forever:
// the vocabulary got better and the numbers never moved, because nothing was
// ever removed.

const path = require('path');

const db = require(path.join(__dirname, '..', 'src', 'db'));
const ingest = require(path.join(__dirname, '..', 'src', 'lib', 'ingest'));

const dryRun = process.argv.includes('--dry-run');

const snapshot = () => ({
  tags: new Set(
    db
      .prepare(
        `SELECT u.item_id || ':' || u.unit_code AS k FROM ca_item_units u
           JOIN ca_items i ON i.id = u.item_id WHERE i.status = 'published'`
      )
      .all()
      .map((r) => r.k)
  ),
  blanks: db
    .prepare(
      `SELECT COUNT(*) AS n FROM ca_items i WHERE i.status = 'published'
         AND NOT EXISTS (SELECT 1 FROM ca_item_units u WHERE u.item_id = i.id)`
    )
    .get().n,
});

const before = snapshot();
const editions = db.prepare('SELECT id, date FROM np_editions ORDER BY date').all();

if (!editions.length) {
  console.log('No editions stored — nothing to re-score.');
  process.exit(0);
}

if (dryRun) {
  console.log(`Would re-score ${editions.length} edition(s) and rebuild item units.`);
  console.log(`Currently ${before.tags.size} tag(s) on published items, ${before.blanks} blank.`);
  process.exit(0);
}

for (const ed of editions) {
  const out = ingest.scoreEdition(ed.id, { log: () => {} });
  console.log(`  scored ${ed.date}: ${out.scored} article(s)`);
}

const linked = db
  .prepare(
    'SELECT i.id AS item_id, a.id AS article_id FROM ca_items i JOIN np_articles a ON a.item_id = i.id'
  )
  .all();
const del = db.prepare('DELETE FROM ca_item_units WHERE item_id = ?');
const ins = db.prepare('INSERT OR IGNORE INTO ca_item_units (item_id, unit_code) VALUES (?, ?)');
const unitsOf = db.prepare(
  `SELECT au.unit_code FROM np_article_units au
     JOIN ref_units ru ON ru.unit_code = au.unit_code
    WHERE au.article_id = ? AND ru.format = 'objective'
          AND ru.broad = 0 AND ru.unfeedable = 0`
);

db.transaction(() => {
  for (const { item_id, article_id } of linked) {
    del.run(item_id);
    for (const u of unitsOf.all(article_id)) ins.run(item_id, u.unit_code);
  }
})();

const after = snapshot();
const removed = [...before.tags].filter((k) => !after.tags.has(k));
const added = [...after.tags].filter((k) => !before.tags.has(k));
const head = new Map(db.prepare('SELECT id, headline FROM ca_items').all().map((r) => [r.id, r.headline]));

console.log('');
console.log(`blanks: ${before.blanks} -> ${after.blanks}`);
console.log(`tags:   ${before.tags.size} -> ${after.tags.size}   (-${removed.length}, +${added.length})`);

for (const [title, keys] of [['REMOVED', removed], ['ADDED', added]]) {
  if (!keys.length) continue;
  console.log(`\n${title} (${keys.length})`);
  const by = new Map();
  for (const k of keys) {
    const [i, u] = k.split(':');
    if (!by.has(i)) by.set(i, []);
    by.get(i).push(u);
  }
  for (const [i, us] of [...by].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    console.log(
      `  ${String(i).padEnd(4)} ${String(head.get(Number(i)) || '').slice(0, 48).padEnd(48)} ${us.join(', ')}`
    );
  }
}
