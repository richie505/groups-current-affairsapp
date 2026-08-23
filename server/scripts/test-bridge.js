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
// 6. paced learning — the reading clock
//
// The arithmetic and the clock are pure logic and pin cleanly. What is NOT
// covered here is the route that enforces it; that is one `if` in content.js and
// the thing worth pinning is the state machine underneath it.
// ---------------------------------------------------------------------------

const P = require(path.join(__dirname, '..', 'src', 'lib', 'pacing'));

const short = { id: 1, notes_markdown: 'Nine words is not enough to be a note.' };
const long = { id: 2, notes_markdown: 'word '.repeat(2000) };
const medium = { id: 3, notes_markdown: 'word '.repeat(300) };

check('pacing off asks for no time at all', P.requiredSecondsFor(medium, 'off') === 0);
check('an unknown pace is treated as off', P.requiredSecondsFor(medium, 'nonsense') === 0);
check('a short item gets the floor, not nine seconds', P.requiredSecondsFor(short, 'steady') === P.MIN_SECONDS);
check('a very long item is capped', P.requiredSecondsFor(long, 'thorough') === P.MAX_SECONDS);
check(
  'a thorough pace asks for more time than a brisk one',
  P.requiredSecondsFor(medium, 'thorough') > P.requiredSecondsFor(medium, 'brisk')
);
check(
  '300 words at a steady pace lands near 100 seconds',
  Math.abs(P.requiredSecondsFor(medium, 'steady') - 100) <= 2
);
check(
  'only the fields a student reads are counted',
  P.wordsIn({ notes_markdown: 'one two three', verify_note: 'four five six seven eight' }) === 3
);

// A user and a published item to run a clock against.
const userId = db
  .prepare("INSERT INTO users (name, email, password_hash, role) VALUES ('T','t@example.com','x','student')")
  .run().lastInsertRowid;
const pacedItemId = out2.itemIds[0];
const pacedItem = db.prepare('SELECT * FROM ca_items WHERE id = ?').get(pacedItemId);

const before = P.stateFor(db, userId, pacedItem, 'steady', false);
check('an unopened item reports its whole time as remaining', before.remaining_seconds === before.required_seconds);
check('an unopened item is locked', before.unlocked === false && before.started_at === null);

const opened = P.stateFor(db, userId, pacedItem, 'steady', true);
check('opening the item starts the clock', !!opened.started_at);
check('a freshly started item is still locked', opened.unlocked === false);

// Reopening must not restart it. Backdated first, so a restart would be visible
// as the elapsed time collapsing back to zero.
db.prepare(
  "UPDATE ca_progress SET reading_started_at = datetime('now', '-2 minutes') WHERE user_id = ? AND item_id = ?"
).run(userId, pacedItemId);
const reopened = P.stateFor(db, userId, pacedItem, 'steady', true);
check('reopening does not restart the clock', reopened.elapsed_seconds >= 115);

db.prepare(
  "UPDATE ca_progress SET reading_started_at = datetime('now', '-3 hours') WHERE user_id = ? AND item_id = ?"
).run(userId, pacedItemId);
check('the clock unlocks once its time has run', P.stateFor(db, userId, pacedItem, 'steady', false).unlocked);

check('with pacing off everything is unlocked', P.stateFor(db, userId, pacedItem, 'off', false).unlocked === true);

const plan = P.planFor(db, userId, [pacedItem], 'steady');
check('a finished item owes no more time', plan.remaining_seconds === 0 && plan.locked === 0);
check('the plan still reports what the day totals', plan.total_seconds > 0);
check('the plan is empty when pacing is off', P.planFor(db, userId, [pacedItem], 'off').mode === 'off');

// ---------------------------------------------------------------------------
// 7. the student's own time
//
// The three paces above are a reading SPEED, so a long item is given longer.
// This one is a flat number the student chose, and the point of the checks is
// that it is used AS CHOSEN — the floor and cap that protect a computed number
// must not overrule a deliberate one.
// ---------------------------------------------------------------------------

check(
  'a chosen time is used exactly',
  P.requiredSecondsFor(medium, { mode: 'custom', minutes: 4 }) === 240
);
check(
  'the same chosen time applies whatever the length',
  P.requiredSecondsFor(short, { mode: 'custom', minutes: 4 }) ===
    P.requiredSecondsFor(long, { mode: 'custom', minutes: 4 })
);
// The smallest choosable time is one minute, and the computed floor is 45
// seconds — so the floor can never bite a chosen time in the first place. Worth
// pinning, because lowering MIN_MINUTES below 45 seconds later would silently
// start rounding a student's choice UP without anything saying so.
check(
  'the smallest choosable time clears the computed floor',
  P.MIN_MINUTES * 60 >= P.MIN_SECONDS &&
    P.requiredSecondsFor(short, { mode: 'custom', minutes: P.MIN_MINUTES }) === P.MIN_MINUTES * 60
);
check(
  'a chosen time above the computed cap is still honoured',
  P.requiredSecondsFor(short, { mode: 'custom', minutes: 20 }) === 1200 &&
    1200 > P.MAX_SECONDS
);
check('a mistyped zero is clamped, not obeyed', P.clampMinutes(0) === P.MIN_MINUTES);
check('a mistyped 600 is clamped', P.clampMinutes(600) === P.MAX_MINUTES);
check('nonsense falls back to the default', P.clampMinutes('abc') === P.DEFAULT_MINUTES);

check('a bare mode string is still a valid preference', P.normalisePref('steady').mode === 'steady');
check('an unknown mode is off', P.normalisePref({ mode: 'sideways' }).mode === 'off');

const customState = P.stateFor(db, userId, pacedItem, { mode: 'custom', minutes: 6 }, false);
check('the state reports a chosen time in minutes', customState.minutes === 6);
check('the state carries the chosen time as seconds', customState.required_seconds === 360);
check(
  'a computed pace reports no chosen minutes',
  P.stateFor(db, userId, pacedItem, 'steady', false).minutes === null
);

const customPlan = P.planFor(db, userId, [pacedItem, pacedItem], { mode: 'custom', minutes: 5 });
check('a day plan multiplies the chosen time', customPlan.total_seconds === 600);
check('the day plan names the chosen minutes', customPlan.minutes === 5);

// ---------------------------------------------------------------------------
// 8. what day is it, for the student
//
// "Today" was the UTC date, so between midnight and 05:30 IST the app believed
// it was still yesterday: revision cards due today did not appear, and a note
// read at 2 a.m. counted towards the previous day's streak.
// ---------------------------------------------------------------------------

const T = require(path.join(__dirname, '..', 'src', 'lib', 'appTime'));

// 22 Aug, 20:30 UTC — which is 02:00 on the 23rd in Andhra Pradesh.
const lateNight = new Date('2026-08-22T20:30:00Z');
check('after midnight locally, today is the local date', T.today(lateNight) === '2026-08-23');
check('the UTC date would have been wrong', lateNight.toISOString().slice(0, 10) === '2026-08-22');

// 22 Aug, 03:00 UTC — 08:30 local, same date either way.
check('during the day the two agree', T.today(new Date('2026-08-22T03:00:00Z')) === '2026-08-22');

// 22 Aug, 19:00 UTC — 00:30 on the 23rd. The very first minutes of a local day.
check('the first minutes of a local day are that day', T.today(new Date('2026-08-22T19:00:00Z')) === '2026-08-23');

check('a stored SQLite timestamp reads as a local date', T.localDate('2026-08-22 20:30:00') === '2026-08-23');
check('nonsense falls back to today rather than NaN', /^\d{4}-\d{2}-\d{2}$/.test(T.localDate('not a date')));
check('the SQL shift names the column', T.localSql('marked_at').includes('marked_at'));

// Run against SQLite, not just inspected. An unparseable datetime modifier is
// answered with NULL rather than an error, so the first version of this shifted
// nothing, grouped every read under the key `null`, and showed a student who had
// read something today a streak of zero. It looked exactly like working code.
const shifted = db
  .prepare(`SELECT date(${T.localSql("'2026-08-22 20:30:00'")}) AS d`)
  .get().d;
check('the SQL shift actually shifts, in SQLite', shifted === '2026-08-23');
check(
  'the SQL shift and the JS agree',
  shifted === T.localDate('2026-08-22 20:30:00')
);

// Scheduling has to count in the same calendar at both ends, or the interval is
// off by one for a fifth of every day.
const Rev = require(path.join(__dirname, '..', 'src', 'lib', 'revision'));
check('a card read at 2 a.m. local is due the NEXT local day', Rev.fmt(Rev.addDays(lateNight, 1)) === '2026-08-24');

// ---------------------------------------------------------------------------
// 9. how many questions an item is worth
//
// Three of the four APPSC papers are objective and one is written, and the app
// was built the other way round: 25,421 words of descriptive material serving
// one paper, and 3.9 questions an item serving three. The count now follows how
// much syllabus ground the item actually covers.
// ---------------------------------------------------------------------------

const u = (n) => Array.from({ length: n }, (_, i) => ({ unit_code: `X${i}` }));

check('an item feeding nothing still gets the base four', D.mcqCountFor(u(0)) === 4);
check('one unit gets the base four', D.mcqCountFor(u(1)) === 4);
check('two units are worth more than one', D.mcqCountFor(u(2)) > D.mcqCountFor(u(1)));
check('the count rises with the ground covered', D.mcqCountFor(u(3)) === 8);
check('and is capped, because a press conference runs out of questions', D.mcqCountFor(u(9)) === 10);
check('the base is overridable', D.mcqCountFor(u(1), 6) === 6);

// The unit tag has to survive the round trip, and an invented one must not.
const mcqItem = D.insertDrafted(db, {
  date: '2026-08-21',
  drafted: [
    {
      ...record,
      headline: 'An item whose questions carry units',
      mcqs: [
        { question: 'Real unit?', option_a: 'a', option_b: 'b', option_c: 'c', option_d: 'd',
          correct_option: 'a', format: 'direct_recall', unit_code: 'P3-U7' },
        { question: 'Invented unit?', option_a: 'a', option_b: 'b', option_c: 'c', option_d: 'd',
          correct_option: 'b', format: 'direct_recall', unit_code: 'G9-NOPE' },
      ],
    },
  ],
  onLog: () => {},
});
const written = db
  .prepare('SELECT question, unit_code FROM ca_mcqs WHERE item_id = ? ORDER BY id')
  .all(mcqItem.itemIds[0]);
check('a real unit code is stored on the question', written[0]?.unit_code === 'P3-U7');
check('an invented unit code is stored as blank, not as itself', written[1]?.unit_code === '');

// ---------------------------------------------------------------------------
// 10. which provider serves which model, and the cacheable prompt prefix
// ---------------------------------------------------------------------------

const L = require(path.join(__dirname, '..', '..', 'content-pipeline', 'ca-daily', 'lib'));

const saved = { ...process.env };
const withEnv = (vars, fn) => {
  for (const k of ['ALT_BASE_URL', 'ALT_API_KEY', 'ALT_MODELS', 'OPENAI_BASE_URL']) delete process.env[k];
  Object.assign(process.env, vars);
  try { return fn(); } finally {
    for (const k of Object.keys(vars)) delete process.env[k];
    Object.assign(process.env, saved);
  }
};

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

check(
  'with no second provider everything goes to OpenAI',
  withEnv({}, () => L.endpointFor('gpt-5.6-luna').url) === 'https://api.openai.com/v1/chat/completions'
);
check(
  'a listed model goes to the second provider',
  withEnv(
    { ALT_BASE_URL: 'https://api.deepseek.com/v1', ALT_MODELS: 'deepseek-v4-flash' },
    () => L.endpointFor('deepseek-v4-flash').url
  ) === 'https://api.deepseek.com/v1/chat/completions'
);
check(
  'an UNLISTED model still goes to OpenAI, even with a second provider configured',
  withEnv(
    { ALT_BASE_URL: 'https://api.deepseek.com/v1', ALT_MODELS: 'deepseek-v4-flash' },
    () => L.endpointFor('gpt-5.6-luna').url
  ) === 'https://api.openai.com/v1/chat/completions'
);
check(
  'a trailing slash on the base URL does not double up',
  withEnv(
    { ALT_BASE_URL: 'https://api.deepseek.com/v1/', ALT_MODELS: 'x' },
    () => L.endpointFor('x').url
  ) === 'https://api.deepseek.com/v1/chat/completions'
);
check(
  'the second provider falls back to the OpenAI key if it has none of its own',
  withEnv(
    { ALT_BASE_URL: 'https://api.deepseek.com/v1', ALT_MODELS: 'x', OPENAI_API_KEY: 'k' },
    () => L.endpointFor('x').key
  ) === 'k'
);

// The cacheable prefix. Providers bill a repeated prompt prefix at about a tenth
// of the input rate, and 86% of a drafting call is this prompt — so where the
// opinion block sits is a billing decision as much as a wording one.
const fakePrompt = 'PROMPT';
const fakeVocab = 'V'.repeat(2000);
const headOf = (opinion) =>
  `${fakePrompt}\n\n${D.PRINT_ADDENDUM}\n\n${fakeVocab}${opinion ? `\n\n${D.OPINION_ADDENDUM}` : ''}`;
const a = headOf(false);
const b = headOf(true);
let shared = 0;
while (shared < a.length && a[shared] === b[shared]) shared += 1;
check(
  'a report and an op-ed share the whole prompt+vocabulary head',
  shared === a.length,
  );
check('the opinion block is still present, just last', b.length > a.length && b.includes('OPINION, NOT REPORTAGE'));

// ---------------------------------------------------------------------------
// THE THREE FAULTS THAT COST THE 23 AUGUST RUN
//
// Each of these was a silent loss, not a crash: the run reported itself done
// and the missing work was only findable by counting. They are pinned here for
// that reason — a regression would look exactly as healthy as the bug did.
// ---------------------------------------------------------------------------

const LIB = require(path.join(__dirname, '..', '..', 'content-pipeline', 'ca-daily', 'lib'));

// 1. A dropped connection is transient. 29 of 72 articles were lost because it
//    was not treated as one, and the retry budget was spent only on 429s.
const netErr = () => {
  const e = new TypeError('fetch failed');
  e.cause = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
  return e;
};
check('a dropped connection is retried', LIB.isTransient(netErr()));
check('a timeout is retried', LIB.isTransient(Object.assign(new Error('x'), { name: 'TimeoutError' })));
check('a flagged 429 is still retried', LIB.isTransient(Object.assign(new Error('HTTP 429'), { retryable: true })));
check(
  'a genuine programming error is NOT retried',
  !LIB.isTransient(new TypeError('rows.map is not a function'))
);

// 2. A literal newline inside a JSON string threw away a whole 70-score draft.
check(
  'a raw newline inside a string is repaired, not fatal',
  LIB.parseJson('{"a": "one\ntwo"}').a === 'one\ntwo'
);
check(
  'a tab inside a string is repaired too',
  LIB.parseJson('[{"q":"a\tb"}]', { array: true })[0].q === 'a\tb'
);
check('escaped quotes still survive the repair', LIB.parseJson('{"x":"a\\"b"}').x === 'a"b');
let stillThrows = false;
try {
  LIB.parseJson('{"a": }');
} catch {
  stillThrows = true;
}
check('genuinely broken JSON still throws', stillThrows);

// 3. The model answered with `CODE — label` and the exact-match check filed four
//    correct answers under no unit at all.
const validUnits = new Set(['G2-P1-U7', 'G1P-C5', 'G2-P1-U1', 'G2-P1-U10']);
check('an exact code passes through', D.canonicalUnit('G2-P1-U7', validUnits) === 'G2-P1-U7');
check(
  'a code followed by its label is read as the code',
  D.canonicalUnit('G2-P1-U7 — Union and State government — legislature', validUnits) === 'G2-P1-U7'
);
check(
  'a code in parentheses is read as the code',
  D.canonicalUnit('G1P-C5 (named in the headline)', validUnits) === 'G1P-C5'
);
check('an invented code is still rejected', D.canonicalUnit('G2-P9-U1', validUnits) === '');
check(
  'two codes in one field is an ambiguity, not a guess',
  D.canonicalUnit('G2-P1-U7 or G1P-C5', validUnits) === ''
);
// The codes are not prefix-free. A substring test would see "G2-P1-U1" inside
// "G2-P1-U10", call it ambiguous, and drop a tag that was never in doubt.
check(
  'U10 is not confused with U1',
  D.canonicalUnit('G2-P1-U10 — Andhra Pradesh economy', validUnits) === 'G2-P1-U10'
);
check('U1 is still itself', D.canonicalUnit('G2-P1-U1', validUnits) === 'G2-P1-U1');

// 4. A question on a published item must not reach a student before review.
db.prepare("INSERT INTO ca_days (id, date, status) VALUES (900, '2026-08-01', 'published')").run();
db.prepare(
  `INSERT INTO ca_items (id, day_id, headline, bucket, status, relevance_g1)
     VALUES (900, 900, 'H', 'national', 'published', 0)`
).run();
const insQ = db.prepare(
  `INSERT INTO ca_mcqs (item_id, question, option_a, option_b, option_c, option_d,
     correct_option, status) VALUES (900, ?, 'a', 'b', 'c', 'd', 'a', ?)`
);
insQ.run('reviewed', 'published');
insQ.run('not yet reviewed', 'draft');
check(
  'a question defaults to visible, so the pre-existing bank keeps working',
  db
    .prepare(
      `INSERT INTO ca_mcqs (item_id, question, option_a, option_b, option_c, option_d, correct_option)
       VALUES (900, 'no status given', 'a', 'b', 'c', 'd', 'a') RETURNING status`
    )
    .get().status === 'published'
);
check(
  'an unreviewed question on a published item is not served',
  db
    .prepare(
      `SELECT COUNT(*) AS n FROM ca_mcqs m JOIN ca_items i ON i.id = m.item_id
        JOIN ca_days d ON d.id = i.day_id
        WHERE i.status = 'published' AND d.status = 'published' AND m.status = 'published'`
    )
    .get().n === 2
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
