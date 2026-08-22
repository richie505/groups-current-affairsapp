#!/usr/bin/env node
'use strict';

// The whole daily run, in one command.
//
//   node content-pipeline/ca-daily/daily.js --date 2026-08-21 --dry-run
//   node content-pipeline/ca-daily/daily.js --date 2026-08-21
//   node content-pipeline/ca-daily/daily.js --date 2026-08-21 --ap-only
//
// Four stages:
//
//   1. DISCOVER   sweep.js parses PIB's own release index. No LLM — asking a
//                 model what happened invites invented URLs, whereas asking PIB
//                 for its index returns the actual list.
//   2. SHORTLIST  one cheap model call over headlines and ministries only,
//                 deciding which few of ~40 releases are worth drafting. This is
//                 the discard gate, and running it on headlines rather than
//                 bodies is what makes the whole thing affordable: fetching 40
//                 full releases to throw 32 away is pure waste.
//   3. FETCH      full body text for the survivors only, via fetch-source.js.
//                 Note quality is capped by how much source text reaches the
//                 model, so this stage is where the notes are actually won.
//   4. DRAFT      run.js does the dual-lane routing, the corrections guard, the
//                 MCQs, validation and dedupe, and writes drafts.
//
// Nothing is published. Everything lands in Admin → Review queue.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const L = require('./lib');
const { sweep } = require('./sweep');

L.loadEnv();

function parseArgs(argv) {
  const args = {
    date: null,
    dryRun: false,
    apOnly: false,
    maxItems: 10,
    mcqsPer: 4,
    model: process.env.OPENAI_MODEL || 'gpt-4o',
    // A cheaper model is plenty for the shortlist: it is a triage judgement on
    // a headline, not a writing task. Override if the shortlist is keeping junk.
    shortlistModel: process.env.OPENAI_SHORTLIST_MODEL || 'gpt-4o-mini',
    noMcqs: false,
    keepCandidates: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--date') args.date = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--ap-only') args.apOnly = true;
    else if (a === '--max-items') args.maxItems = Number(argv[++i]);
    else if (a === '--mcqs-per') args.mcqsPer = Number(argv[++i]);
    else if (a === '--model') args.model = argv[++i];
    else if (a === '--shortlist-model') args.shortlistModel = argv[++i];
    else if (a === '--no-mcqs') args.noMcqs = true;
    else if (a === '--keep-candidates') args.keepCandidates = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function yesterdayIso() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Headlines per shortlist call. Two hundred-odd items arrive on a normal day
// across twenty feeds, and judging them in one prompt works but degrades: the
// model gets less careful towards the end of a long list, and a dropped verdict
// silently becomes a discard. Chunking keeps each judgement sharp, and the calls
// are cheap enough that the extra round trips do not matter.
const CHUNK = 60;

function describeItem(it, n) {
  const flags = [it.is_primary ? 'PRIMARY' : null, it.ap ? 'AP' : null, it.opinion ? 'OPINION' : null]
    .filter(Boolean)
    .join(',');
  const where = it.category ? `${it.source} · ${it.category}` : it.source;
  const line = `${n}. [${where}${flags ? ` · ${flags}` : ''}] (${it.date}) ${it.headline}`;
  // The feed's own summary, trimmed. It costs little and often settles whether a
  // vague headline is a policy change or a speech.
  return it.summary ? `${line}\n     — ${it.summary.slice(0, 220)}` : line;
}

async function shortlistChunk(chunk, offset, args, prompt) {
  const list = chunk.map((it, i) => describeItem(it, offset + i + 1)).join('\n');
  const raw = await L.complete({
    system: prompt,
    user: list,
    model: args.shortlistModel,
    temperature: 0,
  });
  return L.parseJson(raw, { array: true });
}

async function shortlist(items, args) {
  const prompt = L.readPrompt('prompt-shortlist.txt');

  const verdicts = [];
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    try {
      verdicts.push(...(await shortlistChunk(chunk, i, args, prompt)));
    } catch (e) {
      // A failed chunk is reported and skipped. Losing 60 headlines to a bad
      // response is better than losing the run, and saying so means the gap is
      // visible rather than looking like a quiet day.
      console.log(`      ! shortlist chunk ${i + 1}-${i + chunk.length} failed (${e.message}) — skipped`);
    }
  }

  // Index by `n` rather than trusting array order — a model that drops or
  // reorders an entry would otherwise shift every verdict onto the wrong item,
  // which is the kind of bug that looks like bad judgement rather than a bug.
  const byN = new Map(verdicts.map((v) => [Number(v.n), v]));

  const kept = [];
  const dropped = [];
  for (let i = 0; i < items.length; i++) {
    const v = byN.get(i + 1);
    const item = { ...items[i], why: v?.why || '', ap: items[i].ap || !!v?.ap };
    // No verdict is treated as a discard, not a keep. An unjudged item should
    // not slip through to drafting on a technicality.
    if (v?.keep && v?.duplicate_of == null) kept.push(item);
    else {
      dropped.push({
        ...item,
        why:
          v?.duplicate_of != null
            ? `Duplicate of item ${v.duplicate_of}.`
            : v?.why || 'Not shortlisted.',
      });
    }
  }

  // AP first among the survivors, so a --max-items cap never cuts an Andhra
  // Pradesh item in favour of a national one. AP is the coverage that decides
  // marks and the coverage no other source provides.
  kept.sort((a, b) => {
    if (a.ap !== b.ap) return a.ap ? -1 : 1;
    if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
    return 0;
  });

  return { kept, dropped };
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    console.log(fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8'));
    return;
  }

  // Default to yesterday, not today: PIB posts through the day, so a run at
  // 08:00 for "today" sees a fraction of it.
  const date = args.date || yesterdayIso();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error('--date must be YYYY-MM-DD');
    process.exit(1);
  }

  const outDir = L.ensureOutDir();

  // ---- 1. discover ----
  console.log(`[1/4] Discovering across all sources for ${date}…`);
  const { stats, perSource, items } = await sweep({
    from: date,
    to: date,
    ap: args.apOnly,
    limit: Infinity,
  });
  const failed = perSource.filter((s) => s.error);
  console.log(
    `      ${perSource.length - failed.length}/${perSource.length} sources ok · ` +
      `${stats.fetched} fetched → ${stats.inWindow} on ${date} → ${stats.afterNoise} after noise → ` +
      `${stats.afterDedupe} deduped → ${items.length} to triage`
  );
  console.log(`      ${items.filter((i) => i.ap).length} AP-relevant · ` +
    `${items.filter((i) => i.is_primary).length} from primary sources`);
  // Named, not just counted: a silently dropped source looks like a quiet news
  // day, which is the one failure mode that would go unnoticed for weeks.
  for (const f of failed) console.log(`      ! ${f.name} unavailable: ${f.error}`);

  if (!items.length) {
    console.log(
      '      Nothing found. News feeds carry only the last few days and the PIB\n' +
        '      listing covers the current month — for anything older, use the browser.'
    );
    return;
  }

  // ---- 2. shortlist ----
  console.log(`[2/4] Shortlisting on headlines (${args.shortlistModel})…`);
  const { kept, dropped } = await shortlist(items, args);
  const shortlisted = kept.slice(0, args.maxItems);
  const overflow = kept.slice(args.maxItems);

  console.log(`      kept ${kept.length} · discarded ${dropped.length} of ${items.length}` +
    ` (${Math.round((dropped.length / items.length) * 100)}%)`);
  for (const k of shortlisted) console.log(`      keep ${k.ap ? '[AP] ' : ''}${k.headline.slice(0, 78)}`);
  // A cap that silently drops work reads as "we covered everything" when it
  // didn't, so say what was cut.
  if (overflow.length) {
    console.log(`      NOTE: --max-items ${args.maxItems} cut ${overflow.length} shortlisted item(s):`);
    for (const o of overflow) console.log(`            ${o.headline.slice(0, 70)}`);
  }

  if (!shortlisted.length) {
    console.log('      Nothing survived the shortlist. That is a legitimate outcome for a quiet day.');
    return;
  }

  // ---- 3. fetch bodies ----
  console.log(`[3/4] Fetching ${shortlisted.length} release bodies…`);
  const { fetchBody } = require('./fetch-source');
  const candidates = [];
  for (const it of shortlisted) {
    try {
      const text = await fetchBody(it.url);
      candidates.push({
        headline: it.headline,
        date: it.date,
        text,
        sources: [{ url: it.url, publisher: it.publisher, is_primary: it.is_primary }],
      });
      console.log(`      ${text.length} chars — ${it.headline.slice(0, 62)}`);
    } catch (e) {
      // Skipped rather than sent through with an empty body: the drafting prompt
      // is forbidden from filling gaps from memory, so a bodyless candidate can
      // only produce a hollow item.
      console.log(`      SKIP (${e.message}) — ${it.headline.slice(0, 62)}`);
    }
  }

  if (!candidates.length) {
    console.log('      No bodies could be fetched. Nothing to draft.');
    return;
  }

  const candFile = path.join(outDir, `${date}-candidates.json`);
  fs.writeFileSync(candFile, JSON.stringify(candidates, null, 2));
  console.log(`      wrote ${candFile}`);

  // ---- 4. draft ----
  console.log(`[4/4] Drafting (${args.model})…\n`);
  const runArgs = [
    path.join(__dirname, 'run.js'),
    '--candidates', candFile,
    '--date', date,
    '--model', args.model,
    '--mcqs-per', String(args.mcqsPer),
    '--fresh',
  ];
  if (args.dryRun) runArgs.push('--dry-run');
  if (args.noMcqs) runArgs.push('--no-mcqs');

  const res = spawnSync(process.execPath, runArgs, { stdio: 'inherit' });

  if (!args.keepCandidates && !args.dryRun) {
    // The drafts are in the database and the run's log is in ca_runs; the
    // intermediate file is only useful while debugging.
    try {
      fs.unlinkSync(candFile);
    } catch {
      /* nothing to clean up */
    }
  }

  process.exit(res.status || 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
