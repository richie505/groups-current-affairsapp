#!/usr/bin/env node
'use strict';

// Blueprint keyword angles -> ref_keywords, read from the skill's own reference
// file rather than retyped.
//
//   node server/scripts/seed-blueprint-keywords.js --file <blueprint-keywords.md>
//   node server/scripts/seed-blueprint-keywords.js --file ... --dry-run
//   node server/scripts/seed-blueprint-keywords.js --file ... --prune
//
// WHY THIS EXISTS
//
// reference-data.js carries a hand-typed subset of the blueprint: 424 angles
// against the file's full list. The missing ones are not decoration. This
// vocabulary is what relevance.js scores an article's PYQ angle against (20 of
// its 100 points), what the pipeline tags items with, and what the admin
// editor offers in its dropdown — so an angle absent here is an angle the
// system cannot see APPSC using, however often it is used.
//
// Keeping reference-data.js as well is deliberate. It holds a handful of angles
// that are not in the blueprint file, and it is the list the admin UI and the
// tagger share. This seeder adds the blueprint's vocabulary on top of it rather
// than replacing it, and reports anything it does not recognise instead of
// quietly dropping it.

const fs = require('fs');
const path = require('path');
const db = require(path.join(__dirname, '..', 'src', 'db'));

const args = process.argv.slice(2);
const fileFlag = args.indexOf('--file');
const dryRun = args.includes('--dry-run');
const prune = args.includes('--prune');
const file = fileFlag !== -1 ? args[fileFlag + 1] : null;

if (!file) {
  console.error(
    'Usage: node server/scripts/seed-blueprint-keywords.js --file <blueprint-keywords.md> [--dry-run] [--prune]'
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// parse
// ---------------------------------------------------------------------------

// The file's section names, mapped to the subject vocabulary the database
// already uses. Only one differs; the rest are written out so that a renamed
// section shows up as an error rather than seeding a brand new subject.
const SUBJECTS = new Map([
  ['AP History', 'AP History'],
  ['Indian History', 'Indian History'],
  ['Polity', 'Polity'],
  ['Indian Economy / AP Economy', 'Economy'],
  ['Geography', 'Geography'],
  ['Environment', 'Environment'],
  ['Science & Technology', 'Science & Technology'],
  ['Society', 'Society'],
  ['Current Affairs', 'Current Affairs'],
]);

// The trailing section of the file lists angles its author flagged as gaps and
// deliberately did NOT promote to keywords. Seeding them would be overruling
// that judgement, so it is skipped by name.
const SKIP_SECTION = /^Known gaps/i;

// Angles are comma-separated, but commas also appear INSIDE them:
// "Questions in Parliamentary Proceedings (Starred, Unstarred, Short Notice)",
// "Power station → Location (Thermal, Nuclear)", "2011 census data (e.g.
// Density, Literacy)". Splitting on every comma would shred those into
// fragments that match nothing and look like real angles, so depth is tracked.
function splitAngles(line) {
  const out = [];
  let depth = 0;
  let buf = '';
  for (const ch of line) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      out.push(buf);
      buf = '';
    } else {
      buf += ch;
    }
  }
  out.push(buf);
  return out.map((s) => s.trim()).filter(Boolean);
}

function parse(text) {
  const bySubject = new Map();
  const unknownSections = [];
  let subject = null;

  for (const line of text.split('\n')) {
    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2) {
      const name = h2[1].trim();
      if (SKIP_SECTION.test(name)) {
        subject = null;
      } else if (SUBJECTS.has(name)) {
        subject = SUBJECTS.get(name);
        if (!bySubject.has(subject)) bySubject.set(subject, []);
      } else {
        subject = null;
        unknownSections.push(name);
      }
      continue;
    }
    if (!subject) continue;
    const l = line.trim();
    // Prose, rules and bullets are not angle lists.
    if (!l || l.startsWith('#') || l.startsWith('-') || l.startsWith('*') || l.startsWith('---')) continue;
    bySubject.get(subject).push(...splitAngles(l));
  }
  return { bySubject, unknownSections };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const { bySubject, unknownSections } = parse(fs.readFileSync(file, 'utf8'));

if (unknownSections.length) {
  console.log('! sections not in the subject map, skipped (add them to SUBJECTS if real):');
  for (const s of unknownSections) console.log(`    ${s}`);
  console.log();
}

const existing = new Map(
  db.prepare('SELECT keyword, subject FROM ref_keywords').all().map((r) => [r.keyword, r.subject])
);

// reference-data.js stores several angles in a shortened form: the blueprint
// writes "NSO (National Statistical Office)", "Revolution (e.g. Blue
// revolution)" and "Power station → Location (Thermal, Nuclear)", and the
// database holds "NSO", "Revolution" and "Power station → Location". Adding the
// long forms alongside the short ones would put the SAME angle in the
// vocabulary twice, splitting every count and tag between the two spellings.
//
// So a blueprint angle is matched against what is already stored with its
// parentheticals removed. This is an exact comparison after stripping, not a
// fuzzy one — anything looser would start merging angles that differ for a
// reason.
const bare = (s) => s.replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const existingBare = new Map([...existing.keys()].map((k) => [bare(k), k]));

// One keyword can be listed under several subjects — "FIRST" appears under four
// of them — and ref_keywords makes the keyword its primary key, so only one
// subject can win. The first section to claim an angle keeps it, and the rest
// are reported: silently reassigning would make the subject field depend on
// section order in a markdown file.
const claimed = new Map();
const contested = new Map();
let listed = 0;

for (const [subject, angles] of bySubject) {
  angles.forEach((kw) => {
    listed++;
    if (!claimed.has(kw)) claimed.set(kw, { subject, order: claimed.size });
    else if (claimed.get(kw).subject !== subject) {
      if (!contested.has(kw)) contested.set(kw, [claimed.get(kw).subject]);
      contested.get(kw).push(subject);
    }
  });
}

const covered = (kw) => existing.has(kw) || existingBare.has(bare(kw));
const toAdd = [...claimed].filter(([kw]) => !covered(kw));
const alreadyThere = [...claimed].filter(([kw]) => covered(kw));
const shortForm = [...claimed]
  .filter(([kw]) => !existing.has(kw) && existingBare.has(bare(kw)))
  .map(([kw]) => [kw, existingBare.get(bare(kw))]);

const claimedBare = new Set([...claimed.keys()].map(bare));
const notInFile = [...existing.keys()].filter((kw) => !claimed.has(kw) && !claimedBare.has(bare(kw)));

// An angle already stored as a strict prefix of a blueprint one — "Built –
// City/Town" against "Built – City/Town/Construction" — is probably the same
// angle truncated, but "probably" is not enough to merge two entries in a
// vocabulary this much depends on, so it is reported for a person to settle.
const prefixSuspects = [];
for (const [kw] of claimed) {
  if (covered(kw)) continue;
  for (const ex of existing.keys()) {
    if (ex.length > 6 && kw.toLowerCase().startsWith(ex.toLowerCase())) prefixSuspects.push([kw, ex]);
  }
}

console.log(`Blueprint: ${listed} listing(s) across ${bySubject.size} subject(s), ${claimed.size} distinct angle(s).`);
for (const [subject, angles] of bySubject) {
  const nw = angles.filter((k) => !covered(k) && claimed.get(k).subject === subject).length;
  console.log(`   ${subject.padEnd(22)} ${String(angles.length).padStart(4)} listed, ${String(nw).padStart(3)} new`);
}

console.log(`\nAlready in ref_keywords: ${alreadyThere.length}`);
if (shortForm.length) {
  console.log(`   of which ${shortForm.length} are already stored in a shorter form, so they are NOT added again:`);
  for (const [long, short] of shortForm) console.log(`      ${short}  <-  ${long}`);
}
console.log(`To add:                  ${toAdd.length}`);
console.log(`In ref_keywords but not in the blueprint file: ${notInFile.length}`);
if (notInFile.length) {
  console.log(
    '   (kept — reference-data.js carries angles of its own; pass --prune to delete them)\n   ' +
    notInFile.slice(0, 20).join(', ') + (notInFile.length > 20 ? ', ...' : '')
  );
}

if (prefixSuspects.length) {
  console.log(`\n${prefixSuspects.length} blueprint angle(s) extend an angle already stored — check whether these are the same angle:`);
  for (const [long, short] of prefixSuspects) console.log(`   stored: ${short.padEnd(24)} blueprint: ${long}`);
}

if (contested.size) {
  console.log(`\n${contested.size} angle(s) listed under more than one subject; the first listing wins:`);
  for (const [kw, subs] of [...contested].slice(0, 15)) {
    console.log(`   ${kw.padEnd(38)} ${claimed.get(kw).subject}  (also ${[...new Set(subs.slice(1))].join(', ')})`);
  }
  if (contested.size > 15) console.log(`   ... and ${contested.size - 15} more`);
}

if (dryRun) {
  console.log('\nDry run — nothing written.');
  process.exit(0);
}

// ---- write ----

const upsert = db.prepare(
  `INSERT INTO ref_keywords (keyword, subject, order_index) VALUES (?, ?, ?)
   ON CONFLICT(keyword) DO NOTHING`
);
const del = db.prepare('DELETE FROM ref_keywords WHERE keyword = ?');

let added = 0;
let pruned = 0;

db.transaction(() => {
  // order_index continues after whatever the subject already holds, so the
  // admin dropdown keeps its existing order and the new angles follow it.
  const nextIndex = new Map(
    db
      .prepare('SELECT subject, COALESCE(MAX(order_index), -1) + 1 AS next FROM ref_keywords GROUP BY subject')
      .all()
      .map((r) => [r.subject, r.next])
  );
  for (const [kw, { subject }] of toAdd) {
    const i = nextIndex.get(subject) ?? 0;
    nextIndex.set(subject, i + 1);
    upsert.run(kw, subject, i);
    added++;
  }
  if (prune) {
    for (const kw of notInFile) {
      del.run(kw);
      pruned++;
    }
  }
})();

const total = db.prepare('SELECT COUNT(*) AS n FROM ref_keywords').get().n;
console.log(`\nAdded ${added} angle(s)${prune ? `, pruned ${pruned}` : ''}. ref_keywords now holds ${total}.`);
