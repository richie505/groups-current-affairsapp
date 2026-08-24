#!/usr/bin/env node
'use strict';

// The newspaper lane, in one command.
//
//   node content-pipeline/np-daily/paper.js "TH- Vijayawada 21-08.pdf" --date 2026-08-21 --dry-run
//   node content-pipeline/np-daily/paper.js hindu.pdf eenadu.pdf --date 2026-08-21
//
// FIVE STAGES
//
//   1. EXTRACT    layout.py: text layer where there is one, OCR where there is
//                 not. No model.
//   2. SEGMENT    segment.js: columns -> articles, advertisements and page
//                 furniture dropped with reasons. No model.
//   3. MERGE      merge.js: the same event reported twice becomes one event.
//                 Same-script pairs are settled arithmetically; cross-script
//                 pairs (Hindu vs Eenadu) are proposed here and judged by a
//                 model in stage 4. No model in this stage.
//   4. GATE       one cheap model call over headlines and openings, deciding
//                 which few of ~120 articles are worth drafting. This is the
//                 discard gate.
//   5. EMIT       a candidates file in exactly the shape run.js already
//                 consumes.
//
// WHY IT STOPS AT A CANDIDATES FILE
//
// Because the drafting, the corrections guard, the MCQ generation, the
// validation and the dedupe already exist and are already good, in
// ca-daily/run.js. A newspaper is a different way of *discovering* an event,
// not a different kind of event, so this lane ends where the existing one
// begins:
//
//   paper.js ... --out cands.json
//   node content-pipeline/ca-daily/run.js --candidates cands.json --date 2026-08-21
//
// Nothing here publishes. Nothing here even drafts.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { pythonBin, parseJsonStdout } = require(require('path').join(__dirname, '..', 'python-bin'));

const L = require(path.join(__dirname, '..', 'ca-daily', 'lib'));
const { AP_TERMS } = require(path.join(__dirname, '..', 'ca-daily', 'sweep'));
const { segment } = require('./segment');
const { PROFILES } = require('./profiles');
const M = require('./merge');
const { gateByRules } = require('./gate-rules');

L.loadEnv();

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    pdfs: [],
    date: null,
    profile: null,
    pages: null,
    dpi: 300,
    lang: null,
    out: null,
    dryRun: false,
    maxItems: 12,
    apOnly: false,
    gate: 'auto',   // auto | model | rules | none
    keepIr: false,
    model: process.env.OPENAI_SHORTLIST_MODEL || 'gpt-4o-mini',
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--date') args.date = argv[++i];
    else if (a === '--profile') args.profile = argv[++i];
    else if (a === '--pages') args.pages = argv[++i];
    else if (a === '--dpi') args.dpi = Number(argv[++i]);
    else if (a === '--lang') args.lang = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--max-items') args.maxItems = Number(argv[++i]);
    else if (a === '--ap-only') args.apOnly = true;
    else if (a === '--gate') args.gate = argv[++i];
    else if (a === '--no-gate') args.gate = 'none';
    else if (a === '--keep-ir') args.keepIr = true;
    else if (a === '--model') args.model = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
    else if (!a.startsWith('-')) args.pdfs.push(a);
    else {
      console.error(`Unknown flag: ${a}`);
      process.exit(1);
    }
  }
  return args;
}

const args = parseArgs(process.argv);

if (args.help || !args.pdfs.length) {
  console.log(fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8'));
  process.exit(args.help ? 0 : 1);
}
if (!['auto', 'model', 'rules', 'none'].includes(args.gate)) {
  console.error(`--gate must be auto, model, rules or none (got ${args.gate}).`);
  process.exit(1);
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(String(args.date || ''))) {
  console.error('--date YYYY-MM-DD is required (the edition date).');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// stage 1: extract
// ---------------------------------------------------------------------------

// Which python. A venv on PATH wins; otherwise the plain interpreter.
// Resolved, not assumed. See content-pipeline/python-bin.js.
const PYTHON = pythonBin();

function extract(pdf, opts) {
  const script = path.join(__dirname, 'layout.py');
  const argv = [script, pdf, '--dpi', String(opts.dpi)];
  if (opts.pages) argv.push('--pages', opts.pages);
  if (opts.lang) argv.push('--lang', opts.lang);

  const res = spawnSync(PYTHON, argv, {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    // Without this, a rupee sign in the text layer kills the process on a
    // Windows console whose default codepage is cp1252.
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`layout.py failed (${res.status}):\n${(res.stderr || '').slice(0, 2000)}`);
  }
  return parseJsonStdout(res.stdout, { label: 'layout.py' });
}

// ---------------------------------------------------------------------------
// AP detection
// ---------------------------------------------------------------------------

// Reuses the district and place list the PIB sweep already maintains, rather
// than keeping a second copy that drifts from it. The dateline is checked as
// well as the text, because a story filed from AMALAPURAM is an AP story even
// when its body never names the State.
function isAp(article) {
  const hay = `${article.headline} ${article.dateline} ${article.body}`.toLowerCase();
  return AP_TERMS.some((t) => hay.includes(t));
}

// ---------------------------------------------------------------------------
// stage 4: the gate
// ---------------------------------------------------------------------------

function describe(event, n) {
  const flags = [
    event.pages.length ? `p${event.pages.join('+')}` : null,
    event.prominence ? `${event.prominence}x` : null,
    event.dateline || null,
    event.ap ? 'AP' : null,
    event.parts > 1 ? `MERGED x${event.parts}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const opening = event.body.replace(/\s+/g, ' ').slice(0, 260);
  return `${n}. [${flags}] ${event.headline}\n     — ${opening}`;
}

// Articles per gate call. The whole edition would fit in one prompt, but a
// model gets measurably less careful towards the end of a 120-item list and a
// dropped verdict silently becomes a discard. Chunking keeps each judgement
// sharp; the calls are cheap enough that the round trips do not matter. Same
// reasoning, and same number, as the PIB lane.
const CHUNK = 60;

async function gate(events, opts) {
  // Read directly rather than through L.readPrompt, which resolves against
  // ca-daily's directory and would not find this lane's prompt.
  const prompt = fs.readFileSync(path.join(__dirname, 'prompt-np-shortlist.txt'), 'utf8');
  const system = prompt.replace(/\{\{MAX_ITEMS\}\}/g, String(opts.maxItems));

  const verdicts = new Map();
  for (let i = 0; i < events.length; i += CHUNK) {
    const chunk = events.slice(i, i + CHUNK);
    const list = chunk.map((e, k) => describe(e, i + k + 1)).join('\n');
    try {
      const raw = await L.complete({ system, user: list, model: opts.model, temperature: 0 });
      for (const v of L.parseJson(raw, { array: true })) {
        if (Number.isInteger(v.n)) verdicts.set(v.n - 1, v);
      }
    } catch (e) {
      // A failed chunk is reported, not fatal. Losing 60 articles to one bad
      // response is bad; losing the whole edition to it is worse.
      console.error(`  ! gate chunk ${i}-${i + chunk.length - 1} failed: ${e.message}`);
    }
  }
  return verdicts;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const started = Date.now();
  const all = [];

  // ---- stages 1 and 2, per PDF ----
  for (const pdf of args.pdfs) {
    if (!fs.existsSync(pdf)) throw new Error(`No such file: ${pdf}`);

    const hint = args.profile || guessProfile(pdf);
    const lang = args.lang || (PROFILES[hint] || PROFILES.generic).ocrLang;

    console.log(`\n=== ${path.basename(pdf)}`);
    console.log(`    profile hint=${hint || 'auto'}  ocr lang=${lang}  dpi=${args.dpi}`);

    const ir = extract(pdf, { dpi: args.dpi, pages: args.pages, lang });
    if (args.keepIr) {
      const p = path.join(__dirname, 'out', `${path.basename(pdf, '.pdf')}.ir.json`);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify(ir));
      console.log(`    IR written to ${path.relative(process.cwd(), p)}`);
    }

    for (const w of ir.warnings || []) console.log(`    ! ${w}`);
    if (!ir.ocr.binary) {
      console.log('    ! tesseract not found: image-only pages cannot be read');
    }

    const seg = segment(ir, { profile: args.profile || undefined });
    const pub = (PROFILES[seg.profile] || PROFILES.generic).label;

    console.log(
      `    ${ir.pages.length} pages -> ${seg.articles.length} articles ` +
      `(profile ${seg.profile}, ${seg.skipped.length} pages skipped)`
    );
    for (const s of seg.skipped) console.log(`      skip p${s.page}: ${s.reason}`);

    for (const a of seg.articles) {
      all.push({
        ...a,
        publication: pub,
        edition: path.basename(pdf, '.pdf'),
        date: args.date,
        language: seg.language,
      });
    }
  }

  if (!all.length) {
    console.error('\nNo articles were segmented. Nothing to do.');
    process.exit(1);
  }

  // ---- stage 3: merge ----
  const { events: groups, proposals, merged } = M.group(all);
  const events = groups.map((idx) => {
    const ev = M.collapse(all, idx);
    ev.ap = idx.some((i) => isAp(all[i]));
    return ev;
  });

  console.log(`\n=== merge`);
  console.log(`    ${all.length} articles -> ${events.length} events`);
  if (merged.length) {
    console.log(`    ${merged.length} same-script pair(s) merged automatically:`);
    for (const m of merged.slice(0, 8)) {
      console.log(`      ${m.score}  "${all[m.a].headline.slice(0, 46)}" ~ "${all[m.b].headline.slice(0, 46)}"`);
    }
  }
  if (proposals.length) {
    console.log(`    ${proposals.length} cross-script pair(s) proposed, NOT merged:`);
    for (const p of proposals.slice(0, 8)) {
      console.log(`      ${p.score}  "${all[p.a].headline.slice(0, 46)}" ~ "${all[p.b].headline.slice(0, 46)}"`);
    }
    console.log('      (cross-language merging needs a model verdict; see README)');
  }

  let shortlist = events;
  if (args.apOnly) {
    shortlist = events.filter((e) => e.ap);
    console.log(`\n--ap-only: ${shortlist.length} of ${events.length} events mention Andhra Pradesh`);
  }

  // Prominence first, so that if the gate's cap bites, it bites the fillers.
  // AP items are sorted ahead of everything regardless of prominence: a minor
  // AP item is worth more to this exam than a major national one.
  shortlist = [...shortlist].sort(
    (a, b) => (b.ap ? 1 : 0) - (a.ap ? 1 : 0) || (b.prominence || 0) - (a.prominence || 0)
  );

  // ---- stage 4: the gate ----
  const report = [];
  let kept = shortlist;

  // Which gate. `auto` prefers the model, because judging whether APPSC would
  // ask about a story is a question about an exam's taste - but falls back to
  // the rule gate rather than producing nothing, since a lane that cannot run
  // without a key is not a lane.
  let mode = args.gate;
  if (mode === 'auto') {
    mode = process.env.OPENAI_API_KEY ? 'model' : 'rules';
    if (mode === 'rules') {
      console.log('\n=== no OPENAI_API_KEY: using the deterministic rule gate');
      console.log('    set the key and re-run for the model gate, which judges better');
    }
  }

  if (mode === 'none') {
    console.log('\n=== gate skipped (--gate none): every event is being emitted');
  } else if (args.dryRun) {
    console.log(`\n=== gate skipped (--dry-run); would have used the ${mode} gate`);
    if (mode === 'model') {
      console.log(`    ${shortlist.length} events, ${CHUNK} per call ` +
        `(${Math.ceil(shortlist.length / CHUNK)} calls)`);
    }
    console.log('\n    the first 25 as the gate would see them:\n');
    for (const [i, e] of shortlist.slice(0, 25).entries()) {
      console.log(`    ${describe(e, i + 1).split('\n')[0]}`);
    }
  } else {
    const verdicts = mode === 'rules'
      ? gateByRules(shortlist, {
          maxItems: args.maxItems,
          onWarn: (m) => console.log(`    ! ${m}`),
        })
      : await gate(shortlist, args);

    if (!verdicts.size) {
      console.error('\nThe gate returned no verdicts. Refusing to emit an unfiltered file.');
      process.exit(1);
    }
    kept = [];
    let discarded = 0;
    let unjudged = 0;
    for (const [i, e] of shortlist.entries()) {
      const v = verdicts.get(i);
      if (!v) {
        unjudged++;
        continue;
      }
      if (v.duplicate_of) {
        report.push({ headline: e.headline, kept: false, why: `duplicate of #${v.duplicate_of}` });
        discarded++;
        continue;
      }
      if (!v.keep) {
        report.push({ headline: e.headline, kept: false, why: v.why || 'not examinable' });
        discarded++;
        continue;
      }
      e.gate = {
        why: v.why || '',
        ap: !!v.ap,
        needs_lookup: v.needs_lookup !== false,
        score: v.score ?? null,
        keywords: v.keywords || [],
      };
      kept.push(e);
      report.push({ headline: e.headline, kept: true, why: v.why || '' });
    }

    const rate = discarded / Math.max(1, discarded + kept.length);
    console.log(`\n=== gate`);
    console.log(`    kept ${kept.length}, discarded ${discarded} (${Math.round(rate * 100)}%)` +
      (unjudged ? `, ${unjudged} unjudged` : ''));
    if (rate < 0.7) {
      console.log('    ! a newspaper is mostly not examinable; a discard rate under 70%');
      console.log('      means the gate is keeping filler. Check prompt-np-shortlist.txt.');
    }
    for (const r of report.filter((r) => r.kept)) {
      console.log(`      KEEP  ${r.headline.slice(0, 58)}
            ${r.why}`);
    }
  }

  // ---- stage 5: emit ----
  const outPath = args.out || path.join(__dirname, 'out', `candidates-${args.date}.json`);

  if (args.dryRun) {
    console.log(`\nDry run: nothing written. Drop --dry-run to write ${path.relative(process.cwd(), outPath)}.`);
    return;
  }

  const candidates = kept.map((e) => toCandidate(e, args.date));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(candidates, null, 2));

  const secs = Math.round((Date.now() - started) / 1000);
  console.log(`\nWrote ${candidates.length} candidates to ${path.relative(process.cwd(), outPath)} in ${secs}s`);
  console.log('\nNext, and read it before you run it:');
  console.log(`  node content-pipeline/ca-daily/run.js --candidates "${outPath}" --date ${args.date} --dry-run`);
}

// A newspaper is a lead, not a citable source, and this is where that belief
// gets encoded. `url` carries a citation rather than a link because there is no
// link: an ePaper PDF has no public address, and inventing one would be worse
// than admitting there is none. `is_primary` is therefore always false, which is
// what makes these items visibly weaker than a PIB release in the review queue —
// correctly, since they are.
function toCandidate(event, date) {
  const cite = event.sources.map((s) => {
    const bits = [s.publication, s.edition, s.date, s.page ? `p${s.page}` : null];
    if (s.ocr) bits.push(`OCR${s.ocr_confidence != null ? ` ${s.ocr_confidence}%` : ''}`);
    return bits.filter(Boolean).join(', ');
  });

  return {
    headline: event.headline,
    date,
    text: [event.standfirst, event.body].filter(Boolean).join('\n\n'),
    sources: cite.map((c, i) => ({
      url: `newspaper:${slug(c)}`,
      publisher: event.sources[i].publication,
      is_primary: false,
      citation: c,
    })),
    // Carried through for the drafting stage and the review queue. `needs_lookup`
    // is the one that matters: it says this figure has not been seen in an
    // official document yet.
    origin: {
      lane: 'newspaper',
      pages: event.pages,
      publications: event.publications,
      dateline: event.dateline,
      prominence: event.prominence,
      merged_parts: event.parts,
      ap: !!event.ap,
      needs_lookup: event.gate ? event.gate.needs_lookup : true,
      gate_reason: event.gate ? event.gate.why : '',
      gate_score: event.gate ? (event.gate.score ?? null) : null,
      // Blueprint keyword angles matched deterministically, so the drafting
      // stage starts from "this looks like an Appointed / Committee / Index
      // question" rather than from nothing.
      keyword_angles: event.gate ? (event.gate.keywords || []) : [],
    },
  };
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// A filename is a weak hint and is treated as one: segment.js re-decides from
// the fonts actually present, and an explicit --profile always wins.
function guessProfile(pdf) {
  const base = path.basename(pdf).toLowerCase();
  if (/\b(?:th|hindu)\b/.test(base) || base.includes('thehindu')) return 'the-hindu';
  if (base.includes('eenadu') || base.includes('enadu')) return 'eenadu';
  return null;
}

main().catch((e) => {
  console.error(`\n${e.stack || e.message}`);
  process.exit(1);
});
