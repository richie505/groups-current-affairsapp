const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');
const { seedRevisionItem, scheduleOutcome, fmt, addDays } = require('../lib/revision');
const { bankReview, BANK_TARGETS } = require('../lib/bankReview');
const { buildQuiz } = require('../lib/quiz');

const router = express.Router();
router.use(requireAuth);

const BUCKETS = ['international', 'national', 'ap', 'dynamic'];

// Only published items on a published day are ever visible to a student. Two
// levels rather than one because a day is published as a unit — the admin
// approves a digest, not a scattering of items — while an individual item can
// still be held back or discarded within an approved day.
const VISIBLE = `i.status = 'published' AND d.status = 'published'`;

const P = require('../lib/pacing');
const T = require('../lib/appTime');

// The pacing setting, read from the database rather than from the JWT.
//
// The token carries it too, and the client uses that for first paint — but a
// token lives thirty days and this is the setting the gate below is enforced on.
// Reading the row is the difference between "what the browser was told when it
// logged in" and "what the student has chosen".
// A query-string number, bounded at both ends. `Number(x) || fallback` is the
// idiom this replaces, and it has one hole big enough to matter: it rejects NaN
// and zero and accepts every negative.
function clamp(value, fallback, min, max) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, Math.max(min, n));
}

function pacingOf(userId) {
  const row = db.prepare('SELECT pacing, pacing_minutes FROM users WHERE id = ?').get(userId);
  return { mode: row?.pacing || 'off', minutes: row?.pacing_minutes ?? 4 };
}

function itemColumns(alias = 'i') {
  return `${alias}.id, ${alias}.day_id, ${alias}.headline, ${alias}.event_date, ${alias}.bucket,
          ${alias}.subject_tag, ${alias}.notes_markdown, ${alias}.static_linkage,
          ${alias}.static_notes,
          ${alias}.prelims_facts, ${alias}.g1_bank, ${alias}.g1_fact, ${alias}.g1_angle,
          ${alias}.g1_theme, ${alias}.g1_sub_theme, ${alias}.g1_why_news,
          ${alias}.g1_background, ${alias}.g1_ap_angle, ${alias}.g1_linked,
          ${alias}.g1_bridges, ${alias}.g1_way_forward,
          ${alias}.importance, ${alias}.relevance_g1, ${alias}.relevance_g2,
          ${alias}.needs_verify, ${alias}.verify_note,
          ${alias}.source_genre, ${alias}.source_author, ${alias}.order_index`;
}

// Tag/source fan-out for a set of items, fetched in three queries rather than
// three per item. A digest day routinely carries 12 items with 4 tags each,
// and the N+1 version of this was the slowest thing on the Today screen.
function attachTags(items) {
  if (!items.length) return items;
  const ids = items.map((i) => i.id);
  const holes = ids.map(() => '?').join(',');
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const it of items) {
    it.keywords = [];
    it.units = [];
    it.themes = [];
    it.sources = [];
    it.dimensions = [];
    it.essay_questions = [];
  }
  for (const r of db.prepare(`SELECT item_id, keyword FROM ca_item_keywords WHERE item_id IN (${holes})`).all(...ids)) {
    byId.get(r.item_id)?.keywords.push(r.keyword);
  }
  for (const r of db
    .prepare(
      `SELECT u.item_id, u.unit_code, r.label, r.paper
         FROM ca_item_units u LEFT JOIN ref_units r ON r.unit_code = u.unit_code
        WHERE u.item_id IN (${holes}) ORDER BY u.unit_code`
    )
    .all(...ids)) {
    byId.get(r.item_id)?.units.push({ unit_code: r.unit_code, label: r.label, paper: r.paper });
  }
  for (const r of db.prepare(`SELECT item_id, theme FROM ca_item_themes WHERE item_id IN (${holes})`).all(...ids)) {
    byId.get(r.item_id)?.themes.push(r.theme);
  }
  for (const r of db
    .prepare(
      `SELECT item_id, url, publisher, is_primary FROM ca_item_sources
        WHERE item_id IN (${holes}) ORDER BY is_primary DESC, id`
    )
    .all(...ids)) {
    byId.get(r.item_id)?.sources.push(r);
  }
  // Sections 3 and 8 of the Group-I note template.
  for (const r of db
    .prepare(
      `SELECT item_id, dimension, note FROM ca_item_dimensions
        WHERE item_id IN (${holes}) ORDER BY dimension`
    )
    .all(...ids)) {
    byId.get(r.item_id)?.dimensions.push({ dimension: r.dimension, note: r.note });
  }
  for (const r of db
    .prepare(
      `SELECT item_id, id, question, kind, note FROM ca_essay_questions
        WHERE item_id IN (${holes}) ORDER BY kind DESC, id`
    )
    .all(...ids)) {
    byId.get(r.item_id)?.essay_questions.push({ id: r.id, question: r.question, kind: r.kind, note: r.note });
  }
  return items;
}

// Per-user state for a set of items, again batched.
function attachUserState(items, userId) {
  if (!items.length) return items;
  const ids = items.map((i) => i.id);
  const holes = ids.map(() => '?').join(',');
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const it of items) {
    it.marked_read = 0;
    it.bookmarked = 0;
    it.my_card = null;
  }
  for (const r of db
    .prepare(
      `SELECT item_id, marked_read FROM ca_progress
        WHERE user_id = ? AND item_id IN (${holes})`
    )
    .all(userId, ...ids)) {
    const it = byId.get(r.item_id);
    if (it) it.marked_read = r.marked_read;
  }
  for (const r of db
    .prepare(`SELECT item_id FROM ca_bookmarks WHERE user_id = ? AND item_id IN (${holes})`)
    .all(userId, ...ids)) {
    const it = byId.get(r.item_id);
    if (it) it.bookmarked = 1;
  }
  for (const r of db
    .prepare(`SELECT item_id, bank, own_note FROM ca_user_cards WHERE user_id = ? AND item_id IN (${holes})`)
    .all(userId, ...ids)) {
    const it = byId.get(r.item_id);
    if (it) it.my_card = { bank: r.bank, own_note: r.own_note };
  }
  // MCQ counts, and how many the student has already answered — the Today
  // screen shows "4 questions" on a locked item so the unlock is worth doing.
  for (const r of db
    .prepare(
      `SELECT m.item_id,
              COUNT(*) AS mcq_count,
              SUM(CASE WHEN a.id IS NOT NULL THEN 1 ELSE 0 END) AS attempted
         FROM ca_mcqs m
         LEFT JOIN (
              SELECT mcq_id, MAX(id) AS id FROM ca_attempts WHERE user_id = ? GROUP BY mcq_id
         ) a ON a.mcq_id = m.id
        WHERE m.item_id IN (${holes})
        GROUP BY m.item_id`
    )
    .all(userId, ...ids)) {
    const it = byId.get(r.item_id);
    if (it) {
      it.mcq_count = r.mcq_count;
      it.mcq_attempted = r.attempted || 0;
    }
  }
  for (const it of items) {
    it.mcq_count = it.mcq_count || 0;
    it.mcq_attempted = it.mcq_attempted || 0;
  }
  return items;
}

// ---- Reference vocabularies ---------------------------------------------

router.get('/meta', (req, res) => {
  res.json({
    buckets: BUCKETS,
    bank_targets: BANK_TARGETS,
    units: db.prepare('SELECT unit_code, paper, label FROM ref_units ORDER BY order_index').all(),
    keywords: db.prepare('SELECT keyword, subject FROM ref_keywords ORDER BY subject, order_index').all(),
    themes: db.prepare('SELECT DISTINCT theme FROM ca_item_themes ORDER BY theme').all().map((r) => r.theme),
    corrections: db
      .prepare('SELECT topic, superseded_claim, correct_position, effective_date FROM ref_corrections ORDER BY id')
      .all(),
  });
});

// ---- Days ---------------------------------------------------------------

// The digest list. Defaults to the most recent days rather than "today", so
// the app still opens onto something on a day the pipeline hasn't run.
router.get('/days', (req, res) => {
  // Clamped at BOTH ends. `Number(x) || 30` catches NaN and zero and lets a
  // negative through, and SQLite reads `LIMIT -1` as no limit at all — so
  // ?limit=-1 quietly returned every day in the database.
  const limit = clamp(req.query.limit, 30, 1, 120);
  const month = req.query.month; // 'YYYY-MM'
  const where = [`d.status = 'published'`];
  const params = [];
  if (month) {
    where.push(`d.date LIKE ?`);
    params.push(`${month}-%`);
  }
  const days = db
    .prepare(
      `SELECT d.id, d.date, d.title, d.intro_markdown,
              COUNT(i.id) AS item_count,
              SUM(CASE WHEN i.importance = 1 THEN 1 ELSE 0 END) AS tier1_count,
              SUM(CASE WHEN i.bucket = 'ap' THEN 1 ELSE 0 END) AS ap_count
         FROM ca_days d
         LEFT JOIN ca_items i ON i.day_id = d.id AND i.status = 'published'
        WHERE ${where.join(' AND ')}
        GROUP BY d.id
        ORDER BY d.date DESC
        LIMIT ?`
    )
    .all(...params, limit);

  // How much of each day this student has read. Shown as a ring on the
  // archive so a half-finished day is visibly half-finished.
  if (days.length) {
    const ids = days.map((d) => d.id);
    const holes = ids.map(() => '?').join(',');
    const read = db
      .prepare(
        `SELECT i.day_id, COUNT(*) AS n
           FROM ca_progress p JOIN ca_items i ON i.id = p.item_id
          WHERE p.user_id = ? AND p.marked_read = 1 AND i.day_id IN (${holes})
          GROUP BY i.day_id`
      )
      .all(req.user.id, ...ids);
    const byDay = new Map(read.map((r) => [r.day_id, r.n]));
    for (const d of days) d.read_count = byDay.get(d.id) || 0;
  }
  res.json({ days });
});

// A single digest, by date rather than id — the URL a student navigates to is
// /day/2026-08-21, which is meaningful and shareable in a way /day/47 isn't.
router.get('/days/:date', (req, res) => {
  const day = db
    .prepare(`SELECT id, date, title, intro_markdown FROM ca_days WHERE date = ? AND status = 'published'`)
    .get(req.params.date);
  if (!day) return res.status(404).json({ error: 'No published digest for that date.' });

  const items = db
    .prepare(
      `SELECT ${itemColumns()} FROM ca_items i JOIN ca_days d ON d.id = i.day_id
        WHERE i.day_id = ? AND ${VISIBLE}
        ORDER BY i.importance, i.order_index, i.id`
    )
    .all(day.id);
  attachTags(items);
  attachUserState(items, req.user.id);

  // Neighbouring digests, so the day view has prev/next without a second
  // round trip. Restricted to published days, so navigation can't dead-end on
  // a draft the student cannot see.
  const prev = db
    .prepare(`SELECT date FROM ca_days WHERE date < ? AND status = 'published' ORDER BY date DESC LIMIT 1`)
    .get(day.date);
  const next = db
    .prepare(`SELECT date FROM ca_days WHERE date > ? AND status = 'published' ORDER BY date ASC LIMIT 1`)
    .get(day.date);

  // What the day will cost at this student's pace, and how much of it is still
  // owed. Sent with the digest so the plan is visible before the reading starts,
  // which is the whole point of choosing a pace.
  const pacing = P.planFor(db, req.user.id, items, pacingOf(req.user.id));

  res.json({ day, items, pacing, prev: prev?.date || null, next: next?.date || null });
});

// The latest published digest — what "Today" actually resolves to.
router.get('/today', (req, res) => {
  const day = db
    .prepare(`SELECT date FROM ca_days WHERE status = 'published' ORDER BY date DESC LIMIT 1`)
    .get();
  if (!day) return res.json({ date: null });
  res.json({ date: day.date });
});

// Month-by-month counts for the archive calendar.
router.get('/archive', (req, res) => {
  const months = db
    .prepare(
      `SELECT substr(d.date, 1, 7) AS month,
              COUNT(DISTINCT d.id) AS days,
              COUNT(i.id) AS items
         FROM ca_days d
         LEFT JOIN ca_items i ON i.day_id = d.id AND i.status = 'published'
        WHERE d.status = 'published'
        GROUP BY month
        ORDER BY month DESC`
    )
    .all();
  res.json({ months });
});

// ---- One item -----------------------------------------------------------

router.get('/items/:id', (req, res) => {
  const item = db
    .prepare(
      `SELECT ${itemColumns()}, d.date AS day_date, d.title AS day_title
         FROM ca_items i JOIN ca_days d ON d.id = i.day_id
        WHERE i.id = ? AND ${VISIBLE}`
    )
    .get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found.' });

  attachTags([item]);
  attachUserState([item], req.user.id);

  // Opening the item starts its reading clock, once. Re-opening does not restart
  // it: reading is not a single sitting, and a feature that assumed it was would
  // punish exactly the student who goes back to check something.
  item.pacing = P.stateFor(db, req.user.id, item, pacingOf(req.user.id), true);

  // MCQs stay hidden until the notes are marked read. Same rule as the static
  // app, for the same reason: a question answered before the notes teaches the
  // answer, not the topic. The count is still returned so the lock has a
  // visible payoff.
  item.mcqs = item.marked_read
    ? db
        .prepare(
          `SELECT id, question, option_a, option_b, option_c, option_d, correct_option,
                  explanation, format, keyword, difficulty, fact_as_of
             FROM ca_mcqs WHERE item_id = ? ORDER BY id`
        )
        .all(item.id)
    : [];

  item.skeletons = db
    .prepare('SELECT id, paper, question_text, skeleton_markdown FROM ca_skeletons WHERE item_id = ? ORDER BY id')
    .all(item.id);

  res.json({ item });
});

router.post('/items/:id/read', (req, res) => {
  const item = db
    .prepare(`SELECT i.id FROM ca_items i JOIN ca_days d ON d.id = i.day_id WHERE i.id = ? AND ${VISIBLE}`)
    .get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found.' });

  // The pacing gate, and the only place it is enforced.
  //
  // Everything downstream — the item page's questions, the quiz builder, the
  // revision queue — already keys off `marked_read`, so refusing to set it here
  // is enough. One gate rather than five is also the only version of this that
  // stays true as those five callers change.
  //
  // 409 rather than 403: nothing is forbidden, the request is simply early.
  const pref = pacingOf(req.user.id);
  if (pref.mode !== 'off') {
    const full = db.prepare(`SELECT ${itemColumns()} FROM ca_items i WHERE i.id = ?`).get(item.id);
    const state = P.stateFor(db, req.user.id, full, pref, true);
    if (!state.unlocked) {
      return res.status(409).json({
        error:
          `Still reading — ${P.remainingLabel(state.remaining_seconds)} to go at your chosen ` +
          'pace. You can change or switch off pacing in Your account.',
        pacing: state,
      });
    }
  }

  db.prepare(
    `INSERT INTO ca_progress (user_id, item_id, marked_read, marked_at)
     VALUES (?, ?, 1, datetime('now'))
     ON CONFLICT(user_id, item_id) DO UPDATE SET marked_read = 1, marked_at = datetime('now')`
  ).run(req.user.id, item.id);

  seedRevisionItem(db, { userId: req.user.id, itemType: 'item', itemId: item.id });
  res.json({ ok: true, marked_read: 1 });
});

router.delete('/items/:id/read', (req, res) => {
  db.prepare('UPDATE ca_progress SET marked_read = 0 WHERE user_id = ? AND item_id = ?').run(
    req.user.id,
    req.params.id
  );
  res.json({ ok: true, marked_read: 0 });
});

router.post('/items/:id/bookmark', (req, res) => {
  // The same existence check the read and card routes make. Without it an
  // unknown id reached the foreign key and came back as a 500 "something went
  // wrong on the server" — which is a lie: nothing went wrong on the server,
  // the item does not exist.
  const item = db
    .prepare(`SELECT i.id FROM ca_items i JOIN ca_days d ON d.id = i.day_id WHERE i.id = ? AND ${VISIBLE}`)
    .get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found.' });

  db.prepare(
    `INSERT INTO ca_bookmarks (user_id, item_id) VALUES (?, ?)
     ON CONFLICT(user_id, item_id) DO NOTHING`
  ).run(req.user.id, item.id);
  res.json({ ok: true, bookmarked: 1 });
});

router.delete('/items/:id/bookmark', (req, res) => {
  db.prepare('DELETE FROM ca_bookmarks WHERE user_id = ? AND item_id = ?').run(req.user.id, req.params.id);
  res.json({ ok: true, bookmarked: 0 });
});

router.get('/bookmarks', (req, res) => {
  const items = db
    .prepare(
      `SELECT ${itemColumns()}, d.date AS day_date, b.created_at AS saved_at
         FROM ca_bookmarks b
         JOIN ca_items i ON i.id = b.item_id
         JOIN ca_days d ON d.id = i.day_id
        WHERE b.user_id = ? AND ${VISIBLE}
        ORDER BY b.created_at DESC`
    )
    .all(req.user.id);
  attachTags(items);
  attachUserState(items, req.user.id);
  res.json({ items });
});

// ---- Group-I personal banks --------------------------------------------

// Filing a card is a deliberate act, not a side effect of reading. A bank that
// fills itself is a bank nobody has read, and the targets it's measured
// against only mean something if the student chose each entry.
router.post('/items/:id/card', (req, res) => {
  const { bank, own_note } = req.body || {};
  if (!['Q', 'D', 'E', 'S'].includes(bank)) {
    return res.status(400).json({ error: 'Bank must be Q, D, E or S.' });
  }
  const item = db
    .prepare(
      `SELECT i.id, i.g1_angle FROM ca_items i JOIN ca_days d ON d.id = i.day_id
        WHERE i.id = ? AND ${VISIBLE}`
    )
    .get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found.' });
  if (!item.g1_angle.trim()) {
    // Refusing here rather than silently filing it: a card with no argument
    // will never make it into an answer, so letting it inflate the bank count
    // would make the bank review lie about how ready the student is.
    return res.status(400).json({ error: 'This item has no angle, so it cannot be filed to a bank.' });
  }
  db.prepare(
    `INSERT INTO ca_user_cards (user_id, item_id, bank, own_note) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, item_id) DO UPDATE SET bank = excluded.bank, own_note = excluded.own_note`
  ).run(req.user.id, item.id, bank, String(own_note || '').slice(0, 2000));
  res.json({ ok: true, bank });
});

router.delete('/items/:id/card', (req, res) => {
  db.prepare('DELETE FROM ca_user_cards WHERE user_id = ? AND item_id = ?').run(req.user.id, req.params.id);
  res.json({ ok: true });
});

router.get('/banks', (req, res) => {
  res.json(bankReview(db, req.user.id));
});

// The cards themselves, for browsing one bank at a time.
router.get('/banks/:bank', (req, res) => {
  const bank = String(req.params.bank).toUpperCase();
  if (!['Q', 'D', 'E', 'S'].includes(bank)) return res.status(400).json({ error: 'Unknown bank.' });
  const items = db
    .prepare(
      `SELECT ${itemColumns()}, d.date AS day_date, c.own_note, c.created_at AS filed_at
         FROM ca_user_cards c
         JOIN ca_items i ON i.id = c.item_id
         JOIN ca_days d ON d.id = i.day_id
        WHERE c.user_id = ? AND c.bank = ? AND ${VISIBLE}
        ORDER BY c.created_at DESC`
    )
    .all(req.user.id, bank);
  attachTags(items);
  res.json({ bank, items });
});

// ---- Practice -----------------------------------------------------------

// Builds a paper. Scope is deliberately expressive — a current-affairs student
// revises by *window* ("this month") far more than by topic, which is the
// opposite of how static subjects are practised.
router.get('/practice', (req, res) => {
  const quiz = buildQuiz(db, {
    userId: req.user.id,
    scope: req.query.scope || 'range',
    from: req.query.from,
    to: req.query.to,
    month: req.query.month,
    date: req.query.date,
    bucket: req.query.bucket,
    keyword: req.query.keyword,
    unit: req.query.unit,
    // Same clamp, and here the consequence was stranger: a negative limit
    // reached pickByFormatMix, whose per-format quota went negative, whose
    // slice(0, -n) then took ALL BUT the last n — so ?limit=-5 handed back a
    // 92-question quiz.
    limit: clamp(req.query.limit, 20, 1, 100),
    onlyUnread: req.query.only_unread === '1',
  });
  res.json(quiz);
});

router.post('/mcqs/:id/attempt', (req, res) => {
  const { selected_option, session_id } = req.body || {};
  if (!['a', 'b', 'c', 'd'].includes(selected_option)) {
    return res.status(400).json({ error: 'Pick an option.' });
  }
  const mcq = db
    .prepare(
      `SELECT m.id, m.correct_option, m.explanation, m.fact_as_of, m.item_id
         FROM ca_mcqs m JOIN ca_items i ON i.id = m.item_id JOIN ca_days d ON d.id = i.day_id
        WHERE m.id = ? AND ${VISIBLE}`
    )
    .get(req.params.id);
  if (!mcq) return res.status(404).json({ error: 'Question not found.' });

  const is_correct = mcq.correct_option === selected_option ? 1 : 0;
  db.prepare(
    `INSERT INTO ca_attempts (user_id, mcq_id, selected_option, is_correct, session_id)
     VALUES (?, ?, ?, ?, ?)`
  ).run(req.user.id, mcq.id, selected_option, is_correct, session_id || null);

  scheduleOutcome(db, {
    userId: req.user.id,
    itemType: 'mcq',
    itemId: mcq.id,
    success: !!is_correct,
  });

  res.json({
    is_correct,
    correct_option: mcq.correct_option,
    explanation: mcq.explanation,
    fact_as_of: mcq.fact_as_of,
  });
});

router.post('/sessions', (req, res) => {
  const { scope, scope_ref, label, total, answered, correct, timed, duration_seconds } = req.body || {};

  // A session is written once and never edited, and the Progress screen divides
  // by these numbers. `{ total: -1, answered: 99, correct: 1e9 }` was accepted
  // and stored, which is an accuracy figure of 1,010,101% sitting permanently in
  // a student's history with no way to remove it.
  const n = (v) => {
    const x = Math.round(Number(v));
    return Number.isFinite(x) && x >= 0 ? x : null;
  };
  const nTotal = n(total);
  const nAnswered = n(answered) ?? 0;
  const nCorrect = n(correct) ?? 0;
  if (!nTotal) return res.status(400).json({ error: 'A session needs a question count.' });
  if (nTotal > 500) return res.status(400).json({ error: 'That is not a session, that is a paper.' });
  if (nAnswered > nTotal) {
    return res.status(400).json({ error: 'More answers than questions.' });
  }
  if (nCorrect > nAnswered) {
    return res.status(400).json({ error: 'More correct than answered.' });
  }
  const info = db
    .prepare(
      `INSERT INTO ca_sessions (user_id, scope, scope_ref, label, total, answered, correct, timed, duration_seconds)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user.id,
      scope || 'range',
      String(scope_ref || ''),
      String(label || ''),
      nTotal,
      nAnswered,
      nCorrect,
      timed ? 1 : 0,
      n(duration_seconds)
    );
  res.json({ id: info.lastInsertRowid });
});

router.get('/sessions', (req, res) => {
  const sessions = db
    .prepare(
      `SELECT id, scope, scope_ref, label, total, answered, correct, timed, duration_seconds, created_at
         FROM ca_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 60`
    )
    .all(req.user.id);
  res.json({ sessions });
});

// ---- Revision -----------------------------------------------------------

router.get('/revision/due', (req, res) => {
  // The student's today, not UTC's. See lib/appTime.js.
  const today = T.today();
  const items = db
    .prepare(
      `SELECT ${itemColumns()}, d.date AS day_date, r.box, r.due_date
         FROM ca_revision r
         JOIN ca_items i ON i.id = r.item_id
         JOIN ca_days d ON d.id = i.day_id
        WHERE r.user_id = ? AND r.item_type = 'item' AND r.due_date <= ? AND ${VISIBLE}
        ORDER BY r.due_date, i.importance
        LIMIT 40`
    )
    .all(req.user.id, today);
  attachTags(items);

  const mcqs = db
    .prepare(
      `SELECT m.id, m.question, m.option_a, m.option_b, m.option_c, m.option_d,
              m.correct_option, m.explanation, m.format, m.keyword, m.fact_as_of,
              i.id AS item_id, i.headline, d.date AS day_date, r.box, r.due_date
         FROM ca_revision r
         JOIN ca_mcqs m ON m.id = r.item_id
         JOIN ca_items i ON i.id = m.item_id
         JOIN ca_days d ON d.id = i.day_id
        WHERE r.user_id = ? AND r.item_type = 'mcq' AND r.due_date <= ? AND ${VISIBLE}
        ORDER BY r.due_date
        LIMIT 40`
    )
    .all(req.user.id, today);

  // A forward view, so the student can see the load coming rather than only
  // what has already piled up.
  const upcoming = db
    .prepare(
      `SELECT due_date, COUNT(*) AS n FROM ca_revision
        WHERE user_id = ? AND due_date > ? AND due_date <= ?
        GROUP BY due_date ORDER BY due_date`
    )
    .all(req.user.id, today, fmt(addDays(new Date(), 14)));

  res.json({ items, mcqs, upcoming, today });
});

router.post('/revision/review', (req, res) => {
  const { item_type, item_id, success } = req.body || {};
  if (!['item', 'mcq'].includes(item_type)) return res.status(400).json({ error: 'Unknown item type.' });
  const out = scheduleOutcome(db, {
    userId: req.user.id,
    itemType: item_type,
    itemId: item_id,
    success: !!success,
  });
  res.json({ ok: true, ...out });
});

// ---- Mistakes -----------------------------------------------------------

// Grouped by keyword angle, not just listed. A student who keeps missing
// "Appointed" questions has a specific, fixable gap; a flat list of wrong
// answers tells them only that they got things wrong.
router.get('/mistakes', (req, res) => {
  const rows = db
    .prepare(
      `WITH latest AS (
         SELECT mcq_id, MAX(id) AS attempt_id
           FROM ca_attempts WHERE user_id = ? GROUP BY mcq_id
       )
       SELECT m.id, m.question, m.option_a, m.option_b, m.option_c, m.option_d,
              m.correct_option, m.explanation, m.format, m.keyword, m.fact_as_of,
              a.selected_option, a.attempted_at,
              i.id AS item_id, i.headline, i.bucket, d.date AS day_date
         FROM latest l
         JOIN ca_attempts a ON a.id = l.attempt_id
         JOIN ca_mcqs m ON m.id = l.mcq_id
         JOIN ca_items i ON i.id = m.item_id
         JOIN ca_days d ON d.id = i.day_id
        WHERE a.is_correct = 0 AND ${VISIBLE}
        ORDER BY a.attempted_at DESC`
    )
    .all(req.user.id);

  const byKeyword = {};
  for (const r of rows) {
    const k = r.keyword || 'untagged';
    (byKeyword[k] = byKeyword[k] || []).push(r);
  }
  const groups = Object.entries(byKeyword)
    .map(([keyword, mcqs]) => ({ keyword, count: mcqs.length, mcqs }))
    .sort((a, b) => b.count - a.count);

  res.json({ total: rows.length, groups });
});

// ---- Progress -----------------------------------------------------------

router.get('/progress', (req, res) => {
  const userId = req.user.id;

  const totals = db
    .prepare(
      `SELECT COUNT(*) AS published_items,
              SUM(CASE WHEN i.bucket = 'ap' THEN 1 ELSE 0 END) AS ap_items
         FROM ca_items i JOIN ca_days d ON d.id = i.day_id WHERE ${VISIBLE}`
    )
    .get();

  const read = db
    .prepare(
      `SELECT COUNT(*) AS n, SUM(CASE WHEN i.bucket = 'ap' THEN 1 ELSE 0 END) AS ap
         FROM ca_progress p JOIN ca_items i ON i.id = p.item_id JOIN ca_days d ON d.id = i.day_id
        WHERE p.user_id = ? AND p.marked_read = 1 AND ${VISIBLE}`
    )
    .get(userId);

  const accuracy = db
    .prepare(
      `SELECT COUNT(*) AS attempts, SUM(is_correct) AS correct
         FROM ca_attempts WHERE user_id = ?`
    )
    .get(userId);

  // Per-bucket coverage. Uneven coverage is the failure mode this catches: it
  // is easy to read national news daily and let the AP bucket rot, which is
  // exactly backwards for this exam.
  const buckets = db
    .prepare(
      `SELECT i.bucket,
              COUNT(*) AS total,
              SUM(CASE WHEN p.marked_read = 1 THEN 1 ELSE 0 END) AS read
         FROM ca_items i
         JOIN ca_days d ON d.id = i.day_id
         LEFT JOIN ca_progress p ON p.item_id = i.id AND p.user_id = ?
        WHERE ${VISIBLE}
        GROUP BY i.bucket`
    )
    .all(userId);

  // Where the marks are being lost, by keyword angle.
  const weakKeywords = db
    .prepare(
      `SELECT m.keyword,
              COUNT(*) AS attempts,
              SUM(a.is_correct) AS correct
         FROM ca_attempts a JOIN ca_mcqs m ON m.id = a.mcq_id
        WHERE a.user_id = ? AND m.keyword <> ''
        GROUP BY m.keyword
       HAVING attempts >= 3
        ORDER BY (CAST(SUM(a.is_correct) AS REAL) / COUNT(*)) ASC
        LIMIT 8`
    )
    .all(userId);

  const daily = db
    .prepare(
      // Grouped by the day the STUDENT had, not the day UTC had. Reading at
      // 02:00 used to be filed under the previous date, so a real day of work
      // could show as blank and break a streak that had actually been kept.
      `SELECT date(${T.localSql('marked_at')}) AS date, COUNT(*) AS n
         FROM ca_progress
        WHERE user_id = ? AND marked_read = 1 AND marked_at IS NOT NULL
          AND marked_at >= datetime('now', '-90 days')
        GROUP BY date ORDER BY date`
    )
    .all(userId);

  res.json({
    totals,
    read: { items: read.n || 0, ap: read.ap || 0 },
    accuracy: {
      attempts: accuracy.attempts || 0,
      correct: accuracy.correct || 0,
      pct: accuracy.attempts ? Math.round((accuracy.correct / accuracy.attempts) * 100) : null,
    },
    buckets,
    weak_keywords: weakKeywords,
    daily,
    streak: computeStreak(daily),
  });
});

// Consecutive days up to today (or yesterday — a streak shouldn't be reported
// as broken before the day is over).
function computeStreak(daily) {
  const dates = new Set(daily.map((d) => d.date));
  let streak = 0;
  // Walked in local days, to match the grouping above. Stepping a UTC cursor
  // over locally-grouped dates would drop a day twice a year and, worse, every
  // night between midnight and half past five.
  const cursor = new Date();
  if (!dates.has(T.today(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (dates.has(T.today(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

// ---- Monthly revision --------------------------------------------------

// A whole month as one compendium. This is how current affairs is actually
// revised — nobody re-reads 30 separate days, they re-read the month.
router.get('/months/:month', (req, res) => {
  const month = req.params.month;
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'Month must be YYYY-MM.' });

  const items = db
    .prepare(
      `SELECT ${itemColumns()}, d.date AS day_date
         FROM ca_items i JOIN ca_days d ON d.id = i.day_id
        WHERE d.date LIKE ? AND ${VISIBLE}
        ORDER BY i.importance, d.date, i.order_index`
    )
    .all(`${month}-%`);
  attachTags(items);
  attachUserState(items, req.user.id);

  const mcqTotal = db
    .prepare(
      `SELECT COUNT(*) AS n FROM ca_mcqs m
         JOIN ca_items i ON i.id = m.item_id JOIN ca_days d ON d.id = i.day_id
        WHERE d.date LIKE ? AND ${VISIBLE}`
    )
    .get(`${month}-%`);

  res.json({ month, items, mcq_total: mcqTotal.n });
});

// ---- Search -------------------------------------------------------------

router.get('/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ items: [] });
  // `_` and `%` are LIKE's own wildcards, so an unescaped term searched for
  // something else entirely: "c_urt" found "court", and five underscores
  // matched every item in the database. A student searching "50%" or
  // "Article_21" got nonsense back and no way to tell it was nonsense.
  // `~` rather than the conventional backslash. The SQL below is a JS template
  // literal, so a backslash has to survive two layers of escaping to reach
  // SQLite — written as `ESCAPE '\'` it arrives as `ESCAPE ''`, an empty string,
  // and every search 500s. `~` needs escaping in neither layer, and is escaped
  // by the same rule as the wildcards if a student ever types one.
  const like = `%${q.replace(/[~%_]/g, '~$&')}%`;
  const items = db
    .prepare(
      `SELECT ${itemColumns()}, d.date AS day_date
         FROM ca_items i JOIN ca_days d ON d.id = i.day_id
        WHERE ${VISIBLE}
          AND (i.headline LIKE ? ESCAPE '~' OR i.notes_markdown LIKE ? ESCAPE '~'
               OR i.g1_fact LIKE ? ESCAPE '~' OR i.g1_angle LIKE ? ESCAPE '~'
               OR i.prelims_facts LIKE ? ESCAPE '~'
               OR EXISTS (SELECT 1 FROM ca_item_keywords k
                           WHERE k.item_id = i.id AND k.keyword LIKE ? ESCAPE '~'))
        ORDER BY d.date DESC
        LIMIT 50`
    )
    .all(like, like, like, like, like, like);
  attachTags(items);
  res.json({ items, query: q });
});

module.exports = router;
