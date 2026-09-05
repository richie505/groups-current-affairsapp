'use strict';

// What the salvage pass will look at, defined once.
//
// The admin screen shows a count and the worker does the work, and if those two
// answer the question differently the screen is lying. The drafting route
// already carries that scar — "counting one way and drafting another is how
// '24 waiting' turns into 35 items in the queue" — so this is one function with
// two callers rather than two queries that agree today.

const SELECT = require('./select');

/**
 * The articles in this edition that drafting did not take.
 *
 * Two exclusions, for different reasons.
 *
 * `item_id IS NULL` keeps out anything already drafted into an item. An article
 * that produced a note must not also produce a card, or the same fact reaches a
 * student twice — once inside the note and once on its own — and nothing in
 * either says it happened.
 *
 * The selector's own picks are excluded too, because between processing and
 * salvaging nobody may have pressed Draft yet: those articles have no item_id,
 * but they are going to, and salvaging them first would take the good material
 * out of the notes.
 *
 * WHY 'discarded' IS NOT SIMPLY SKIPPED
 *
 * The status means two unrelated things. Processing sets it before scoring —
 * sport match reports, local crime, from-the-archives — and those carry score 0.
 * The DRAFTER sets it after reading the whole article and paying for the call,
 * and those keep the score they earned. The second group is the best salvage
 * material in the edition: a judgement has already been made that the article is
 * not examinable, which is a different question from whether it CARRIES anything
 * examinable. Score separates them exactly, because a processing discard was
 * never scored.
 */
function leftovers(db, editionId) {
  const picked = new Set(
    SELECT.selectForDrafting(SELECT.candidateRows(db, editionId)).picked.map((r) => r.id)
  );
  // THE SAME NO-UNIT RULE THE DRAFTER APPLIES, FOR THE SAME REASON.
  //
  // selectForDrafting refuses an article that connects to no syllabus unit —
  // `unmatchedMinScore: null` — because a composite score cannot tell "Rs 7,470
  // cr. cleared for infra works in ULBs" from "Cultural diversity highlight of
  // gala dinner in Vizag": both score highly on AP place names, money and
  // officialdom, and neither is on the syllabus.
  //
  // Salvage was exempt from that, and it should not be. It reads what drafting
  // left behind, so without the rule it becomes the back door for exactly the
  // articles the rule exists to keep out. Six published items — a Duleep Trophy
  // preview, a race club AGM, a jockey's win — carry no unit at all and were
  // drafted before the rule existed; nothing should be able to add more.
  //
  // Objective, feedable units only, matching candidateRows().
  return db
    .prepare(
      `SELECT a.id, a.headline, a.body, a.dateline, a.score, a.page
         FROM np_articles a
        WHERE a.edition_id = ?
          AND a.item_id IS NULL
          AND a.status <> 'duplicate'
          AND (a.status <> 'discarded' OR a.score > 0)
          AND EXISTS (
                SELECT 1 FROM np_article_units au
                  JOIN ref_units ru ON ru.unit_code = au.unit_code
                 WHERE au.article_id = a.id
                   AND ru.format = 'objective' AND ru.broad = 0 AND ru.unfeedable = 0
              )
        ORDER BY a.score DESC`
    )
    .all(editionId)
    .filter((a) => !picked.has(a.id));
}

/**
 * How many there are, for a screen that needs the number and not the rows.
 *
 * Deliberately the same function rather than a COUNT(*) of its own: a count that
 * can drift from the list it describes is worse than a slightly slower one, and
 * an edition is a hundred rows.
 */
function leftoverCount(db, editionId) {
  return leftovers(db, editionId).length;
}

module.exports = { leftovers, leftoverCount };
