// Spaced-revision scheduling (Leitner system) for both current-affairs items
// and MCQs. Pulled out of the route handlers so the interval math is
// independently testable — see server/src/db/schema.sql for the
// ca_revision table this operates on.
//
// Dates are LOCAL 'YYYY-MM-DD' strings — see lib/appTime.js. They were UTC,
// which put the day boundary at 05:30 in the morning for every student: a card
// scheduled for today did not appear as due until after dawn.

const MAX_BOX = 5;
// Days until next review, keyed by box. A correct/"got it" outcome pushes an
// item to a longer box (standard Leitner spacing); a miss/"needs practice"
// drops it straight back to box 1 — so the cycle adapts itself to how well
// each student actually knows each piece of content, not a fixed calendar.
const BOX_INTERVALS = { 1: 1, 2: 3, 3: 7, 4: 14, 5: 30 };

const T = require('./appTime');

function fmt(date) {
  return T.today(date);
}
function addDays(date, n) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

// Seed a revision item the first time it's eligible: a CA item just
// marked read, or an MCQ attempted for the first time. Always starts at box
// 1, due tomorrow, so new items show up as "due soon" rather than being
// retroactively overdue. No-ops if already scheduled — scheduleOutcome()
// below is what moves it from here on.
function seedRevisionItem(db, { userId, itemType, itemId, now = new Date() }) {
  const due_date = fmt(addDays(now, BOX_INTERVALS[1]));
  db.prepare(
    `INSERT INTO ca_revision (user_id, item_type, item_id, box, due_date)
     VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(user_id, item_type, item_id) DO NOTHING`
  ).run(userId, itemType, itemId, due_date);
}

// Advance (or reset) an item's box after a review outcome. `success: true`
// means "got it" (a correct MCQ attempt, or the student self-marking a note
// as revised); `false` means "still shaky" — back to box 1, see it again
// tomorrow. Upserts so an item that's somehow attempted before being seeded
// still ends up scheduled correctly.
function scheduleOutcome(db, { userId, itemType, itemId, success, now = new Date() }) {
  const existing = db
    .prepare('SELECT box FROM ca_revision WHERE user_id = ? AND item_type = ? AND item_id = ?')
    .get(userId, itemType, itemId);
  const currentBox = existing?.box || 0;
  const box = success ? Math.min(currentBox + 1, MAX_BOX) : 1;
  const due_date = fmt(addDays(now, BOX_INTERVALS[box]));
  db.prepare(
    `INSERT INTO ca_revision (user_id, item_type, item_id, box, due_date, last_outcome, last_reviewed_at, reviews_count)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'), 1)
     ON CONFLICT(user_id, item_type, item_id) DO UPDATE SET
       box = excluded.box,
       due_date = excluded.due_date,
       last_outcome = excluded.last_outcome,
       last_reviewed_at = excluded.last_reviewed_at,
       reviews_count = reviews_count + 1`
  ).run(userId, itemType, itemId, box, due_date, success ? 'success' : 'retry');
  return { box, due_date };
}

module.exports = { BOX_INTERVALS, MAX_BOX, seedRevisionItem, scheduleOutcome, fmt, addDays };
