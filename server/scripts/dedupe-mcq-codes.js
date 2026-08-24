#!/usr/bin/env node
'use strict';

// Strips a duplicated "(a) ... (d) ..." code block from any list_matching or
// assertion_reason question already in the database.
//
//   node server/scripts/dedupe-mcq-codes.js [--dry-run]
//
// WHY THIS EXISTS
//
// The drafting prompt never explicitly said the four lettered choices belong
// ONLY in option_a-d, and roughly one in ten list_matching/assertion_reason
// questions echoed them into the question stem as well — so a student saw
// "(a) A-1, B-2, C-3 ... (d) A-2, B-3, C-1" printed once as part of the
// question, then again as the four option buttons right below it. The prompt
// is fixed and new questions are stripped automatically at draft time (see
// stripEmbeddedOptionCodes in server/src/lib/draft.js, the same function this
// script calls) — this is the one-time pass for everything drafted before
// that fix existed.
//
// Idempotent and conservative: a question is only touched if its trailing
// "(a)...(d)..." block matches option_a-d exactly (normalised for case and
// whitespace). Anything that doesn't match — a genuinely different use of
// that shape, or a question wrong in some other way — is left untouched.

const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
require(path.join(ROOT, 'content-pipeline', 'ca-daily', 'lib')).loadEnv();
const db = require(path.join(__dirname, '..', 'src', 'db'));
const { stripEmbeddedOptionCodes } = require(path.join(__dirname, '..', 'src', 'lib', 'draft'));

const dryRun = process.argv.includes('--dry-run');

const rows = db
  .prepare(
    `SELECT id, item_id, question, option_a, option_b, option_c, option_d
       FROM ca_mcqs
      WHERE format IN ('list_matching', 'assertion_reason')`
  )
  .all();

const affected = [];
for (const r of rows) {
  const cleaned = stripEmbeddedOptionCodes(r.question, [r.option_a, r.option_b, r.option_c, r.option_d]);
  if (cleaned !== r.question) affected.push({ ...r, cleaned });
}

if (!affected.length) {
  console.log(`Checked ${rows.length} list_matching/assertion_reason question(s) — none had the duplicated block.`);
  process.exit(0);
}

console.log(`${affected.length} of ${rows.length} question(s) repeat their own options:`);
for (const r of affected.slice(0, 40)) {
  console.log(`  mcq ${r.id} (item ${r.item_id})`);
  console.log(`    before: …${JSON.stringify(r.question.slice(-70))}`);
  console.log(`    after:  …${JSON.stringify(r.cleaned.slice(-70))}`);
}
if (affected.length > 40) console.log(`  … and ${affected.length - 40} more`);

if (dryRun) {
  console.log('\nDRY RUN — nothing written.');
  process.exit(0);
}

const upd = db.prepare('UPDATE ca_mcqs SET question = ? WHERE id = ?');
db.transaction(() => {
  for (const r of affected) upd.run(r.cleaned, r.id);
})();

console.log(`\nCleaned ${affected.length} question(s).`);
