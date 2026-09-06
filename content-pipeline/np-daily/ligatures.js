'use strict';

// REPAIRING LIGATURES THE PDF THREW AWAY.
//
// THE FAULT
//
// The Hindu's ePaper sets its body in Publico, which has real ff/fi/fl/ffi/ffl
// ligature glyphs. The embedded font's ToUnicode map sends every one of them
// back to a bare `f`, so the extracted text layer reads
//
//   Staf to get PRC, two DAs, pension beneft          (Staff … benefit)
//   camp ofce in Undavalli                            (office)
//   Govt. rejects 'no takers' charge for coal gasifcation scheme
//
// IT IS NOT ONE BAD FILE. It looked like one: the stored text of the four
// August editions carries every ligature correctly and the 6 September edition
// lost 142 words, which reads as a file that was built differently. Running the
// extractor over the August PDFs again says otherwise — they come out broken
// too, now, on this machine:
//
//   23 Aug PDF, extracted today:  "ing unverifed bulk appli-"   (unverified)
//                                 "booth-level ofcer (BLO)"     (officer)
//                                 "A Form 7 is fled to ob-"     (filed)
//
// So the difference is not the files, it is the environment that read them.
// Those editions were processed on the previous workstation and their stored
// text is what that machine's PyMuPDF returned; every edition processed here
// from now on would have arrived broken. That makes this a standing repair
// rather than a patch for one morning's paper — and it means the four clean
// editions are clean by luck of history, not because their PDFs are sound.
//
// WHAT IS RECOVERABLE, AND HOW
//
// The glyph is still there — only its *unicode mapping* is lossy. A ligature
// glyph is much wider than a plain `f`, and that width survives into the
// extraction. Measured over 2,461 `f` glyphs in the body font, the widths fall
// into four clean clusters (as a multiple of the plain `f`):
//
//   1.00  ×1993   plain f
//   1.81  × 307   a two-letter ligature — fi or fl
//   1.93  ×  86   ff
//   2.75  ×  75   a three-letter ligature — ffi or ffl
//
// So layout.py measures each `f` against the plain-`f` width for its own font
// and size, and writes a marker where a ligature stood. This module turns the
// markers back into letters.
//
// WHY THE GLYPH ID IS NOT USED INSTEAD
//
// It would be exact, and it does not work here. `get_texttrace()` does expose a
// glyph id per character, but the file carries many subsetted instances of the
// same font with independent numbering — plain `f` alone appears as gid 35, 36,
// 37 and 38 — and PyMuPDF's span dict does not report which font object a span
// belongs to. Keyed on the gid alone the mapping is a mixture: gid 76 covers
// `ofcials` (ffi), `dragonfies` (fl) and `fourish` (fl) at once. Width is the
// signal that survives.
//
// WHAT STILL NEEDS A DECISION
//
// Width separates the four clusters, but `fi` and `fl` are the same advance —
// `i` and `l` are both narrow — so the two-letter narrow cluster is ambiguous,
// and so is the three-letter one (`ffi` vs `ffl`). Both are decided here, from
// what FOLLOWS the ligature, which is enough because English is strict about
// it: `fl` is always followed by a vowel and only a bounded set of
// continuations occurs.
//
// Checked against the 333 ambiguous slots in the 6 September edition: zero
// cases where both readings produce an English word. The decision is real, not
// a coin toss dressed up.

// Private-use characters, written by layout.py. Chosen from the BMP private-use
// area so nothing in a newspaper can produce them by accident, and written as
// escapes rather than literals — a private-use character pasted into source is
// invisible in every editor and every diff, and the only thing worse than a
// marker leaking into a note is a marker nobody can see in the file that
// defines it.
const MARK_LIG2 = '\u{E000}'; // fi or fl
const MARK_LIG3 = '\u{E002}'; // ffi or ffl

// What can follow `fl`. The list is the decision: anything not here reads as
// `fi`, which is right roughly four times in five and is the safe default —
// `fi` is far commoner, and the words it is wrong about are all here.
//
// Longest match wins, so `ood` (flood) is tested before `o`, and entries that
// are prefixes of one another are harmless.
const FL_AFTER = [
  // fla-
  'ag', 'ags', 'agged', 'agging', 'agship', 'agships', 'agrant',
  'ame', 'ames', 'aming', 'ammable', 'ammation', 'ammatory',
  'ank', 'anks', 'anked', 'anking',
  'are', 'ares', 'aring',
  'ash', 'ashed', 'ashes', 'ashing', 'ashpoint',
  'ask', 'asks',
  'at', 'ats', 'atten', 'attened', 'attening', 'attery',
  'aunt', 'aunted', 'aunting',
  'avour', 'avours', 'avoured', 'avouring',
  'aw', 'aws', 'awed', 'awless',
  'ax',
  // Inflate / inflation / inflated — the `infl-` family, which a newspaper
  // uses constantly and which reads as `infated` without this.
  'ate', 'ated', 'ates', 'ating', 'ation', 'ationary',
  // fle- / fli- / flo- / flu-
  'ea', 'eas',
  'edging', 'edgling',
  'ee', 'eeing', 'ees', 'eece', 'eet', 'eets', 'eeting',
  'esh', 'eshy',
  'ew',
  'ex', 'exed', 'exes', 'exible', 'exibility', 'exing', 'exion',
  'ick', 'icker', 'ickering', 'icks',
  'ier', 'iers', 'ies',
  'ight', 'ights', 'ighty',
  'imsy',
  'ing', 'ings',
  'ip', 'ips', 'ipped', 'ipping', 'ipper',
  'irt', 'irted', 'irting',
  'oat', 'oated', 'oating', 'oats',
  'ock', 'ocks', 'ocked', 'ocking',
  'og',
  'ood', 'ooded', 'ooding', 'oods', 'oodlight', 'oodlit',
  'oor', 'oors', 'ooring',
  'op', 'ops', 'opped', 'oppy',
  'oral', 'ora', 'orist',
  'ounder', 'oundering',
  'our', 'ours',
  'ourish', 'ourished', 'ourishes', 'ourishing',
  'out', 'outed', 'outing',
  'ow', 'ows', 'owed', 'owing', 'ower', 'owers', 'owering',
  'u', 'uctuate', 'uctuated', 'uctuates', 'uctuating', 'uctuation', 'uctuations',
  'uency', 'uent', 'uently',
  // influence / influential / influenza / affluence
  'uence', 'uenced', 'uencer', 'uencers', 'uences', 'uencing', 'uential', 'uenza',
  'uid', 'uids', 'uidity',
  'uke', 'ung', 'unk',
  'uorescent', 'uoride', 'uorine',
  'urries', 'urry',
  'ush', 'ushed', 'ushes', 'ushing',
  'ute', 'utes',
  'utter', 'uttered', 'uttering',
  'uvial', 'ux', 'uxes',
  // conflict / inflict / afflict, and reflect / deflect / inflection
  'ict', 'icts', 'icted', 'icting', 'iction', 'ictions',
  'ect', 'ects', 'ected', 'ecting', 'ection', 'ections', 'ective', 'ectivity',
  // fly / flyer / flyover
  'y', 'ying', 'yer', 'yers', 'yover', 'yovers', 'ypast',
];

// Continuations that mean `fl` ONLY when the ligature opens the word.
//
// `ed` is the whole reason this second list exists, and it is worth spelling
// out because it is the one collision in the set. "fled" is `fl` + "ed". So is
// nothing else: every other word ending that way is `fi` + "ed" — identified,
// notified, verified, clarified, unified, qualified, specified, classified,
// certified — and there are eight of those in a single edition against one
// "fled". Kept in the general list it turned `identified` into `identifled`.
//
// Position settles it cleanly. "fled" is the whole word; "-fied" always has
// letters in front of it.
const FL_AFTER_WORD_INITIAL = ['ed', 'ee', 'ea', 'ew', 'ex', 'og', 'at', 'ap', 'ab'];

// What can follow `ffl`. Much smaller: shuffle, baffle, scuffle, affluent,
// afflict and their relatives are the whole of it in news English.
const FFL_AFTER = [
  'e', 'ed', 'es', 'er', 'ers', 'ing',
  'uent', 'uently', 'uence', 'uential',
  'ict', 'icts', 'icted', 'icting', 'iction', 'ictions',
  'orescence', 'uvium',
];

// Longest-first, so `ourishing` is tried before `our` and `ood` before `o`.
const byLength = (list) => [...list].sort((a, b) => b.length - a.length);
const FL_SORTED = byLength(FL_AFTER);
const FL_INITIAL_SORTED = byLength([...FL_AFTER, ...FL_AFTER_WORD_INITIAL]);
const FFL_SORTED = byLength(FFL_AFTER);

function startsWithAny(rest, sorted) {
  const r = rest.toLowerCase();
  for (const s of sorted) if (r.startsWith(s)) return true;
  return false;
}

/** The letters after the marker, up to the end of the word. Only letters: a
 *  full stop or a comma ends the decision, and including it would make
 *  `flood,` fail to match `ood`. */
function tailOf(text, i) {
  let j = i + 1;
  while (j < text.length && /[A-Za-z]/.test(text[j])) j += 1;
  return text.slice(i + 1, j);
}

/**
 * Turns layout.py's ligature markers back into letters.
 *
 * Case is taken from the letter that follows, so a marker opening a capitalised
 * word — "Flood", "Office" — does not come back lowercase in the middle of a
 * headline. There is no case information in the marker itself; a ligature glyph
 * is either the lowercase form or it is not used at all, which is why the
 * uppercase test looks at the tail rather than at the marker.
 */
function resolve(text) {
  const s = String(text || '');
  if (!s.includes(MARK_LIG2) && !s.includes(MARK_LIG3)) return s;

  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch !== MARK_LIG2 && ch !== MARK_LIG3) {
      out += ch;
      continue;
    }
    const rest = tailOf(s, i);
    // Does the ligature open the word? Only then do the word-initial-only
    // continuations apply — see FL_AFTER_WORD_INITIAL.
    const atWordStart = i === 0 || !/[A-Za-z]/.test(s[i - 1]);
    let letters;
    if (ch === MARK_LIG2) {
      const list = atWordStart ? FL_INITIAL_SORTED : FL_SORTED;
      letters = startsWithAny(rest, list) ? 'fl' : 'fi';
    } else {
      letters = startsWithAny(rest, FFL_SORTED) ? 'ffl' : 'ffi';
    }
    // A marker at the start of a capitalised word. `rest` is what follows, so
    // an all-caps headline ("FLOOD RELIEF") shows as capitals there too.
    if (rest && rest === rest.toUpperCase() && /[A-Z]/.test(rest)) {
      letters = letters.toUpperCase();
    } else if (rest && /^[A-Z]/.test(rest)) {
      // Something like "FLood" cannot arise from a ligature; leave it lower.
      letters = letters[0].toUpperCase() + letters.slice(1);
    }
    out += letters;
  }
  return out;
}

/** True if any marker survives — used by the tests and by the segmenter's own
 *  assertion, because a marker reaching the database is invisible in a note and
 *  obvious in a PDF. */
function hasMarkers(text) {
  return String(text || '').includes(MARK_LIG2) || String(text || '').includes(MARK_LIG3);
}

module.exports = {
  MARK_LIG2,
  MARK_LIG3,
  FL_AFTER,
  FL_AFTER_WORD_INITIAL,
  FFL_AFTER,
  resolve,
  hasMarkers,
};
