'use strict';

// Section 2 — the APPSC relevance score.
//
//   A. Syllabus relevance      30
//   B. PYQ keyword match       20
//   C. Andhra Pradesh          20
//   D. Current importance      15
//   E. Cross-paper reuse       15
//                             ---
//                             100
//
//   80-100 CRITICAL   60-79 HIGH   40-59 MEDIUM   below 40 LOW
//
// WHY EVERY SCORE CARRIES ITS BREAKDOWN
//
// Because a number nobody can decompose is a number nobody trusts. The first
// question anyone asks about "62 / HIGH" is which part came from where, and if
// that cannot be answered the score gets ignored and the list goes back to being
// read top to bottom. So `score()` returns the five components and the reason
// each one fired, and the caller stores them.
//
// It also means the weights are testable. They are a judgement — 30 for syllabus
// against 20 for AP is an opinion about this exam — and an opinion that can be
// re-run over past articles can be corrected. One that only exists as a total
// cannot.
//
// WHY IT IS DETERMINISTIC
//
// Because it runs on every article of every edition — 118 of them for one day's
// paper — and it must be free, repeatable, and explainable. A model asked to
// score relevance gives a different answer to the same article on Tuesday, which
// makes "why did this drop out of today's list" unanswerable.
//
// THE VETO COMES FIRST
//
// A robbery in Nandyal mentions an AP district, names a police officer, and
// matches the 'Arrested' angle: it would score in the forties on the factors
// alone. So the categories that are never examinable are excluded before any
// scoring happens, rather than being outvoted by it.

const path = require('path');

const T = require('./topics');
const { VETO, INSTRUMENT, SPORT_MATCH_REPORT, SPORT_EXEMPT } = require(
  path.join(__dirname, '..', '..', '..', 'content-pipeline', 'np-daily', 'gate-rules')
);
const G = require(path.join(__dirname, '..', '..', '..', 'content-pipeline', 'np-daily', 'genre'));

let AP_TERMS = [];
try {
  ({ AP_TERMS } = require(
    path.join(__dirname, '..', '..', '..', 'content-pipeline', 'ca-daily', 'sweep')
  ));
} catch {
  AP_TERMS = ['andhra', 'amaravati', 'visakhapatnam', 'vijayawada', 'tirupati'];
}

const WEIGHTS = { syllabus: 30, pyq: 20, ap: 20, importance: 15, reuse: 15 };
const BANDS = [
  [80, 'critical'],
  [60, 'high'],
  [40, 'medium'],
  [0, 'low'],
];

function bandFor(score) {
  return (BANDS.find(([min]) => score >= min) || [0, 'low'])[1];
}

// ---------------------------------------------------------------------------
// the four buckets (spec section 6)
// ---------------------------------------------------------------------------

// Requires India-as-party framing, not merely a country name. The first version
// listed bare country names and filed "Collectors empowered to grant citizenship
// under CAA" as international, because a CAA story naturally mentions Pakistan
// and Bangladesh. A country appearing in a story is not the story being about
// that country.
const INTERNATIONAL =
  /\b(?:United Nations|UNESCO|UNICEF|WTO|G20|G7|BRICS|ASEAN|QUAD|COP\d+|bilateral|multilateral|summit|treaty|foreign minister|external affairs|ambassador|diplomatic|envoy)\b|\bIndia\s*(?:[-–—]|and)\s*[A-Z][a-z]+\b/;
const NATIONAL = /\b(?:Union Cabinet|Parliament|Lok Sabha|Rajya Sabha|Supreme Court|Centre|Government of India|Union Minister|Ministry of|RBI|NITI Aayog|Election Commission|CAG|President of India)\b/i;

// 'dynamic' is the fast-changing edge of another subject — a fresh GI tag, a new
// index rank, a rate decision. It is current affairs by recency, but its home is
// Economy or Environment rather than Current Affairs, which is exactly the
// distinction the Group-II bucket scheme draws.
const DYNAMIC = /\b(?:GI tag|index|ranking|rank\b|repo rate|inflation|GDP|growth rate|survey|census|report released|data released|tiger reserve|Ramsar|biosphere|launch(?:ed)? (?:of )?(?:a )?satellite|mission)\b/i;

const SUBJECT_HINTS = [
  ['Polity', /\b(?:Constitution|Article \d+|Amendment|Parliament|Assembly|judiciary|Supreme Court|High Court|Governor|federalism|Panchayat|municipal|writ|Bill|Act\b)/i],
  ['Economy', /\b(?:GDP|inflation|repo|fiscal|deficit|budget|tax|GST|MSME|industry|investment|export|import|bank|subsidy|MSP|crore|lakh crore)/i],
  ['Geography', /\b(?:river|monsoon|rainfall|drought|cyclone|soil|mineral|coast|forest cover|landform|irrigation|canal|dam)/i],
  ['Environment', /\b(?:pollution|emission|climate|biodiversity|wildlife|conservation|Ramsar|tiger|ecosystem|CPCB|environmental clearance)/i],
  ['Science & Technology', /\b(?:ISRO|satellite|space|vaccine|AI|artificial intelligence|semiconductor|nuclear|research|DRDO|biotechnology|quantum)/i],
  ['Society', /\b(?:caste|tribal|women|SC\/ST|literacy|education|health|poverty|migration|urbanisation|welfare|reservation)/i],
  ['AP History', /\b(?:Satavahana|Kakatiya|Vijayanagara|Ikshvaku|Qutb Shahi|Reddi|Telugu literature|inscription|dynasty)/i],
  ['Indian History', /\b(?:freedom struggle|Gandhi|Nehru|colonial|British rule|revolt|independence movement|Mughal|Maurya)/i],
];

// How many distinct signals of each kind the text carries. Counted rather than
// merely detected, because a single passing word is not evidence of what a story
// is ABOUT.
//
// A strict precedence — any international token beats every national one — put a
// Supreme Court opinion on Indian environmental clearances into the
// 'international' bucket on the strength of one occurrence of "multilateral",
// and an Indian fiscal-outlook piece there on "India and West". Measured over
// the 21 August edition: 9 articles bucketed international, 2 of them wrongly,
// and both had a clear domestic anchor ("Supreme Court", "Centre") sitting in
// the same text.
const countOf = (re, text) => (text.match(new RegExp(re.source, re.flags + 'g')) || []).length;

// Another country's internal affairs, with no Indian thread in the story at all.
//
// WHY THIS EXISTS
//
// A master-topic match assumes the topic is the INDIAN institution of that name.
// "Imran Khan shifted back to jail after medical check-up" matched the Tier-1
// topic "Supreme Court and judicial review" on the words "Supreme Court", and
// picked up the angles "Institute" (from Pakistan Institute of Medical Sciences)
// and "Prime Minister" (from "Former Prime Minister"). Every match was real text
// and every one was spurious. It took 30/30 on the largest factor and reached
// 59 — ahead of an AP medical-infrastructure spend at 47, a Supreme Court
// comment on MGNREGA at 50 and an NGT floodplain case at 50.
//
// DAMPED, NOT VETOED. A foreign story with an Indian thread is examinable and
// often important — India-Japan pacts, a neighbour's politics that bears on
// India — so this only withdraws the TOPIC-derived part of the syllabus score,
// which is the part that was measuring the wrong country. Subject territory
// still counts, and every other factor is untouched.
//
// The test requires a foreign name in the HEADLINE and no Indian term anywhere
// in the article. Measured over both editions: 6 of 169 articles flagged, all
// genuinely foreign-domestic, and "India, Japan sign maritime security pact",
// "Rashtrapati Bhavan withdraws email on Bangladesh PM visit" and "Structures
// outside Pakistan embassy pulled down in Delhi" were all correctly spared.
const FOREIGN_NAME =
  /\b(?:Pakistan|Pakistani|Bangladesh|Sri Lanka|Nepal|Myanmar|Afghanistan|Iran|Iraq|Israel|Palestin\w*|Ukraine|Russia|Russian|China|Chinese|Beijing|Taiwan|Japan|Japanese|Korea|Vietnam|Indonesia|Malaysia|Thailand|Turkey|Egypt|Nigeria|Kenya|Brazil|Argentina|Mexico|Venezuela|Cuba|Canada|Australia|Britain|British|United Kingdom|France|French|Germany|German|Italy|Spain|Netherlands|Sweden|Norway|Poland|Greece|Washington|Moscow|Islamabad|Dhaka|Kathmandu|Colombo|Kabul|Tehran|Gaza|Imran Khan|Trump|Putin|Xi Jinping|Netanyahu|Zelensky\w*)\b/i;
const INDIA_TERM =
  /\b(?:India|Indian|Bharat|Andhra|Telangana|Amaravati|Vijayawada|Visakhapatnam|Tirupati|Delhi|Mumbai|Chennai|Kolkata|Bengaluru|Kerala|Karnataka|Tamil Nadu|Maharashtra|Gujarat|Rajasthan|Bihar|Odisha|Jharkhand|Assam|Punjab|Haryana|Centre|Union Government|Parliament|Lok Sabha|Rajya Sabha|RBI|NITI Aayog|Supreme Court of India)\b/i;

function bucketOf({ text, ap }) {
  // AP wins over everything else. A story that is both national and about Andhra
  // Pradesh belongs in the AP bucket, because AP is the axis this exam turns on
  // and burying it under 'national' is how it stops being read.
  if (ap) return 'ap';
  // International has to out-signal the domestic reading, not merely appear in
  // it. A tie goes to 'national': this is a State exam, and a story carrying
  // equal evidence of both is far more often a domestic story with a foreign
  // reference than the reverse. Verified against the edition — the seven
  // genuinely international stories all carried zero national tokens, so none of
  // them is affected by this.
  if (INTERNATIONAL.test(text) && countOf(INTERNATIONAL, text) > countOf(NATIONAL, text)) {
    return 'international';
  }
  if (DYNAMIC.test(text) && !NATIONAL.test(text)) return 'dynamic';
  if (NATIONAL.test(text)) return 'national';
  return DYNAMIC.test(text) ? 'dynamic' : 'national';
}

function subjectsOf(text) {
  return SUBJECT_HINTS.filter(([, re]) => re.test(text)).map(([name]) => name);
}

// ---------------------------------------------------------------------------
// vocabularies, loaded once per scoring run
// ---------------------------------------------------------------------------

const KEYWORD_STOPLIST = new Set([
  'last', 'first', 'new', 'best', 'top', 'largest', 'highest', 'lowest', 'longest',
  'oldest', 'total', 'number', 'place', 'location', 'name', 'year', 'day', 'state',
  'city', 'district', 'area', 'people', 'group', 'india', 'government', 'minister',
  'president', 'world', 'ministry', 'party', 'days', 'website', 'platform',
  'programme', 'policy', 'capital', 'council', 'defence', 'cases', 'report',
  'committee', 'commission', 'chairman', 'chairperson', 'commissioner',
  'secretary', 'officer', 'department', 'scheme', 'project', 'meeting',
]);

// EVERY published syllabus that carries match vocabulary, as one list.
//
// Loaded once per scoring pass and reused across every article, because the
// alternative is compiling 489 regular expressions 121 times for one edition.
//
// Group-II and Group-I PRELIMS both, and any syllabus added later without this
// function changing: the query asks for units that have aliases, not for an exam
// by name. The Group-I MAINS map has no aliases — it is reached through the
// master topics — so it is absent here without being excluded.
//
// `broad` and `unfeedable` units are excluded rather than filtered later, so
// nothing downstream can accidentally count them. See scripts/g2-syllabus.js:
// a 30-mark current-affairs paper matches every newspaper article ever printed,
// which makes it evidence of nothing at all.
function loadSyllabusUnits(db) {
  let rows = [];
  try {
    rows = db
      .prepare(
        // `standalone` decides whether ONE mention of this alias is enough to
        // carry the unit — see the third clause of the evidence filter below,
        // and server/scripts/backfill-alias-standalone.js for how it is set.
        // COALESCE so a database that predates the column still scores.
        `SELECT a.unit_code, a.alias, a.strict,
                COALESCE(a.standalone, 0) AS standalone,
                u.label, u.paper, u.exam, u.format
           FROM ref_unit_aliases a
           JOIN ref_units u ON u.unit_code = a.unit_code
          WHERE u.broad = 0 AND u.unfeedable = 0`
      )
      .all();
  } catch {
    // An older database without the syllabus map still scores, on topics alone.
    return [];
  }
  return rows.map((r) => ({ ...r, matcher: T.aliasMatcher(r.alias, !!r.strict) }));
}

function loadContext(db) {
  const keywords = [];
  const seen = new Set();
  for (const r of db.prepare('SELECT keyword, subject FROM ref_keywords').all()) {
    for (const raw of String(r.keyword).split(/[/|]/)) {
      const term = raw.trim();
      if (term.length < 4) continue;
      const low = term.toLowerCase();
      if (KEYWORD_STOPLIST.has(low) || seen.has(low)) continue;
      seen.add(low);
      keywords.push({
        term,
        subject: r.subject,
        re: new RegExp(`\\b${term.replace(/[.*+?^${}()[\]\\]/g, '\\$&')}\\b`, 'i'),
      });
    }
  }

  // How often each angle has actually been asked. This is what turns factor B
  // from "matches a word on a list" into "matches an angle the commission keeps
  // returning to".
  const pyqCount = new Map();
  try {
    for (const r of db
      .prepare(
        `SELECT k.keyword, COUNT(*) AS n FROM pyq_question_keywords k
           JOIN pyq_questions q ON q.id = k.question_id
          GROUP BY k.keyword`
      )
      .all()) {
      pyqCount.set(r.keyword.toLowerCase(), r.n);
    }
  } catch {
    // No PYQ corpus yet; factor B falls back to a plain keyword match.
  }

  // Papers each topic is known to serve, for factor E.
  //
  // MEASURED FROM THE OBJECTIVE SYLLABUS, NOT FROM A BLUEPRINT.
  //
  // This used to read `topic_evidence`, which held one person's reading of the
  // Group-I MAINS papers. That was the only source of factor E, so when the
  // Mains layer was removed the factor would have silently gone to zero for
  // every article — 15 of the 100 points, vanishing with nothing to say so.
  //
  // The honest replacement is the reuse the objective papers actually show:
  // a topic inherits the units of every item that names it (`topic_units`),
  // and those units carry the paper they belong to. Counting DISTINCT papers
  // across Group-I Prelims and Group-II answers the same question the
  // blueprint was being asked — "does studying this pay in more than one
  // place?" — from this app's own evidence rather than from a document.
  const topicPapers = new Map();
  try {
    for (const r of db
      .prepare(
        `SELECT tu.topic_id, COUNT(DISTINCT u.paper) AS papers
           FROM topic_units tu
           JOIN ref_units u ON u.unit_code = tu.unit_code
          WHERE u.paper <> '' AND u.unfeedable = 0 AND u.broad = 0
          GROUP BY tu.topic_id`
      )
      .all()) {
      topicPapers.set(r.topic_id, r.papers);
    }
  } catch {
    // No derived reuse map yet — factor E simply does not fire.
  }

  const topicTier = new Map(
    db.prepare('SELECT id, tier, ap FROM topics').all().map((r) => [r.id, r])
  );

  return {
    keywords, pyqCount, topicPapers, topicTier,
    aliases: T.loadAliases(db),
    g2Units: loadSyllabusUnits(db),
  };
}

// ---------------------------------------------------------------------------
// the score
// ---------------------------------------------------------------------------

/**
 * Scores one article. Pure: same input, same output, no model, no clock.
 *
 * Returns { score, band, bucket, subjects, breakdown, keywords, topics, vetoed }.
 */
function score(article, ctx) {
  const headline = `${article.headline || ''} ${article.standfirst || ''}`;
  const body = String(article.body || '');
  const text = `${headline} ${body}`;
  const head = headline;

  const ap =
    article.ap != null
      ? !!article.ap
      : AP_TERMS.some((t) => `${text} ${article.dateline || ''}`.toLowerCase().includes(t));

  const breakdown = {};
  const notes = [];

  // ---- veto ----
  //
  // Some pieces are not events at all, whatever they score.
  //
  // Letters to the editor are readers' opinions; the archive columns ("A HUNDRED
  // YEARS AGO", "FROM THE ARCHIVES") are reprints of copy a century old. Both
  // read as perfectly plausible current-affairs prose and both would score on
  // the ordinary signals — the 21 August archive column is about Calcutta's
  // foreign trade, names an instrument, carries a figure and reads like a
  // business report from 1926, which is exactly what it is.
  //
  // This is a veto rather than a penalty because no score is the right score
  // here. The question "how examinable is this?" does not apply to a document
  // that is not a record of anything current.
  if (G.isNonEvent(article.genre)) {
    const label = G.labelOf(article.genre).toLowerCase();
    return {
      score: 0, band: 'low', bucket: bucketOf({ text, ap }), subjects: [],
      breakdown: { vetoed: label }, keywords: [], topics: [],
      vetoed: label, why: `excluded: ${label} — not a report of a current event`,
    };
  }

  // Sport is tested separately from the veto list because the rule is narrower:
  // a match report is not examinable, but doping, governance, a major tournament
  // or a sports policy question is, and the blueprint carries CWG and Olympics as
  // angles. Omitting this check let a CBSE archery tournament reach 62/HIGH.
  if (SPORT_MATCH_REPORT.test(text) && !SPORT_EXEMPT.test(text)) {
    return {
      score: 0, band: 'low', bucket: bucketOf({ text, ap }), subjects: [],
      breakdown: { vetoed: 'sport match report' }, keywords: [], topics: [],
      vetoed: 'sport match report', why: 'excluded: sport match report',
    };
  }
  // A tournament or championship ANNOUNCEMENT is not a match report and so slips
  // past the rule above, while being just as unexaminable.
  if (/\b(?:tourney|tournament|championship|meet|league)\b/i.test(head) && !SPORT_EXEMPT.test(text)) {
    return {
      score: 0, band: 'low', bucket: bucketOf({ text, ap }), subjects: [],
      breakdown: { vetoed: 'sports event announcement' }, keywords: [], topics: [],
      vetoed: 'sports event announcement', why: 'excluded: sports event announcement',
    };
  }
  for (const v of VETO) {
    if (v.re.test(head) || v.re.test(body.slice(0, 900))) {
      return {
        score: 0,
        band: 'low',
        bucket: bucketOf({ text, ap }),
        subjects: [],
        breakdown: { vetoed: v.label },
        keywords: [],
        topics: [],
        vetoed: v.label,
        why: `excluded: ${v.label}`,
      };
    }
  }

  // ---- topics, needed by A and E ----
  const matched = T.matchItem(
    { headline: head, notes_markdown: body },
    ctx.aliases
  ).filter((m) => (m.in_headline ? m.hits >= 1 : m.hits >= 2));

  // ---- A. syllabus relevance (30) ----
  //
  // Earned by connecting to the syllabus in a way something downstream can use:
  // a known master topic, or recognisable subject territory. A headline topic is
  // worth more than a body mention, because it is what the article is about.
  const subjects = subjectsOf(text);
  const headTopic = matched.some((m) => m.in_headline);
  // See FOREIGN_NAME above. A topic match in a story about another country's
  // internal affairs is naming the wrong country's institution, so the
  // topic-derived tiers are withheld and subject territory carries the factor.
  const foreignDomestic = !ap && FOREIGN_NAME.test(head) && !INDIA_TERM.test(text);
  let syllabus = 0;
  if (foreignDomestic) {
    if (subjects.length >= 2) {
      syllabus = 12;
      notes.push(`foreign domestic story; syllabus territory only: ${subjects.slice(0, 3).join(', ')}`);
    } else if (subjects.length === 1) {
      syllabus = 7;
      notes.push(`foreign domestic story; syllabus territory only: ${subjects[0]}`);
    } else {
      notes.push('foreign domestic story with no Indian thread');
    }
  } else if (headTopic) {
    syllabus = 30;
    notes.push('names a known topic in the headline');
  } else if (matched.length) {
    syllabus = 18;
    notes.push('mentions a known topic');
  } else if (subjects.length >= 2) {
    syllabus = 12;
    notes.push(`syllabus territory: ${subjects.slice(0, 3).join(', ')}`);
  } else if (subjects.length === 1) {
    syllabus = 7;
    notes.push(`syllabus territory: ${subjects[0]}`);
  }
  // A Tier-1 topic is the syllabus at its most concentrated, so it tops the
  // factor out rather than merely contributing to it.
  const tier1 = !foreignDomestic && matched.some((m) => ctx.topicTier.get(m.topic_id)?.tier === 1);
  if (tier1 && syllabus < 30) {
    syllabus = 30;
    notes.push('Tier-1 topic');
  }
  // ---- A2. the Group-II syllabus ----
  //
  // Factor A above asks "does this touch a master topic?", and the master topics
  // were built from the Group-I map. So an article could serve Group II
  // perfectly, match no Group-I topic, and score as though it served nobody —
  // and, worse, an article that served NEITHER exam scored the same as one that
  // served Group II alone. That is the shape of the filler problem: the scorer
  // had no way to say "this is on nobody's syllabus".
  //
  // The units matched are recorded whatever the score, because the drafter needs
  // them (it should write to the unit APPSC actually examines) and the admin
  // needs them (a list of articles with no unit between them is a list to skip).
  // THE HEADLINE AND THE STANDFIRST ARE SEPARATED HERE, and only here.
  //
  // `head` above is headline + standfirst, which is right for keyword and
  // topic matching — a standfirst is prominent text and a term in it is worth
  // more than one buried in paragraph nine. It is wrong for the unit filter,
  // whose strongest clause is "named in the headline". On this paper the
  // standfirst is frequently a whole paragraph and on one advertisement it was
  // the ad copy, so that clause was being satisfied by 200 characters of prose
  // — which is how `stock exchange` came to be a headline hit on an article
  // headed "Trade scam or supply chain play? Profit in transit".
  //
  // So the unit loop reads the headline alone as the headline, and treats the
  // standfirst as body evidence: it still contributes a distinct term to the
  // two-terms clause, it simply cannot carry a unit by itself.
  //
  // Kept local rather than changing `head`, because `head` is also what the
  // keyword and topic matchers read and their flags mean something different.
  // np_article_keywords.in_headline has the same conflation and is a separate
  // decision.
  const unitHead = String(article.headline || '');
  const unitStand = String(article.standfirst || '');

  const g2Hits = [];
  for (const u of ctx.g2Units || []) {
    const inHead = u.matcher.test(unitHead, T.norm(unitHead));
    const inStand = u.matcher.test(unitStand, T.norm(unitStand));
    const inBody = u.matcher.test(body, T.norm(body));
    if (!inHead && !inStand && !inBody) continue;
    const found = g2Hits.find((h) => h.unit_code === u.unit_code);
    if (found) {
      found.hits += 1;
      found.in_headline = found.in_headline || (inHead ? 1 : 0);
      found.in_standfirst = found.in_standfirst || (inStand ? 1 : 0);
      // Tracked on every alias regardless of the four-term display cap: a
      // standalone alias that happens to be the fifth match still counts.
      found.standalone = found.standalone || !!u.standalone;
      if (found.matched.length < 4) found.matched.push(u.alias);
    } else {
      g2Hits.push({
        unit_code: u.unit_code, label: u.label, paper: u.paper,
        exam: u.exam, format: u.format,
        hits: 1,
        in_headline: inHead ? 1 : 0,
        in_standfirst: inStand ? 1 : 0,
        standalone: !!u.standalone,
        matched: [u.alias],
      });
    }
  }
  // Strongest first: a unit named in the headline, then one with more distinct
  // terms behind it. A single body mention of "hospital" is not a health-policy
  // article, and the ordering is what lets a caller take the top two and be
  // right most of the time.
  g2Hits.sort((a, b) => b.in_headline - a.in_headline || b.matched.length - a.matched.length || b.hits - a.hits);

  // WHAT COUNTS AS EVIDENCE, measured rather than assumed.
  //
  // The first version scored any match at all, and on a real edition it raised
  // "Woman dies in lift accident" from 20 to 30 on the word `hospital`, and a
  // Ukraine war report from 19 to 30 on `missile`. One passing noun is not a
  // syllabus connection; it is the same failure as a unit tag that lands on
  // three quarters of the corpus.
  //
  // So a unit must be NAMED IN THE HEADLINE, or reached by two DISTINCT terms in
  // the body, or reached by one term SPECIFIC enough to stand alone.
  //
  // That last clause is the one that took a second pass. Requiring two terms
  // read "YSRCP disrupts proceedings in Council" as off-syllabus, because the
  // body says "Legislative Council" once and says it exactly right. The
  // distinction that matters is not how often a term appears but how much work
  // it does.
  //
  // A SPACE WAS THE WRONG TEST FOR THAT, measured on 40 random tags in
  // docs/audits/2026-09-05-paper-mapping/. Precision came out at 72.5%, and
  // this clause was seven of the eleven errors: `human rights` from a quote
  // about an extradition, `good governance` on a SEBI framework, `stock
  // exchange` from "New York Stock Exchange", `population density` on a
  // highway land dispute, `renewable energy` on industrial parks, `artificial
  // intelligence` on a robotic dog, `Legislative Assembly` on the place a
  // fertiliser figure was read out. Every one of them contains a space.
  //
  // It failed in the other direction at the same time, which is what makes it
  // one fault rather than two. 415 aliases have no space and so could never
  // qualify — UPSC, SEBI, IRDAI, NHRC, ASEAN, BRICS, SAARC, AMRUT, MGNREGA. A
  // report on the BRICS Youth Ministers' Meeting was left with no unit at all.
  //
  // So specificity is now recorded per alias rather than inferred from its
  // punctuation. See server/scripts/backfill-alias-standalone.js, which holds
  // the decision and can be re-run after a reseed.
  const solid = g2Hits.filter((h) => h.in_headline || h.matched.length >= 2 || h.standalone);

  // The same foreign-domestic guard factor A already applies. A war report
  // naming a missile is not Indian defence technology, and letting the Group-II
  // map in through the side door would undo a fix that is already made above.
  if (solid.length && !foreignDomestic && syllabus < 18) {
    const headUnit = solid.some((h) => h.in_headline);
    // Never above what a Group-I topic match earns. The two syllabi overlap
    // heavily, and paying twice for one sentence inflates everything equally,
    // which is the same as paying for nothing.
    const gained = headUnit ? 18 : 12;
    if (gained > syllabus) {
      syllabus = gained;
      notes.push(
        `Group-II syllabus: ${solid.slice(0, 2).map((h) => h.unit_code).join(', ')}` +
          `${headUnit ? ' (in the headline)' : ''}`
      );
    }
  }

  // THE ANSWER THE ADMIN ACTUALLY WANTS.
  //
  // Not "how relevant is this" but "is this on anybody's syllabus at all". An
  // article that names no master topic, no Group-II unit and no past-question
  // angle is filler however many AP place names it happens to contain — and
  // until now nothing in the score said so, because every factor measured a
  // presence and none measured the absence.
  const offSyllabus = !solid.length && !matched.length;
  if (offSyllabus) notes.push('touches no unit of either syllabus');
  breakdown.syllabus = { score: syllabus, max: WEIGHTS.syllabus };
  // Solid matches first, so a reader of the breakdown sees what was counted.
  breakdown.g2_units = solid.slice(0, 6).map((h) => h.unit_code);
  breakdown.off_syllabus = offSyllabus ? 1 : 0;

  // ---- B. PYQ keyword match (20) ----
  const kwHits = [];
  for (const k of ctx.keywords) {
    const inHead = k.re.test(head);
    if (inHead || k.re.test(body.slice(0, 1400))) {
      kwHits.push({ ...k, in_headline: inHead ? 1 : 0, pyq: ctx.pyqCount.get(k.term.toLowerCase()) || 0 });
      if (kwHits.length >= 8) break;
    }
  }
  // An angle the commission has asked before is worth more than one it has not,
  // which is the whole reason the PYQ layer exists.
  const asked = kwHits.filter((k) => k.pyq > 0);
  let pyq = 0;
  if (asked.length) {
    pyq = Math.min(20, 8 + asked.length * 4);
    notes.push(`recurring angle(s): ${asked.slice(0, 3).map((k) => k.term).join(', ')}`);
  } else if (kwHits.some((k) => k.in_headline)) {
    pyq = 8;
    notes.push(`blueprint angle in headline: ${kwHits.find((k) => k.in_headline).term}`);
  } else if (kwHits.length) {
    pyq = 4;
  }
  breakdown.pyq = { score: pyq, max: WEIGHTS.pyq };

  // ---- C. Andhra Pradesh (20) ----
  //
  // Full marks for an AP story, and the dateline counts: a story filed from
  // AMALAPURAM is an AP story even when its text never names the State. Half
  // marks where a topic is AP-specific but the article reads as national, which
  // is how a Centre decision about Polavaram scores.
  let apScore = 0;
  if (ap) {
    apScore = 20;
    notes.push(article.dateline ? `AP (filed from ${article.dateline})` : 'Andhra Pradesh');
  } else if (matched.some((m) => ctx.topicTier.get(m.topic_id)?.ap)) {
    apScore = 10;
    notes.push('touches an AP topic');
  }
  breakdown.ap = { score: apScore, max: WEIGHTS.ap };

  // ---- D. current importance (15) ----
  //
  // Does it name a findable official act? This is the difference between a
  // decision that can be cited and a meeting that was held.
  const instruments = INSTRUMENT.filter((i) => i.re.test(text));
  const rawWeight = instruments.reduce((s, i) => s + i.w, 0);
  const importance = Math.min(WEIGHTS.importance, Math.round(rawWeight * 2.5));
  if (instruments.length) {
    notes.push(`names: ${instruments.slice(0, 3).map((i) => i.label).join(', ')}`);
  }
  breakdown.importance = { score: importance, max: WEIGHTS.importance };

  // ---- E. cross-paper reuse (15) ----
  // RESCALED WHEN THE EVIDENCE MOVED FROM FIVE PAPERS TO TEN.
  //
  // These thresholds were set against the Group-I Mains blueprint, which spans
  // five papers — so "4 or more" meant a topic covering 80% of them. The
  // objective syllabi span ten feedable papers between them, and leaving the
  // numbers alone would have quietly redefined a full 15 as 40% breadth.
  //
  // The measured effect of the rescale is small — mean score 31.7 to 31.3
  // across 411 articles, and 3 articles leaving the 70+ band — because the
  // factor fires on 75 articles at all. It is done anyway: a threshold that no
  // longer means what its comment says is how a score stops being trusted.
  let reuse = 0;
  const papers = Math.max(0, ...matched.map((m) => ctx.topicPapers.get(m.topic_id) || 0));
  if (papers >= 6) reuse = 15;
  else if (papers >= 4) reuse = 12;
  else if (papers === 3) reuse = 8;
  else if (papers === 2) reuse = 4;
  if (papers >= 2) notes.push(`reusable across ${papers} papers`);
  breakdown.reuse = { score: reuse, max: WEIGHTS.reuse };

  const total = syllabus + pyq + apScore + importance + reuse;

  return {
    score: Math.round(total),
    band: bandFor(total),
    bucket: bucketOf({ text, ap }),
    subjects,
    breakdown,
    keywords: kwHits,
    topics: matched,
    g2_units: solid,
    g2_weak: g2Hits.filter((h) => !solid.includes(h)),
    off_syllabus: offSyllabus,
    vetoed: null,
    why: notes.join('; ') || 'no examinable signal',
  };
}

// ---------------------------------------------------------------------------
// entity extraction
// ---------------------------------------------------------------------------

// Deliberately conservative patterns. A wrong entity is worse than a missing
// one here, because entities are used to link articles to each other and a bad
// link is read as a fact about the world.
const ORG_SUFFIX = /\b((?:[A-Z][A-Za-z&.]*\s+){1,5}(?:Authority|Commission|Corporation|Ministry|Department|Board|Council|Tribunal|Committee|Institute|University|Agency|Bank|Federation|Devasthanams?))\b/g;
const ACRONYM = /\b([A-Z]{3,7})\b/g;
const SCHEME = /\b((?:[A-Z][A-Za-z]*\s+){0,4}(?:Yojana|Mission|Abhiyan|Scheme|Programme|Act|Bill|Code|Policy))\b/g;
const PERSON = /\b(?:Mr\.|Ms\.|Mrs\.|Dr\.|Justice|Minister|Chief Minister|Governor|President)\s+([A-Z][A-Za-z.]*(?:\s+[A-Z][A-Za-z.]*){0,3})/g;

const ACRONYM_STOP = new Set([
  'THE', 'AND', 'FOR', 'WITH', 'THAT', 'THIS', 'FROM', 'WILL', 'SAID', 'NOT',
  'ALL', 'NEW', 'ONE', 'TWO', 'PDF', 'IST', 'AM', 'PM', 'OCR',
]);

function extractEntities(article) {
  const text = `${article.headline || ''} ${article.standfirst || ''} ${article.body || ''}`;
  const found = new Map();

  const add = (kind, name) => {
    const clean = String(name || '').replace(/\s+/g, ' ').trim();
    if (clean.length < 3 || clean.length > 70) return;
    const key = `${kind}::${clean}`;
    found.set(key, { kind, name: clean, mentions: (found.get(key)?.mentions || 0) + 1 });
  };

  for (const m of text.matchAll(ORG_SUFFIX)) add('organisation', m[1]);
  for (const m of text.matchAll(SCHEME)) add('scheme', m[1]);
  for (const m of text.matchAll(PERSON)) add('person', m[1]);
  for (const m of text.matchAll(ACRONYM)) {
    if (!ACRONYM_STOP.has(m[1])) add('organisation', m[1]);
  }

  // Places come from the AP list plus the dateline, which is the one place name
  // the paper itself has already identified for us.
  const low = text.toLowerCase();
  for (const t of AP_TERMS) {
    if (t.length >= 5 && low.includes(t)) add('place', t.replace(/\b\w/g, (c) => c.toUpperCase()));
  }
  if (article.dateline) add('place', article.dateline.replace(/\b\w/g, (c) => c.toUpperCase()));

  return [...found.values()];
}

module.exports = { score, bandFor, bucketOf, subjectsOf, loadContext, extractEntities, WEIGHTS, BANDS };
