#!/usr/bin/env node
'use strict';

// REMOVE THE GROUP-I MAINS LAYER.
//
//   node server/scripts/drop-g1-mains.js --dry-run
//   node server/scripts/drop-g1-mains.js
//
// WHY
//
// Three of APPSC's four papers are answered by ticking a box: Group-I Prelims,
// Group-II Screening and Group-II Mains. Only Group-I Mains is written. Serving
// the written paper as well meant carrying a second output shape through every
// layer — an eight-section note per item, four capture banks, essay questions,
// a seven-dimension tagging scheme, 54 descriptive syllabus units, and a
// 252-question descriptive PYQ corpus — none of which a ticked paper uses.
//
// This removes all of it, leaving one intelligence process feeding two
// objective syllabi.
//
// WHAT IT IS CAREFUL ABOUT
//
// The Mains layer was not inert. Factor E of the relevance score — cross-paper
// reuse, 15 of the 100 points — read `topic_evidence`, which held one person's
// reading of the Mains papers and NOTHING ELSE. Deleting it without a
// replacement would have taken 15 points off every article silently, changing
// what gets drafted with no line anywhere saying why.
//
// So the order here matters:
//
//   1. rebuild the derived reuse map from OBJECTIVE units only
//   2. re-derive topics.tier from the 1,137 real Group-II questions
//   3. only then delete the Mains data
//   4. re-score every article, and report the movement
//
// Steps 1 and 2 are what make step 3 safe to do.
//
// RE-RUNNABLE. Every statement is written to be a no-op the second time.

const path = require('path');

const db = require(path.join(__dirname, '..', 'src', 'db'));
const T = require(path.join(__dirname, '..', 'src', 'lib', 'topics'));
const PYQ = require(path.join(__dirname, '..', 'src', 'lib', 'pyq'));

const DRY = process.argv.includes('--dry-run');

const say = (s = '') => console.log(s);
const count = (sql, ...p) => {
  try {
    return db.prepare(sql).get(...p).n;
  } catch {
    return null;
  }
};
const has = (table) =>
  !!db
    .prepare(`SELECT 1 AS n FROM sqlite_master WHERE type='table' AND name=?`)
    .get(table);
const hasColumn = (table, col) =>
  has(table) && db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);

// The eight-section Mains note, plus the routing that only it used.
const ITEM_COLUMNS = [
  'g1_bank', 'g1_fact', 'g1_angle', 'g1_theme', 'g1_sub_theme',
  'g1_why_news', 'g1_background', 'g1_ap_angle', 'g1_linked',
  'g1_bridges', 'g1_way_forward', 'relevance_g1',
];

// Whole features, not fields: the capture banks, the essay engine, the
// dimension tagging and the answer skeletons.
const TABLES = [
  'ca_user_cards',
  'ca_skeletons',
  'ca_essay_questions',
  'ca_item_dimensions',
  'ca_item_themes',
  'topic_evidence',
];

const TRIGGERS = ['trg_items_require_angle_insert', 'trg_items_require_angle_update'];

// ---------------------------------------------------------------------------
// before
// ---------------------------------------------------------------------------

say('BEFORE');
say(`  descriptive ref_units          ${count("SELECT COUNT(*) n FROM ref_units WHERE exam='g1'")}`);
say(`  ca_item_units on those units   ${count("SELECT COUNT(*) n FROM ca_item_units iu JOIN ref_units u ON u.unit_code=iu.unit_code WHERE u.exam='g1'")}`);
say(`  topic_units total              ${count('SELECT COUNT(*) n FROM topic_units')}`);
say(`  topic_units on objective units ${count("SELECT COUNT(*) n FROM topic_units tu JOIN ref_units u ON u.unit_code=tu.unit_code WHERE u.exam<>'g1'")}`);
say(`  topic_evidence                 ${count('SELECT COUNT(*) n FROM topic_evidence')}`);
say(`  Mains PYQ questions            ${count("SELECT COUNT(*) n FROM pyq_questions q JOIN pyq_papers p ON p.id=q.paper_id WHERE p.exam='group1'")}`);
for (const t of TABLES.filter((x) => x !== 'topic_evidence')) say(`  ${t.padEnd(30)} ${count(`SELECT COUNT(*) n FROM ${t}`)}`);
say();

if (DRY) {
  say('--dry-run: nothing was written.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 1 + 2. re-base the scoring evidence BEFORE removing what it replaces
// ---------------------------------------------------------------------------

say('RE-BASING THE SCORING EVIDENCE');

// The reuse map is derived from item unit tags. Those tags still include the
// descriptive units at this point, so the rebuild is run again AFTER the
// deletion below — this first pass exists only to populate `topic_items`,
// which the tier step and the dossier both need and which was empty.
let rebuilt = T.rebuild(db);
say(`  topic_items rebuilt            ${rebuilt.matches} match(es) over ${rebuilt.items} item(s)`);

// ---------------------------------------------------------------------------
// 3. delete
// ---------------------------------------------------------------------------

say();
say('REMOVING THE MAINS LAYER');

const work = db.transaction(() => {
  // Routing first: the rows that point at descriptive units, before the units
  // themselves go and the join can no longer find them.
  const unitRows = db
    .prepare(
      `DELETE FROM ca_item_units WHERE unit_code IN
         (SELECT unit_code FROM ref_units WHERE exam = 'g1')`
    )
    .run().changes;
  say(`  ca_item_units removed          ${unitRows}`);

  const topicUnitRows = db
    .prepare(
      `DELETE FROM topic_units WHERE unit_code IN
         (SELECT unit_code FROM ref_units WHERE exam = 'g1')`
    )
    .run().changes;
  say(`  topic_units removed            ${topicUnitRows}`);

  const mcqRows = db
    .prepare(
      `UPDATE ca_mcqs SET unit_code = NULL WHERE unit_code IN
         (SELECT unit_code FROM ref_units WHERE exam = 'g1')`
    )
    .run().changes;
  say(`  questions untagged             ${mcqRows}`);

  const aliasRows = db
    .prepare(
      `DELETE FROM ref_unit_aliases WHERE unit_code IN
         (SELECT unit_code FROM ref_units WHERE exam = 'g1')`
    )
    .run().changes;
  say(`  unit aliases removed           ${aliasRows}`);

  const unitDefs = db.prepare(`DELETE FROM ref_units WHERE exam = 'g1'`).run().changes;
  say(`  descriptive units removed      ${unitDefs}`);

  // The descriptive PYQ corpus. `pyq_questions` and `pyq_question_topics`
  // cascade from the paper.
  const papers = db.prepare(`DELETE FROM pyq_papers WHERE exam = 'group1'`).run().changes;
  say(`  Mains PYQ papers removed       ${papers}`);

  for (const t of TABLES) {
    if (!has(t)) continue;
    const n = count(`SELECT COUNT(*) n FROM ${t}`);
    db.prepare(`DROP TABLE ${t}`).run();
    say(`  dropped ${t.padEnd(22)} ${n} row(s)`);
  }

  // The angle triggers exist to stop an item publishing to the Mains lane
  // without an argument. There is no Mains lane now.
  for (const trg of TRIGGERS) {
    db.prepare(`DROP TRIGGER IF EXISTS ${trg}`).run();
  }
  say(`  dropped ${TRIGGERS.length} angle trigger(s)`);

  for (const col of ITEM_COLUMNS) {
    if (!hasColumn('ca_items', col)) continue;
    db.prepare(`ALTER TABLE ca_items DROP COLUMN ${col}`).run();
  }
  say(`  ca_items columns dropped       ${ITEM_COLUMNS.length}`);
});
work();

// ---------------------------------------------------------------------------
// 4. rebuild the reuse map from what remains, then re-derive tier
// ---------------------------------------------------------------------------

say();
say('REBUILDING FROM THE OBJECTIVE SYLLABUS');

rebuilt = T.rebuild(db);
say(`  topic_items                    ${rebuilt.matches} match(es) across ${rebuilt.topics} topic(s)`);
say(`  topic_units (all objective)    ${rebuilt.units}`);

const reach = db
  .prepare(
    `SELECT COUNT(*) n FROM (
       SELECT tu.topic_id FROM topic_units tu
         JOIN ref_units u ON u.unit_code = tu.unit_code
        WHERE u.paper <> '' AND u.unfeedable = 0 AND u.broad = 0
        GROUP BY tu.topic_id HAVING COUNT(DISTINCT u.paper) >= 2)`
  )
  .get().n;
say(`  topics now reaching 2+ papers  ${reach}   (factor E can fire for these)`);

// Tier, from measured Group-II recurrence rather than a hand-assigned judgement
// informed by the Mains blueprint.
const suggestions = PYQ.suggestTiers(db);
const applyTiers = db.transaction(() => {
  const upd = db.prepare('UPDATE topics SET tier = ? WHERE id = ?');
  for (const s of suggestions) upd.run(s.suggested, s.id);
});
applyTiers();
say(`  tiers re-derived               ${suggestions.length} topic(s) changed`);
for (const r of db
  .prepare('SELECT tier, COUNT(*) n FROM topics GROUP BY tier ORDER BY tier')
  .all()) {
  say(`     tier ${r.tier}                       ${r.n} topic(s)`);
}

say();
say('Done. Re-score every edition to pick up the new factor E:');
say('  node server/scripts/process-edition.js <editionId>   (for each)');
