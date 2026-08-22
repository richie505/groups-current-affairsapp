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
// 3. genre — what kind of piece the source was
//
// The rules that decide it are pure text and pure geometry, so they pin cleanly.
// Each case below is a real piece from the 21 August edition, and every one of
// them was previously classified as a news report.
// ---------------------------------------------------------------------------

const G = require(path.join(__dirname, '..', '..', 'content-pipeline', 'np-daily', 'genre'));

const runningHead = (text) => ({ blocks: [{ text, bbox: [28, 23, 964, 31] }] });
check('section read off the running head', G.sectionOf(runningHead('Vijayawada Editorial')) === 'Editorial');
check(
  'section read off the one-line running head',
  G.sectionOf(runningHead('7 Friday, August 21, 2026 Vijayawada Opinion')) === 'Opinion'
);
check(
  'a promotional strip is not read as a section',
  G.sectionOf(runningHead('Vijayawada www.thehindu.com Friday, August 21, 2026')) === ''
);
check('a page with no running head has no section', G.sectionOf(runningHead('')) === '');

check(
  'signed piece on the editorial page is an op-ed',
  G.genreOf({ headline: 'The Vanashakti verdict is balanced', byline: 'K. Periyasamy', body: 'x' }, 'Editorial').genre === 'oped'
);
check(
  'unsigned piece on the editorial page is an editorial',
  G.genreOf({ headline: 'Trial by fire', byline: '', body: 'x' }, 'Editorial').genre === 'editorial'
);
check(
  'the disclaimer identifies an op-ed with no section',
  G.genreOf({ headline: 'h', byline: 'C. Rangarajan', body: 'Fiscal text. The views expressed are personal' }, '').genre === 'oped'
);
check(
  'a Q&A transcript is an interview',
  G.genreOf({ headline: 'Can free coaching work?', byline: 'BC', body: 'Is it viable? BC: Yes it is. AS: I disagree. BC: The stack model works.' }, 'Opinion').genre === 'interview'
);
check(
  'a news report stays a report',
  G.genreOf({ headline: 'Four higher education Bills passed', byline: 'The Hindu Bureau', body: 'The Assembly passed.' }, 'Andhra Pradesh').genre === 'report'
);
check(
  'a kicker labels the piece below it, not the page',
  G.markerFor({ bbox: [385, 1360, 515, 1380] }, G.markersOf({
    blocks: [
      { text: 'FIFTY YEARS AGO AUGUST 21, 1976', bbox: [385, 1330, 529, 1342] },
      { text: 'PARLEY', bbox: [172, 160, 209, 172] },
    ],
  }))?.genre === 'archive'
);
check('op-ed counts as opinion', G.isOpinion('oped') && G.isOpinion('editorial') && !G.isOpinion('report'));
check('letters and archive are not events', G.isNonEvent('letters') && G.isNonEvent('archive') && !G.isNonEvent('oped'));

// ---------------------------------------------------------------------------
// 4. provenance — an opinion source is marked as one, and says whose it is
// ---------------------------------------------------------------------------

const opRecord = D.markProvenance(
  { headline: 'h', verify_note: '' },
  { genre: 'oped', byline: 'C. Rangarajan', bylines: 'C. Rangarajan | D.K. Srivastava' }
);
check('op-ed record carries its genre', opRecord._genre === 'oped');
check('op-ed record names every author', opRecord._author === 'C. Rangarajan, D.K. Srivastava');
check('op-ed forces the verify flag', Number(opRecord.needs_verify) === 1);
check('verify note names whose claims these are', /C\. Rangarajan, D\.K\. Srivastava/.test(opRecord.verify_note));

const edRecord = D.markProvenance({ headline: 'h' }, { genre: 'editorial', byline: '', publication: 'The Hindu' });
check('an unsigned editorial is attributed to the paper', edRecord._author === 'The Hindu');

const repRecord = D.markProvenance({ headline: 'h', needs_verify: 0 }, { genre: 'report', byline: 'The Hindu Bureau' });
check('a report is not force-flagged', Number(repRecord.needs_verify) === 0);
check('a report carries no forced verify note', !repRecord.verify_note);

const provOut = D.insertDrafted(db, {
  date: '2026-08-21',
  drafted: [{ ...record, headline: 'An op-ed item', _genre: 'oped', _author: 'C. Rangarajan' }],
  onLog: () => {},
});
const provItem = db.prepare('SELECT source_genre, source_author FROM ca_items WHERE id = ?').get(provOut.itemIds[0]);
check('source genre is stored on the item', provItem.source_genre === 'oped');
check('source author is stored on the item', provItem.source_author === 'C. Rangarajan');

// ---------------------------------------------------------------------------
// 5. the relevance gate refuses pieces that are not events at all
// ---------------------------------------------------------------------------

const R = require(path.join(__dirname, '..', 'src', 'lib', 'relevance'));
const ctx = R.loadContext(db);
const archive = R.score(
  {
    headline: "A HUNDRED YEARS AGO AUGUST 21, 1926 Calcutta's foreign trade",
    body: 'Calcutta, August 18: Calcutta trade with foreign countries in July 1926 shows a small decline under the Act.',
    genre: 'archive',
  },
  ctx
);
check('an archive reprint is vetoed, not scored', archive.score === 0 && !!archive.vetoed);
check('the veto says why', /not a report of a current event/.test(archive.why));

// ---------------------------------------------------------------------------

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed += 1;
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
cleanup();
process.exit(failed ? 1 : 0);
