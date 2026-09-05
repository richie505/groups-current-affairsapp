#!/usr/bin/env node
'use strict';

// Exports one day's compendium as the retention template's data.json, for
// rendering by hand or for inspecting what the app would send.
//
//   node server/scripts/export-compendium-json.js 2026-08-23 out/data.json [--max 15] [--report]
//
// The mapping itself lives in server/src/lib/compendiumData.js, which the
// digest endpoint uses too — one place that knows how our columns become the
// template's fields, so the file this writes and the file the app renders can
// never drift apart.

const fs = require('fs');
const path = require('path');

const db = require(path.join(__dirname, '..', 'src', 'db'));
const { buildCompendiumData } = require(path.join(__dirname, '..', 'src', 'lib', 'compendiumData'));

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const [date, outPath = 'data.json'] = args;
const maxArg = process.argv.indexOf('--max');
const MAX = maxArg > -1 ? Number(process.argv[maxArg + 1]) : 0;

if (!date) {
  console.error('usage: export-compendium-json.js <YYYY-MM-DD> [out.json] [--max N] [--report]');
  process.exit(2);
}

const day = db.prepare('SELECT id, date, title, status FROM ca_days WHERE date = ?').get(date);
if (!day) {
  console.error(`No day ${date}.`);
  process.exit(1);
}

const items = db
  .prepare(
    `SELECT i.* FROM ca_items i
      WHERE i.day_id = ? AND i.status IN ('draft', 'published')
      ORDER BY i.importance, i.salvaged, i.order_index, i.id`
  )
  .all(day.id);

const picked = MAX > 0 ? items.slice(0, MAX) : items;

const mcqs = db.prepare(
  `SELECT question, option_a, option_b, option_c, option_d, correct_option, explanation, fact_as_of
     FROM ca_mcqs WHERE item_id = ? AND status = 'published' ORDER BY id`
);
const units = db.prepare(
  `SELECT u.unit_code, r.label, r.paper, r.exam FROM ca_item_units u
     JOIN ref_units r ON r.unit_code = u.unit_code WHERE u.item_id = ?`
);

const byItem = new Map(picked.map((i) => [i.id, mcqs.all(i.id)]));
const out = buildCompendiumData(picked, byItem, { day, unitsOf: (id) => units.all(id) });

fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out.data, null, 2), 'utf8');

console.log(
  `${outPath}: ${out.data.sections.length} section(s), ${out.topics} topic(s), ${out.questions} question(s).`
);
if (out.thin.length) {
  console.log(`\n${out.thin.length} topic(s) short of what the template wants:`);
  for (const t of out.thin) {
    console.log(
      `  item ${String(t.id).padEnd(4)} ${t.missing.join(', ').padEnd(34)} ${String(t.headline).slice(0, 46)}`
    );
  }
}
