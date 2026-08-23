'use strict';

// WHICH ARTICLES GET DRAFTED — decided by the syllabus, adaptively.
//
// THE PROBLEM WITH A FLAT THRESHOLD
//
// `--min-score 45` is one number applied to a blend of five factors: syllabus
// 30, PYQ 20, AP 20, importance 15, reuse 15. Because it is a blend, an article
// can clear the bar on AP place-names and importance alone while feeding no
// syllabus unit at all — and an article that plainly belongs to a unit can miss
// it because nothing else about it scored.
//
// Measured across 248 scored articles:
//
//   10 articles scored 45+ and feed NO syllabus unit      — drafted anyway
//   54 articles scored under 45 and DO feed a unit        — never drafted
//
// Wrong in both directions, and the second number is the expensive one: 54
// articles with a genuine syllabus connection that the paper was never asked
// about. "Centre notifies key scheme to manufacture mobile phones" scored 43
// and feeds four units. "IRDAI places branch curbs on life insurers" scored 42
// and feeds three.
//
// THE LEVER
//
// The number of DISTINCT syllabus units an article feeds is the signal the flat
// score buries. In the 35-44 band, 9 of the 20 articles that match at all match
// three or more units — an article examinable in three places is examinable,
// whatever its composite came to. Only 2 of the 20 rest solely on the one unit
// known to over-fire.
//
// So leverage is computed from the syllabus connection and ranked ALONGSIDE the
// composite score rather than inside it. The composite still matters — it
// carries AP-ness, recency and PYQ pressure — but it no longer decides alone.
//
// WHY EVIDENCE STRENGTH IS NOT RE-CHECKED HERE
//
// `np_article_units` only receives a row when the match is already solid:
// named in the headline, or two or more matched terms, or one multi-word
// phrase. That rule lives in relevance.js and applying it twice would let the
// two copies drift. Every row here is solid by construction.

// How strongly this article connects to the syllabus, 0-100.
//
// Deliberately flat after four units. The difference between four units and
// seven is not "nearly twice as examinable" — past a point a long unit list is
// a story touching many things lightly, which is the shape of a default block
// rather than of a strong match.
function leverageOf({ units = 0, headlineUnits = 0 }) {
  if (!units) return 0;
  const base = units === 1 ? 40 : units === 2 ? 62 : units === 3 ? 76 : 85;
  // Named in the headline is what the story is ABOUT, rather than something it
  // mentions. Worth more than a fourth unit.
  return Math.min(100, base + (headlineUnits ? 15 : 0));
}

// The composite and the leverage, combined.
//
// Weighted towards leverage because that is the whole point of the change —
// but not overwhelmingly, or a three-unit story about nothing outranks a
// two-unit story about the state budget.
function rankOf(row) {
  const leverage = leverageOf(row);
  return { leverage, rank: Math.round(0.55 * leverage + 0.45 * (row.score || 0)) };
}

const DEFAULTS = {
  // The rank an article must reach to be drafted at all.
  minRank: 45,
  // A floor on the COMPOSITE, whatever the leverage says.
  //
  // Leverage can otherwise rescue an article the scorer thought was nothing:
  // "Karnataka govt. bans sale of non-dairy paneer" scored 22, touched three
  // units, and ranked 52. Three loose unit matches on a weak story is not the
  // same as a story about three units.
  //
  // 32 rather than 36, because 36 also removed material that is genuinely
  // examinable and merely scored low — the J&K census enumerators, SEBI on bond
  // platform advertising, the Great Nicobar clearance. Those are exactly the
  // articles this change exists to rescue.
  minScore: 32,
  // AN ARTICLE THAT CONNECTS TO NO SYLLABUS UNIT IS NOT DRAFTED. null = never.
  //
  // This was a score threshold — draft an unmatched article if it scored well
  // enough — and the threshold cannot work, because the score is exactly what
  // cannot tell these two apart:
  //
  //   "Cultural diversity highlight of gala dinner in Vizag"   70, no unit
  //   "Rs 7,470 cr. cleared for infra works in ULBs under HAM"  55, no unit
  //
  // The first is the article that started this whole complaint; the second is
  // real AP infrastructure. Any cut-off that admits the second admits the first,
  // because both score highly for the same reason — AP place names, money,
  // officialdom — and neither connects to the syllabus.
  //
  // So the rule stops guessing. No connection, no draft. The valuable ones are
  // not lost: they are unmatched because the syllabus VOCABULARY has a gap, and
  // every run now prints them under "scored 45+ but match NO syllabus unit" so
  // the gap gets closed. Add the missing term, re-score, and they come back
  // through the front door — matched, ranked, and for a reason.
  //
  // Set a number here to restore the old behaviour for one run.
  unmatchedMinScore: null,
  // The edition-adaptive band. A thin paper should not yield four items and a
  // rich one should not yield ninety: the digest a person actually reads is
  // twenty to thirty.
  minItems: 12,
  maxItems: 35,
};

/**
 * Ranks an edition's articles and returns the ones worth drafting.
 *
 * Pure — takes rows, returns rows — so the rule can be tested and dry-run
 * without touching the database or paying for a model call.
 *
 * Each row needs: { id, score, units, headlineUnits }.
 */
function selectForDrafting(rows, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  // An explicit cap wins over the floor. Asking for --max 10 and getting 12
  // because the default minimum quietly overrode it is the kind of surprise
  // that makes a person stop trusting the flag.
  cfg.minItems = Math.min(cfg.minItems, cfg.maxItems);

  const ranked = rows
    .map((r) => ({ ...r, ...rankOf(r) }))
    .sort((a, b) => b.rank - a.rank || b.score - a.score);

  const eligible = ranked.filter(
    (r) =>
      r.score >= cfg.minScore &&
      (r.units
        ? r.rank >= cfg.minRank
        : cfg.unmatchedMinScore != null && r.score >= cfg.unmatchedMinScore)
  );

  // ADAPTIVE, IN BOTH DIRECTIONS.
  //
  // Over the cap, take the best — the ranking has already put the
  // syllabus-anchored ones on top. Under the floor, reach further down the
  // ranked list rather than returning almost nothing, because a quiet news day
  // is still a day a student opens the app.
  let picked = eligible.slice(0, cfg.maxItems);
  if (picked.length < cfg.minItems) {
    const already = new Set(picked.map((r) => r.id));
    for (const r of ranked) {
      if (picked.length >= cfg.minItems) break;
      // Never reach into rows with no syllabus connection at all to pad a
      // thin day — that is how the junk got in before.
      if (!already.has(r.id) && r.units) picked.push(r);
    }
    picked.sort((a, b) => b.rank - a.rank);
  }

  return {
    picked,
    // Everything the rule turned down, kept so a dry run can show what it cost
    // and so "scored high, matched nothing" stays visible rather than silent.
    rejected: ranked.filter((r) => !picked.some((p) => p.id === r.id)),
    config: cfg,
  };
}

/**
 * The rows `selectForDrafting` needs, for one edition.
 *
 * Objective units only, and only the ones that can be evidence: the 30-mark
 * current-affairs paper matches everything and mental ability matches nothing,
 * so both are excluded — the same exclusion the scorer and the coverage report
 * already apply.
 */
function candidateRows(db, editionId) {
  return db
    .prepare(
      `SELECT a.id, a.score, a.headline, a.page, a.band,
              COUNT(DISTINCT au.unit_code) AS units,
              COALESCE(SUM(DISTINCT CASE WHEN au.in_headline THEN 1 ELSE 0 END), 0) AS headlineUnits
         FROM np_articles a
         LEFT JOIN np_article_units au ON au.article_id = a.id
         LEFT JOIN ref_units u
                ON u.unit_code = au.unit_code
               AND u.format = 'objective' AND u.broad = 0 AND u.unfeedable = 0
        WHERE a.edition_id = ?
          AND a.status NOT IN ('duplicate', 'discarded')
          AND a.score IS NOT NULL
          AND (au.unit_code IS NULL OR u.unit_code IS NOT NULL)
        GROUP BY a.id
        ORDER BY a.score DESC`
    )
    .all(editionId);
}

module.exports = { selectForDrafting, leverageOf, rankOf, candidateRows, DEFAULTS };
