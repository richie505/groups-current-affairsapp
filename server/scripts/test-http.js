// HTTP smoke test: the routes as a client sees them.
//
// test-bridge.js has 300-odd checks and every one calls a library function
// directly, so a middleware ordered wrongly, a JSON body parser removed, or the
// login throttle wired to the wrong route would all ship green. This boots the
// real server as a child process on a spare port against a throwaway database
// and asserts the handful of contracts that must never regress:
//
//   health answers          admin routes refuse without a token
//   registration is closed  the eleventh bad login is throttled
//   an admin gets in        a student is refused the admin routes
//
// It runs in the deploy script's `npm test`, so it has to be fast (a few
// seconds) and self-contained (no network, no OpenAI key, no Chromium).

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 4900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-http-'));
const DB_PATH = path.join(TMP, 'ca.db');

let failed = 0;
function check(label, ok, detail = '') {
  if (ok) console.log(`  ok   ${label}`);
  else {
    failed += 1;
    console.log(`  FAIL ${label}${detail ? ` - ${detail}` : ''}`);
  }
}

async function req(method, url, { token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

async function waitForHealth(child, ms = 20000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error(`server exited early with ${child.exitCode}`);
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server did not answer /api/health in time');
}

function seedUsers() {
  // Straight into the temp database: registration is closed by design, and
  // the test must not depend on a route it is also testing.
  const bcrypt = require('bcryptjs');
  const Database = require('better-sqlite3');
  const db = new Database(DB_PATH);
  const ins = db.prepare(
    'INSERT INTO users (name, email, password_hash, role, exam_track) VALUES (?, ?, ?, ?, ?)'
  );
  ins.run('Smoke Admin', 'admin@smoke.test', bcrypt.hashSync('correct-horse-9', 10), 'admin', 'both');
  ins.run('Smoke Student', 'student@smoke.test', bcrypt.hashSync('correct-horse-9', 10), 'student', 'both');
  db.close();
}

async function main() {
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      DB_PATH,
      NODE_ENV: 'test',
      JWT_SECRET: 'smoke-test-secret-not-for-production',
      ALLOW_REGISTRATION: '0',
      OPENAI_API_KEY: '',
      LOG_ALL_REQUESTS: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => {
    log += d;
  });
  child.stderr.on('data', (d) => {
    log += d;
  });

  try {
    await waitForHealth(child);
    console.log(`HTTP smoke test on ${BASE}`);

    const health = await req('GET', '/api/health');
    check(
      'GET /api/health -> 200 { ok: true }',
      health.status === 200 && health.data && health.data.ok === true
    );

    const noToken = await req('GET', '/api/admin/days');
    check('GET /api/admin/days without token -> 401', noToken.status === 401, `got ${noToken.status}`);

    const badToken = await req('GET', '/api/admin/days', { token: 'not.a.jwt' });
    check('GET /api/admin/days with garbage token -> 401', badToken.status === 401, `got ${badToken.status}`);

    const reg = await req('POST', '/api/auth/register', {
      body: { name: 'x', email: 'x@smoke.test', password: 'long-enough-1' },
    });
    check('POST /api/auth/register -> 403 (registration closed)', reg.status === 403, `got ${reg.status}`);

    const noBody = await req('POST', '/api/auth/login', { body: {} });
    check('POST /api/auth/login with empty body -> 400', noBody.status === 400, `got ${noBody.status}`);

    // The server has opened the database and run its migrations, so the users
    // table exists. It reads users per request, so rows inserted from here are
    // visible immediately.
    seedUsers();

    const codes = [];
    for (let i = 0; i < 11; i += 1) {
      const r = await req('POST', '/api/auth/login', {
        body: { email: 'throttle@smoke.test', password: 'wrong' },
      });
      codes.push(r.status);
    }
    check(
      'login throttle: ten 401s then a 429 for the same email',
      codes.slice(0, 10).every((c) => c === 401) && codes[10] === 429,
      codes.join(' ')
    );

    const other = await req('POST', '/api/auth/login', {
      body: { email: 'admin@smoke.test', password: 'wrong' },
    });
    check('a different email is not caught by that bucket -> 401', other.status === 401, `got ${other.status}`);

    const admin = await req('POST', '/api/auth/login', {
      body: { email: 'admin@smoke.test', password: 'correct-horse-9' },
    });
    check(
      'admin login -> 200 with token',
      admin.status === 200 && admin.data && typeof admin.data.token === 'string',
      `got ${admin.status}`
    );
    const adminToken = admin.data && admin.data.token;

    const me = await req('GET', '/api/auth/me', { token: adminToken });
    check(
      'GET /api/auth/me with token -> 200, role admin',
      me.status === 200 && me.data && me.data.user && me.data.user.role === 'admin',
      `got ${me.status}`
    );

    const days = await req('GET', '/api/admin/days', { token: adminToken });
    check('GET /api/admin/days as admin -> 200', days.status === 200, `got ${days.status}`);

    const student = await req('POST', '/api/auth/login', {
      body: { email: 'student@smoke.test', password: 'correct-horse-9' },
    });
    const denied = await req('GET', '/api/admin/days', { token: student.data && student.data.token });
    check('GET /api/admin/days as student -> 403', denied.status === 403, `got ${denied.status}`);

    // Every /api route sits behind requireAuth, so an unknown path answers 401
    // to a stranger (nothing about the route table leaks) and 404 to a user.
    const strangerMiss = await req('GET', '/api/no-such-route');
    check('unknown API route without token -> 401', strangerMiss.status === 401, `got ${strangerMiss.status}`);
    const userMiss = await req('GET', '/api/no-such-route', { token: adminToken });
    check('unknown API route with token -> 404 JSON, not the SPA shell', userMiss.status === 404 && userMiss.data !== null, `got ${userMiss.status}`);
  } catch (e) {
    failed += 1;
    console.log(`  FAIL ${e.message}`);
    console.log(log.split('\n').slice(-15).join('\n'));
  } finally {
    child.kill();
    await new Promise((r) => setTimeout(r, 300));
    try {
      fs.rmSync(TMP, { recursive: true, force: true });
    } catch {
      // Windows can hold the WAL for a moment after kill; a leftover temp dir is harmless.
    }
  }

  console.log(failed ? `\n${failed} HTTP check(s) failed` : '\nHTTP smoke test passed');
  process.exit(failed ? 1 : 0);
}

main();
