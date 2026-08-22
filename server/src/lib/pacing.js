'use strict';

// PACED LEARNING — the reading clock that has to run before the questions open.
//
// THE PROBLEM IT SOLVES
//
// The app already gates MCQs behind "mark as read", for a good reason: a
// question answered before the notes teaches the answer, not the topic. But
// "mark as read" is a button, and a button takes half a second. The gate
// records an intention, not a reading.
//
// Pacing makes the gate mean what it says. With it on, the clock starts when the
// item is opened and the questions open when the clock has run — which is the
// difference between a student who has read twelve items and a student who has
// opened twelve items.
//
// WHY IT IS OPT-IN AND WHY IT STAYS OPT-IN
//
// Because it is a discipline, and a discipline imposed on somebody is just an
// obstacle. A candidate revising the night before an exam wants to move at their
// own speed through material they have already read; a candidate meeting an item
// for the first time does not. The same person is both, on different days.
//
// So it is off by default, chosen from Your account, and switching it off takes
// effect on the next request. It is never a trap.
//
// WHY THE CLOCK IS SERVER-SIDE
//
// `ca_progress.reading_started_at` is written by the server on first open. Two
// reasons, and only the second is about cheating:
//
//   A student who opens an item on the bus, closes the app, and comes back on a
//   laptop is still the same reading. A clock held in the browser would restart,
//   which would punish exactly the interrupted reading the feature is meant to
//   support.
//
//   A clock held in the browser is also a clock the browser can set to zero,
//   which would make the whole thing decorative.
//
// WHY THE REQUIRED TIME IS COMPUTED AND NOT ASKED FOR
//
// Because nobody will set a per-item time for twelve items a day, and a single
// fixed time is wrong for both ends of the range: the published items run 462 to
// 944 words, a factor of two. So it comes from the item's own length, at a
// words-per-minute the student picks once.

// Words per minute for each pace, with what each is FOR — the label matters more
// than the number, because the number means nothing to somebody choosing.
//
// 200 wpm is the usual figure quoted for adult reading of ordinary prose. These
// notes are not ordinary prose: they are dense with Articles, section numbers,
// figures and case names, which is precisely the material that is read slowly
// and re-read. So 'steady' sits below the quoted average, not at it.
const PACES = {
  off: { label: 'Off', wpm: 0, hint: 'Questions unlock as soon as you mark an item read.' },
  brisk: {
    label: 'Brisk',
    wpm: 260,
    hint: 'For revisiting material you have already worked through.',
  },
  steady: {
    label: 'Steady',
    wpm: 180,
    hint: 'For a first read of the day’s digest. The usual choice.',
  },
  thorough: {
    label: 'Thorough',
    wpm: 130,
    hint: 'For material you intend to write an answer from.',
  },
};

const MODES = Object.keys(PACES);

// A floor and a ceiling, because the arithmetic alone is wrong at both ends.
// Without the floor a three-line item unlocks in nine seconds, which is not a
// pace but a flicker; without the cap a long note can hold its questions shut
// past the point where a student waits rather than reads, which inverts the
// whole thing.
//
// MEASURED, so the numbers are not guesses:
//
//   The 33 published items run 462 to 944 words, median 603 — the drafting
//   template has eight sections plus static notes, so nothing it produces is
//   short. NEITHER BOUND FIRES on any of them today. They are here for the
//   material that will arrive, not for the material that has.
//
//   At those lengths a median item takes 139s brisk, 201s steady, 278s
//   thorough, and a full day of sixteen items comes to roughly an hour at the
//   steady pace. That is the number a student is really choosing, which is why
//   the digest header states the day's remaining time rather than leaving them
//   to discover it item by item.
const MIN_SECONDS = 45;
const MAX_SECONDS = 8 * 60;

// Every field a student actually reads on the item page. Deliberately NOT the
// whole row: `verify_note` is an instruction to the reviewer, `g1_linked` is a
// list of references, and counting them would charge the student time for text
// they are not reading.
const READ_FIELDS = [
  'notes_markdown',
  'static_notes',
  'prelims_facts',
  'g1_why_news',
  'g1_background',
  'g1_ap_angle',
  'g1_bridges',
  'g1_way_forward',
  'g1_fact',
  'g1_angle',
];

function wordsIn(item) {
  let n = 0;
  for (const f of READ_FIELDS) {
    const t = String(item?.[f] || '').trim();
    if (t) n += t.split(/\s+/).length;
  }
  return n;
}

/**
 * How long this item should take at this pace, in whole seconds.
 *
 * Returns 0 when pacing is off, which is what every caller tests — so "is this
 * paced?" and "how long?" are one question with one answer rather than two that
 * can disagree.
 */
function requiredSecondsFor(item, mode) {
  const pace = PACES[mode];
  if (!pace || !pace.wpm) return 0;
  const seconds = Math.round((wordsIn(item) / pace.wpm) * 60);
  return Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, seconds));
}

const normaliseMode = (mode) => (MODES.includes(String(mode)) ? String(mode) : 'off');

/**
 * Starts the reading clock for an item, if pacing is on and it has not already
 * started.
 *
 * Idempotent, and deliberately so: re-opening an item must not restart its
 * clock. Reading is not a single sitting, and a feature that assumed it was
 * would punish the student who goes back to check something.
 */
function startClock(db, userId, itemId) {
  db.prepare(
    `INSERT INTO ca_progress (user_id, item_id, reading_started_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(user_id, item_id) DO UPDATE
       SET reading_started_at = COALESCE(reading_started_at, datetime('now'))`
  ).run(userId, itemId);
}

/**
 * The pacing state of one item for one user.
 *
 * Always returns an object, never null, and `unlocked` is always meaningful:
 * with pacing off it is true, which lets every caller write the same test
 * instead of branching on the mode.
 *
 * @param {object} db
 * @param {number} userId
 * @param {object} item      a ca_items row (needs the READ_FIELDS)
 * @param {string} mode      the user's pacing setting
 * @param {boolean} [start]  start the clock if it has not started
 */
function stateFor(db, userId, item, mode, start = false) {
  const paceMode = normaliseMode(mode);
  const required = requiredSecondsFor(item, paceMode);
  if (!required) {
    return { mode: 'off', required_seconds: 0, started_at: null, elapsed_seconds: 0, remaining_seconds: 0, unlocked: true };
  }

  if (start) startClock(db, userId, item.id);

  const row = db
    .prepare(
      `SELECT reading_started_at,
              CAST(strftime('%s','now') - strftime('%s', reading_started_at) AS INTEGER) AS elapsed
         FROM ca_progress WHERE user_id = ? AND item_id = ?`
    )
    .get(userId, item.id);

  const started = row?.reading_started_at || null;
  // No clock yet means the item has not been opened. Reporting the full time as
  // remaining is the truthful answer for a digest listing, where nothing has
  // been started and the student wants to know what the day will cost.
  const elapsed = started ? Math.max(0, Number(row.elapsed) || 0) : 0;
  const remaining = started ? Math.max(0, required - elapsed) : required;

  return {
    mode: paceMode,
    required_seconds: required,
    started_at: started,
    elapsed_seconds: elapsed,
    remaining_seconds: remaining,
    unlocked: !!started && remaining === 0,
  };
}

/**
 * What a set of items will cost at this pace, for the digest header.
 *
 * Counts what is still owed rather than the total: an item already read through
 * should not still be billed for, or the day's estimate never falls and stops
 * being information.
 */
function planFor(db, userId, items, mode) {
  const paceMode = normaliseMode(mode);
  if (paceMode === 'off') return { mode: 'off', total_seconds: 0, remaining_seconds: 0, locked: 0 };

  let total = 0;
  let remaining = 0;
  let locked = 0;
  for (const item of items) {
    const s = stateFor(db, userId, item, paceMode, false);
    total += s.required_seconds;
    remaining += s.remaining_seconds;
    if (!s.unlocked) locked += 1;
  }
  return { mode: paceMode, total_seconds: total, remaining_seconds: remaining, locked };
}

/**
 * A remaining time a person would say out loud. Under a minute the seconds are
 * useful, because the student is nearly there; over it they are not, and
 * "4 more minute(s)" is nobody's sentence.
 */
function remainingLabel(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  if (s <= 0) return 'no time';
  if (s < 60) return `${s} seconds`;
  const m = Math.round(s / 60);
  return m === 1 ? 'about a minute' : `about ${m} minutes`;
}

module.exports = {
  PACES, MODES, MIN_SECONDS, MAX_SECONDS, READ_FIELDS,
  wordsIn, requiredSecondsFor, normaliseMode, startClock, stateFor, planFor, remainingLabel,
};
