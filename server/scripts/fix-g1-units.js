#!/usr/bin/env node
'use strict';

// Brings the Group-I Mains unit map into line with the commission's own
// syllabus copy.
//
//   node server/scripts/fix-g1-units.js [--dry-run]
//
// WHAT WAS WRONG
//
// Three things, all found by reading the published syllabus against the map
// rather than by anything failing:
//
// 1. PAPER II WAS NUMBERED WRONG. The map ran units 1–9 as Andhra Pradesh
//    history. The syllabus runs 1–5 as the history and culture of INDIA, 6–10
//    as Andhra Pradesh, and 11–15 as the geography of India AND Andhra Pradesh
//    rather than of AP alone.
//
//    A unit code is the one thing a candidate carries between this app and the
//    syllabus in front of them. A "P2-U3" that means Vishnukundins here and
//    the Mughals to the commission is worse than no code: it is a confident
//    wrong answer to "where does this sit".
//
// 2. PAPER III WAS MISSING TWO UNITS. The list jumped from U11 to U14, so
//    Human values (12) and Attitude and emotional intelligence (13) — two of
//    the five ethics units — had no code, and nothing could ever be routed to
//    them or reported as missing from them.
//
// 3. THE TWO LANGUAGE PAPERS WERE ABSENT. 300 marks of the Mains total, with
//    no row and no note saying why.
//
// WHAT THIS SCRIPT DOES
//
// `reference-data.js` is the source of truth and `seed.js` upserts from it, so
// the labels and the new rows come from re-seeding. This handles the two things
// re-seeding cannot: the stored tags that pointed at the old meaning of a
// renumbered code, and the flags that are not in the seed list.
//
// Only P2-U1..U9 changed meaning. Everything from U10 up kept its theme, and
// P3, P4 and P5 numbering was already correct.

const path = require('path');
const db = require(path.join(__dirname, '..', 'src', 'db'));

const dryRun = process.argv.includes('--dry-run');

// old code → new code, for the units whose MEANING moved.
//
// Derived by matching what each old label described against where the syllabus
// actually puts that material — not by shifting everything by five, because the
// old list was not a clean subset. Old U1–U4 described AP material from
// pre-history to the Kakatiyas, which the syllabus splits across the new U6 and
// U7; old U7 and U8 (reform movements, nationalist movement in Andhra) both
// land in the new U8 and U9.
const REMAP = {
  'P2-U1': 'P2-U6', // AP pre/proto-history          → Ancient AP
  'P2-U2': 'P2-U6', // Satavahanas and Ikshvakus     → Ancient AP
  'P2-U3': 'P2-U6', // Vishnukundins, E. Chalukyas   → Ancient AP
  'P2-U4': 'P2-U7', // Kakatiyas and successors      → Medieval AP
  'P2-U5': 'P2-U7', // Vijayanagara and Qutb Shahis  → Medieval AP
  'P2-U6': 'P2-U8', // AP colonial administration    → Modern AP
  'P2-U7': 'P2-U8', // AP social/religious reform    → Modern AP
  'P2-U8': 'P2-U9', // Nationalist movement, Andhra  → Nationalist movement
  'P2-U9': 'P2-U9', // Andhra statehood, Visalandhra → Nationalist movement (unchanged)
};

// The flags the seed list does not carry.
const FLAGS = [
  // A newspaper cannot feed a precis or a grammar exercise. Same treatment as
  // G2-S4 mental ability: excluded from scoring, recorded so the exclusion is
  // visible rather than silent.
  ['LANG-EN', { marks: 150, unfeedable: 1 }],
  ['LANG-TE', { marks: 150, unfeedable: 1 }],
  // The essay paper is fed as a by-product of the other four rather than
  // matched on its own vocabulary, which is why it is one catch-all row.
  ['P1', { marks: 150, broad: 1 }],
];

const PAPER_MARKS = { P2: 150, P3: 150, P4: 150, P5: 150 };

const report = [];

const run = db.transaction(() => {
  // 1. Re-point stored tags whose code changed meaning.
  const move = db.prepare(
    'UPDATE OR IGNORE ca_item_units SET unit_code = ? WHERE unit_code = ?'
  );
  const moveTopic = db.prepare(
    'UPDATE OR IGNORE topic_units SET unit_code = ? WHERE unit_code = ?'
  );
  const drop = db.prepare('DELETE FROM ca_item_units WHERE unit_code = ?');
  const dropTopic = db.prepare('DELETE FROM topic_units WHERE unit_code = ?');

  // READ EVERY AFFECTED ROW FIRST, THEN WRITE. NOT A LOOP OF UPDATEs.
  //
  // The obvious form — walk the map, UPDATE each `from` to its `to` — cascades,
  // because a later rule picks up the rows an earlier one has just moved.
  // P2-U5 → P2-U7 ran, then P2-U7 → P2-U8 moved the same row again, then
  // P2-U8 → P2-U9 moved it a third time. Both of item 177's tags ended on U9,
  // collided with each other, and one was deleted as a duplicate.
  //
  // This is the same shape as the dateline bug earlier in this project:
  // recomputing from an input that an earlier pass in the same run has already
  // rewritten. Snapshotting first is what makes the mapping mean what it says.
  const snapshot = {
    items: db
      .prepare(
        `SELECT item_id, unit_code FROM ca_item_units
          WHERE unit_code IN (${Object.keys(REMAP).map(() => '?').join(',')})`
      )
      .all(...Object.keys(REMAP)),
    topics: db
      .prepare(
        `SELECT topic_id, unit_code FROM topic_units
          WHERE unit_code IN (${Object.keys(REMAP).map(() => '?').join(',')})`
      )
      .all(...Object.keys(REMAP)),
  };

  for (const [from, to] of Object.entries(REMAP)) {
    if (from === to) continue;
    const items = snapshot.items.filter((r) => r.unit_code === from).length;
    const topics = snapshot.topics.filter((r) => r.unit_code === from).length;
    if (!items && !topics) continue;
    report.push(`  ${from} → ${to}   ${items} item tag(s), ${topics} topic link(s)`);
  }

  if (!dryRun) {
    // Delete the old rows outright, then insert the mapped ones. INSERT OR
    // IGNORE collapses the case where two old codes map to the same new one on
    // the same item — that is one tag, not two.
    const delItem = db.prepare('DELETE FROM ca_item_units WHERE unit_code = ?');
    const delTopic = db.prepare('DELETE FROM topic_units WHERE unit_code = ?');
    const addItem = db.prepare(
      'INSERT OR IGNORE INTO ca_item_units (item_id, unit_code) VALUES (?, ?)'
    );
    const addTopic = db.prepare(
      'INSERT OR IGNORE INTO topic_units (topic_id, unit_code) VALUES (?, ?)'
    );
    for (const from of Object.keys(REMAP)) {
      if (REMAP[from] === from) continue;
      delItem.run(from);
      delTopic.run(from);
    }
    for (const r of snapshot.items) addItem.run(r.item_id, REMAP[r.unit_code]);
    for (const r of snapshot.topics) addTopic.run(r.topic_id, REMAP[r.unit_code]);
  }

  if (!dryRun) {
    // 2. Marks and flags.
    for (const [code, flags] of FLAGS) {
      const sets = Object.keys(flags).map((k) => `${k} = @${k}`).join(', ');
      db.prepare(`UPDATE ref_units SET ${sets} WHERE unit_code = @code`).run({ ...flags, code });
    }
    for (const [paper, marks] of Object.entries(PAPER_MARKS)) {
      db.prepare('UPDATE ref_units SET marks = ? WHERE paper = ? AND marks IS NULL')
        .run(marks, paper);
    }
    // Every Group-I Mains unit is descriptive — it is the one written paper.
    db.prepare(
      `UPDATE ref_units SET format = 'descriptive'
        WHERE exam = 'g1' AND format <> 'descriptive'`
    ).run();
  }
});

run();

console.log('Paper II renumbering — tags moved to the unit the syllabus actually uses:');
console.log(report.length ? report.join('\n') : '  (no stored tags used the affected range)');

const units = db
  .prepare(
    `SELECT paper, COUNT(*) n, SUM(unfeedable) unfeedable
       FROM ref_units WHERE exam = 'g1' GROUP BY paper ORDER BY paper`
  )
  .all();
console.log('\nGroup-I Mains map now:');
for (const u of units) {
  console.log(`  ${u.paper.padEnd(5)} ${String(u.n).padStart(2)} unit(s)${u.unfeedable ? `, ${u.unfeedable} unfeedable` : ''}`);
}
console.log(`  ${units.reduce((a, b) => a + b.n, 0)} in total`);

if (dryRun) console.log('\nDRY RUN — nothing written.');
