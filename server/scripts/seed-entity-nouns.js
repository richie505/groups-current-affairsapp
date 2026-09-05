#!/usr/bin/env node
'use strict';

// The words that turn a syllabus alias into part of somebody's name.
//
//   node server/scripts/seed-entity-nouns.js [--dry-run]
//
// Owns `ref_entity_nouns` and replaces its rows, so this file is the record of
// what is in the list. Re-runnable; adding a noun is a row and an audit note,
// not a deploy.
//
// The guard in lib/relevance.js rejects a match when the alias sits next to one
// of these — allowing one linking word (of / for / and) — or is immediately
// followed by "+". Three real failures it exists for:
//
//   `Alluri Sitarama Raju` inside "Alluri Sitarama Raju ACADEMY of Medical
//   Sciences", a college in a rankings table, filed under AP colonial history.
//
//   `public health` inside "DIRECTORATE of Public Health", the employer in a
//   story about a contract-staff pay dispute, filed under environment and health.
//
//   `BRICS` inside "BRICS+ Legal Forum", the room a Chief Justice gave a speech
//   in, filed under foreign policy.
//
// WHAT IS DELIBERATELY ABSENT, and why it must stay absent:
//
//   Act, Board, Council, Commission, Mission — each is part of legitimate
//   aliases (Forest Rights Act, Pollution Control Board, Finance Commission,
//   Legislative Council). Adding any of them would reject the tag the alias
//   exists to make. Where a longer form is itself an alias it matches on its
//   own, so nothing is lost by leaving these out.

const path = require('path');
const db = require(path.join(__dirname, '..', 'src', 'db'));

const DRY = process.argv.includes('--dry-run');

const NOUNS = [
  // teaching and research bodies
  'Academy', 'Institute', 'Institution', 'University', 'College', 'School',
  // government offices
  'Directorate', 'Department', 'Authority', 'Corporation',
  // civil-society bodies
  'Foundation', 'Trust', 'Society', 'Association', 'Federation',
  // gatherings — the "BRICS+ Legal Forum" family
  'Forum', 'Summit', 'Conclave',
  // buildings and places named after people
  'Hospital', 'Stadium', 'Museum', 'Library', 'Bhavan', 'Centre', 'Center',
  // honours and competitions
  'Award', 'Prize', 'Cup', 'Trophy', 'Games',
];

const existing = db.prepare('SELECT noun FROM ref_entity_nouns').all().map((r) => r.noun);
const adding = NOUNS.filter((n) => !existing.includes(n));
const dropping = existing.filter((n) => !NOUNS.includes(n));

console.log(`entity nouns: ${NOUNS.length} wanted, ${existing.length} present`);
if (adding.length) console.log(`  adding:   ${adding.join(', ')}`);
if (dropping.length) console.log(`  dropping: ${dropping.join(', ')}`);

if (DRY) {
  console.log('\n--dry-run: nothing written.');
  process.exit(0);
}

db.transaction(() => {
  db.prepare('DELETE FROM ref_entity_nouns').run();
  const ins = db.prepare('INSERT INTO ref_entity_nouns (noun) VALUES (?)');
  for (const n of NOUNS) ins.run(n);
})();

console.log(`\nwrote ${NOUNS.length} noun(s).`);
