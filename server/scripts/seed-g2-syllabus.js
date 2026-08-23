#!/usr/bin/env node
'use strict';

// Seeds the Group-II syllabus into ref_units, with the match vocabulary.
//
//   node server/scripts/seed-g2-syllabus.js [--dry-run]
//
// Idempotent: re-running replaces the G2 rows and their aliases and leaves the
// Group-I map (Papers I to V) untouched. The two live in one table, separated by
// `exam`, because everything downstream — topic→unit mapping, item tagging, the
// cross-paper reuse score, the unit badges, "which items feed this unit" —
// already works on unit codes and gains a second exam for free.

const path = require('path');

const db = require(path.join(__dirname, '..', 'src', 'db'));
const { G2_UNITS } = require('./g2-syllabus');

const dryRun = process.argv.includes('--dry-run');

const upsertUnit = db.prepare(
  `INSERT INTO ref_units (unit_code, paper, label, order_index, exam, syllabus_text, marks, unfeedable, broad)
   VALUES (@unit_code, @paper, @label, @order_index, 'g2', @syllabus_text, @marks, @unfeedable, @broad)
   ON CONFLICT(unit_code) DO UPDATE SET
     paper = excluded.paper, label = excluded.label, order_index = excluded.order_index,
     exam = 'g2', syllabus_text = excluded.syllabus_text, marks = excluded.marks,
     unfeedable = excluded.unfeedable, broad = excluded.broad`
);
const clearAliases = db.prepare('DELETE FROM ref_unit_aliases WHERE unit_code = ?');
const insAlias = db.prepare(
  'INSERT OR IGNORE INTO ref_unit_aliases (unit_code, alias, strict) VALUES (?, ?, ?)'
);

let units = 0;
let aliases = 0;
const collisions = [];

// An alias claimed by two units is not automatically wrong — "irrigation" is
// genuinely both a geography topic and an AP agriculture one — but it is worth
// seeing, because an alias on five units is a word doing no work.
const owners = new Map();
for (const u of G2_UNITS) {
  for (const a of u.aliases) {
    if (!owners.has(a)) owners.set(a, []);
    owners.get(a).push(u.code);
  }
}
for (const [alias, codes] of owners) {
  if (codes.length > 1) collisions.push(`${alias} → ${codes.join(', ')}`);
}

if (!dryRun) {
  db.transaction(() => {
    G2_UNITS.forEach((u, i) => {
      upsertUnit.run({
        unit_code: u.code,
        paper: u.paper,
        label: u.label,
        order_index: i,
        syllabus_text: u.syllabus,
        marks: u.marks ?? null,
        unfeedable: u.unfeedable ? 1 : 0,
        broad: u.broad ? 1 : 0,
      });
      units += 1;
      clearAliases.run(u.code);
      for (const a of u.aliases) {
        // Case-sensitive for anything that is also an ordinary word or a short
        // acronym, so "RTI" does not match inside "PARTIES" and "COP" does not
        // match "cop".
        const strict = /^[A-Z0-9&.\- ]+$/.test(a) && a.length <= 5 ? 1 : 0;
        insAlias.run(u.code, a, strict);
        aliases += 1;
      }
    });
  })();
}

const g1 = db.prepare("SELECT COUNT(*) n FROM ref_units WHERE exam = 'g1'").get().n;
const g2 = db.prepare("SELECT COUNT(*) n FROM ref_units WHERE exam = 'g2'").get().n;

console.log(
  `${dryRun ? 'Would seed' : 'Seeded'} ${G2_UNITS.length} Group-II unit(s) and ` +
    `${G2_UNITS.reduce((s, u) => s + u.aliases.length, 0)} alias(es).`
);
console.log(`ref_units now holds ${g1} Group-I unit(s) and ${g2} Group-II unit(s).`);

const scoring = G2_UNITS.filter((u) => !u.broad && !u.unfeedable).length;
console.log(
  `${scoring} of ${G2_UNITS.length} count towards relevance. ` +
    'The other two are the 30-mark current-affairs paper, which matches everything and is ' +
    'therefore evidence of nothing, and mental ability, which no newspaper feeds.'
);

if (collisions.length) {
  console.log(`\n${collisions.length} alias(es) claimed by more than one unit — usually fine:`);
  for (const c of collisions.slice(0, 12)) console.log(`   ${c}`);
}
if (dryRun) console.log('\nDRY RUN — nothing written.');
