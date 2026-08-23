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

// Mounted before express.json: the edition upload takes a raw PDF body, and a
// JSON parser in front of it would consume the stream and leave req.body empty.
app.use('/api/admin/editions', editionRoutes);

app.use(express.json({ limit: '10mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api', contentRoutes);
app.use('/api/topics', topicRoutes);
app.use('/api/admin', adminRoutes);

const webDist = path.join(__dirname, '..', '..', 'web', 'dist');

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
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

const PORT = process.env.PORT || 4100;
app.listen(PORT, () => {
  console.log(`APPSC Current Affairs API listening on http://localhost:${PORT}`);
});
