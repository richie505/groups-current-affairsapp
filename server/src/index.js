require('dotenv').config();
const path = require('path');
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
