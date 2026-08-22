#!/usr/bin/env node
'use strict';

// Checks on the article → note bridge, against a throwaway database.
//
//   node server/scripts/test-bridge.js
//
// Exits non-zero if anything fails, so it can gate a commit.
//
// WHAT IT COVERS
//
// `insertDrafted` — the one piece of Section 3 that is pure logic and therefore
// worth pinning. Everything it checks is a fault that actually happened and was
// silent when it did: a unit code written in a form no query can match, a
// keyword carrying the subject bracket the vocabulary listing invited, an array
// bound to a TEXT column, a redraft stranding its predecessor in the queue.
//
// The model call is deliberately NOT covered. It costs money, it is not
// deterministic, and the faults it produces are the kind a person has to read.
//
// WHY IT USES THE REAL `src/db` WITH DB_PATH POINTED AT A SCRATCH FILE
//
// An earlier version of this built its own database and hand-replayed the
// column additions from `db/index.js`. That list drifted the moment a column was
// added — every check failed at once with "table ca_items has no column named
// static_notes", which looks exactly like a broken bridge and was a broken test.
// Requiring the real module runs the real migrations, so the harness cannot
// disagree with the schema it is testing.

const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = path.join(os.tmpdir(), `appsc-bridge-test-${process.pid}.db`);
process.env.DB_PATH = TMP;

const db = require(path.join(__dirname, '..', 'src', 'db'));
const D = require(path.join(__dirname, '..', 'src', 'lib', 'draft'));

const cleanup = () => {
  for (const f of [TMP, `${TMP}-wal`, `${TMP}-shm`]) {
    try {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch {
      // A scratch file that will not delete is untidy, not a failure.
    }
  }
};

const checks = [];
const check = (name, ok) => checks.push([name, !!ok]);

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

db.prepare("INSERT INTO ref_units (unit_code, paper, label) VALUES ('P3-U7','P3','Policy process')").run();
db.prepare("INSERT INTO ref_units (unit_code, paper, label) VALUES ('P4-U4','P4','Fiscal federalism')").run();
db.prepare("INSERT INTO ref_keywords (keyword, subject) VALUES ('Committee','Current Affairs')").run();
db.prepare("INSERT INTO ref_keywords (keyword, subject) VALUES ('Election','Polity')").run();

const editionId = db
  .prepare(
    `INSERT INTO np_editions (publication, edition, date, status)
     VALUES ('The Hindu','Vijayawada','2026-08-21','processed')`
  )
  .run().lastInsertRowid;

const articleId = db
  .prepare(
    `INSERT INTO np_articles (edition_id, page, headline, body, score, band, bucket)
     VALUES (?, 7, 'Panel named on river sharing', 'body text', 82, 'critical', 'ap')`
  )
  .run(editionId).lastInsertRowid;

// ---------------------------------------------------------------------------
// 1. one drafted record, carrying every shape that has previously gone wrong
// ---------------------------------------------------------------------------

const record = {
  _articleId: articleId,
  headline: 'Committee constituted on river water sharing',
  event_date: '2026-08-20',
  bucket: 'ap',
  // Arrays where the schema wants TEXT: the fault that rolled back a whole run
  // AFTER every draft in it had been paid for.
  g1_bridges: ['Federalism is contested in the plumbing', 'Water is the test case'],
  g1_linked: { scheme: 'Polavaram', report: 'KWDT-II' },
  g1_fact: 'A committee was constituted on 20 August 2026.',
  g1_angle: 'Inter-state water disputes are resolved administratively, not judicially.',
  static_notes: '### Constitutional position\n**Article 262** bars the courts.',
  importance: 1,
  needs_verify: 1,
  verify_note: 'Confirm the chair.',
  // One clean code, one echoed vocabulary line, one that resolves to nothing.
  units: ['P3-U7', 'P4-U4 — Fiscal federalism and devolution', 'Paper III Unit 7'],
  // One in-vocabulary, one carrying the subject bracket, one off-vocabulary.
  keywords: ['Committee', 'Election [Polity]', 'Federalism'],
  themes: ['Federalism'],
  sources: [{ url: '', publisher: 'The Hindu (Vijayawada), 2026-08-21, p.7', is_primary: 0 }],
  dimensions: [{ dimension: 'political', note: 'centre-state' }, { dimension: 'nonsense', note: 'x' }],
  essay_questions: [{ question: 'Are tribunals working?', kind: 'direct' }],
};

const out = D.insertDrafted(db, { date: '2026-08-21', drafted: [record], onLog: () => {} });
const itemId = out.itemIds[0];
const item = db.prepare('SELECT * FROM ca_items WHERE id = ?').get(itemId);
const article = db.prepare('SELECT status, item_id FROM np_articles WHERE id = ?').get(articleId);
const units = db.prepare('SELECT unit_code FROM ca_item_units WHERE item_id = ?').all(itemId).map((r) => r.unit_code);
const kws = db.prepare('SELECT keyword FROM ca_item_keywords WHERE item_id = ?').all(itemId).map((r) => r.keyword);
const dims = db.prepare('SELECT dimension FROM ca_item_dimensions WHERE item_id = ?').all(itemId).map((r) => r.dimension);

check('item created', !!item);
check('article linked to the item it produced', article.item_id === itemId);
check("article marked 'drafted'", article.status === 'drafted');
check('array field coerced to text', typeof item.g1_bridges === 'string' && item.g1_bridges.includes('- Federalism is contested'));
check('object field coerced to text, not emptied', typeof item.g1_linked === 'string' && item.g1_linked.length > 0);
check('static notes stored', String(item.static_notes).includes('Article 262'));
check('clean unit kept', units.includes('P3-U7'));
check('echoed vocabulary line reduced to its code', units.includes('P4-U4'));
check('unresolvable unit dropped, not written', !units.some((u) => u.includes('Paper III')));
check('unresolvable unit reported', out.droppedUnits.some((u) => u.includes('Paper III')));
check('in-vocabulary keyword kept', kws.includes('Committee'));
check('subject bracket stripped from keyword', kws.includes('Election') && !kws.some((k) => k.includes('[')));
check('off-vocabulary keyword kept as a free tag', kws.includes('Federalism'));
check('off-vocabulary keyword reported', out.offVocabKeywords.includes('Federalism'));
check('valid dimension kept', dims.includes('political'));
check('invalid dimension rejected', !dims.includes('nonsense'));
check('bucket preserved', item.bucket === 'ap');
check('day row created for the edition date', !!db.prepare("SELECT id FROM ca_days WHERE date='2026-08-21'").get());

// ---------------------------------------------------------------------------
// 2. a redraft supersedes its predecessor, but never a published item
// ---------------------------------------------------------------------------

const again = { ...record, headline: 'Second draft of the same story' };
const logs = [];
const out2 = D.insertDrafted(db, { date: '2026-08-21', drafted: [again], onLog: (m) => logs.push(m) });
const first = db.prepare('SELECT status, discard_reason FROM ca_items WHERE id = ?').get(itemId);
const relinked = db.prepare('SELECT item_id FROM np_articles WHERE id = ?').get(articleId).item_id;

check('redraft supersedes the earlier draft', first.status === 'discarded');
check('supersession reason names the new item', /Superseded by item #/.test(first.discard_reason));
check('article now points at the new item', relinked === out2.itemIds[0]);
check('supersession is logged', logs.some((l) => /superseded draft item/.test(l)));

db.prepare("UPDATE ca_items SET status = 'published' WHERE id = ?").run(out2.itemIds[0]);
D.insertDrafted(db, { date: '2026-08-21', drafted: [{ ...record, headline: 'Third' }], onLog: () => {} });
check(
  'a PUBLISHED item is not withdrawn by a redraft',
  db.prepare('SELECT status FROM ca_items WHERE id = ?').get(out2.itemIds[0]).status === 'published'
);

// ---------------------------------------------------------------------------

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed += 1;
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
cleanup();
process.exit(failed ? 1 : 0);
