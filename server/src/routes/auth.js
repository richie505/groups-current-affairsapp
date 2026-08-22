const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken, requireAuth } = require('../auth');
const { loginRateLimit, recordFailure, recordSuccess, clearForEmail } = require('../lib/rateLimit');
const { findValidReset, consumeReset } = require('../lib/passwordReset');

const router = express.Router();

const TRACKS = ['g1', 'g2', 'both'];

router.post('/register', (req, res) => {
  const { name, email, password, exam_track } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are required.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }
  // 'both' is the default because it is the common case: most people sit
  // Group-II while preparing Group-I, and the whole point of the app is that
  // they need not read the news twice.
  const track = TRACKS.includes(exam_track) ? exam_track : 'both';

  const cleanEmail = email.toLowerCase().trim();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
  if (existing) {
    return res.status(409).json({ error: 'An account with that email already exists.' });
  }
  const info = db
    .prepare(
      'INSERT INTO users (name, email, password_hash, role, exam_track) VALUES (?, ?, ?, ?, ?)'
    )
    .run(name.trim(), cleanEmail, bcrypt.hashSync(password, 10), 'student', track);

  const user = {
    id: info.lastInsertRowid,
    name: name.trim(),
    email: cleanEmail,
    role: 'student',
    exam_track: track,
  };
  res.json({ token: signToken(user), user });
});

router.post('/login', loginRateLimit, (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    recordFailure(req);
    // One message for both cases — saying which half was wrong would turn the
    // form into a way to test whether an email has an account here.
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  recordSuccess(req);
  res.json({
    token: signToken(user),
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      exam_track: user.exam_track,
    },
  });
});

// ---- Password reset (link issued by an admin) ---------------------------
//
// Public on purpose: whoever holds the link is, by construction, whoever the
// admin sent it to. The token is the credential.

router.get('/reset/:token', (req, res) => {
  const reset = findValidReset(db, req.params.token);
  if (!reset) return res.status(404).json({ valid: false, error: 'This reset link is no longer valid.' });
  res.json({ valid: true, name: reset.name });
});

router.post('/reset/:token', (req, res) => {
  const { new_password } = req.body || {};
  if (!new_password || String(new_password).length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }
  const reset = findValidReset(db, req.params.token);
  if (!reset) return res.status(404).json({ error: 'This reset link is no longer valid.' });

  consumeReset(db, {
    resetId: reset.id,
    userId: reset.user_id,
    passwordHash: bcrypt.hashSync(String(new_password), 10),
  });

  const user = db
    .prepare('SELECT id, name, email, role, exam_track FROM users WHERE id = ?')
    .get(reset.user_id);

  // A reset is the recovery path for someone locked out, so it clears that
  // account's failed-attempt counter — otherwise they'd set a new password and
  // still be throttled out of using it.
  clearForEmail(user.email);

  res.json({ ok: true, token: signToken(user), user });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// Update your own name, exam track and/or password.
//
// Email is deliberately not editable: it's the login identity, so changing it
// belongs with an admin rather than behind a form with no verification step.
// A password change requires the current password even though the caller is
// authenticated — a token left live on a borrowed device shouldn't be enough
// to lock the real owner out.
router.put('/me', requireAuth, (req, res) => {
  const { name, exam_track, current_password, new_password } = req.body || {};
  const updates = [];
  const values = [];

  if (name !== undefined) {
    const trimmed = String(name).trim();
    if (trimmed.length < 2) return res.status(400).json({ error: 'Name must be at least 2 characters.' });
    updates.push('name = ?');
    values.push(trimmed);
  }

  if (exam_track !== undefined) {
    if (!TRACKS.includes(exam_track)) {
      return res.status(400).json({ error: 'Exam track must be g1, g2 or both.' });
    }
    updates.push('exam_track = ?');
    values.push(exam_track);
  }

  if (new_password !== undefined && new_password !== '') {
    if (String(new_password).length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters.' });
    }
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!row) return res.status(404).json({ error: 'Account not found.' });
    if (!current_password || !bcrypt.compareSync(String(current_password), row.password_hash)) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }
    updates.push('password_hash = ?');
    values.push(bcrypt.hashSync(String(new_password), 10));
  }

  if (!updates.length) return res.status(400).json({ error: 'Nothing to update.' });

  values.push(req.user.id);
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const user = db
    .prepare('SELECT id, name, email, role, exam_track FROM users WHERE id = ?')
    .get(req.user.id);
  // Both the name and the track are baked into the JWT (the navbar and the
  // lens read them from there), so a save has to hand back a fresh token or
  // the header keeps showing the old values.
  res.json({ user, token: signToken(user) });
});

module.exports = router;
