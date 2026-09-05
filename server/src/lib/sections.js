'use strict';

// WHICH THEMED SECTION A TOPIC BELONGS TO, AND WHICH PAPER IT FEEDS.
//
// The circulated compendium is organised the way a candidate revises —
// Governance, Economy, Environment, Society, Culture — and not the way the
// pipeline scores. Those are different questions and they were being answered
// with the same field:
//
//   `bucket` (AP / National / International) is about WHERE an event happened.
//     It is the right axis for a daily reading order, because AP material is
//     the half no national paper covers properly.
//   `section` is about WHAT the event is about. It is the right axis for a
//     revision document, because that is how the syllabus is examined and how
//     a candidate looks something up three weeks later.
//
// A compendium filed by bucket puts a drinking-water grid, a temple tableau
// and a Supreme Court judgment in one undifferentiated "Andhra Pradesh" run.
//
// The section is derived from the syllabus units the item already carries —
// not from a new model call, not from keyword-matching the headline. Those
// units were assigned by relevance.js under a rule that only writes a row when
// the match is solid, so they are the most reliable thing on the item.

// THE SECTIONS ARE THE EXAM'S SUBJECTS, NOT A CONVENIENT FEW.
//
// This started as five, and five turned out to be a shape that hid three whole
// subjects. Science and Technology — six units, ISRO and DRDO and Digital India
// and energy policy — was folded into "Economy". The whole of History was
// folded into "Culture, Tourism & Heritage", so a Vijayanagara item printed
// under a heading about tourism. Geography had no section at all: physical
// geography sat in Environment, economic geography in Economy, social geography
// in Society, and a candidate revising geography had nowhere to look.
//
// A compendium is read by somebody revising a subject, and a section heading is
// the promise that everything on that subject is under it. Eight sections keep
// that promise; five broke it three times.
//
// Empty sections never print — the document is built from the items a day
// actually has, so a day with no history simply has no history section.
const SECTIONS = [
  { key: 'governance', numeral: 'I', title: 'Polity, Governance & Administration' },
  { key: 'international', numeral: 'II', title: 'International Relations' },
  { key: 'economy', numeral: 'III', title: 'Economy, Industry & Infrastructure' },
  { key: 'science', numeral: 'IV', title: 'Science, Technology & Energy' },
  { key: 'environment', numeral: 'V', title: 'Environment, Ecology & Agriculture' },
  { key: 'geography', numeral: 'VI', title: 'Geography & Natural Resources' },
  { key: 'society', numeral: 'VII', title: 'Society, Education & Welfare' },
  { key: 'culture', numeral: 'VIII', title: 'History, Art & Culture' },
];

// Every objective unit in ref_units, placed once.
//
// Hand-assigned rather than inferred from the label text, because the labels
// are prose and the edge cases are the whole problem: "Economic geography —
// sectors, industries, transport and trade" is an ECONOMY unit whose label is
// mostly geography words, and "Rights issues — human, women, SC/ST and child
// rights" is a POLITY unit whose label is mostly society words. Fifty-two
// codes assigned once beats a matcher that is wrong on the interesting ones.
const UNIT_SECTION = {
  // ---- Governance, Polity & Administration
  'G1P-B1': 'governance',
  'G1P-B2': 'governance',
  'G1P-B3': 'governance',
  'G1P-B4': 'governance',
  'G1P-B5': 'governance',
  'G1P-B6': 'international',
  'G2-P1-U6': 'governance',
  'G2-P1-U7': 'governance',
  'G2-P1-U8': 'governance',
  'G2-P1-U9': 'governance',
  'G2-P1-U10': 'governance',
  // HISTORY THAT IS REALLY ADMINISTRATION.
  //
  // "Gandhi, Ambedkar, Patel, Bose and post-Independence consolidation" and
  // "Formation of Andhra Pradesh, 1956-2014 — Visalandhra to bifurcation" are
  // filed under History in the syllabus and are about institution-building in
  // every news item that touches them. Left in Culture, they put a Railway
  // Board zone reorganisation — tagged to both, plus federal structure and
  // Union-State powers — into "Culture, Tourism & Heritage", where a candidate
  // revising railways would never look for it.
  'G1P-A6': 'governance',
  'G2-P1-U5': 'governance',

  // ---- Economy, Infrastructure & Urban Development
  'G1P-C1': 'economy',
  'G1P-C2': 'economy',
  'G1P-C3': 'economy',
  'G1P-C4': 'economy',
  'G1P-C5': 'economy',
  'G1P-D4': 'economy',
  'G2-P2-U1': 'economy',
  'G2-P2-U2': 'economy',
  'G2-P2-U3': 'economy',
  'G2-P2-U4': 'economy',
  'G2-P2-U5': 'economy',
  // Technology as INFRASTRUCTURE — a drone city, a subsea cable landing, a
  // quantum campus. These are industrial policy stories that happen to be
  // about technology, and filing them under Environment & Health because the
  // syllabus files science and environment in one paper would scatter them.
  'G1P-S1': 'science',
  'G1P-S2': 'science',
  'G1P-S3': 'science',
  'G1P-S4': 'science',
  'G2-P2-U6': 'science',
  'G2-P2-U7': 'science',

  // ---- Agriculture, Environment & Health
  'G1P-D1': 'geography',
  'G1P-D2': 'geography',
  'G1P-S5': 'environment',
  'G2-P2-U8': 'environment',
  'G2-P2-U9': 'environment',
  'G2-P2-U10': 'environment',

  // ---- Society, Education & Welfare
  'G1P-D3': 'geography',
  // G2-S2 was in no section at all. sectionOf() ignores a code it cannot place,
  // so a geography-only item fell through to the governance fallback and
  // printed under Administration — silently, because an unmapped unit and a
  // genuinely untagged item look identical to that function.
  'G2-S2': 'geography',
  'G2-S3': 'society',

  // ---- Culture, Tourism & Heritage
  'G1P-A1': 'culture',
  'G1P-A2': 'culture',
  'G1P-A3': 'culture',
  'G1P-A4': 'culture',
  'G1P-A5': 'culture',
  'G2-P1-U1': 'culture',
  'G2-P1-U2': 'culture',
  'G2-P1-U3': 'culture',
  'G2-P1-U4': 'culture',
  'G2-S1': 'culture',
};

// Units that match a great deal and therefore evidence very little. They vote
// at half weight rather than not at all: on an item whose only other unit is
// one code, "Geography — physical, economic and human" is genuinely the second
// opinion, and on an item with four units it should not outvote them.
//
// G2-S5 and G1P-CE (current affairs / current events) are excluded entirely,
// the same exclusion the scorer and the coverage report already apply — every
// item in this document matches them by construction, so they separate nothing.
// G2-S1 sits here for the same reason as G2-S2: "Indian History — ancient,
// medieval and modern" is the whole of history in one screening unit, and at
// full weight it was enough on its own to carry a story about railway zones
// into the culture section.
const WEAK_UNITS = { 'G2-S2': 0.5, 'G2-S1': 0.5 };
const IGNORED_UNITS = new Set(['G2-S5', 'G1P-CE', 'G2-S4']);

// The section for one item, by COUNTING its units rather than by testing them
// in order.
//
// Order-of-test is the bug relevance.js already had to fix in bucketOf: a
// single passing word decided the answer because it was checked first. Here
// the same shape would file a story about an irrigation project's FINANCING
// under Environment purely because the environment test ran earlier. So every
// unit votes, the largest total wins, and ties fall to the order the sections
// are printed in — which puts the more specific section first.
function sectionOf(item) {
  const votes = new Map();
  for (const u of item.units || []) {
    const code = typeof u === 'string' ? u : u.unit_code;
    if (!code || IGNORED_UNITS.has(code)) continue;
    const key = UNIT_SECTION[code];
    if (!key) continue;
    votes.set(key, (votes.get(key) || 0) + (WEAK_UNITS[code] ?? 1));
  }
  if (!votes.size) {
    // No unit places it. Governance is the fallback because an untagged item
    // is almost always an announcement, a policy or an official's statement —
    // and because a section named for administration is the least misleading
    // place to be wrong.
    return 'governance';
  }
  let best = null;
  let bestScore = -1;
  for (const s of SECTIONS) {
    const score = votes.get(s.key) || 0;
    if (score > bestScore) {
      best = s.key;
      bestScore = score;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// The paper-mapping line
// ---------------------------------------------------------------------------

// What each paper code is CALLED, for a candidate rather than for the database.
//
// "G2-P2B" is an internal key. The line under a headline in a revision document
// has to name the paper the way the commission's own notification does, because
// that is the form a candidate has a timetable against.
const PAPER_NAMES = {
  'G1P-History': 'Group-I Prelims — History & Culture',
  'G1P-Polity': 'Group-I Prelims — Polity & Governance',
  'G1P-Economy': 'Group-I Prelims — Economy & Development',
  'G1P-Geography': 'Group-I Prelims — Geography',
  'G1P-Science': 'Group-I Prelims — Science & Technology',
  'G1P-Current': 'Group-I Prelims — Current Affairs',
  'G2-Screening': 'Group-II Screening',
  'G2-P1A': 'Group-II Paper I — History & Polity',
  'G2-P1B': 'Group-II Paper I — Polity & Governance',
  'G2-P2A': 'Group-II Paper II — Economy',
  'G2-P2B': 'Group-II Paper II — Science, Environment & Health',
};

/**
 * The papers this item feeds, most specific first, as display strings.
 *
 * Deduplicated on the PAPER and not on the unit: an item tagged to three units
 * of Group-II Paper II should say "Group-II Paper II" once, not three times.
 * Screening and current-affairs papers come last — every item feeds them, so
 * leading with one tells a candidate nothing about this item in particular.
 */
function papersFor(item) {
  const mine = sectionOf(item);
  const seen = new Map();
  for (const u of item.units || []) {
    if (typeof u === 'string' || !u.paper) continue;
    if (IGNORED_UNITS.has(u.unit_code)) continue;
    const name = PAPER_NAMES[u.paper];
    if (!name) continue;
    const onTopic = UNIT_SECTION[u.unit_code] === mine;
    // Keep the strongest reason for each paper: a paper reached by an on-topic
    // unit stays on-topic even if a later unit of the same paper is not.
    if (!seen.has(name) || (onTopic && !seen.get(name).onTopic)) {
      seen.set(name, { paper: u.paper, onTopic });
    }
  }

  // THE FIRST PAPER NAMED HAS TO AGREE WITH THE SECTION IT IS PRINTED UNDER.
  //
  // Sorting only broad-papers-last put "Group-I Prelims — History & Culture"
  // at the head of a railway-zone story sitting in the Governance section, and
  // "Polity & Governance" at the head of an NGT judgment sitting under
  // Environment. Both mappings are true — those items really do touch those
  // papers — but the line under a headline is read as the reason the topic is
  // there, so it must lead with the reason it was filed where it was.
  const broad = (p) => p === 'G2-Screening' || p === 'G1P-Current';
  return [...seen.entries()]
    .sort(
      (a, b) =>
        Number(b[1].onTopic) - Number(a[1].onTopic) ||
        Number(broad(a[1].paper)) - Number(broad(b[1].paper))
    )
    .map(([name]) => name);
}

/** Groups items into the five sections, dropping the empty ones and keeping
 *  each section's items in the order they were handed over. */
function groupIntoSections(items) {
  const by = new Map(SECTIONS.map((s) => [s.key, []]));
  for (const item of items) by.get(sectionOf(item)).push(item);
  return SECTIONS.filter((s) => by.get(s.key).length).map((s) => ({ ...s, items: by.get(s.key) }));
}

module.exports = { SECTIONS, sectionOf, papersFor, groupIntoSections, PAPER_NAMES };
