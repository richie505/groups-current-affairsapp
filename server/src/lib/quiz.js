'use strict';

// Builds a practice paper out of the MCQ bank.
//
// Two things make this different from practice in a static-notes app:
//
// 1. The scope a current-affairs student wants is a *window* — "this month",
//    "last week" — far more often than a topic. Static subjects are revised by
//    chapter; news is revised by date.
//
// 2. The format mix matters as much as the content. The real paper leans hard
//    on assertion-reason, list-matching and negative-statement, so a bank
//    served in whatever order SQL returns it trains the wrong reflex: the
//    student gets fluent at plain recall and then meets a paper that is mostly
//    not plain recall. So the selection deliberately spreads across formats
//    instead of taking the first N rows.

// Rough shares to aim for. Direct recall, multi-statement and list-matching
// suit current-affairs facts most naturally — single events, several claims
// about one event, natural pairings like scheme↔ministry or summit↔country —
// while assertion-reason and negative-statement are cycled in because the real
// paper uses them heavily and they are the formats students lose marks on.
const FORMAT_WEIGHTS = {
  direct_recall: 0.3,
  multi_statement: 0.18,
  list_matching: 0.18,
  assertion_reason: 0.14,
  negative_statement: 0.1,
  statement_based: 0.05,
  chronological: 0.03,
  count_based: 0.02,
};

const VISIBLE = `i.status = 'published' AND d.status = 'published'`;

function resolveWindow({ scope, from, to, month, date }) {
  // Returns [sqlFragment, params] constraining d.date, plus a human label.
  if (scope === 'day' && date) return [`d.date = ?`, [date], date];
  if (scope === 'month' && month) return [`d.date LIKE ?`, [`${month}-%`], month];
  if (from && to) return [`d.date BETWEEN ? AND ?`, [from, to], `${from} → ${to}`];
  if (from) return [`d.date >= ?`, [from], `since ${from}`];
  if (to) return [`d.date <= ?`, [to], `up to ${to}`];
  return ['1=1', [], 'all published'];
}

function buildQuiz(db, opts) {
  const {
    userId,
    scope = 'range',
    bucket,
    keyword,
    unit,
    limit = 20,
    onlyUnread = false,
  } = opts;

  const [windowSql, windowParams, windowLabel] = resolveWindow(opts);

  // The filters that describe *what the student asked for* — window, bucket,
  // keyword, unit. Built once and used by both queries below, so the two can
  // never disagree about the scope they are counting.
  const scopeWhere = [VISIBLE, windowSql];
  const scopeParams = [...windowParams];

  if (bucket) {
    scopeWhere.push('i.bucket = ?');
    scopeParams.push(bucket);
  }
  if (keyword) {
    scopeWhere.push(`(m.keyword = ? OR EXISTS (SELECT 1 FROM ca_item_keywords k
                                                WHERE k.item_id = i.id AND k.keyword = ?))`);
    scopeParams.push(keyword, keyword);
  }
  if (unit) {
    scopeWhere.push(`EXISTS (SELECT 1 FROM ca_item_units u WHERE u.item_id = i.id AND u.unit_code = ?)`);
    scopeParams.push(unit);
  }

  // The filters that describe *what this student may see right now*. Kept
  // separate because the locked count is precisely the difference between the
  // two sets: a student who asks for 20 questions and gets 6 needs to be told
  // the other 14 are behind unread notes, not left thinking the bank is empty.
  const servableWhere = [...scopeWhere];
  const servableParams = [...scopeParams];

  servableWhere.push(`EXISTS (SELECT 1 FROM ca_progress p
                               WHERE p.user_id = ? AND p.item_id = i.id AND p.marked_read = 1)`);
  servableParams.push(userId);

  if (onlyUnread) {
    // Never attempted, rather than "last attempt was wrong" — that is what the
    // Mistakes screen is for.
    servableWhere.push(`NOT EXISTS (SELECT 1 FROM ca_attempts a WHERE a.user_id = ? AND a.mcq_id = m.id)`);
    servableParams.push(userId);
  }

  const FROM = `FROM ca_mcqs m
         JOIN ca_items i ON i.id = m.item_id
         JOIN ca_days d ON d.id = i.day_id`;

  const rows = db
    .prepare(
      `SELECT m.id, m.question, m.option_a, m.option_b, m.option_c, m.option_d,
              m.correct_option, m.explanation, m.format, m.keyword, m.difficulty,
              m.fact_as_of, i.id AS item_id, i.headline, i.bucket, d.date AS day_date
         ${FROM}
        WHERE ${servableWhere.join(' AND ')}
        ORDER BY RANDOM()`
    )
    .all(...servableParams);

  const picked = pickByFormatMix(rows, limit);

  // Everything in scope regardless of what has been read — the total the
  // locked count is measured against.
  const totalInWindow = db
    .prepare(`SELECT COUNT(*) AS n ${FROM} WHERE ${scopeWhere.join(' AND ')}`)
    .get(...scopeParams).n;

  return {
    scope,
    label: windowLabel,
    mcqs: picked,
    available: rows.length,
    locked: Math.max(totalInWindow - rows.length, 0),
    format_mix: countFormats(picked),
  };
}

// Spread the selection across formats rather than taking the first N.
//
// Works in two passes: fill each format up to its weighted quota, then top up
// from whatever is left. The top-up matters more than the quota — a young bank
// often has no chronological questions at all, and a strict quota would return
// 14 questions when 20 were asked rather than substituting.
function pickByFormatMix(rows, limit) {
  if (rows.length <= limit) return rows;

  const byFormat = new Map();
  for (const r of rows) {
    if (!byFormat.has(r.format)) byFormat.set(r.format, []);
    byFormat.get(r.format).push(r);
  }

  const picked = [];
  const used = new Set();

  for (const [format, weight] of Object.entries(FORMAT_WEIGHTS)) {
    const quota = Math.round(limit * weight);
    const pool = byFormat.get(format) || [];
    for (const r of pool.slice(0, quota)) {
      picked.push(r);
      used.add(r.id);
    }
  }

  for (const r of rows) {
    if (picked.length >= limit) break;
    if (!used.has(r.id)) {
      picked.push(r);
      used.add(r.id);
    }
  }

  // Interleave so the paper doesn't arrive in format blocks — five
  // assertion-reason questions in a row is a rhythm the real paper never has.
  return shuffleStable(picked.slice(0, limit));
}

// Fisher-Yates. Not seeded: two attempts at the same scope should not present
// the same paper in the same order, or the second sitting measures recall of
// the order rather than of the content.
function shuffleStable(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function countFormats(rows) {
  const out = {};
  for (const r of rows) out[r.format] = (out[r.format] || 0) + 1;
  return out;
}

module.exports = { buildQuiz, FORMAT_WEIGHTS };
