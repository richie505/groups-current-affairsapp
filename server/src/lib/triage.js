'use strict';

// RELEVANCE-GATED EXTRACTION — the stage between "we have articles" and "we
// spend money on them".
//
// WHAT WAS THERE BEFORE, AND WHY IT WAS NOT ENOUGH
//
// An article already arrives here carrying a 0-100 composite from
// relevance.js and a list of syllabus units from the alias matcher. Those are
// deterministic, free, and good at what they measure — but what they measure is
// how much of the article's text collides with a vocabulary the app already
// holds. That is not the same question as "is this examinable".
//
// The gap is measurable and large. Across the four editions stored before this
// existed, between 36 and 70 articles PER EDITION matched no syllabus unit and
// were therefore never drafted, never salvaged, and never read by anything. The
// composite scored them and nothing judged them. Some are genuine filler — most
// of a newspaper is. Some are examinable material the alias map has a hole for,
// and the score cannot tell those two apart because the score IS the alias map.
//
// So a model reads every article once, cheaply, and files a verdict: high,
// partial or drop. That verdict is stored with its score and its reason, which
// is the part that matters most — a gate whose rejections are invisible is a
// gate nobody can tune, and the whole point of keeping the drop pile is that
// somebody can come back in a month and ask whether the line is in the right
// place.
//
// TWO DECISIONS, AND ONLY ONE OF THEM IS THE MODEL'S
//
// The model judges an ARTICLE: is this examinable, and is it worth 250 words or
// only its hard facts. That is what a model is good at and what it is asked.
//
// How MANY articles a day should yield in full is not a property of any article
// and the model cannot see it — each call reads twelve and nothing else. Asked
// to decide anyway it produced three on a 93-article edition, because three
// separate batches happened to find nothing outstanding in their own twelve.
// So the app keeps that decision, ranks what the model kept, and draws the line
// with the same adaptive band select.js already uses for drafting. See
// drawBand.
//
// Both answers are stored. `triage_class_model` is the verdict as given and
// `triage_class` is the route after the band, so the override is countable
// rather than assumed — which is the whole point of keeping scores at all.

const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const L = require(path.join(ROOT, 'content-pipeline', 'ca-daily', 'lib'));

const CLASSES = ['high', 'partial', 'drop'];

// TWELVE, and the number is a trade rather than a round figure.
//
// One call per article would be 96 calls on this edition; one call for all 96
// would be a 70,000-character prompt whose middle the model reads least
// carefully, and a single malformed reply would cost the whole edition. Twelve
// keeps a batch under ~10k characters — small enough that every article in it
// gets attention, large enough that the 1,500-word instruction block is
// amortised across twelve verdicts rather than one.
const BATCH_SIZE = 12;

// How much of the body the model sees. Enough to reach the paragraph where a
// routine story hides its one hard fact — the tunnel length in paragraph nine,
// which is the entire case for the `partial` class — and not so much that the
// batch stops being cheap.
const BODY_CHARS = 900;

/**
 * The articles a model needs to look at.
 *
 * Excludes duplicates (they are the same event as their lead, already judged
 * under it) and excludes the PROCESSING VETO — sport results, crime reports,
 * from-the-archives — which relevance.js discarded before scoring and which
 * carry score 0 with a reason already written. Those are recorded as drops
 * without a call: paying a model to agree that a road-accident report is not
 * examinable is paying for an answer already in the row.
 *
 * The two are distinguished exactly by score, for the reason salvage.js gives:
 * a processing veto was never scored, whereas a DRAFTER discard keeps the score
 * it earned.
 */
function pendingRows(db, editionId, { redo = false } = {}) {
  return db
    .prepare(
      `SELECT a.id, a.page, a.headline, a.standfirst, a.dateline, a.genre, a.ap,
              a.score, a.band, a.status, a.item_id,
              substr(a.body, 1, ${BODY_CHARS + 200}) AS body,
              (SELECT GROUP_CONCAT(u.unit_code)
                 FROM np_article_units u
                 JOIN ref_units r ON r.unit_code = u.unit_code
                WHERE u.article_id = a.id
                  AND r.format = 'objective' AND r.broad = 0 AND r.unfeedable = 0
              ) AS unit_codes
         FROM np_articles a
        WHERE a.edition_id = ?
          AND a.status <> 'duplicate'
          AND NOT (a.status = 'discarded' AND COALESCE(a.score, 0) = 0)
          ${redo ? '' : "AND a.triage_class = ''"}
        ORDER BY a.page, a.id`
    )
    .all(editionId);
}

/** The processing vetoes — dropped without a call, with the reason relevance.js
 *  already wrote. */
function vetoedRows(db, editionId) {
  return db
    .prepare(
      `SELECT id, headline, discard_reason
         FROM np_articles
        WHERE edition_id = ?
          AND status = 'discarded' AND COALESCE(score, 0) = 0`
    )
    .all(editionId);
}

/** One article, as the prompt expects to see it. */
function renderArticle(a) {
  const units = String(a.unit_codes || '')
    .split(',')
    .filter(Boolean);
  const flags = [
    `PAGE ${a.page ?? '?'}`,
    a.genre && a.genre !== 'report' ? a.genre : 'report',
    a.ap ? 'AP' : null,
    `score ${a.score == null ? '?' : Math.round(a.score)}`,
    units.length ? `units ${units.join(', ')}` : 'units none',
  ]
    .filter(Boolean)
    .join(' · ');

  const body = String(a.body || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, BODY_CHARS);

  return [
    `### ${a.id}`,
    flags,
    `HEADLINE: ${String(a.headline || '').trim()}`,
    a.standfirst ? `STANDFIRST: ${String(a.standfirst).trim()}` : null,
    `BODY: ${body}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function renderBatch(rows) {
  return rows.map(renderArticle).join('\n\n');
}

function chunk(rows, size = BATCH_SIZE) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

// Models are not consistent about the words. Asking for "drop" gets "dropped",
// "reject" and "low" often enough that a strict match would throw away good
// verdicts and — worse — throw them away silently, since an unparsed verdict
// looks exactly like an article the model forgot.
const CLASS_ALIASES = {
  high: 'high',
  full: 'high',
  keep: 'high',
  partial: 'partial',
  brief: 'partial',
  short: 'partial',
  salvage: 'partial',
  medium: 'partial',
  drop: 'drop',
  dropped: 'drop',
  discard: 'drop',
  reject: 'drop',
  none: 'drop',
  low: 'drop',
};

function normaliseClass(raw) {
  const k = String(raw || '')
    .trim()
    .toLowerCase();
  return CLASS_ALIASES[k] || '';
}

/**
 * Turns one model reply into verdicts, and says what it could not turn.
 *
 * `expected` is the id set that was asked about. Anything outside it is
 * dropped — a verdict about an article from another batch is a hallucinated id
 * and writing it would file one article's judgement onto another. Anything
 * inside it and missing is reported, because a silently missing verdict is an
 * article that never gets classified and never gets noticed.
 */
function parseVerdicts(raw, expectedIds) {
  const expected = new Set(expectedIds.map(Number));
  const seen = new Set();
  const verdicts = [];
  const problems = [];

  let list;
  try {
    list = L.parseJson(raw, { array: true });
  } catch (e) {
    return { verdicts: [], missing: [...expected], problems: [`unparseable reply: ${e.message}`] };
  }
  if (!Array.isArray(list)) {
    return { verdicts: [], missing: [...expected], problems: ['reply was not an array'] };
  }

  for (const row of list) {
    const id = Number(row && row.id);
    if (!expected.has(id)) {
      problems.push(`verdict for id ${row && row.id} which was not in this batch`);
      continue;
    }
    if (seen.has(id)) {
      problems.push(`two verdicts for id ${id} — the first was kept`);
      continue;
    }
    const cls = normaliseClass(row.class);
    if (!cls) {
      problems.push(`id ${id}: unknown class ${JSON.stringify(row.class)}`);
      continue;
    }
    seen.add(id);

    let score = Number(row.score);
    if (!Number.isFinite(score)) score = cls === 'high' ? 70 : cls === 'partial' ? 45 : 10;
    score = Math.max(0, Math.min(100, Math.round(score)));

    verdicts.push({
      id,
      class: cls,
      score,
      reason: String(row.reason || '').trim().slice(0, 240),
      areas: (Array.isArray(row.areas) ? row.areas : [])
        .map((x) => String(x).trim())
        .filter(Boolean)
        .slice(0, 6)
        .join(', '),
    });
  }

  return {
    verdicts,
    missing: [...expected].filter((id) => !seen.has(id)),
    problems,
  };
}

/**
 * A NO-UNIT ARTICLE IS FLAGGED, NOT VETOED — and that reverses a rule this
 * repository has held for weeks, on measurement, so the reasoning is here.
 *
 * The old rule: an article matching no syllabus unit is never drafted in full.
 * It earned its place. A composite score cannot separate "Rs 7,470 cr. cleared
 * for infra works in ULBs under HAM" from "Cultural diversity highlight of gala
 * dinner in Vizag" — both score highly for the same reasons, AP place names,
 * money and officialdom — so with nothing better to go on, refusing the whole
 * unmatched class was the only safe answer.
 *
 * What changed is that there is now something better to go on. On the first
 * real edition the veto fired on 6 of the model's 9 `high` verdicts, and all
 * six were core APPSC material: the 12th Pay Revision Commission, the Census
 * 2027 schedule, a CM order on the SC/ST Atrocities Act, the SIR voter-roll
 * revision, the Javelin acquisition. The alias map covered 26 of 93 articles —
 * 28% — so the rule was not filtering junk, it was capping the digest at what
 * the vocabulary already happened to know.
 *
 * And the class the veto existed to stop is now stopped by the model instead.
 * On the same edition it dropped every one of these, which the composite had
 * rated high:
 *
 *   composite 78 → triage 18   Jagan demands CBI probe into DSC recruitment
 *   composite 66 → triage 17   APUTF ends hunger strike after CM's assurance
 *   composite 60 → triage 24   Young Leaders for Social Change programme
 *   composite 60 → triage 18   Cong. revamps organisation ahead of polls
 *
 * So the veto was using the weaker signal to overrule the stronger one. It is
 * gone. What remains is the flag: `vocabularyGap` marks an article routed to
 * full drafting with no syllabus unit behind it, which is not a reason to
 * refuse it — it is a hole in the alias map, and the edition screen lists them
 * so the hole gets filled.
 */
function vocabularyGap(article) {
  return !String(article.unit_codes || '').trim();
}

/** The model's verdict, unmodified. Kept as a named step because the class it
 *  writes is not the final route — see drawBand. */
function routeVerdict(verdict, article) {
  return {
    ...verdict,
    class_model: verdict.class,
    vocabulary_gap: verdict.class === 'high' && vocabularyGap(article),
  };
}

/**
 * WHO DECIDES HOW MANY ARTICLES GET THE FULL TREATMENT.
 *
 * Not the model, and the first run said why. Each call sees twelve articles and
 * nothing else, so an instruction like "a typical edition yields about twenty
 * high" is not something a batch can act on: batches 4, 6 and 7 returned zero
 * `high` between them and the edition came out with three. Three is not a
 * digest.
 *
 * The ranking those same calls produced was good — the top sixteen by score
 * were all defensible exam material and the tail fell away exactly where it
 * should. So the model is asked for the thing it is good at, a judgement about
 * one article, and the app keeps the thing that is not a property of any
 * article at all: how big a day's digest should be.
 *
 * This is the same split select.js already makes for drafting, and the band is
 * the same band. `drop` is never touched — a budget may decide how much of the
 * examinable material is written up in full, and may not promote something the
 * model refused.
 */
function drawBand(db, editionId, { minItems, maxItems } = {}) {
  const cfg = require('./select').DEFAULTS;
  const lo = Math.max(1, minItems || cfg.minItems);
  const hi = Math.max(lo, maxItems || cfg.maxItems);

  // Everything the model kept, best first. The composite breaks ties: two
  // articles the model scored 55 are separated by the syllabus evidence, which
  // is the one signal the model was not looking at.
  const pool = db
    .prepare(
      `SELECT id, triage_class_model, triage_score
         FROM np_articles
        WHERE edition_id = ? AND status <> 'duplicate' AND triage_class <> 'drop'
              AND triage_class <> ''
        ORDER BY triage_score DESC, score DESC, id`
    )
    .all(editionId);

  const wanted = pool.filter((r) => r.triage_class_model === 'high').length;
  const n = Math.min(pool.length, Math.max(lo, Math.min(hi, wanted)));

  const upd = db.prepare('UPDATE np_articles SET triage_class = ? WHERE id = ?');
  db.transaction(() => {
    pool.forEach((row, i) => upd.run(i < n ? 'high' : 'partial', row.id));
  })();
  return { high: n, partial: pool.length - n, wanted, floor: lo, cap: hi };
}

/** Writes verdicts onto the articles. One transaction — a half-triaged edition
 *  reports a breakdown that does not add up to its own article count. */
function applyVerdicts(db, verdicts, { model = '' } = {}) {
  const upd = db.prepare(
    `UPDATE np_articles
        SET triage_class = @class,
            triage_class_model = @class_model,
            triage_score = @score,
            triage_reason = @reason,
            triage_areas = @areas,
            triage_model = @model,
            triaged_at = datetime('now')
      WHERE id = @id`
  );
  db.transaction(() => {
    for (const v of verdicts) {
      upd.run({
        id: v.id,
        class: v.class,
        class_model: v.class_model || v.class,
        score: v.score == null ? null : Number(v.score),
        reason: v.reason || '',
        areas: v.areas || '',
        model,
      });
    }
  })();
  return verdicts.length;
}

/** The breakdown, counted from the articles themselves. */
function counts(db, editionId) {
  const row = db
    .prepare(
      `SELECT
         COUNT(*) AS articles,
         SUM(triage_class = 'high')    AS high,
         SUM(triage_class = 'partial') AS partial,
         SUM(triage_class = 'drop')    AS drop_,
         SUM(triage_class = '')        AS untriaged,
         -- Full drafting with no syllabus unit behind it. Not an error: a hole
         -- in the alias map, listed so it gets filled.
         SUM(triage_class = 'high' AND NOT EXISTS (
               SELECT 1 FROM np_article_units u
                 JOIN ref_units r ON r.unit_code = u.unit_code
                WHERE u.article_id = np_articles.id
                  AND r.format = 'objective' AND r.broad = 0 AND r.unfeedable = 0
             )) AS gaps
       FROM np_articles
      WHERE edition_id = ? AND status <> 'duplicate'`
    )
    .get(editionId);
  return {
    articles: row.articles || 0,
    high: row.high || 0,
    partial: row.partial || 0,
    drop: row.drop_ || 0,
    untriaged: row.untriaged || 0,
    gaps: row.gaps || 0,
  };
}

/** Copies the breakdown onto the edition, where every screen reads it. */
function recount(db, editionId) {
  const c = counts(db, editionId);
  db.prepare(
    `UPDATE np_editions
        SET triage_high = ?, triage_partial = ?, triage_drop = ?,
            triaged_at = datetime('now')
      WHERE id = ?`
  ).run(c.high, c.partial, c.drop, editionId);
  return c;
}

/** The one line that goes in the processing log, the run log and the API. Built
 *  in one place so the screen and the terminal cannot disagree about it. */
function summaryLine(c) {
  const parts = [
    `${c.articles} articles → ${c.high} high, ${c.partial} partial, ${c.drop} dropped`,
  ];
  if (c.untriaged) parts.push(`${c.untriaged} not classified`);
  if (c.gaps) parts.push(`${c.gaps} with no syllabus unit — vocabulary gaps`);
  return parts.join(' · ');
}

/**
 * Classifies a whole edition.
 *
 * Sequential, one batch at a time. Not for want of speed: the pipeline's
 * standing rule is that batch API work runs at concurrency 1, and eight calls
 * take under a minute anyway.
 */
async function classify(
  db,
  {
    editionId,
    model,
    batchSize = BATCH_SIZE,
    prompt,
    onLog = () => {},
    redo = false,
    minItems,
    maxItems,
  }
) {
  const system = prompt || L.readPrompt('prompt-triage.txt');

  // The free half first. These already carry a reason from relevance.js, and
  // asking a model to confirm that a road accident is not examinable is paying
  // for an answer that is already in the row.
  // ALWAYS, including on a --redo. The veto is a rule, not a verdict: it costs
  // nothing to re-apply and skipping it on a re-run left the 15 articles
  // relevance.js had already thrown out with no class at all, which reads
  // downstream as "never triaged" and falls back to the old behaviour for
  // exactly the rows that were never in question.
  const vetoed = vetoedRows(db, editionId);
  if (vetoed.length) {
    applyVerdicts(
      db,
      vetoed.map((a) => ({
        id: a.id,
        class: 'drop',
        class_model: 'drop',
        score: 0,
        reason: a.discard_reason || 'Excluded before scoring as not examinable.',
        areas: '',
      })),
      { model: 'rule' }
    );
    onLog(`${vetoed.length} article(s) dropped by the processing veto — no model call needed`);
  }

  const rows = pendingRows(db, editionId, { redo });
  if (!rows.length) {
    onLog('Nothing to classify.');
    drawBand(db, editionId, { minItems, maxItems });
    return { ...recount(db, editionId), calls: 0, problems: [] };
  }

  const batches = chunk(rows, batchSize);
  onLog(`${rows.length} article(s) to classify in ${batches.length} call(s), model ${model}`);

  const byId = new Map(rows.map((r) => [r.id, r]));
  const allProblems = [];
  let calls = 0;
  let stillMissing = [];

  for (let i = 0; i < batches.length; i += 1) {
    const batch = batches[i];
    const ids = batch.map((r) => r.id);
    let raw;
    try {
      raw = await L.complete({ system, user: renderBatch(batch), model });
      calls += 1;
    } catch (e) {
      // A batch that fails is a batch of articles nobody judged. Reported and
      // carried to the retry pass rather than defaulted: defaulting to `drop`
      // silently loses material and defaulting to `partial` spends money on
      // articles nothing has read.
      onLog(`  batch ${i + 1}/${batches.length} FAILED — ${e.message.slice(0, 90)}`);
      allProblems.push(`batch ${i + 1}: ${e.message}`);
      stillMissing.push(...ids);
      continue;
    }

    const { verdicts, missing, problems } = parseVerdicts(raw, ids);
    const routed = verdicts.map((v) => routeVerdict(v, byId.get(v.id)));
    applyVerdicts(db, routed, { model });

    const h = routed.filter((v) => v.class === 'high').length;
    const p = routed.filter((v) => v.class === 'partial').length;
    const d = routed.filter((v) => v.class === 'drop').length;
    const gap = routed.filter((v) => v.vocabulary_gap).length;
    onLog(
      `  batch ${i + 1}/${batches.length}: ${h} high, ${p} partial, ${d} dropped` +
        `${gap ? ` (${gap} high with no syllabus unit)` : ''}` +
        `${missing.length ? ` · ${missing.length} missing` : ''}`
    );
    for (const p2 of problems) onLog(`    ${p2}`);
    allProblems.push(...problems);
    stillMissing.push(...missing);
  }

  // ONE RETRY, IN SMALL BATCHES.
  //
  // A model that skipped four ids in a batch of twelve will usually return all
  // four when asked about four. A model that skips them twice is not going to
  // produce them on a third ask, and the honest outcome then is an article left
  // unclassified and SAID SO — which the consumers read as "fall back to the
  // deterministic rule", the behaviour the app had before this stage existed.
  if (stillMissing.length) {
    onLog(`Retrying ${stillMissing.length} article(s) the first pass did not return.`);
    const retryRows = stillMissing.map((id) => byId.get(id)).filter(Boolean);
    stillMissing = [];
    for (const batch of chunk(retryRows, 4)) {
      const ids = batch.map((r) => r.id);
      try {
        const raw = await L.complete({ system, user: renderBatch(batch), model });
        calls += 1;
        const { verdicts, missing } = parseVerdicts(raw, ids);
        applyVerdicts(db, verdicts.map((v) => routeVerdict(v, byId.get(v.id))), { model });
        stillMissing.push(...missing);
      } catch (e) {
        allProblems.push(`retry: ${e.message}`);
        stillMissing.push(...ids);
      }
    }
    if (stillMissing.length) {
      onLog(
        `${stillMissing.length} article(s) could not be classified after two passes — ` +
          'they keep the deterministic routing the app used before triage existed.'
      );
    }
  }

  // The model has judged every article; the app now decides how many of the
  // ones it kept are worth the full treatment. See drawBand.
  const band = drawBand(db, editionId, { minItems, maxItems });
  if (band.wanted !== band.high) {
    onLog(
      `The model called ${band.wanted} article(s) high; the digest band is ` +
        `${band.floor}-${band.cap}, so ${band.high} go to full drafting and the rest ` +
        'to short entries.'
    );
  }

  const c = recount(db, editionId);
  onLog(summaryLine(c));
  return { ...c, calls, band, problems: allProblems };
}

module.exports = {
  BATCH_SIZE,
  BODY_CHARS,
  CLASSES,
  pendingRows,
  vetoedRows,
  renderArticle,
  renderBatch,
  chunk,
  normaliseClass,
  parseVerdicts,
  routeVerdict,
  vocabularyGap,
  drawBand,
  applyVerdicts,
  counts,
  recount,
  summaryLine,
  classify,
};
