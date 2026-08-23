#!/usr/bin/env node
'use strict';

// Seeds a published syllabus into ref_units, with its match vocabulary.
//
//   node server/scripts/seed-g2-syllabus.js [--dry-run]
//
// Seeds BOTH maps it knows about — Group-II and Group-I Prelims. They share
// every line of this script because they are the same kind of object: a list of
// units, each with the words a newspaper uses for it. The only thing that
// differs is which exam they belong to and how that exam is answered.
//
// Idempotent: re-running replaces the G2 rows and their aliases and leaves the
// Group-I map (Papers I to V) untouched. The two live in one table, separated by
// `exam`, because everything downstream — topic→unit mapping, item tagging, the
// cross-paper reuse score, the unit badges, "which items feed this unit" —
// already works on unit codes and gains a second exam for free.

const path = require('path');

const db = require(path.join(__dirname, '..', 'src', 'db'));
const { G2_UNITS } = require('./g2-syllabus');
const { G1P_UNITS } = require('./g1-prelims-syllabus');

// Three papers, two formats — see g1-prelims-syllabus.js for why that matters.
const SYLLABI = [
  { exam: 'g2', format: 'objective', label: 'Group-II', units: G2_UNITS },
  { exam: 'g1p', format: 'objective', label: 'Group-I Prelims', units: G1P_UNITS },
];

const dryRun = process.argv.includes('--dry-run');

const upsertUnit = db.prepare(
  `INSERT INTO ref_units (unit_code, paper, label, order_index, exam, format,
                          syllabus_text, marks, unfeedable, broad)
   VALUES (@unit_code, @paper, @label, @order_index, @exam, @format,
           @syllabus_text, @marks, @unfeedable, @broad)
   ON CONFLICT(unit_code) DO UPDATE SET
     paper = excluded.paper, label = excluded.label, order_index = excluded.order_index,
     exam = excluded.exam, format = excluded.format,
     syllabus_text = excluded.syllabus_text, marks = excluded.marks,
     unfeedable = excluded.unfeedable, broad = excluded.broad`
);
const clearAliases = db.prepare('DELETE FROM ref_unit_aliases WHERE unit_code = ?');
const insAlias = db.prepare(
  'INSERT OR IGNORE INTO ref_unit_aliases (unit_code, alias, strict) VALUES (?, ?, ?)'
);

let units = 0;
let aliases = 0;
const collisions = [];

// An alias claimed by two units of the SAME exam is worth seeing — "irrigation"
// is genuinely both a geography topic and an AP agriculture one, but an alias on
// five units is a word doing no work. Across exams it is expected and silent:
// the syllabi overlap by design.
for (const syl of SYLLABI) {
  const owners = new Map();
  for (const u of syl.units) {
    for (const a of u.aliases) {
      if (!owners.has(a)) owners.set(a, []);
      owners.get(a).push(u.code);
    }
  }
  for (const [alias, codes] of owners) {
    if (codes.length > 1) collisions.push(`${alias} → ${codes.join(', ')}`);
  }
}

if (!dryRun) {
  db.transaction(() => {
    for (const syl of SYLLABI) {
      syl.units.forEach((u, i) => {
        upsertUnit.run({
          unit_code: u.code,
          paper: u.paper,
          label: u.label,
          order_index: i,
          exam: syl.exam,
          format: syl.format,
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
    }
  })();
}

console.log(`${dryRun ? 'Would seed' : 'Seeded'} ${units} unit(s) and ${aliases} alias(es).`);
console.log('');

for (const row of db
  .prepare(
    `SELECT exam, format, COUNT(*) AS n,
            SUM(CASE WHEN broad = 0 AND unfeedable = 0 THEN 1 ELSE 0 END) AS scoring
       FROM ref_units GROUP BY exam, format ORDER BY exam`
  )
  .all()) {
  const name = { g1: 'Group-I Mains', g1p: 'Group-I Prelims', g2: 'Group-II' }[row.exam] || row.exam;
  console.log(
    `  ${name.padEnd(18)} ${String(row.n).padStart(3)} unit(s), ${row.scoring} scoring   [${row.format}]`
  );
}

console.log(
  [
    '',
    'Three papers, two formats. Group-I Mains is written; Group-I Prelims and both',
    'Group-II papers are ticked. The units flagged `broad` are the current-affairs',
    'papers, which contain every article ever printed and are therefore evidence of',
    'nothing; `unfeedable` is mental ability, which no newspaper feeds.',
  ].join('\n')
);

if (collisions.length) {
  console.log('');
  console.log(`${collisions.length} alias(es) claimed by more than one unit of the same exam:`);
  for (const c of collisions.slice(0, 12)) console.log(`   ${c}`);
}
if (dryRun) console.log('\nDRY RUN — nothing written.');
