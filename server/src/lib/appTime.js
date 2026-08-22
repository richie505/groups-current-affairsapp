'use strict';

// What day is it, for a student sitting in Andhra Pradesh?
//
// THE BUG THIS EXISTS TO FIX
//
// "Today" was the UTC date everywhere: `new Date().toISOString().slice(0, 10)`
// for the revision queue and the streak, `substr(marked_at, 1, 10)` for the
// activity chart, since SQLite writes UTC. India is UTC+5:30, so between
// midnight and 05:30 local the app believed it was still yesterday.
//
// Measured consequences, all in that window:
//
//   A card scheduled for today did not appear in "due" until 05:30 a.m. A
//   student revising at five — which is when a lot of this exam gets prepared —
//   opened the app and was told nothing was due.
//
//   An item read at 02:00 counted towards the PREVIOUS day on the activity
//   chart, so a genuine day of study could show as blank and break a streak the
//   student had actually kept.
//
// WHY A FIXED OFFSET AND NOT A PER-USER TIMEZONE
//
// Because this is an app for one State's public service commission. Every
// candidate sits the exam in Andhra Pradesh and studies on Indian Standard
// Time, which has no daylight saving and has not changed since 1945. A
// per-user timezone column would be a setting nobody would ever have reason to
// change, defaulting to the value everybody wants — which is a fixed offset
// with extra steps and one more thing to get wrong.
//
// If the app ever serves another timezone, this is the one file to change, and
// the offset becomes a column read through the same two functions.

// Indian Standard Time, UTC+05:30.
const OFFSET_MINUTES = 330;
const OFFSET_SQL = '+5 hours 30 minutes';

/**
 * The current date where the student is, as 'YYYY-MM-DD'.
 *
 * @param {Date} [now] injectable for tests
 */
function today(now = new Date()) {
  return new Date(now.getTime() + OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

/**
 * The local date of a UTC timestamp, as 'YYYY-MM-DD'.
 *
 * Used for scheduling from a moment rather than from now — a revision card is
 * due N days after the reading, and both ends have to be counted in the same
 * calendar or the interval is off by one for a third of the day.
 */
function localDate(value) {
  const d = value instanceof Date ? value : new Date(String(value).replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? today() : today(d);
}

/**
 * A SQL fragment that shifts a stored UTC timestamp into local time.
 *
 *   `substr(marked_at, 1, 10)`                      -> the UTC day
 *   `date(${localSql('marked_at')})`                -> the day the student had
 *
 * A string rather than a bound parameter because it is a datetime MODIFIER, not
 * a value; it is a constant defined in this file and never comes from a request.
 */
function localSql(column) {
  return `datetime(${column}, '${OFFSET_SQL}')`;
}

module.exports = { OFFSET_MINUTES, OFFSET_SQL, today, localDate, localSql };
