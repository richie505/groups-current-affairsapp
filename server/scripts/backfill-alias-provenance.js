#!/usr/bin/env node
'use strict';

// Stamps `ref_unit_aliases.provenance` for every row added or re-mapped in
// September 2026. Everything else stays 'seed'.
//
//   node server/scripts/backfill-alias-provenance.js [--dry-run]
//
// WHY THIS IS A LIST AND NOT A DATE COMPARISON
//
// There is no created_at on an alias row, and there could not usefully be one:
// seed-g2-syllabus.js deletes and rewrites every row of a unit whenever the
// vocabulary file changes, so every row in the table has the same age as the
// last reseed. The provenance has to be asserted from the record of what was
// approved, which is what this file is.
//
// Idempotent, and safe to re-run after a reseed — though the seed script now
// carries provenance across the rebuild itself, so a reseed no longer loses it.

const path = require('path');

const db = require(path.join(__dirname, '..', 'src', 'db'));

const dryRun = process.argv.includes('--dry-run');

// Batch 1 — 5 September 2026. Reviewed row by row against the sentence each
// alias appears in and the number of articles it would touch.
const BATCH_1 = [
  'APPSC', 'Mega DSC', 'Bharat Audyogik Vikas Yojana', 'BHAVYA', 'national highway',
  'Indian Roads Congress', 'South Coast Railway', 'rule of law', 'Zonal Council',
  'Inter-State Council', 'Jal Shakti', 'Scheduled Areas', 'energy security',
  'Tariff Rate Quota', 'stockholding limit', 'MMDR', 'mining sector', 'road safety',
  'Gorkhaland',
  // repairs, not additions: `disabilit` and `decentralis` were hand-truncated
  // stems that could never match, because there is no word boundary before the
  // letters they were cut before.
  'disability', 'decentralisation',
];

// Batch 2 — same day, second sitting.
const BATCH_2 = [
  'National AYUSH Mission', 'AYUSH', 'Visakhapatnam Steel Plant', 'Rashtriya Ispat Nigam',
  'nursing personnel', 'Nurses Registration and Tracking System',
  'Integrated Tribal Development Agency', 'Geological Survey of India', 'research integrity',
  'cardiovascular', 'Sample Registration System', 'crude death rate', 'FSSAI',
  'fixed-dose combination', 'Drugs Technical Advisory Board', 'fuel supply agreement',
];

// The syllabus audit — every generic alias sitting on an AP-scoped unit was
// checked against the national syllabus, and 56 mappings were added where the
// concept is examined in both places. Recorded per (alias, unit), because for
// most of these the alias already existed and it is the MAPPING that is new.
const AUDIT = [
  ['G2-P2-U2', ['State budget', 'State debt', 'State expenditure', 'State revenue',
                'borrowing limit', 'FRBM limit']],
  ['G1P-C4', ['State budget', 'borrowing limit', 'Finance Commission grant',
              'revenue deficit grant', 'special status', 'central assistance']],
  ['G2-P2-U1', ['GSDP']],
  ['G1P-C2', ['GSDP']],
  ['G1P-B6', ['ADB loan', 'AIIB']],
  ['G2-P2-U3', ['agricultural marketing', 'animal husbandry', 'aqua', 'fisheries',
                'industrial park', 'industrial incentive', 'single window',
                'electronics manufacturing', 'BHAVYA', 'Bharat Audyogik Vikas Yojana',
                'dairy']],
  ['G1P-C3', ['cooperative bank', 'assigned land', 'land acquisition', 'industrial park',
              'BHAVYA', 'Bharat Audyogik Vikas Yojana', 'MSME']],
  ['G2-P2-U3', ['MSME']],
  ['G2-P2-U6', ['IT policy']],
  ['G1P-S2', ['IT policy']],
  ['G1P-A1', ['Buddhist site', 'megalith', 'prehistoric']],
  ['G2-S1', ['Buddhist site']],
  ['G1P-A3', ['temple architecture']],
  ['G1P-A5', ['Justice Party', 'Self-Respect Movement', 'Library Movement']],
  ['G2-S3', ['tribal culture']],
  ['G1P-A6', ['States Reorganisation Commission', 'Fazal Ali']],
  ['G1P-B2', ['Reorganisation Act', 'Reorganization Act', 'bifurcation',
              'successor State', 'river water sharing']],
  ['G2-P1-U8', ['river water sharing']],
  ['G1P-D2', ['Krishna water', 'Godavari water']],
  ['G2-P1-U5', ['States Reorganisation']],
  // The state-qualified phrases that replaced a bare word on an AP unit. Both
  // match zero articles today; they are insurance for a future paper, and the
  // provenance is what will say so when somebody finds them idle.
  ['G2-P2-U5', ['AP MSME', 'Andhra Pradesh MSME', 'MSME in Andhra Pradesh',
                'Sunrise Andhra Pradesh']],
  // Terms the vocabulary audit found the syllabus naming and the map missing.
  ['G2-P2-U6', ['emerging technology', 'space science', 'nuclear programme']],
  ['G2-P2-U9', ['pollution control']],
  ['G1P-S5', ['pollution control']],
  ['G1P-B2', ['river water dispute', 'inter-State river']],
  ['G2-P1-U8', ['river water dispute', 'inter-State river']],
  ['G1P-C5', ['river water dispute', 'natural resource', 'revenue loss']],
  ['G1P-B3', ['74th Constitutional Amendment', '73rd Constitutional Amendment']],
  ['G2-P1-U10', ['74th Constitutional Amendment', '73rd Constitutional Amendment',
                 'urban local body']],
  ['G1P-C4', ['financial institution', 'financial market']],
  ['G2-S2', ['natural resource']],
  ['G1P-A4', ['British rule']],
  ['G1P-A5', ['social reform movement']],
  ['G2-P1-U3', ['British rule', 'social reform movement']],
  // The two thin units, filled from their own syllabus text and standard exam
  // vocabulary. Twenty rows, none of which had a corpus hit when they were
  // approved — which is exactly what provenance and first_hit_at are for.
  ['G1P-C1', ['Planning Commission', 'Twelfth Five Year Plan', 'perspective plan',
              'poverty line', 'multidimensional poverty', 'environmental degradation',
              'environmental policy', 'Aspirational District', 'SDG India Index',
              'mixed economy']],
  ['G2-P1-U4', ['Sri Bagh Pact', 'Visalandhra', 'Madras Presidency', 'Rayalaseema Mahasabha',
                'Krishna Patrika', 'Andhra Kesari', 'Pattabhi Sitaramayya',
                'Vandemataram Movement', 'Andhra University', 'Sriramulu fast']],
];

const byAlias = db.prepare('UPDATE ref_unit_aliases SET provenance = ? WHERE alias = ?');
const byPair = db.prepare(
  'UPDATE ref_unit_aliases SET provenance = ? WHERE alias = ? AND unit_code = ?'
);

let n = 0;
const run = () => {
  // Order matters: the audit tag is applied last, so an alias that was added in
  // a batch AND re-mapped by the audit ends up labelled by the more recent
  // event on the row the audit actually touched.
  for (const a of BATCH_1) n += byAlias.run('batch-2026-09-05', a).changes;
  for (const a of BATCH_2) n += byAlias.run('batch-2026-09-05b', a).changes;
  for (const [unit, list] of AUDIT) {
    for (const a of list) n += byPair.run('syllabus-audit-2026-09', a, unit).changes;
  }
};

if (dryRun) {
  // Apply inside a transaction and throw, so the counts are real and nothing
  // is written.
  try {
    db.transaction(() => {
      run();
      throw new Error('__rollback__');
    })();
  } catch (e) {
    if (e.message !== '__rollback__') throw e;
  }
} else {
  db.transaction(run)();
}

console.log(`${dryRun ? 'Would stamp' : 'Stamped'} ${n} row(s).\n`);
for (const r of db
  .prepare('SELECT provenance, COUNT(*) AS n FROM ref_unit_aliases GROUP BY provenance ORDER BY n DESC')
  .all()) {
  console.log(`  ${String(r.provenance).padEnd(24)} ${String(r.n).padStart(4)}`);
}
