'use strict';

// The known-corrections guard.
//
// This exists because a verification pass over the user's own blueprint found
// four of nine checked facts had gone stale in fifteen months — three of them
// on Tier-1 topics. That is the failure mode this app is most exposed to: a
// language model drafting from older training data will confidently restate
// the superseded position, and unlike a static-subject error there is no
// textbook to catch it against.
//
// So every draft is checked against ref_corrections at three points: when the
// pipeline writes it, when it appears in the review queue, and on demand from
// the item editor. The guard does not block — it annotates, because the
// correct handling depends on what the item actually says, and only a person
// can tell "an item about the 16th Finance Commission" from "an item that
// assumes the 15th is still operative".

// Terms that, appearing near a correction's trigger, suggest the draft is
// stating the *old* position rather than merely touching the topic. Weak
// signals on purpose: this decides how loudly to flag, never whether to.
const STALE_HINTS = [
  'three capitals',
  'three-capital',
  'not yet in force',
  'yet to be notified',
  'yet to be implemented',
  'awaiting notification',
  'is expected to',
  '15th finance commission',
  'fifteenth finance commission',
  '2021-26',
  'census 2021',
];

function haystackFor(item) {
  return [
    item.headline,
    item.notes_markdown,
    item.static_linkage,
    item.prelims_facts,
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
}

// Returns one entry per correction the item touches. Empty array is the normal
// case and means nothing to report.
function checkCorrections(db, item) {
  const corrections = db
    .prepare('SELECT id, topic, superseded_claim, correct_position, effective_date, match_terms FROM ref_corrections')
    .all();
  if (!corrections.length) return [];

  const haystack = haystackFor(item);
  if (!haystack) return [];

  const hits = [];
  for (const corr of corrections) {
    const terms = corr.match_terms
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    const matched = terms.filter((t) => haystack.includes(t));
    if (!matched.length) continue;

    // Which stale phrasings are actually present. When this is non-empty the
    // item is probably asserting the old position, not just mentioning the
    // topic — that distinction is the difference between "worth a glance" and
    // "fix this before publishing".
    const staleSignals = STALE_HINTS.filter((h) => haystack.includes(h));

    hits.push({
      correction_id: corr.id,
      topic: corr.topic,
      matched_terms: matched,
      superseded_claim: corr.superseded_claim,
      correct_position: corr.correct_position,
      effective_date: corr.effective_date,
      // 'high' when the text carries a phrase associated with the superseded
      // position; 'low' when it merely mentions the topic.
      severity: staleSignals.length ? 'high' : 'low',
      stale_signals: staleSignals,
    });
  }
  return hits;
}

// Prose form, for the pipeline's log and for the prompt it feeds back to the
// model on a redraft. Kept next to the checker so the two never drift.
function describeHits(hits) {
  if (!hits.length) return '';
  return hits
    .map(
      (h) =>
        `[${h.severity.toUpperCase()}] ${h.topic} — matched "${h.matched_terms.join('", "')}". ` +
        `Correct position: ${h.correct_position}`
    )
    .join('\n');
}

// The block injected into every drafting prompt. Stating the corrections up
// front is cheaper and more reliable than catching them afterwards, though
// both happen — the model is told the current position, and the output is
// still checked in case it ignored the instruction.
function correctionsPromptBlock(db) {
  const rows = db
    .prepare('SELECT topic, superseded_claim, correct_position, effective_date FROM ref_corrections ORDER BY id')
    .all();
  if (!rows.length) return '';
  const lines = rows.map(
    (r) =>
      `- ${r.topic}: DO NOT write "${r.superseded_claim}" — that position is superseded. ` +
      `Current position${r.effective_date ? ` (effective ${r.effective_date})` : ''}: ${r.correct_position}`
  );
  return [
    'KNOWN CORRECTIONS — these facts changed recently and are commonly stated wrongly.',
    'Use the current position. If an item touches one of these, say so explicitly.',
    ...lines,
  ].join('\n');
}

module.exports = { checkCorrections, describeHits, correctionsPromptBlock, STALE_HINTS };
