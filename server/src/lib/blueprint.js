'use strict';

// THE BLUEPRINT-NOTES SHAPE, APPLIED TO A DAY'S NEWSPAPER.
//
// The static subjects in this project are revised from blueprint notes, and a
// blueprint cell is a specific object: a named question angle, the composed
// ANGLES line saying how the commission asks it, a tier by how hard the angle is
// pressed, the facts grouped under headings, and the pairs a candidate confuses.
//
//   keyword : India's Bilateral Agreements and Partnerships   [CORE · 32 PYQs]
//   ANGLES  : Country — Agreement · Date · Quantity · FIRST
//   ## BrahMos deal with Vietnam
//   **India finalised a BrahMos deal with Vietnam — jointly developed by DRDO
//     and NPOM, Mach 2.8-3.0, exportable past 300 km after MTCR entry in 2016.**
//   confusable: CEPA vs FTA — CEPA covers goods, services, investment and IPR;
//               an FTA mainly covers goods.
//
// A newspaper item already carried the first half of that — the angles are
// tagged from `ref_keywords` and the facts are bolded — and none of the second.
// This module supplies what was missing, so a day's current affairs revises the
// same way as the standing material rather than as a separate thing with its
// own habits.

// ---------------------------------------------------------------------------
// tier — how hard the commission presses this item's angles
// ---------------------------------------------------------------------------
//
// NOT COPIED FROM THE BLUEPRINT'S OWN NUMBERS, and that is the whole subtlety.
// Their cells score 20-35 PYQs because a cell is a broad theme over a curated
// pool of 672. Our angles are far finer-grained — 402 of them over 1,367 links —
// so the same absolute cut would make almost everything MED and the tier would
// distinguish nothing. Measured: at their CORE >= 20, exactly 2 of 129 stored
// items qualify.
//
// So the cuts are the PERCENTILES of our own angle distribution rather than
// their integers: p90 = 7 PYQs, p75 = 3. That gives 16% CORE, 33% HIGH, 43% MED
// across the existing corpus — a tier that actually sorts — and it stays true as
// the PYQ bank grows, which a hard-coded 20 would not.
const TIER_CUTS = { CORE: 7, HIGH: 3 };

/**
 * The tier for a given PYQ pressure.
 *
 * '' rather than 'MED' at zero, deliberately. An angle the commission has never
 * asked is not a weakly-tested angle, it is an UNTESTED one — and on a
 * current-affairs item that is often correct rather than damning, because the
 * event is new. Collapsing the two would hide the distinction that matters when
 * somebody asks later whether the tagging is any good.
 */
function tierOf(pressure) {
  const n = Number(pressure) || 0;
  if (n >= TIER_CUTS.CORE) return 'CORE';
  if (n >= TIER_CUTS.HIGH) return 'HIGH';
  if (n >= 1) return 'MED';
  return '';
}

/**
 * How hard the commission presses this item — the MAXIMUM across its angles,
 * not the sum.
 *
 * Sum would rank an item carrying six barely-tested angles above one carrying
 * the single most-tested angle in the bank, which is backwards: the question
 * being answered is "how likely is this to be asked", and that is decided by the
 * strongest angle on it, not by how many weak ones it collected.
 */
function pressureOf(db, keywords = []) {
  const list = [...new Set(keywords.filter(Boolean))];
  if (!list.length) return 0;
  const holes = list.map(() => '?').join(',');
  try {
    const row = db
      .prepare(
        `SELECT keyword, COUNT(*) AS n
           FROM pyq_question_keywords
          WHERE keyword IN (${holes})
          GROUP BY keyword
          ORDER BY n DESC
          LIMIT 1`
      )
      .get(...list);
    return row ? row.n : 0;
  } catch {
    // No PYQ bank on this install — the tier is simply absent rather than wrong.
    return 0;
  }
}

// ---------------------------------------------------------------------------
// angles
// ---------------------------------------------------------------------------

/**
 * Collapses near-duplicate angles to one.
 *
 * The tagger returned `Elected | Election | Elections | NOTA | System` on a
 * single item — three spellings of one angle taking three of its five slots. A
 * blueprint cell names ONE angle, and a list that says the same thing three
 * times reads as three separate reasons the item is examinable when there is
 * one.
 *
 * Stemming rather than a synonym table: the collisions are all morphological
 * (elect/election/elections/elected), a table would need maintaining against a
 * 737-term vocabulary, and a wrong merge here costs a tag rather than a fact.
 * Multi-word angles are left alone — "Local Self Government" and "Government"
 * are not the same angle and no stem should say they are.
 */
function angleStem(keyword) {
  const w = String(keyword || '').trim().toLowerCase();
  if (!w || /\s/.test(w)) return w;
  return w
    .replace(/(ions|ion|ing|ies|ed|es|s)$/, '')
    .replace(/e$/, '');
}

function dedupeAngles(keywords = [], rank = () => 0) {
  const best = new Map();
  for (const k of keywords) {
    const key = angleStem(k);
    if (!key) continue;
    const prev = best.get(key);
    // The most-tested spelling wins, then the shortest — "Election" over
    // "Elections" where the bank has no opinion.
    if (
      !prev ||
      rank(k) > rank(prev) ||
      (rank(k) === rank(prev) && String(k).length < String(prev).length)
    ) {
      best.set(key, k);
    }
  }
  return [...best.values()];
}

/**
 * Tidies the model's ANGLES line into the blueprint's own punctuation.
 *
 * The format is load-bearing rather than decorative: `Country — Agreement`
 * names the PAIRING a list-matching question is built from, and the `·`
 * separators divide the independent facets. A line written with commas
 * throughout loses the distinction between "these two are matched against each
 * other" and "these are separate things you could be asked".
 */
function normaliseAngleLine(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  s = s.replace(/^\s*ANGLES?\s*[:\-—]\s*/i, '');
  s = s.replace(/\s*[|;]\s*/g, ' · ');
  s = s.replace(/\s+[-–]\s+/g, ' — ');
  s = s.replace(/\s*·\s*/g, ' · ');
  s = s.replace(/\s{2,}/g, ' ').trim();
  s = s.replace(/[·—\s]+$/, '');
  return s.slice(0, 220);
}

// ---------------------------------------------------------------------------
// confusables
// ---------------------------------------------------------------------------
//
// The pairs a candidate mixes up: CEPA vs FTA, OPEC vs OPEC+, FATF grey list vs
// black list. In the blueprint notes they are a revision aid. Here they earn
// their place twice, because a confusable is ALSO the best distractor there is —
// "real but wrong" is exactly what the MCQ brief asks for, and the pair names
// one without anybody having to invent it.
//
// Stored one per line as `A vs B — the distinction`, in a TEXT column rather
// than a table. It is read as a block, never joined on, and a sixth derived
// table for two sentences is a table somebody has to keep in step.

const CONFUSABLE_SEP = ' — ';

function parseConfusables(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.replace(/^\s*[-*·]\s*/, '').trim())
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf(CONFUSABLE_SEP);
      // A dash of any kind, since the model will not always send an em dash.
      const j = i === -1 ? line.search(/\s[-–—]\s/) : i;
      if (j === -1) return { pair: line, point: '' };
      const sepLen = i === -1 ? 3 : CONFUSABLE_SEP.length;
      return { pair: line.slice(0, j).trim(), point: line.slice(j + sepLen).trim() };
    })
    .filter((c) => c.pair);
}

/** Accepts either the array the model returns or a block of text, and stores
 *  one pair per line. Capped: three is a revision aid, ten is a second note. */
function formatConfusables(value) {
  const rows = Array.isArray(value)
    ? value.map((c) =>
        typeof c === 'string'
          ? c
          : `${String(c.pair || '').trim()}${c.point ? CONFUSABLE_SEP + String(c.point).trim() : ''}`
      )
    : String(value || '').split('\n');

  return rows
    .map((r) => String(r).replace(/^\s*[-*·]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 3)
    .join('\n');
}

/** The confusables as distractor material for the question writer. */
function distractorBrief(text) {
  const list = parseConfusables(text);
  if (!list.length) return '';
  return [
    '=== PAIRS A CANDIDATE CONFUSES ===',
    '',
    'These were written from this item as the near-misses worth knowing. Each is',
    'also the best distractor available for it: the wrong half of a pair is real,',
    'is plausible, and is clearly wrong once the distinction is known — which is',
    'exactly what a distractor has to be. Prefer these to anything invented.',
    '',
    ...list.map((c) => `  ${c.pair}${c.point ? ` — ${c.point}` : ''}`),
  ].join('\n');
}

module.exports = {
  TIER_CUTS,
  tierOf,
  pressureOf,
  angleStem,
  dedupeAngles,
  normaliseAngleLine,
  parseConfusables,
  formatConfusables,
  distractorBrief,
};
