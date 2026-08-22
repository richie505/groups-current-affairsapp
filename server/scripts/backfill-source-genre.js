#!/usr/bin/env node
'use strict';

// Stamps `source_genre` and `source_author` onto items drafted before the
// pipeline knew what kind of piece it was reading.
//
//   node server/scripts/backfill-source-genre.js [--dry-run]
//
// WHY THIS IS NOT A REDRAFT
//
// Because it costs nothing and answers a different question. A redraft rewrites
// the item under the opinion rules and needs review and publishing again; this
// only records WHERE the item came from, which is already known — the article is
// still in the database, still linked by `item_id`, and now carries its genre.
//
// The distinction matters for what the user sees today. Without this, a
// published item drafted from an op-ed renders with no badge at all, which is a
// silent claim that it is a news summary. With it the badge is honest even
// though the prose underneath has not been rewritten — and the badge is the part
// that stops a student memorising an argument as a fact.
//
// Redrafting is still the right fix for the prose. This is the part that should
// not have to wait for it.

const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const db = require(path.join(__dirname, '..', 'src', 'db'));
const G = require(path.join(ROOT, 'content-pipeline', 'np-daily', 'genre'));

const dryRun = process.argv.includes('--dry-run');

const rows = db
  .prepare(
    `SELECT i.id, i.status, i.headline, i.needs_verify, i.verify_note,
            a.id AS article_id, a.genre, a.byline, a.bylines, e.publication
       FROM ca_items i
       JOIN np_articles a ON a.item_id = i.id
       JOIN np_editions e ON e.id = a.edition_id
      WHERE i.status <> 'discarded'
      ORDER BY i.id`
  )
  .all();

const upd = db.prepare(
  `UPDATE ca_items
      SET source_genre = ?, source_author = ?, updated_at = datetime('now')
    WHERE id = ?`
);

let stamped = 0;
let opinion = 0;

db.transaction(() => {
  for (const r of rows) {
    const genre = r.genre || 'report';
    const authors = String(r.bylines || r.byline || '')
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean);
    const author =
      genre === 'editorial' ? `${r.publication} (editorial)` : authors.join(', ');

    if (G.isOpinion(genre)) {
      opinion += 1;
      console.log(
        `  item #${r.id} (${r.status}) ← article #${r.article_id} [${genre}]` +
          `${author ? ` — ${author}` : ''}\n      ${r.headline.slice(0, 70)}`
      );
    }
    if (!dryRun) upd.run(genre, author, r.id);
    stamped += 1;
  }
})();

console.log(
  `\n${dryRun ? 'Would stamp' : 'Stamped'} ${stamped} item(s); ${opinion} came from opinion, ` +
    'not from reportage.'
);
if (opinion && !dryRun) {
  console.log(
    'Those items now carry the badge but NOT the opinion drafting rules — their\n' +
      'prose was written under the assumption that the source reported facts.\n' +
      'Re-draft them to fix the prose:\n' +
      `  node server/scripts/draft-articles.js --redraft --article ${rows
        .filter((r) => G.isOpinion(r.genre))
        .map((r) => r.article_id)
        .join(',')}`
  );
}
