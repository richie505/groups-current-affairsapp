#!/usr/bin/env node
'use strict';

// Sets, clears or shows the hand override on one alias's `standalone` flag.
//
//   node server/scripts/set-alias-standalone.js Gorkhaland true
//   node server/scripts/set-alias-standalone.js "rule of law" false
//   node server/scripts/set-alias-standalone.js BHAVYA auto     # back to derived
//   node server/scripts/set-alias-standalone.js Gorkhaland      # just show it
//
// WHY A SCRIPT AND NOT AN EDIT TO THE BLOCKLIST.
//
// The blocklist in backfill-alias-standalone.js says "these words are not
// specific enough", which is a statement about a class. An override says "the
// rule is wrong about this one row", which is a statement about a row, and
// mixing the two makes the blocklist unreadable — you can no longer tell which
// entries are a principle and which are a patch.
//
// Sets every row for the alias, across units, because `standalone` is a
// property of the WORDS and an alias that carries G1P-B2 alone carries
// G2-P1-U9 alone too. Re-run backfill-alias-standalone.js afterwards to apply
// it, then re-score.

const path = require('path');

const db = require(path.join(__dirname, '..', 'src', 'db'));

const [alias, value] = process.argv.slice(2);
if (!alias) {
  console.error('usage: set-alias-standalone.js <alias> [true|false|auto]');
  process.exit(2);
}

const rows = db
  .prepare(
    'SELECT unit_code, alias, strict, standalone, standalone_override FROM ref_unit_aliases WHERE alias = ? COLLATE NOCASE'
  )
  .all(alias);

if (!rows.length) {
  console.error(`No alias "${alias}" in ref_unit_aliases.`);
  process.exit(1);
}

if (value === undefined) {
  for (const r of rows) {
    const o = r.standalone_override;
    console.log(
      `  ${r.unit_code.padEnd(10)} "${r.alias}"  standalone=${r.standalone}  ` +
        `override=${o == null ? '(none — derived)' : o ? 'true' : 'false'}`
    );
  }
  process.exit(0);
}

const map = { true: 1, false: 0, auto: null, null: null };
if (!(value in map)) {
  console.error(`Value must be true, false or auto — got "${value}".`);
  process.exit(2);
}
const to = map[value];

const upd = db.prepare(
  'UPDATE ref_unit_aliases SET standalone_override = ? WHERE alias = ? COLLATE NOCASE'
);
const n = upd.run(to, alias).changes;

console.log(
  `Set standalone_override = ${to == null ? 'NULL (derive it)' : to} on ${n} row(s) for "${alias}":`
);
for (const r of rows) console.log(`  ${r.unit_code}`);
console.log('');
console.log('Now re-run:  node server/scripts/backfill-alias-standalone.js');
console.log('then re-score the editions for it to reach the item tags.');
