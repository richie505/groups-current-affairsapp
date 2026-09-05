#!/usr/bin/env node
'use strict';

// Copies the OBJECTIVE syllabus units from each article onto the item drafted
// from it.
//
//   node server/scripts/backfill-item-units.js [--dry-run]
//
// WHY THE ITEMS WERE MISSING THEM
//
// `ca_item_units` was written from the units the MODEL chose, and the vocabulary
// it is offered is the whole of `ref_units` — so it returned Group-I Mains paper
// units and almost nothing else. Item 84 carried P2-U12, P4-U7, P4-U8, P4-U11,
// P4-U12 and P5-U7: six units, all for the one paper that is written, and none
// for the three that are answered by ticking a box.
//
// Meanwhile `np_article_units` already held G2-P2-U5 for that same story,
// established by Section 2 against APPSC's published syllabus vocabulary. The
// tag existed. It just stopped at the article and never reached the item a
// student reads.
//
// So the Group-II lane showed keyword angles — "Association, Export, Exports,
// Visited" — and no syllabus topic at all, which is exactly the half a candidate
// needs: a keyword tells them the shape of the question, the unit tells them
// where it sits on the syllabus.
//
// WHY IT IS A COPY AND NOT A RE-DERIVATION
//
// Because the derivation is already done, deterministically, and re-running a
// model over it would produce a second and disagreeing answer to a settled
// question. Fixed at source too, in insertDrafted; this is for the items that
// already exist.

const path = require('path');
const db = require(path.join(__dirname, '..', 'src', 'db'));

const dryRun = process.argv.includes('--dry-run');

// IT REBUILDS RATHER THAN TOPS UP, and that is the whole point of it now.
//
// INSERT-ONLY was right while this was a one-off backfill for items whose
// units the model had chosen badly. It is wrong as a standing tool, because
// `ca_item_units` is DERIVED from `np_article_units` and a derived table that
// can only grow drifts away from its source in one direction.
//
// Measured on 5 Sep 2026, before this changed: of 378 tags on published items,
// 60 were not in `np_article_units` at all — left over from an older
// vocabulary — and 35 were broad or unfeedable units that the drafter already
// excludes and this script had quietly added anyway. Ninety-five tags, none of
// which any re-score could remove, because nothing ever deleted.
//
// Items with NO linked article are left alone: their units were typed by a
// person through the item editor, and there is no article to rebuild them from.
const linked = db
  .prepare('SELECT i.id AS item_id, a.id AS article_id FROM ca_items i JOIN np_articles a ON a.item_id = i.id')
  .all();

const rows = db
  .prepare(
    `SELECT a.item_id, au.unit_code, ru.label, ru.exam
       FROM np_articles a
       JOIN np_article_units au ON au.article_id = a.id
       JOIN ref_units ru ON ru.unit_code = au.unit_code
      WHERE a.item_id IS NOT NULL
            AND ru.format = 'objective' AND ru.broad = 0 AND ru.unfeedable = 0
      ORDER BY a.item_id, au.in_headline DESC, au.hits DESC`
  )
  .all();

const existing = new Set(
  db
    .prepare(
      `SELECT iu.item_id || ':' || iu.unit_code AS k FROM ca_item_units iu
         JOIN ca_items i ON i.id = iu.item_id
        WHERE EXISTS (SELECT 1 FROM np_articles a WHERE a.item_id = i.id)`
    )
    .all()
    .map((r) => r.k)
);
const wanted = new Set(rows.map((r) => `${r.item_id}:${r.unit_code}`));
const willAdd = [...wanted].filter((k) => !existing.has(k));
const willDrop = [...existing].filter((k) => !wanted.has(k));

const byItem = new Map();
for (const r of rows) {
  if (!byItem.has(r.item_id)) byItem.set(r.item_id, []);
  byItem.get(r.item_id).push(r);
}

console.log(`${willAdd.length} tag(s) to add, ${willDrop.length} to drop, across ${linked.length} linked item(s).`);

// How many items currently have NO objective unit at all — the number that
// says whether the Group-II lane has anything to show.
const before = db
  .prepare(
    `SELECT COUNT(*) AS n FROM ca_items i
      WHERE i.status <> 'discarded'
        AND NOT EXISTS (
          SELECT 1 FROM ca_item_units iu JOIN ref_units ru ON ru.unit_code = iu.unit_code
           WHERE iu.item_id = i.id AND ru.format = 'objective'
        )`
  )
  .get().n;
console.log(`${before} item(s) currently carry no objective unit at all.`);

const headline = db.prepare('SELECT headline FROM ca_items WHERE id = ?');
for (const [itemId, list] of [...byItem].slice(0, 8)) {
  const h = headline.get(itemId);
  console.log(
    `  ${String(itemId).padStart(4)}  ${list.map((r) => r.unit_code).join(', ')}` +
      `  — ${(h ? h.headline : '').slice(0, 44)}`
  );
}
if (byItem.size > 8) console.log(`  … and ${byItem.size - 8} more.`);

if (dryRun) {
  console.log('\nDRY RUN — nothing written.');
  process.exit(0);
}

const ins = db.prepare('INSERT OR IGNORE INTO ca_item_units (item_id, unit_code) VALUES (?, ?)');
const del = db.prepare('DELETE FROM ca_item_units WHERE item_id = ?');
const byItemAll = new Map();
for (const r of rows) {
  if (!byItemAll.has(r.item_id)) byItemAll.set(r.item_id, []);
  byItemAll.get(r.item_id).push(r.unit_code);
}
db.transaction(() => {
  for (const { item_id } of linked) {
    del.run(item_id);
    for (const code of byItemAll.get(item_id) || []) ins.run(item_id, code);
  }
})();

const after = db
  .prepare(
    `SELECT COUNT(*) AS n FROM ca_items i
      WHERE i.status <> 'discarded'
        AND NOT EXISTS (
          SELECT 1 FROM ca_item_units iu JOIN ref_units ru ON ru.unit_code = iu.unit_code
           WHERE iu.item_id = i.id AND ru.format = 'objective'
        )`
  )
  .get().n;

console.log(`\nDone: ${rows.length} tag(s) added across ${byItem.size} item(s).`);
console.log(`Items with no objective unit: ${before} → ${after}.`);
if (after) {
  console.log(
    '  The remainder feed no objective unit, which is a finding rather than a gap —\n' +
      '  their questions still count for the 30-mark Group-II Current Affairs paper.'
  );
}
