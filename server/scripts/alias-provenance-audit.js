#!/usr/bin/env node
'use strict';

// The monthly accountability report on aliases that were added by a reviewed
// batch or a syllabus audit rather than by the original seed.
//
//   node server/scripts/alias-provenance-audit.js [--since YYYY-MM-DD] [--editions N]
//
// Two lists, and NEITHER IS A DEFECT LIST.
//
//   A. FIRED FOR THE FIRST TIME — a mapping that was approved on the syllabus
//      text and has now earned a tag. Its tags are printed for spot-checking,
//      because the first thing an untested mapping does is the thing worth
//      looking at. If they hold, the mapping is proven and stops appearing here.
//
//   B. STILL SILENT — approved, and still has never earned anything after N
//      editions. This is not evidence against the mapping. Four editions of one
//      newspaper simply do not contain a story about most of the syllabus, and
//      an alias that has never been tested has not failed. It is here so nobody
//      has to wonder whether it was forgotten, and so that a row still silent
//      after a year can be reconsidered on purpose rather than by drift.
//
// The rule the reviewer set: a syllabus-justified mapping with zero corpus hits
// stays until this audit shows it fired WRONGLY.

const path = require('path');

const db = require(path.join(__dirname, '..', 'src', 'db'));

const argOf = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const since = argOf('since', null);
const editionsSeen = db.prepare('SELECT COUNT(*) AS n FROM np_editions').get().n;

const rows = db
  .prepare(
    `SELECT a.unit_code, a.alias, a.provenance, a.first_hit_at,
            COALESCE(a.standalone, 0) AS standalone, u.label
       FROM ref_unit_aliases a JOIN ref_units u ON u.unit_code = a.unit_code
      WHERE a.provenance <> 'seed'
      ORDER BY a.provenance, a.alias, a.unit_code`
  )
  .all();

const fired = rows.filter((r) => r.first_hit_at && (!since || r.first_hit_at >= since));
const silent = rows.filter((r) => !r.first_hit_at);

// The surviving tags each newly-fired alias is part of the evidence for, so a
// reviewer can judge them without opening the database.
const tagsFor = db.prepare(
  `SELECT i.id AS item, i.status, a.headline, au.matched
     FROM ca_items i
     JOIN np_articles a ON a.item_id = i.id
     JOIN np_article_units au ON au.article_id = a.id
    WHERE au.unit_code = ? AND (', ' || au.matched || ', ') LIKE ?
    ORDER BY i.id`
);

console.log(`Alias provenance audit — ${editionsSeen} edition(s) processed`);
console.log(`${rows.length} alias row(s) come from a batch or an audit rather than the seed.`);
console.log('');

console.log(`A. FIRED${since ? ` SINCE ${since}` : ''} — ${fired.length} row(s), tags to spot-check`);
console.log('='.repeat(96));
if (!fired.length) console.log('  (none)');
for (const r of fired) {
  const tags = tagsFor.all(r.unit_code, `%, ${r.alias}, %`);
  console.log(
    `\n  ${r.alias}  ->  ${r.unit_code}   [${r.provenance}]  first hit ${r.first_hit_at}`
  );
  console.log(`      ${String(r.label).slice(0, 84)}`);
  for (const t of tags.slice(0, 4)) {
    console.log(
      `      item ${String(t.item).padEnd(4)} ${String(t.status).padEnd(9)} ${String(t.headline).slice(0, 60)}`
    );
  }
  if (!tags.length) {
    // The alias earned a hit on some article, but no tag on a PUBLISHED item
    // survives with it in the evidence — the item was discarded, or a later
    // re-score moved the tag.
    console.log('      (first hit recorded, but no current tag rests on it)');
  }
}

console.log('');
console.log(`B. STILL SILENT after ${editionsSeen} edition(s) — ${silent.length} row(s)`);
console.log('='.repeat(96));
const byProv = new Map();
for (const r of silent) {
  if (!byProv.has(r.provenance)) byProv.set(r.provenance, []);
  byProv.get(r.provenance).push(`${r.alias} -> ${r.unit_code}`);
}
for (const [prov, list] of byProv) {
  console.log(`\n  ${prov}  (${list.length})`);
  for (const l of list) console.log(`      ${l}`);
}

console.log('');
console.log('-'.repeat(96));
for (const r of db
  .prepare(
    `SELECT provenance, COUNT(*) AS n,
            SUM(CASE WHEN first_hit_at IS NOT NULL THEN 1 ELSE 0 END) AS fired
       FROM ref_unit_aliases GROUP BY provenance ORDER BY n DESC`
  )
  .all()) {
  const pct = r.n ? ((100 * r.fired) / r.n).toFixed(0) : '0';
  console.log(`  ${String(r.provenance).padEnd(24)} ${String(r.n).padStart(4)} rows   ${String(r.fired).padStart(3)} fired (${pct}%)`);
}
console.log('');
console.log('Silence is not failure. Reconsider a mapping only when this report');
console.log('shows it fired and the tag was wrong.');
