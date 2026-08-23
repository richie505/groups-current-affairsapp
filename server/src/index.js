const path = require('path');

// The .env lives at the REPO ROOT, and dotenv resolves a bare config() against
// process.cwd(). The server is started from `server/` — by npm --prefix, by the
// launch config, by anyone in that directory — so the bare call found nothing
// and silently loaded no environment at all.
//
// Silently is the problem. dotenv does not complain about a missing file, and
// every variable has a working fallback, so the app ran perfectly: PORT already
// defaults to 4100, CORS is empty anyway, and the drafting pipeline reads the
// same file itself through its own loader with an explicit path.
//
// Except JWT_SECRET, whose fallback is a well-known development string. Every
// session token this app has ever issued was signed with it, while the .env sat
// beside the code carrying a generated secret and a comment explaining that
// changing it would log everyone out. It had never been used.
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const contentRoutes = require('./routes/content');
const adminRoutes = require('./routes/admin');
const topicRoutes = require('./routes/topics');
const editionRoutes = require('./routes/editions');

const app = express();

// nginx terminates TLS and proxies to this process, so without this every
// request looks like it came from 127.0.0.1 and the login throttle would be
// one shared bucket for the entire internet.
app.set('trust proxy', 1);

// Express advertises itself in every response. It tells an attacker which
// framework to look up CVEs for and tells a user nothing.
app.disable('x-powered-by');

// SECURITY HEADERS, HAND-WRITTEN RATHER THAN VIA helmet.
//
// helmet is fifteen headers behind a config object, and this app needs five of
// them. Written out, each one can carry the reason it is set, and the CSP —
// the only one with any real risk of breaking the page — is visible rather
// than assembled from defaults.
//
// The CSP is tight because this app can afford it: no CDN, no analytics, no
// embedded video, no inline event handlers. Vite emits hashed .js and .css
// files and nothing else, so 'self' covers the whole application.
//   - `style-src` needs 'unsafe-inline': React sets inline styles on elements
//     (the pacing bar's width is a percentage computed each tick) and there is
//     no nonce path through react-dom for that.
//   - `connect-src 'self'` is what stops a successful injection from posting a
//     student's data anywhere.
//   - `frame-ancestors 'none'` is the clickjacking defence; X-Frame-Options is
//     kept beside it for browsers that predate CSP level 2.
// THE ONE INLINE SCRIPT, ADMITTED BY HASH RATHER THAN BY 'unsafe-inline'.
//
// index.html carries a few lines that read the saved theme and set the dark
// class BEFORE first paint. It has to be inline and it has to be synchronous:
// as an external file it is another blocking request, and deferred it produces
// exactly the white flash it exists to prevent.
//
// `'unsafe-inline'` on script-src would admit it and would also admit every
// injected <script> in the app, which is most of what a CSP is for. A hash
// admits this script and nothing else.
//
// Computed from the built file at startup rather than pasted in as a constant.
// A pasted hash is correct until someone edits those four lines, and then the
// theme flash comes back with a CSP error in a console nobody has open. This
// cannot drift: if the script changes, the hash changes with it.
function inlineScriptHashes(html) {
  const crypto = require('crypto');
  const out = [];
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    out.push(`'sha256-${crypto.createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
  }
  return out;
}

const webDist = path.join(__dirname, '..', '..', 'web', 'dist');
let scriptHashes = [];
try {
  scriptHashes = inlineScriptHashes(
    require('fs').readFileSync(path.join(webDist, 'index.html'), 'utf8')
  );
  console.log(`[csp] ${scriptHashes.length} inline script(s) allowed by hash`);
} catch {
  // No build yet — `npm run dev` against the Vite server, or a first boot
  // before `npm --prefix web run build`. The API still works; preflight is
  // what refuses to deploy in that state.
  console.warn('[csp] no web/dist/index.html — serving the API without a frontend');
}

const CSP = [
  "default-src 'self'",
  ["script-src 'self'", ...scriptHashes].join(' '),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', CSP);
  // Stops a browser from second-guessing a Content-Type — the mechanism behind
  // "uploaded .txt is executed as script".
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  // The full URL of an item page names what a student is reading. Send the
  // origin to other sites and nothing at all on a downgrade.
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // None of these are used, and a page that does not ask for them cannot be
  // tricked into using them.
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  // Only meaningful over TLS, and only honoured there — so it is set whenever
  // the request arrived over https, which behind nginx means the forwarded
  // proto. Sending it on plain http is ignored by browsers but would be a lie.
  if (req.secure) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// The frontend is served by this same process, so the app itself never makes a
// cross-origin request and needs no CORS headers at all. Cross-origin access
// is opt-in via CORS_ORIGINS (comma-separated) and off by default.
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      cb(null, allowedOrigins.includes(origin));
    },
  })
);

// AN ACCESS LOG, WITH NOTHING IN IT THAT IDENTIFIES A STUDENT.
//
// When something goes wrong in production the first question is "what did the
// request look like", and until now the only answer was the stack trace of a
// 500 — nothing at all for a 404, a 403, or a route that is merely slow.
//
// What it deliberately does NOT record: the query string, the body, the IP, or
// the user's email. A search query is what a student was looking for and a
// query string routinely carries one; logging it turns an ops tool into a
// record of what each person is studying. The user ID is enough to answer
// "was this one account or many", and the path is enough to find the route.
//
// Errors and slow requests only, unless LOG_ALL_REQUESTS is set. A line per
// request is noise at any real traffic level, and noise is how a log stops
// being read.
const LOG_ALL = process.env.LOG_ALL_REQUESTS === '1';
const SLOW_MS = Number(process.env.SLOW_REQUEST_MS || 1000);
app.use((req, res, next) => {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const slow = ms >= SLOW_MS;
    if (!LOG_ALL && res.statusCode < 400 && !slow) return;
    console.log(
      `${res.statusCode} ${req.method} ${req.path} ${ms.toFixed(0)}ms` +
        `${req.user ? ` user=${req.user.id}` : ''}${slow ? ' SLOW' : ''}`
    );
  });
  next();
});

// Mounted before express.json: the edition upload takes a raw PDF body, and a
// JSON parser in front of it would consume the stream and leave req.body empty.
app.use('/api/admin/editions', editionRoutes);

app.use(express.json({ limit: '10mb' }));

// A HEALTH CHECK THAT CAN ACTUALLY FAIL.
//
// `{ ok: true }` from a constant is not a health check, it is a check that
// Node is running — which the TCP connection already proved. It would answer
// 200 with the database file deleted, and a load balancer would keep sending
// traffic to a process that cannot serve a single page.
//
// So it reads. One trivial query against a table that must exist, which is
// enough to catch the failures that actually happen here: a missing or
// unreadable database file, a corrupt page, a disk that has filled up, a
// migration half-applied.
app.get('/api/health', (req, res) => {
  try {
    const db = require('./db');
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM ca_items').get();
    res.json({ ok: true, items: n, uptime_s: Math.round(process.uptime()) });
  } catch (e) {
    console.error('[health] database unreachable:', e.message);
    res.status(503).json({ ok: false, error: 'Database unreachable.' });
  }
});
app.use('/api/auth', authRoutes);
app.use('/api', contentRoutes);
app.use('/api/topics', topicRoutes);
app.use('/api/admin', adminRoutes);


// The service worker decides what every other request may use from cache, so
// it is the one file that must never itself be served stale — a cached sw.js
// would pin an old caching policy in place indefinitely.
app.use(
  express.static(webDist, {
    setHeaders(res, filePath) {
      if (path.basename(filePath) === 'sw.js') res.setHeader('Cache-Control', 'no-cache');
    },
  })
);
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(webDist, 'index.html'), (err) => {
    if (err) next();
  });
});

app.use((err, req, res, next) => {
  // The route is logged with the stack. A bare stack from inside express or
  // better-sqlite3 names a file in node_modules and not the request that got
  // there, which is the one thing needed to reproduce it.
  console.error(`[500] ${req.method} ${req.path}`, err && err.stack ? err.stack : err);

  // A body-parser or raw-body rejection is the client's fault, not the
  // server's, and reporting a 10 MB JSON body as "something went wrong on the
  // server" sends whoever is debugging it to look in the wrong place.
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return res.status(413).json({ error: 'That upload is too large.' });
  }
  if (err && (err.type === 'entity.parse.failed' || err.status === 400)) {
    return res.status(400).json({ error: 'That request body could not be read.' });
  }

  // The message itself never crosses the wire. It routinely carries a file
  // path, a SQL statement or a column name, and none of that helps the person
  // looking at the screen.
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

const PORT = process.env.PORT || 4100;
const server = app.listen(PORT, () => {
  console.log(
    `APPSC Current Affairs API listening on http://localhost:${PORT}` +
      ` (${process.env.NODE_ENV || 'development'})`
  );
});

// ---------------------------------------------------------------------------
// shutting down without losing the last write
// ---------------------------------------------------------------------------

// SQLite in WAL mode keeps recent commits in a sidecar file until a checkpoint
// folds them back into the database. Killing the process leaves them there —
// recoverable, but only by the next process to open the file, and only if the
// -wal file travels with it. A backup taken between those two moments copies a
// database that is missing its most recent writes and gives no sign of it.
//
// So: stop accepting connections, let in-flight requests finish, checkpoint,
// close. The 10-second cap is because a stuck request must not be able to hold
// a deploy open indefinitely — systemd would SIGKILL it anyway, and doing it
// here means the checkpoint still runs.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal} — closing`);

  const done = (code) => {
    try {
      const db = require('./db');
      // TRUNCATE rather than PASSIVE: it waits for readers and then empties the
      // WAL, which is what makes the .db file self-contained for a backup.
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();
      console.log('[shutdown] database checkpointed and closed');
    } catch (e) {
      console.error('[shutdown] could not close the database cleanly:', e.message);
      code = code || 1;
    }
    process.exit(code || 0);
  };

  const force = setTimeout(() => {
    console.error('[shutdown] requests still open after 10s — closing anyway');
    done(0);
  }, 10_000);
  force.unref();

  server.close(() => done(0));
}
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => shutdown(signal));

// A crash must be loud and must be fatal.
//
// Node's default for an unhandled rejection is already to terminate, but the
// default report is a bare stack with no marker saying the process is now
// dying. These exist so the log line that precedes a restart says which of the
// two happened, and so an uncaught exception does not leave the process alive
// in a state nobody has reasoned about.
process.on('uncaughtException', (err) => {
  console.error('[fatal] uncaught exception:', err && err.stack ? err.stack : err);
  shutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] unhandled promise rejection:', reason);
  shutdown('unhandledRejection');
});
