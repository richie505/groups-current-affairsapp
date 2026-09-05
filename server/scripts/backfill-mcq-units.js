#!/usr/bin/env node
'use strict';

// Fills in `ca_mcqs.unit_code` where it is blank, choosing from the units the
// question's ITEM actually carries.
//
//   node server/scripts/backfill-mcq-units.js [--apply] [--include-mismatched]
//
// Dry by default. Prints what it would write and why.
//
// WHY THIS IS A LOOKUP AND NOT A MODEL CALL
//
// The same reason the article mapping is. "Which of these three units does this
// question test" has to be answerable from the question text, re-runnable when
// the vocabulary improves, and correctable by editing one alias row. A model
// asked the same thing gives a different answer on Tuesday and leaves nothing
// behind to correct.
//
// So the question, its four options and its explanation are matched against the
// aliases of each candidate unit — the identical matcher the scorer uses,
// plurals and all — and the unit with the most distinct alias hits wins.
//
// THREE THINGS IT REFUSES TO DO
//
// A tie is left blank. If a question names one term from unit A and one from
// unit B, the evidence does not choose, and a coin-flip tag is exactly the
// "answers 'what covers this unit' with the wrong thing" failure the column
// exists to avoid.
//
// Zero hits is left blank, even when the item has exactly one unit and the
// arithmetic is tempting. An item's unit came from the ARTICLE; a question
// drawn from that article may still test something else in it, and inheriting
// the tag unexamined is how a unit's practice set fills with questions that do
// not practise it. The one exception is below.
//
// A mismatched code is left alone unless --include-mismatched is passed. 192
// questions here are filed under a unit their item does not carry, all written
// before the restriction existed. Re-pointing them is a bigger decision than
// filling a blank and gets asked for separately.

const path = require('path');

const db = require(path.join(__dirname, '..', 'src', 'db'));
const T = require(path.join(__dirname, '..', 'src', 'lib', 'topics'));

const apply = process.argv.includes('--apply');
const includeMismatched = process.argv.includes('--include-mismatched');
// Blank a mismatched code the evidence could not replace, keeping the old value
// in unit_code_prior. Only meaningful alongside --include-mismatched.
const blankUnresolved = process.argv.includes('--blank-unresolved');

// Same vocabulary the scorer reads, same plural handling. Broad and unfeedable
// units are excluded there and are excluded here.
const aliases = db
  .prepare(
    `SELECT a.unit_code, a.alias, a.strict, COALESCE(a.weak, 0) AS weak
       FROM ref_unit_aliases a
       JOIN ref_units u ON u.unit_code = a.unit_code
      WHERE u.broad = 0 AND u.unfeedable = 0`
  )
  .all()
  .map((r) => ({ ...r, matcher: T.aliasMatcher(r.alias, !!r.strict, true) }));

const byUnit = new Map();
for (const a of aliases) {
  if (!byUnit.has(a.unit_code)) byUnit.set(a.unit_code, []);
  byUnit.get(a.unit_code).push(a);
}

const rows = db
  .prepare(
    `SELECT m.id, m.item_id, m.unit_code, m.question, m.option_a, m.option_b,
            m.option_c, m.option_d, m.explanation, m.keyword, i.headline, i.status
       FROM ca_mcqs m JOIN ca_items i ON i.id = m.item_id
      WHERE i.status = 'published'
      ORDER BY m.item_id, m.id`
  )
  .all();

const unitsOf = db.prepare(
  `SELECT u.unit_code, r.label FROM ca_item_units u
     JOIN ref_units r ON r.unit_code = u.unit_code
    WHERE u.item_id = ? AND r.broad = 0 AND r.unfeedable = 0
    ORDER BY u.unit_code`
);

function score(text, unitCode) {
  const norm = T.norm(text);
  const hits = new Set();
  let strong = 0;
  for (const a of byUnit.get(unitCode) || []) {
    if (a.matcher.test(text, norm)) {
      hits.add(a.alias.toLowerCase());
      if (!a.weak) strong += 1;
    }
  }
  return { n: hits.size, strong, terms: [...hits] };
}

const out = { assigned: [], tie: [], noEvidence: [], noUnits: [], skipped: 0 };

for (const m of rows) {
  const blank = !String(m.unit_code || '').trim();
  const cands = unitsOf.all(m.item_id);
  const mismatched =
    !blank && !cands.some((c) => c.unit_code === m.unit_code);
  if (!blank && !(includeMismatched && mismatched)) {
    out.skipped += 1;
    continue;
  }
  if (!cands.length) {
    out.noUnits.push(m);
    continue;
  }
  const text = [
    m.question, m.option_a, m.option_b, m.option_c, m.option_d, m.explanation, m.keyword,
  ]
    .filter(Boolean)
    .join(' \n ');

  const scored = cands
    .map((c) => ({ ...c, ...score(text, c.unit_code) }))
    .sort((a, b) => b.n - a.n || b.strong - a.strong);

  const best = scored[0];
  if (!best.n) {
    out.noEvidence.push({ ...m, cands: scored });
    continue;
  }
  const second = scored[1];
  if (second && second.n === best.n && second.strong === best.strong) {
    out.tie.push({ ...m, cands: scored });
    continue;
  }
  out.assigned.push({ ...m, pick: best, cands: scored, was: m.unit_code || '' });
}

const upd = db.prepare('UPDATE ca_mcqs SET unit_code = ? WHERE id = ?');
// The old value moves rather than disappearing, so making the column true does
// not erase the record that somebody once filed the question somewhere.
const blank = db.prepare(
  `UPDATE ca_mcqs SET unit_code = '', unit_code_prior = COALESCE(unit_code_prior, unit_code)
    WHERE id = ?`
);
// noUnits belongs here too, and leaving it out is how 24 rows survived the
// first pass: an item carrying NO units cannot justify any code, so a question
// on it holding one is mismatched by definition and unresolvable by definition.
const unresolved = blankUnresolved
  ? [...out.noEvidence, ...out.tie, ...out.noUnits].filter((m) =>
      String(m.unit_code || '').trim()
    )
  : [];

if (apply) {
  db.transaction(() => {
    for (const a of out.assigned) upd.run(a.pick.unit_code, a.id);
    for (const m of unresolved) blank.run(m.id);
  })();
}

if (blankUnresolved) {
  console.log(
    `${apply ? 'BLANKED' : 'WOULD BLANK'} ${unresolved.length} question(s) whose unit its ` +
      `item does not carry and the evidence could not replace.\n` +
      `Old value kept in unit_code_prior — one UPDATE puts it back.\n`
  );
}

console.log(
  `${apply ? 'ASSIGNED' : 'WOULD ASSIGN'} ${out.assigned.length} question(s)\n` +
    `  left blank — evidence chose nothing   ${out.noEvidence.length}\n` +
    `  left blank — two units tied           ${out.tie.length}\n` +
    `  left blank — item carries no unit     ${out.noUnits.length}\n` +
    `  untouched                             ${out.skipped}\n`
);

for (const a of out.assigned) {
  console.log(
    `  mcq ${String(a.id).padEnd(5)} item ${String(a.item_id).padEnd(4)} ` +
      `${a.was ? `${a.was} -> ` : ''}${a.pick.unit_code}  [${a.pick.terms.join(', ')}]`
  );
  console.log(`        ${String(a.question).replace(/\s+/g, ' ').slice(0, 96)}`);
}

if (!apply) console.log('\nDRY RUN — nothing written. Re-run with --apply.');
