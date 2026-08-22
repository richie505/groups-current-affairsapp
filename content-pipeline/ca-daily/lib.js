'use strict';

// Shared plumbing for the daily pipeline: env, the OpenAI call, the resumable
// state file, and validation.
//
// Validation deliberately calls the *server's* validators rather than
// reimplementing them. A generator that validates loosely against a server that
// validates strictly produces a pipeline which appears to work and silently
// drops a fraction of its output — the worst failure mode available, because the
// loss is invisible until someone counts.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const OUT_DIR = path.join(__dirname, 'out');
const STATE_FILE = path.join(__dirname, 'state.jsonl');

// Minimal .env reader. dotenv lives under server/node_modules and is not
// resolvable from here, and this needs exactly one feature — KEY=value lines.
// Existing environment variables win, so a shell export can override the file.
function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function db() {
  return require(path.join(ROOT, 'server', 'src', 'db'));
}

function serverValidators() {
  const admin = require(path.join(ROOT, 'server', 'src', 'routes', 'admin'));
  return { validateMcq: admin.validateMcq, validateItem: admin.validateItem };
}

function readPrompt(name) {
  return fs.readFileSync(path.join(__dirname, name), 'utf8');
}

// ---- the model call ------------------------------------------------------

// Sampling parameters that some newer models reject outright rather than
// clamping. gpt-5.6-luna, for instance, answers a temperature of 0.3 with
// "Only the default (1) value is supported" and a 400.
//
// Handled by dropping whichever parameter the API names and retrying, rather
// than by keeping a list of which models allow what: the list would go stale
// with every release, and the error message will not. Behaviour for models that
// do accept a custom temperature is unchanged.
const DROPPABLE_PARAMS = new Set(['temperature', 'top_p']);

// Which endpoint a given model is served from.
//
// The chat-completions shape is the same at OpenAI, DeepSeek, Together, Groq and
// most others, so a provider is a base URL and a key and nothing more. Kept as a
// pair of environment variables rather than a provider abstraction, because an
// abstraction here would be three interfaces wrapping one POST.
//
// WHY TWO PROVIDERS AT ONCE
//
// Because the two jobs in this pipeline have opposite requirements. Shortlisting
// reads forty headlines and picks the examinable ones — judgement over supplied
// text, no recall, and a wrong call costs one article that the next day's paper
// will cover again. Drafting writes static notes: Articles, sections, landmark
// cases, AP schemes, recalled rather than read. A model that invents there
// teaches a candidate something false, confidently, and this project has spent
// weeks on exactly that failure.
//
// So the cheap model gets the cheap job. Leave ALT_BASE_URL unset and everything
// runs on OpenAI as before.
function endpointFor(model) {
  const alt = process.env.ALT_MODELS
    ? process.env.ALT_MODELS.split(',').map((m) => m.trim()).filter(Boolean)
    : [];
  const useAlt = process.env.ALT_BASE_URL && alt.includes(model);
  const base = useAlt
    ? process.env.ALT_BASE_URL
    : process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const key = useAlt
    ? process.env.ALT_API_KEY || process.env.OPENAI_API_KEY
    : process.env.OPENAI_API_KEY;
  return { url: `${base.replace(/\/+$/, '')}/chat/completions`, key, provider: useAlt ? 'alt' : 'openai' };
}

async function complete({ system, user, model, temperature = 0.3, maxRetries = 3 }) {
  const useModel = model || process.env.OPENAI_MODEL || 'gpt-4o';
  const { url, key, provider } = endpointFor(useModel);
  if (!key) {
    throw new Error(
      provider === 'alt'
        ? 'ALT_API_KEY is not set, and OPENAI_API_KEY is not there to fall back on.'
        : 'OPENAI_API_KEY is not set. Put it in the repo root .env.'
    );
  }

  const drop = new Set();
  let lastError;
  // The extra attempts are the parameter-dropping ones, so that shedding a
  // rejected parameter never eats into the transient-failure retry budget.
  for (let attempt = 1; attempt <= maxRetries + DROPPABLE_PARAMS.size; attempt++) {
    try {
      const payload = {
        model: useModel,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      };
      if (!drop.has('temperature')) payload.temperature = temperature;

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(payload),
      });
      if (res.status === 429 || res.status >= 500) {
        // Retry the transient ones with backoff. A rate limit forty items into a
        // run should cost a pause, not the run.
        throw Object.assign(new Error(`HTTP ${res.status}`), { retryable: true });
      }
      if (!res.ok) {
        const body = await res.text();
        let param = null;
        try {
          param = JSON.parse(body)?.error?.param;
        } catch {
          // Not JSON; fall through to the thrown error below.
        }
        if (res.status === 400 && DROPPABLE_PARAMS.has(param) && !drop.has(param)) {
          drop.add(param);
          continue;
        }
        throw new Error(`${useModel} ${res.status}: ${body.slice(0, 300)}`);
      }
      const json = await res.json();
      return json.choices?.[0]?.message?.content || '';
    } catch (e) {
      lastError = e;
      if (!e.retryable || attempt === maxRetries) break;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  throw lastError;
}

// Models wrap JSON in prose or a code fence often enough that stripping it is
// cheaper than fighting it. Extracts the outermost object or array.
function parseJson(text, { array = false } = {}) {
  let t = String(text).trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const open = array ? '[' : '{';
  const close = array ? ']' : '}';
  const start = t.indexOf(open);
  const end = t.lastIndexOf(close);
  if (start === -1 || end === -1) throw new Error(`No JSON ${array ? 'array' : 'object'} found in response.`);
  return JSON.parse(t.slice(start, end + 1));
}

// ---- resumable state ----------------------------------------------------

// Every outcome is appended as one JSON line, so a crash or rate-limit at item
// #40 resumes rather than restarting — and never pays twice for work already
// done.
function loadState() {
  if (!fs.existsSync(STATE_FILE)) return new Map();
  const out = new Map();
  for (const line of fs.readFileSync(STATE_FILE, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      out.set(row.key, row);
    } catch {
      // A half-written final line after a hard kill is expected; skip it.
    }
  }
  return out;
}

function recordState(row) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.appendFileSync(STATE_FILE, `${JSON.stringify(row)}\n`);
}

// ---- dedupe -------------------------------------------------------------

// Normalised question hash. The sibling static-notes corpus accumulated 58
// within-subsection and 35 cross-subsection duplicate questions before this was
// added, so it is a real problem rather than a hypothetical one.
function questionHash(question) {
  const norm = String(question)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return crypto.createHash('sha256').update(norm).digest('hex').slice(0, 32);
}

function existingQuestionHashes(database) {
  const set = new Set();
  for (const r of database.prepare('SELECT question FROM ca_mcqs').all()) {
    set.add(questionHash(r.question));
  }
  return set;
}

// ---- run bookkeeping ---------------------------------------------------

function startRun(database, { windowStart, windowEnd, mode, model }) {
  const info = database
    .prepare(
      `INSERT INTO ca_runs (window_start, window_end, mode, model, status)
       VALUES (?, ?, ?, ?, 'running')`
    )
    .run(windowStart, windowEnd, mode, model);
  return info.lastInsertRowid;
}

function finishRun(database, runId, { status, candidates, drafted, discarded, log }) {
  database
    .prepare(
      `UPDATE ca_runs SET status = ?, candidates = ?, drafted = ?, discarded = ?,
         log = ?, finished_at = datetime('now') WHERE id = ?`
    )
    .run(status, candidates, drafted, discarded, log, runId);
}

function ensureOutDir() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  return OUT_DIR;
}

module.exports = {
  ROOT,
  OUT_DIR,
  STATE_FILE,
  loadEnv,
  db,
  serverValidators,
  readPrompt,
  complete,
  endpointFor,
  parseJson,
  loadState,
  recordState,
  questionHash,
  existingQuestionHashes,
  startRun,
  finishRun,
  ensureOutDir,
};
