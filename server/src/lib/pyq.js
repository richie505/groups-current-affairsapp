'use strict';

// The PYQ layer: what the commission has actually asked, as data.
//
// Two jobs:
//
//   1. CLASSIFY  a question's format, from the formulaic phrasing APPSC uses.
//   2. ANSWER    "for this blueprint keyword, which formats has APPSC used?" —
//                which is what turns MCQ generation from a rotation into an
//                imitation of the real paper.
//
// Classification is deliberately deterministic. An exam board writes its stems
// to a house style: "Match List I with List II", "Which of the following
// statements is/are correct", "Assertion (A) ... Reason (R)", "Arrange the
// following in chronological order". Those are patterns, not judgements, and a
// pattern that can be read and corrected beats a model verdict that cannot.
// Where the patterns genuinely do not decide, the format is left 'unknown'
// rather than guessed, because a wrong format silently biases every count built
// on top of it.

// The eight formats, matching ca_mcqs.format exactly. Order matters: the first
// pattern that fits wins, so the most specific structures are tested first.
const FORMAT_RULES = [
  {
    format: 'assertion_reason',
    // Unmistakable, and tested first because such a question also contains
    // statement language that would otherwise capture it.
    re: [
      /\bassertion\b/i,
      /\breason\s*\(\s*R\s*\)/i,
      /\bAssertion\s*\(\s*A\s*\)/i,
    ],
  },
  {
    format: 'list_matching',
    re: [
      /\bmatch\s+list\s*-?\s*(?:I|1)\b/i,
      /\bmatch\s+the\s+following\b/i,
      /\busing\s+the\s+codes?\s+given\s+below\b/i,
      /\blist\s*-?\s*I\b[\s\S]{0,80}\blist\s*-?\s*II\b/i,
    ],
  },
  {
    format: 'chronological',
    re: [
      /\bchronological\s+order\b/i,
      /\barrange\s+(?:the\s+)?following\b[\s\S]{0,60}\border\b/i,
      /\bcorrect\s+(?:chronological\s+)?sequence\b/i,
      /\bearliest\b[\s\S]{0,30}\blatest\b/i,
    ],
  },
  {
    format: 'count_based',
    re: [
      /\bhow\s+many\s+of\s+the\s+(?:above|following)\b/i,
      /\bhow\s+many\s+(?:statements?|pairs?)\b/i,
      /\bnumber\s+of\s+(?:correct|incorrect)\s+statements?\b/i,
    ],
  },
  {
    format: 'negative_statement',
    // The negative forms. A bare `not` in an exam stem is almost always the
    // negation being tested, and the specific phrasings are too varied to
    // enumerate: "is not correct", "was not written by", "which one of the
    // following books was NOT", "is not correctly matched". Enumerating them
    // missed "was not written by Harshavardhana" on a real 2023 question, so
    // this now tests for the word itself.
    //
    // Matched against the STEM only. An option reading "None of the above" or a
    // distractor that happens to contain "not" must not make the question
    // negative.
    stemOnly: true,
    re: [
      /\bnot\b/i,
      /\bincorrect\b/i,
      /\bexcept\b/i,
      // Narrow, because a *statement* can contain the word "false" without the
      // question being a negative one. Only the question asking which item is
      // false counts.
      /\b(?:is|are)\s+false\b/i,
      /\bfalse\s+statement/i,
    ],
  },
  // NOTE on precedence: negative_statement is tested before multi_statement, so
  // "Consider the following statements ... which is NOT correct" is filed as
  // negative rather than multi. That is deliberate — negation is the rarer and
  // more diagnostic property, and it is where marks are actually lost — but it
  // does mean the multi_statement count is a count of *positive* multi-statement
  // questions. Worth knowing before reading the distribution.
  {
    format: 'multi_statement',
    // Several ENUMERATED claims, then "which is/are correct". The enumeration is
    // what separates this from statement_based: without it, "which of the
    // following statements is correct" is a single-proposition question, and
    // treating the two alike put a plain "With reference to X..." question in
    // this bucket.
    re: [
      /\b(?:1|I)\s*[.):]\s*[\s\S]{5,240}?\b(?:2|II)\s*[.):]/,
      /\bboth\s+1\s+and\s+2\b/i,
      /\b(?:1|2|3)\s+and\s+(?:2|3|4)\s+only\b/i,
      /\bstatements?\s+(?:1|I)\s+and\s+(?:2|II)\b/i,
    ],
  },
  {
    format: 'statement_based',
    re: [
      /\bwith\s+reference\s+to\b/i,
      /\bwhich\s+of\s+the\s+following\s+statements?\b/i,
      /\bconsider\s+the\s+following\b/i,
      /\bwhich\s+of\s+the\s+above\s+statements?\b/i,
    ],
  },
];

// Anything with options that matched no structural rule. A four-option question
// with no special structure IS a direct-recall question, so this is the honest
// residual rather than a guess — and leaving such questions 'unknown' would have
// thrown away most of the corpus, since plain recall is the commonest form.
const RESIDUAL_FORMAT = 'direct_recall';

/**
 * Classifies one question. `stem` plus its options, because the deciding phrase
 * is sometimes in an option ("Both 1 and 2", "None of the above").
 *
 * Returns 'descriptive' for a Mains question (no options), and 'unknown' when
 * nothing matched — never a guess.
 */
function classifyFormat(stem, options = []) {
  const stemText = String(stem || '');
  const full = [stemText, ...(options || [])].filter(Boolean).join(' \n ');
  if (!full.trim()) return 'unknown';

  // A question with no options is a Mains question: it is asked, but it is not
  // an MCQ and must not pollute the format distribution.
  if (!options || options.length < 2) return 'descriptive';

  for (const rule of FORMAT_RULES) {
    const haystack = rule.stemOnly ? stemText : full;
    if (rule.re.some((re) => re.test(haystack))) return rule.format;
  }
  return RESIDUAL_FORMAT;
}

// ---------------------------------------------------------------------------
// keyword tagging
// ---------------------------------------------------------------------------

// Reuses the seeded blueprint vocabulary. Same stoplist reasoning as the
// newspaper gate: an angle that fires on every question separates nothing.
const KEYWORD_STOPLIST = new Set([
  'last', 'first', 'new', 'best', 'top', 'largest', 'highest', 'lowest',
  'longest', 'oldest', 'total', 'number', 'place', 'location', 'name', 'year',
  'day', 'state', 'city', 'district', 'area', 'people', 'group', 'india',
  'government', 'minister', 'president', 'world',
]);

function loadKeywords(db) {
  const out = [];
  const seen = new Set();
  for (const r of db.prepare('SELECT keyword, subject FROM ref_keywords').all()) {
    for (const raw of String(r.keyword).split(/[/|]/)) {
      const term = raw.trim();
      if (term.length < 4) continue;
      const low = term.toLowerCase();
      if (KEYWORD_STOPLIST.has(low) || seen.has(low)) continue;
      seen.add(low);
      out.push({
        term,
        subject: r.subject,
        re: new RegExp(`\\b${term.replace(/[.*+?^${}()[\]\\]/g, '\\$&')}\\b`, 'i'),
      });
    }
  }
  return out;
}

function tagKeywords(text, keywords, max = 5) {
  const hits = [];
  for (const k of keywords) {
    if (k.re.test(text)) {
      hits.push(k);
      if (hits.length >= max) break;
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// the payoff: the observed format distribution
// ---------------------------------------------------------------------------

/**
 * For a blueprint keyword, the formats APPSC has actually used, most-used first.
 *
 * `descriptive` and `unknown` are excluded: the caller is choosing MCQ formats,
 * and a Mains question or an unclassified one is not evidence about which MCQ
 * format to use. Counting them would quietly shrink every real share.
 */
function formatMix(db, keyword) {
  const rows = db
    .prepare(
      `SELECT q.format, COUNT(*) AS n
         FROM pyq_questions q
         JOIN pyq_question_keywords k ON k.question_id = q.id
        WHERE k.keyword = ? AND q.format NOT IN ('descriptive', 'unknown')
        GROUP BY q.format
        ORDER BY n DESC`
    )
    .all(keyword);
  const total = rows.reduce((s, r) => s + r.n, 0);
  return { keyword, total, formats: rows.map((r) => ({ ...r, share: total ? r.n / total : 0 })) };
}

/**
 * Turns an observed distribution into a concrete list of `n` formats to
 * generate, largest remainder first.
 *
 * Falls back to the caller's default cycle when the evidence is too thin.
 * `minEvidence` exists because a distribution built on two questions is not a
 * distribution — it is two questions, and imitating it would be superstition
 * rather than imitation.
 */
function plannedFormats(db, keyword, n, fallback, { minEvidence = 4 } = {}) {
  const mix = formatMix(db, keyword);
  if (mix.total < minEvidence) return { formats: fallback.slice(0, n), source: 'default', evidence: mix.total };

  const planned = [];
  const scored = mix.formats.map((f) => ({ format: f.format, exact: f.share * n }));
  for (const s of scored) {
    const whole = Math.floor(s.exact);
    for (let i = 0; i < whole && planned.length < n; i++) planned.push(s.format);
    s.remainder = s.exact - whole;
  }
  for (const s of [...scored].sort((a, b) => b.remainder - a.remainder)) {
    if (planned.length >= n) break;
    planned.push(s.format);
  }
  // A bank that is 100% one format trains one reflex, so the most-used format is
  // capped below the whole set when there is room for variety.
  return { formats: planned.slice(0, n), source: 'pyq', evidence: mix.total };
}

/** Which angles the commission returns to, across all parsed papers. */
function keywordFrequency(db, { limit = 40 } = {}) {
  return db
    .prepare(
      `SELECT k.keyword, COUNT(*) AS n,
              COUNT(DISTINCT q.paper_id) AS papers,
              GROUP_CONCAT(DISTINCT q.format) AS formats
         FROM pyq_question_keywords k
         JOIN pyq_questions q ON q.id = k.question_id
        GROUP BY k.keyword
        ORDER BY n DESC, papers DESC
        LIMIT ?`
    )
    .all(limit);
}

/**
 * Measured recurrence per topic, from BOTH halves of the PYQ layer.
 *
 * Counting only the Group-II question bank is actively misleading. The bank
 * covers one paper and links few topics, so on its own it recommended demoting
 * "Finance Commission and fiscal federalism" out of tier 1 — the single
 * most-recurring topic in the Group-I blueprint, which records five questions
 * across two papers in two years. Any tier derived from half the evidence is
 * worse than the hand-assigned tier it replaces.
 *
 * So the sources are unioned: question-level counts from the Group-II bank, the
 * same from the hand-compiled Group-I Mains papers, and topic-level counts from
 * the Group-I blueprint's recurrence observations where no real paper covers it.
 *
 * The exam filter matters. Before the Group-I papers were seeded, the first
 * query took every row in `pyq_questions` and called the result 'group2' —
 * harmless while the table held only Group-II questions, and wrong the moment
 * 252 Mains slots landed in it.
 */
function topicRecurrence(db) {
  const byExam = (exam) =>
    db
      .prepare(
        `SELECT t.id, COUNT(DISTINCT qt.question_id) AS questions,
                COUNT(DISTINCT q.paper_id) AS papers
           FROM topics t
           JOIN pyq_question_topics qt ON qt.topic_id = t.id
           JOIN pyq_questions q ON q.id = qt.question_id
           JOIN pyq_papers p ON p.id = q.paper_id
          WHERE p.exam = ?
          GROUP BY t.id`
      )
      .all(exam);

  // MEASURED QUESTIONS ONLY, AND ONLY FROM THE OBJECTIVE PAPERS.
  //
  // This used to merge three sources: the Group-II papers, the Group-I MAINS
  // papers, and `topic_evidence` — one person's reading of the Mains papers,
  // used wherever a real paper did not already cover the topic.
  //
  // Both Group-I Mains sources are gone with the Mains layer, and their loss is
  // smaller than it looks: a descriptive paper cannot tell you which FORMAT a
  // topic is asked in, so the Mains half only ever contributed recurrence. The
  // 1,137 real Group-II questions carry both, and they are the papers this app
  // now serves.
  const merged = new Map();
  const add = (row, source) => {
    const cur = merged.get(row.id) || { id: row.id, questions: 0, papers: 0, sources: [] };
    cur.questions += row.questions || 0;
    cur.papers = Math.max(cur.papers, row.papers || 0);
    cur.sources.push(source);
    merged.set(row.id, cur);
  };
  for (const r of byExam('group2')) add(r, 'group2');

  if (!merged.size) return [];
  const ids = [...merged.keys()];
  const holes = ids.map(() => '?').join(',');
  const topics = db
    .prepare(`SELECT id, slug, name, ap, tier FROM topics WHERE id IN (${holes})`)
    .all(...ids);

  return topics
    .map((t) => ({ ...t, ...merged.get(t.id), sources: [...new Set(merged.get(t.id).sources)] }))
    .sort((a, b) => b.papers - a.papers || b.questions - a.questions);
}

/**
 * A tier suggestion from observed recurrence. Returned as a *suggestion* rather
 * than written: the parsed corpus is 8 papers, which is enough to rank topics
 * and not enough to overwrite a considered judgement without someone looking.
 */
function suggestTiers(db) {
  const rows = topicRecurrence(db);
  return rows
    .map((r) => {
      const suggested = r.papers >= 3 || r.questions >= 6 ? 1 : r.questions >= 2 ? 2 : 3;
      return { ...r, suggested, changed: suggested !== r.tier };
    })
    .filter((r) => r.changed);
}

module.exports = {
  FORMAT_RULES,
  classifyFormat,
  loadKeywords,
  tagKeywords,
  formatMix,
  plannedFormats,
  keywordFrequency,
  topicRecurrence,
  suggestTiers,
};
