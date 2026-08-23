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
  // The student’s own number, in minutes, applied to every item.
  //
  // The three paces above are a reading SPEED, so a long note is given longer
  // than a short one. This one is not: it is a flat time the student chose, and
  // it is the only setting here that is theirs rather than the app’s.
  //
  // Both belong. A speed is the better model of reading and a worse model of a
  // person’s day — somebody who has forty minutes before work wants to say
  // “four minutes an item” and have that be true, not have the app decide which
  // items deserve five. Offering only the speeds meant the one number a student
  // actually cares about was the one number they could not set.
  custom: {
    label: 'Your own time',
    wpm: 0,
    flat: true,
    hint: 'The same time on every item, however long it is.',
  },
};

const MODES = Object.keys(PACES);

// Bounds on the custom time, in minutes. Wide, because it is the student’s
// judgement and not the app’s — narrow enough only to keep a mistyped 0 or 600
// from locking the questions for ever or opening them instantly.
const MIN_MINUTES = 1;
const MAX_MINUTES = 30;
const DEFAULT_MINUTES = 4;

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
// whole row: `verify_note` is an instruction to the reviewer, and counting it
// would charge the student time for text they are not reading.
//
// This list lost the eight Group-I Mains note fields along with the Mains
// layer, so the reading estimate is now smaller. That is the point rather than
// a side effect: the student is no longer being asked to read that material.
const READ_FIELDS = ['notes_markdown', 'static_notes', 'prelims_facts'];

function wordsIn(item) {
  let n = 0;
  for (const f of READ_FIELDS) {
    const t = String(item?.[f] || '').trim();
    if (t) n += t.split(/\s+/).length;
  }
  // A list row carries `words` INSTEAD of the prose it counted — the digest
  // stopped shipping the notes it was never going to render. Falling back to it
  // is what lets planFor() price a day from rows that hold no text.
  if (!n && Number.isFinite(Number(item?.words))) return Math.max(0, Number(item.words));
  return n;
}

const clampMinutes = (minutes) => {
  const n = Math.round(Number(minutes));
  if (!Number.isFinite(n)) return DEFAULT_MINUTES;
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, n));
};

/**
 * A pacing preference, from whatever the caller has.
 *
 * Accepts a bare mode string as well as a {mode, minutes} pair. That is not
 * looseness for its own sake: for four of the five modes the mode IS the whole
 * preference, and making every caller and every test wrap 'steady' in an object
 * would be noise around the one case that needs it.
 */
function normalisePref(value) {
  const raw = typeof value === 'string' || value == null ? { mode: value } : value;
  const mode = MODES.includes(String(raw.mode)) ? String(raw.mode) : 'off';
  return { mode, minutes: clampMinutes(raw.minutes ?? raw.pacing_minutes ?? DEFAULT_MINUTES) };
}

/**
 * How long this item should take at this pace, in whole seconds.
 *
 * Returns 0 when pacing is off, which is what every caller tests — so "is this
 * paced?" and "how long?" are one question with one answer rather than two that
 * can disagree.
 */
function requiredSecondsFor(item, pref) {
  const { mode, minutes } = normalisePref(pref);
  const pace = PACES[mode];
  if (!pace) return 0;

  // A time the student set is used as they set it. The floor and cap below
  // exist to protect a computed number from the arithmetic going silly at the
  // extremes; applying them to a deliberate choice would just be overruling it.
  if (pace.flat) return minutes * 60;

  if (!pace.wpm) return 0;
  const seconds = Math.round((wordsIn(item) / pace.wpm) * 60);
  return Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, seconds));
}

const normaliseMode = (mode) => normalisePref(mode).mode;

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
function stateFor(db, userId, item, pref, start = false) {
  const { mode: paceMode, minutes } = normalisePref(pref);
  const required = requiredSecondsFor(item, { mode: paceMode, minutes });
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
    // Sent so the item page can say "4 min — your own setting" rather than
    // "at a custom pace", which tells a reader nothing they did not just choose.
    minutes: PACES[paceMode].flat ? minutes : null,
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
function planFor(db, userId, items, pref) {
  const { mode: paceMode, minutes } = normalisePref(pref);
  if (paceMode === 'off') {
    return { mode: 'off', minutes: null, total_seconds: 0, remaining_seconds: 0, locked: 0 };
  }

  let total = 0;
  let remaining = 0;
  let locked = 0;
  for (const item of items) {
    const s = stateFor(db, userId, item, { mode: paceMode, minutes }, false);
    total += s.required_seconds;
    remaining += s.remaining_seconds;
    if (!s.unlocked) locked += 1;
  }
  return {
    mode: paceMode,
    minutes: PACES[paceMode].flat ? minutes : null,
    total_seconds: total,
    remaining_seconds: remaining,
    locked,
  };
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
  MIN_MINUTES, MAX_MINUTES, DEFAULT_MINUTES,
  wordsIn, requiredSecondsFor, normaliseMode, normalisePref, clampMinutes,
  startClock, stateFor, planFor, remainingLabel,
};
