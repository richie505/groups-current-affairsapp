'use strict';

// The Group-I bank review.
//
// Cards accumulate and nobody looks at them again — that is how a capture
// system quietly becomes a graveyard, and the student only finds out in the
// final weeks, when the banks were supposed to have become a revision
// resource. This is the report that stops that: counts against targets, which
// bank is lagging, which theme is thin, and specifically whether Andhra
// Pradesh coverage is holding up.
//
// It deliberately reports problems rather than a score. "You have 142 cards"
// is flattering and useless; "Quotations are at 6 of 40 and three themes have
// no AP example" is what changes what the student does this week.

const BANK_TARGETS = { Q: 40, D: 60, E: 50, S: 50 };

const BANK_LABELS = {
  Q: 'Quotations',
  D: 'Data & reports',
  E: 'Examples & case studies',
  S: 'Schemes, committees, Acts',
};

// Where each bank's material is actually found, surfaced when a bank is thin.
// Quotations lag almost universally: they are the hardest bank to fill
// incidentally and the easiest to forget, because nothing in a news cycle
// hands you a quotable line unless you are looking for one.
const BANK_HINTS = {
  Q: 'Judgment paragraphs, commission report prefaces, Economic Survey framing chapters.',
  D: 'Economic Survey, NFHS, MoSPI and RBI releases, AP Socio-Economic Survey.',
  E: 'Pair every national example with an Andhra Pradesh one — that pairing is the mark.',
  S: 'PIB scheme launches, PRS Bill summaries, AP government orders.',
};

const CORE_THEMES = [
  'governance',
  'ethics',
  'science & tech',
  'environment',
  'economy',
  'society & education',
  'federalism',
];

const AP_THEME = 'andhra pradesh';
// Every theme should carry at least three AP examples. A bank that is
// nationally rich and AP-thin fails in exactly the papers where AP is half the
// content, so this is the threshold worth flagging on.
const AP_PER_THEME_TARGET = 3;

function bankReview(db, userId) {
  const counts = db
    .prepare(
      `SELECT c.bank, COUNT(*) AS n
         FROM ca_user_cards c
         JOIN ca_items i ON i.id = c.item_id
         JOIN ca_days d ON d.id = i.day_id
        WHERE c.user_id = ? AND i.status = 'published' AND d.status = 'published'
        GROUP BY c.bank`
    )
    .all(userId);
  const byBank = new Map(counts.map((r) => [r.bank, r.n]));

  const banks = Object.entries(BANK_TARGETS).map(([bank, target]) => {
    const count = byBank.get(bank) || 0;
    return {
      bank,
      label: BANK_LABELS[bank],
      count,
      target,
      gap: Math.max(target - count, 0),
      pct: Math.min(Math.round((count / target) * 100), 100),
      hint: BANK_HINTS[bank],
    };
  });

  // "Thinnest" measured as a share of its own target, not as a raw count —
  // Quotations at 10/40 is in worse shape than Data at 20/60, and comparing
  // raw counts would say the opposite.
  const thinnest = [...banks].sort((a, b) => a.pct - b.pct)[0] || null;

  // Theme coverage, with the AP count per theme alongside the total. The two
  // numbers have to be read together: a theme with 12 cards and no AP example
  // is a theme that will not survive Paper II or IV.
  const themeRows = db
    .prepare(
      `SELECT t.theme,
              COUNT(DISTINCT c.item_id) AS n,
              COUNT(DISTINCT CASE WHEN i.bucket = 'ap'
                                    OR EXISTS (SELECT 1 FROM ca_item_themes t2
                                                WHERE t2.item_id = i.id AND t2.theme = '${AP_THEME}')
                                  THEN c.item_id END) AS ap_n
         FROM ca_user_cards c
         JOIN ca_items i ON i.id = c.item_id
         JOIN ca_days d ON d.id = i.day_id
         JOIN ca_item_themes t ON t.item_id = i.id
        WHERE c.user_id = ? AND i.status = 'published' AND d.status = 'published'
          AND t.theme <> '${AP_THEME}'
        GROUP BY t.theme`
    )
    .all(userId);
  const byTheme = new Map(themeRows.map((r) => [r.theme, r]));

  const themes = CORE_THEMES.map((theme) => {
    const row = byTheme.get(theme) || { n: 0, ap_n: 0 };
    return {
      theme,
      count: row.n,
      ap_count: row.ap_n,
      ap_target: AP_PER_THEME_TARGET,
      ap_short: Math.max(AP_PER_THEME_TARGET - row.ap_n, 0),
    };
  });

  const thinnestTheme = [...themes].sort((a, b) => a.count - b.count)[0] || null;
  const apShortThemes = themes.filter((t) => t.ap_short > 0).map((t) => t.theme);

  // Cards whose underlying item touches a known-superseded position. These are
  // the dangerous ones: the student filed them in good faith and will write
  // them in an exam unless something says otherwise.
  //
  // Matched in JS rather than SQL. The terms are comma-separated free text
  // maintained by hand, so building a SQL IN-list or JSON array out of them
  // breaks the day someone writes a term containing a quote or a comma —
  // and it would break silently, reporting zero stale cards.
  const stale = findStaleCards(db, userId);

  // Same story filed more than once. Matched on the normalised headline rather
  // than the item id, since the pipeline can legitimately create two items for
  // one development on different days.
  const duplicates = db
    .prepare(
      `SELECT LOWER(TRIM(i.headline)) AS key, COUNT(*) AS n,
              GROUP_CONCAT(i.id) AS item_ids,
              MIN(i.headline) AS headline
         FROM ca_user_cards c
         JOIN ca_items i ON i.id = c.item_id
        WHERE c.user_id = ?
        GROUP BY key
       HAVING n > 1`
    )
    .all(userId);

  const total = banks.reduce((s, b) => s + b.count, 0);
  const targetTotal = banks.reduce((s, b) => s + b.target, 0);

  return {
    total,
    target_total: targetTotal,
    pct: Math.min(Math.round((total / targetTotal) * 100), 100),
    banks,
    themes,
    thinnest_bank: thinnest,
    thinnest_theme: thinnestTheme,
    ap_short_themes: apShortThemes,
    stale,
    duplicates,
    hunt: buildHuntList({ thinnest, apShortThemes, thinnestTheme, stale }),
  };
}

// Cards resting on a position a known correction has since superseded.
//
// The date test is what keeps this from crying wolf: an item *about* the 16th
// Finance Commission, filed after the report was tabled, is correct and should
// not be flagged. Only an item predating the correction's effective date is
// suspect — it was filed when the old position still looked right.
function findStaleCards(db, userId) {
  const corrections = db
    .prepare('SELECT id, topic, correct_position, effective_date, match_terms FROM ref_corrections')
    .all();
  if (!corrections.length) return [];

  const cards = db
    .prepare(
      `SELECT i.id, i.headline, i.event_date,
              LOWER(i.headline || ' ' || i.notes_markdown || ' ' || i.g1_fact) AS haystack
         FROM ca_user_cards c
         JOIN ca_items i ON i.id = c.item_id
        WHERE c.user_id = ?`
    )
    .all(userId);

  const out = [];
  for (const card of cards) {
    for (const corr of corrections) {
      const terms = corr.match_terms
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      if (!terms.some((t) => card.haystack.includes(t))) continue;
      // An item dated on or after the correction took effect already reflects
      // the new position, so flagging it would be noise.
      if (card.event_date && corr.effective_date && card.event_date >= corr.effective_date) continue;
      out.push({
        id: card.id,
        headline: card.headline,
        topic: corr.topic,
        correct_position: corr.correct_position,
        effective_date: corr.effective_date,
      });
      break; // one flag per card is enough to send them back to it
    }
  }
  return out;
}

// Two or three specific things to look for this week. Concrete beats
// exhaustive — a list of nine gaps gets read as "everything is broken" and
// nothing gets done.
function buildHuntList({ thinnest, apShortThemes, thinnestTheme, stale }) {
  const hunt = [];
  if (thinnest && thinnest.gap > 0) {
    hunt.push(
      `${thinnest.label} is at ${thinnest.count}/${thinnest.target}. ${thinnest.hint}`
    );
  }
  if (apShortThemes.length) {
    const list = apShortThemes.slice(0, 3).join(', ');
    hunt.push(
      `No AP example yet under: ${list}. Sweep AP department releases — this is the gap that costs marks in Papers II and IV.`
    );
  } else if (thinnestTheme && thinnestTheme.count < 5) {
    hunt.push(`"${thinnestTheme.theme}" is the thinnest theme at ${thinnestTheme.count} cards.`);
  }
  if (stale.length) {
    hunt.push(
      `${stale.length} filed card${stale.length === 1 ? '' : 's'} touch a superseded position — re-read before revising from them.`
    );
  }
  if (!hunt.length) hunt.push('Banks and themes are on target. Keep filing, and re-check next week.');
  return hunt;
}

module.exports = { bankReview, BANK_TARGETS, BANK_LABELS, CORE_THEMES, AP_THEME };
