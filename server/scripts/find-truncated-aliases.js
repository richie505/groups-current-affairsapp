#!/usr/bin/env node
'use strict';

// Finds alias rows that were typed as a stem where a word belongs.
//
//   node server/scripts/find-truncated-aliases.js
//
// WHY THESE EXIST AT ALL
//
// The vocabulary was seeded by reading each unit's syllabus text and writing
// down the terms in it. Somewhere in that pass, four rows were cut short —
// `disabilit`, `decentralis`, `urban local bod`, `Backward Class` — probably an
// attempt to make one alias cover "disability" and "disabilities" at once.
//
// It cannot work, and it fails silently. An alias is matched as `\b<alias>\b`,
// and there is no word boundary in the middle of a word: `\bdisabilit\b` never
// matches "disability", because t and y are both word characters. The row sits
// in the table looking correct and matching nothing, for months.
//
// THE TEST, WHICH NEEDS NO DICTIONARY
//
// The aliases were derived FROM the syllabus text, so the syllabus is the
// dictionary. A row is flagged when its last token
//
//   (a) never appears as a whole word in the syllabus or the corpus, and
//   (b) IS a proper prefix of some word that does.
//
// (a) alone would flag any term the paper has not printed yet. (b) alone would
// flag `port` for being a prefix of `portfolio`. Together they describe exactly
// one thing: a word that was cut off, with the word it was cut from still
// visible in the text it came from.

const path = require('path');

const db = require(path.join(__dirname, '..', 'src', 'db'));

const words = new Set();
const push = (text) => {
  for (const w of String(text || '').split(/[^A-Za-z]+/)) {
    if (w.length > 2) words.add(w.toLowerCase());
  }
};

for (const r of db.prepare('SELECT label, syllabus_text FROM ref_units').all()) {
  push(r.label);
  push(r.syllabus_text);
}
for (const r of db.prepare('SELECT headline, standfirst, body FROM np_articles').all()) {
  push(r.headline);
  push(r.standfirst);
  push(r.body);
}

// Longest-first so the suggestion is the fullest completion, not the shortest.
const sorted = [...words].sort((a, b) => b.length - a.length);

const rows = db
  .prepare(
    `SELECT unit_code, alias, provenance FROM ref_unit_aliases ORDER BY alias, unit_code`
  )
  .all();

const seen = new Set();
const flagged = [];
for (const r of rows) {
  if (seen.has(r.alias)) continue;
  seen.add(r.alias);
  const tokens = r.alias.split(/\s+/);
  const last = tokens[tokens.length - 1].toLowerCase().replace(/[^a-z]/g, '');
  if (last.length < 3) continue;
  // An acronym is not a word and is not supposed to be one. IMF, SCO and TRAI
  // were the whole of the report otherwise.
  if (tokens[tokens.length - 1] === tokens[tokens.length - 1].toUpperCase()) continue;
  if (words.has(last)) continue; // it is a real word in this vocabulary
  const completions = sorted.filter((w) => w.length > last.length && w.startsWith(last));
  if (!completions.length) continue;
  // A completion that is only a plural suffix is not a truncation — `Chalukya`
  // is the correct singular and the plural rule reaches "Chalukyas" on its own.
  // Without this the report is 39 rows of correct singular proper nouns, which
  // is how a real finding gets lost.
  const real = completions.filter((w) => !/^(?:s|es)$/.test(w.slice(last.length)));
  if (!real.length) continue;
  // Prefer the shortest completion — "body" over "bodybuilding" — since a
  // truncation is usually one or two letters, not a compound.
  const best = real.sort((a, b) => a.length - b.length)[0];
  flagged.push({
    ...r,
    last,
    suggest: [...tokens.slice(0, -1), tokens[tokens.length - 1] + best.slice(last.length)].join(' '),
    completions: real.sort((a, b) => a.length - b.length).slice(0, 4),
  });
}

console.log(`${rows.length} alias row(s), ${seen.size} distinct alias(es).`);
console.log(`${flagged.length} end in a fragment that is not a word here.\n`);
if (!flagged.length) {
  console.log('None. The four known cases are all fixed.');
} else {
  for (const f of flagged) {
    console.log(`  ${f.alias.padEnd(28)} ${f.unit_code.padEnd(11)} [${f.provenance}]`);
    console.log(`      "${f.last}" is not a word here; completions: ${f.completions.join(', ')}`);
    console.log(`      probably meant: ${f.suggest}`);
  }
}
