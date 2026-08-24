#!/usr/bin/env node
'use strict';

// Reads the articles that drafting turned down, and keeps the facts inside them.
//
//   node server/scripts/salvage-articles.js <editionId> [--plan] [--limit N]
//   node server/scripts/salvage-articles.js 5 --plan
//
// WHY THIS EXISTS
//
// Adaptive selection judges an ARTICLE, and it judges it well: across four
// editions the drafter discarded 2 of 145 articles it was handed, and every one
// of the 37 that scored under 40 was published. The filter is not too loose.
//
// But an article is not the unit a question is written from. "Adani calls on
// Karnataka CM, sparks political speculation" is a routine political meeting,
// scored 35, and correctly ranked below the cut. Paragraph nine names a
// twin-tube tunnel road with a length and a cost, and that is a question sitting
// inside a story that is not.
//
// So the turned-down pile gets a second, much cheaper look. Not "was this
// article worth a note" — that was already answered — but "does this article
// happen to CARRY a fact". Most do not, and the prompt is written to expect
// that: returning nothing is the common and correct answer.
//
// WHAT COMES OUT IS NOT A NOTE
//
// A salvaged record has prelims facts and questions and nothing else: no
// notes_markdown, no static background, no theme. There was no theme — that is
// why the article was turned down — and writing 200 words around a tunnel
// length would produce exactly the padding this exists to avoid. They are
// flagged `salvaged` and shown under Miscellaneous.

const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const L = require(path.join(ROOT, 'content-pipeline', 'ca-daily', 'lib'));
L.loadEnv();
const db = require(path.join(__dirname, '..', 'src', 'db'));
const D = require(path.join(__dirname, '..', 'src', 'lib', 'draft'));
const SEL = require(path.join(__dirname, '..', 'src', 'lib', 'select'));

const editionId = Number(process.argv[2]);
if (!editionId) {
  console.error('Usage: node server/scripts/salvage-articles.js <editionId> [--plan] [--limit N]');
  process.exit(2);
}
const arg = (n, d = null) => {
  const i = process.argv.indexOf(`--${n}`);
  return i === -1 ? d : process.argv[i + 1];
};
const args = {
  plan: process.argv.includes('--plan'),
  limit: Number(arg('limit', 0)) || 0,
  model: process.env.OPENAI_MODEL || 'gpt-4o',
};

const say = (m) => console.log(`[salvage ${editionId}] ${m}`);

/**
 * Everything this edition holds that drafting did not take.
 *
 * Deliberately NOT "everything below the rank cut": an article already drafted
 * into an item must not be salvaged as well, or the same fact arrives twice —
 * once inside a note and once as a card — and the duplicate is invisible until
 * a student meets both.
 */
function leftovers() {
  const picked = new Set(
    SEL.selectForDrafting(SEL.candidateRows(db, editionId)).picked.map((r) => r.id)
  );
  return db
    .prepare(
      `SELECT a.id, a.headline, a.body, a.dateline, a.score, a.page
         FROM np_articles a
        WHERE a.edition_id = ?
          AND a.item_id IS NULL
          AND a.status NOT IN ('duplicate', 'discarded')
        ORDER BY a.score DESC`
    )
    .all(editionId)
    .filter((a) => !picked.has(a.id));
}

async function main() {
  const edition = db.prepare('SELECT id, date, publication FROM np_editions WHERE id = ?').get(editionId);
  if (!edition) throw new Error(`No edition ${editionId}`);

  let rows = leftovers();
  if (args.limit) rows = rows.slice(0, args.limit);

  say(`${rows.length} article(s) drafting did not take, from ${edition.publication} ${edition.date}`);
  if (!rows.length) return;

  if (args.plan) {
    for (const a of rows.slice(0, 30)) {
      say(`  ${String(Math.round(a.score)).padStart(3)}  ${(a.headline || '').slice(0, 68)}`);
    }
    if (rows.length > 30) say(`  … and ${rows.length - 30} more`);
    say('');
    say(`PLAN ONLY — ${rows.length} article(s) would be examined. Nothing was called or written.`);
    return;
  }

  // The same blueprint vocabulary the drafting lane appends, in the same
  // grouped-by-subject shape. Grouped rather than one-term-per-line because the
  // per-line form invited "Election [Polity]" back as the keyword.
  const keywords = db
    .prepare('SELECT keyword, subject FROM ref_keywords ORDER BY subject, keyword')
    .all();
  const bySubject = keywords.reduce((acc, k) => {
    (acc[k.subject || 'Other'] = acc[k.subject || 'Other'] || []).push(k.keyword);
    return acc;
  }, {});
  const vocabulary = [
    '=== BLUEPRINT KEYWORD ANGLES (use the term exactly, without the subject) ===',
    ...Object.entries(bySubject).map(([subject, list]) => `${subject}: ${list.join(', ')}`),
  ].join('\n');

  const prompt = `${L.readPrompt('prompt-salvage.txt')}\n\n${vocabulary}`;
  const mcqPrompt = L.readPrompt('prompt-mcq.txt');
  const seenHashes = L.existingQuestionHashes(db);

  const kept = [];
  let examined = 0;
  let empty = 0;
  let failed = 0;

  for (const [i, a] of rows.entries()) {
    const label = `[${i + 1}/${rows.length}]`;
    examined += 1;

    const user = [
      `HEADLINE: ${a.headline || ''}`,
      a.dateline ? `DATELINE: ${a.dateline}` : '',
      '',
      'ARTICLE:',
      String(a.body || '').slice(0, 12000),
    ]
      .filter(Boolean)
      .join('\n');

    let record;
    try {
      const raw = await L.complete({ system: prompt, user, model: args.model });
      record = L.parseJson(raw);
    } catch (e) {
      failed += 1;
      say(`${label} FAILED — ${e.message}`);
      continue;
    }

    if (!record || record.salvage !== true) {
      empty += 1;
      continue;
    }
    // The prompt asks for two lines minimum and says why: one orphan fact with
    // no context around it is not a card. Enforced here rather than trusted,
    // because a model that ignores an instruction still has to get past this.
    const facts = String(record.prelims_facts || '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (facts.length < 2) {
      empty += 1;
      say(`${label} thin — ${facts.length} fact(s), dropped: ${(record.headline || '').slice(0, 50)}`);
      continue;
    }

    record.salvaged = 1;
    record._articleId = a.id;
    record.notes_markdown = '';
    record.static_linkage = '';
    record.static_notes = '';
    record.event_date = record.event_date || edition.date;

    record.mcqs =
      Number(record.relevance_g2) === 0
        ? []
        : await D.generateMcqs(db, {
            record,
            index: i,
            count: 2,
            model: args.model,
            mcqPrompt,
            seenHashes,
            fallbackDate: edition.date,
            onLog: say,
          });

    const written = D.insertDrafted(db, { date: edition.date, drafted: [record], onLog: say });
    kept.push(record);
    say(
      `${label} KEPT — ${record.headline.slice(0, 62)} ` +
        `[${record.bucket}] ${facts.length} fact(s), ${record.mcqs.length} question(s)`
    );
    void written;
  }

  say('');
  say(
    `Examined ${examined} · salvaged ${kept.length} · nothing in ${empty}` +
      `${failed ? ` · FAILED ${failed}` : ''}`
  );
  // A salvage rate near zero means the pass is not earning its cost; near one
  // means it has stopped discriminating and is writing cards about meetings.
  // Both are worth seeing rather than inferring from the review queue.
  if (examined) say(`Salvage rate ${Math.round((kept.length / examined) * 100)}%`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
