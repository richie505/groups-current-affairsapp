'use strict';

// The deterministic relevance gate: no model, no API key.
//
// WHY THIS EXISTS ALONGSIDE THE MODEL GATE
//
// The model gate is better at the judgement this stage actually requires -
// "would APPSC ask about this" is a question about an exam's taste, and taste is
// what a model is for. But a lane whose only gate needs a key produces nothing
// at all without one, and a pipeline that cannot run today is not a pipeline.
//
// So this is the floor, not the ceiling. It is deliberately built out of signals
// that are cheap and checkable:
//
//   1. VETO   - the categories that make up the bulk of any edition and are
//               never examinable. Applied first, and absolute.
//   2. AP     - the strongest positive signal this exam has.
//   3. INSTRUMENT - does the story name a findable official act? A GO, a Bill,
//               a Cabinet decision, a report, an appointment, an allocation.
//   4. BLUEPRINT - the 424 keyword angles already seeded in ref_keywords, which
//               is the same vocabulary the Group-II lane tags items with.
//   5. PROMINENCE - the editor's own judgement, in points of headline size.
//
// Signal 4 is the one worth noting: it wires the newspaper lane straight into
// the blueprint keyword engine without a model in the path. A matched angle is
// carried through onto the candidate, so the drafting stage starts from
// "this looks like an Appointed / Committee / Index question" rather than from
// nothing.

const path = require('path');

// ---------------------------------------------------------------------------
// 1. veto
// ---------------------------------------------------------------------------

// A newspaper is mostly not examinable, and these are the categories that make
// up most of the bulk. A veto here is absolute: no accumulation of keyword hits
// rescues a robbery report, because the keywords it matched are incidental.
const VETO = [
  {
    label: 'local crime',
    // `booked` takes any preposition: the first version of this rule said
    // "booked under" and let "MP's son booked after mall employee knocked down
    // by car" straight through. Likewise `body ... retrieved` needs to span the
    // words between them ("Body of engineer's daughter retrieved").
    re: /\b(?:robbed|robbery|murder(?:ed)?|stabbed|arrest(?:ed|s)?|booked\b|remand(?:ed)?|absconding|kidnap(?:ped)?|molest|rape[ds]?|smuggl|seiz(?:ed|ure) of (?:ganja|liquor)|drowned|electrocuted|knocked down|road accident|died after|suicide|hooch)\b/i,
  },
  {
    label: 'death or recovery of a body',
    re: /\bbod(?:y|ies)\b[^.]{0,40}\b(?:retrieved|recovered|found|fished out)\b/i,
  },
  {
    label: 'weather report',
    re: /\b(?:morning showers|humid weather|light to moderate rain|maximum temperature|minimum temperature|heat wave conditions|brings? relief from)\b/i,
  },
  {
    label: 'personal engagement or commemoration',
    re: /\b(?:to attend (?:the )?wedding|wedding of|remembered on|birth anniversary|death anniversary|jayanti (?:was |celebrat)|paid (?:floral )?tributes)\b/i,
  },
  {
    label: 'civic complaint',
    re: /\b(?:pothole|garbage|open drain|sewage overflow|stray dog|power cut|water supply disrupt|encroachment|traffic jam|street light)\b/i,
  },
  {
    label: 'film, TV or celebrity',
    re: /\b(?:film|movie|cinema|actor|actress|heroine|director's next|box office|teaser|trailer|web series|serial|OTT|audio launch|pre-release)\b/i,
  },
  {
    label: 'ceremonial or promotional event',
    re: /\b(?:felicitat|condolence|obituary|passed away|inaugurat(?:ed|ion) of the (?:building|office|showroom)|awareness (?:programme|rally|walk)|blood donation camp|freshers|alumni meet|career guidance|seminar (?:on|was)|valedictory|fashion show|food festival)\b/i,
  },
  {
    label: 'festival logistics',
    re: /\b(?:darshan|queue (?:line|complex)|laddu|annaprasadam|crowd management|devotees (?:were|are) allowed|special buses (?:were|will be) run|toll|kalyanotsavam)\b/i,
  },
  {
    label: 'listings, weather or filler',
    re: /\b(?:horoscope|rashi|today's programmes|classifieds|tenders? invited|weather (?:forecast|update)|maximum temperature|letters to the editor)\b/i,
  },
];

// Sport is vetoed only when it is a match report. A governance, doping, policy or
// major-tournament story is genuinely examinable - the blueprint carries CWG and
// Olympics as keyword angles - so this is a narrower rule than the others.
const SPORT_MATCH_REPORT =
  /\b(?:beat|defeated|thrashed|drew with|won by \d+|innings|wicket|not out|runs off|goal(?:s)? in the|full-time|kick-off|set point|semifinal berth|lost to)\b/i;
const SPORT_EXEMPT =
  /\b(?:Olympic|Commonwealth Games|CWG|Asian Games|World Cup|doping|NADA|WADA|suspended for testing|sports policy|Khelo India|stadium (?:project|funding)|federation (?:election|dispute)|Sports Authority)\b/i;

// ---------------------------------------------------------------------------
// 2-3. positive signals
// ---------------------------------------------------------------------------

// Words that name a findable official act. This is the difference between
// "State to spend Rs 2,400 crore on irrigation, says Minister" - whose
// underlying order can be located and cited - and "Irrigation projects
// reviewed at meeting", which cannot.
const INSTRUMENT = [
  { w: 3, re: /\b(?:Government Order|G\.?O\.?\s?(?:Ms|Rt)?\.?\s?No|ordinance|gazette notification)\b/i, label: 'order or notification' },
  { w: 3, re: /\b(?:Bill|Act|amendment|Rules? (?:were |was )?notified|Section \d+|Article \d+)\b/, label: 'legislation' },
  { w: 3, re: /\b(?:Cabinet|CCEA|Council of Ministers)\b.{0,40}\b(?:approv|clear|decid|nod)/i, label: 'cabinet decision' },
  { w: 3, re: /\b(?:Supreme Court|High Court)\b.{0,60}\b(?:held|ruled|struck down|directed|stayed|upheld|judgment|verdict)/i, label: 'judgment' },
  { w: 3, re: /\b(?:appointed|sworn in|takes? charge as|designated as|nominated as)\b/i, label: 'appointment' },
  { w: 2, re: /\b(?:committee|commission|task force|panel)\b.{0,40}\b(?:constituted|set up|formed|headed by|chaired by|recommend)/i, label: 'committee' },
  { w: 2, re: /\b(?:report|survey|index|ranking|census|estimates?)\b.{0,30}\b(?:released|published|tabled|submitted)/i, label: 'report or index' },
  { w: 2, re: /\b(?:scheme|mission|yojana|programme)\b.{0,40}\b(?:launched|approved|extended|outlay|allocat)/i, label: 'scheme' },
  { w: 2, re: /\b(?:MoU|memorandum of understanding|agreement|treaty|summit|bilateral)\b/i, label: 'agreement or summit' },
  { w: 2, re: /\b(?:GI tag|geographical indication|Ramsar|biosphere reserve|tiger reserve|UNESCO|World Heritage)\b/i, label: 'designation' },
  { w: 2, re: /\b(?:budget|allocation|grant|deficit|tariff|GST|repo rate|MSP|subsidy)\b/i, label: 'fiscal instrument' },
  { w: 1, re: /(?:Rs\.?|₹)\s?[\d,.]+\s*(?:crore|lakh)\b/i, label: 'a figure' },
  { w: 1, re: /\b\d+(?:\.\d+)?\s*(?:per cent|percent|%)\b/i, label: 'a percentage' },
];

// Over-generic blueprint entries. Each is a real APPSC question angle, but as a
// text match it fires on nearly every article and so carries no information -
// "first" and "last" appear in any prose. Dropping them keeps the keyword signal
// discriminating rather than universal.
const KEYWORD_STOPLIST = new Set([
  'last', 'first', 'new', 'best', 'top', 'largest', 'highest', 'lowest',
  'longest', 'oldest', 'total', 'number', 'place', 'location', 'name',
  'year', 'day', 'state', 'city', 'district', 'area', 'people', 'group',
  // Institutions and offices that appear in nearly every Indian news article,
  // whatever it is about. Measured, not guessed: on the first rule-gated run
  // "Minister" was the matched angle for a weather report, a wedding and a
  // strike alike, so it separates nothing. They remain perfectly good APPSC
  // question angles - they are simply useless as a *filter* on a newspaper.
  'minister', 'chief minister', 'prime minister', 'president', 'india',
  'ministry', 'government', 'party', 'world', 'days', 'website', 'platform',
  'programme', 'policy', 'capital', 'council', 'defence', 'cases', 'report',
  'committee', 'commission', 'chairman', 'chairperson', 'commissioner',
  'secretary', 'officer', 'department', 'scheme', 'project', 'meeting',
]);

// The seeded angles, cleaned for matching. Slash-bundled entries
// ("Pollution/Air Quality/CPCB") are three separate terms, and anything short or
// stoplisted is dropped.
function loadKeywords(database) {
  const out = [];
  let rows = [];
  try {
    rows = database.prepare('SELECT keyword, subject FROM ref_keywords').all();
  } catch {
    return out;
  }
  // Splitting the slash-bundles means the same term can arrive twice - "Pollution"
  // is its own row and also the head of "Pollution/Air Quality/CPCB" - which
  // showed up as "angles: Pollution, Pollution" and double-counted the score.
  const seen = new Set();
  for (const r of rows) {
    for (const raw of String(r.keyword).split(/[/|]/)) {
      const term = raw.trim();
      if (term.length < 4) continue;
      if (KEYWORD_STOPLIST.has(term.toLowerCase())) continue;
      if (seen.has(term.toLowerCase())) continue;
      seen.add(term.toLowerCase());
      out.push({
        term,
        subject: r.subject,
        re: new RegExp(`\\b${term.replace(/[.*+?^${}()[\]\\]/g, '\\$&')}\\b`, 'i'),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// scoring
// ---------------------------------------------------------------------------

// Chosen so that an AP item naming an instrument clears the bar comfortably,
// while a national story needs either an instrument plus a blueprint angle or
// real prominence. Tuned against one real edition, which is honest but is one
// edition - raise it if the kept list reads thin, lower it if AP items are
// being missed.
const KEEP_AT = 6;

function score(event, keywords) {
  const text = `${event.headline} ${event.standfirst || ''} ${event.body}`;
  const head = `${event.headline} ${event.standfirst || ''}`;
  const why = [];
  let points = 0;

  // ---- veto ----
  for (const v of VETO) {
    if (v.re.test(head) || v.re.test(text.slice(0, 900))) {
      return { keep: false, score: 0, why: v.label, keywords: [], vetoed: v.label };
    }
  }
  if (SPORT_MATCH_REPORT.test(text.slice(0, 900)) && !SPORT_EXEMPT.test(text)) {
    return { keep: false, score: 0, why: 'sport match report', keywords: [], vetoed: 'sport' };
  }

  // ---- AP ----
  if (event.ap) {
    points += 4;
    why.push('AP');
  }

  // ---- instrument ----
  let instrument = 0;
  const instruments = [];
  for (const i of INSTRUMENT) {
    if (i.re.test(text)) {
      instrument += i.w;
      instruments.push(i.label);
    }
  }
  if (instrument > 6) instrument = 6;   // capped: naming five instruments is not five times the story
  points += instrument;
  if (instruments.length) why.push(instruments.slice(0, 3).join(' + '));

  // ---- blueprint angles ----
  //
  // An angle in the headline is what the story is *about*. The same word buried
  // in the body is usually incidental - every AP article mentions a Minister
  // somewhere - so a body-only hit is worth a fraction of a headline hit rather
  // than the same. Without this split, accumulating four incidental words was
  // enough to push a weather report over the bar.
  const hits = [];
  const body = text.slice(0, 1400);
  for (const k of keywords) {
    const inHead = k.re.test(head);
    if (inHead || k.re.test(body)) {
      hits.push({ ...k, inHead });
      if (hits.length >= 8) break;
    }
  }
  const headHits = hits.filter((h) => h.inHead);
  const anglePoints = Math.min(headHits.length * 1.5 + (hits.length - headHits.length) * 0.4, 6);
  points += anglePoints;
  if (headHits.length) {
    why.push(`headline angles: ${headHits.slice(0, 4).map((h) => h.term).join(', ')}`);
  } else if (hits.length) {
    why.push(`incidental angles only: ${hits.slice(0, 3).map((h) => h.term).join(', ')}`);
  }

  // ---- prominence ----
  const prom = Math.min(event.prominence || 0, 6) * 0.5;
  points += prom;

  return {
    keep: points >= KEEP_AT,
    score: Math.round(points * 10) / 10,
    why: why.join('; ') || 'no examinable signal',
    keywords: hits.map((h) => ({ term: h.term, subject: h.subject })),
    vetoed: null,
  };
}

/**
 * Judges every event. Returns a Map of index -> verdict, in the same shape the
 * model gate produces, so paper.js needs no second code path.
 */
function gateByRules(events, opts = {}) {
  let keywords = [];
  try {
    const database = opts.db || require(path.join(__dirname, '..', 'ca-daily', 'lib')).db();
    keywords = loadKeywords(database);
  } catch (e) {
    // The blueprint signal is a bonus, not a dependency. Without the database
    // the gate still runs on veto, AP, instrument and prominence - say so
    // rather than silently scoring everything lower.
    opts.onWarn?.(`ref_keywords unavailable (${e.message}); scoring without blueprint angles`);
  }

  const scored = events.map((e, i) => ({ i, ...score(e, keywords) }));

  // The cap bites the lowest scores, not an arbitrary slice, and AP items are
  // protected: every one that clears the bar is kept even if that means going
  // past the cap. A minor AP item is worth more to this exam than a major
  // national one, and the cap exists to limit drafting cost rather than to
  // enforce a quota.
  const keptAll = scored.filter((s) => s.keep).sort((a, b) => b.score - a.score);
  const max = opts.maxItems || 12;
  const kept = new Set();
  for (const s of keptAll) {
    if (kept.size < max || events[s.i].ap) kept.add(s.i);
  }

  const verdicts = new Map();
  for (const s of scored) {
    verdicts.set(s.i, {
      n: s.i + 1,
      keep: kept.has(s.i),
      ap: !!events[s.i].ap,
      why: kept.has(s.i)
        ? `[${s.score}] ${s.why}`
        : s.vetoed
          ? s.why
          : `below bar (${s.score} < ${KEEP_AT}): ${s.why}`,
      duplicate_of: null,
      // A newspaper report of a figure has not been seen in an official
      // document, so anything carrying a number needs one. Same default as the
      // model gate.
      needs_lookup: /\d/.test(`${events[s.i].headline} ${events[s.i].body.slice(0, 600)}`),
      keywords: s.keywords,
      score: s.score,
    });
  }
  return verdicts;
}

module.exports = {
  gateByRules, score, loadKeywords,
  VETO, INSTRUMENT, KEEP_AT,
  // Exported so the relevance scorer applies the SAME sport rule rather than a
  // second copy of it. Importing VETO alone let a school archery tournament
  // score 62/HIGH, because the sport test lives here and not in VETO.
  SPORT_MATCH_REPORT, SPORT_EXEMPT,
};
