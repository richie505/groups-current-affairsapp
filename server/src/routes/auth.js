const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken, requireAuth } = require('../auth');
const {
  loginRateLimit, signupRateLimit, recordFailure, recordSuccess, clearForEmail,
} = require('../lib/rateLimit');
const { findValidReset, consumeReset } = require('../lib/passwordReset');

const router = express.Router();

const TRACKS = ['g1', 'g2', 'both'];
const { MODES: PACING_MODES, MIN_MINUTES, MAX_MINUTES } = require('../lib/pacing');

// WHETHER ANYONE MAY SIGN THEMSELVES UP.
//
// Open by default, which is what this app has always done — closing it silently
// would break the signup flow of a running deployment, and that is not a
// decision a hardening pass gets to make.
//
// But it IS a decision, and it was never a considered one. Every item in this
// app cost money to draft, and the admin screen already has the other model
// built: create the student, send them a reset link. A deployment that intends
// that model sets ALLOW_REGISTRATION=0 and the public form stops working.
// Preflight says which mode is in force so the choice is made once, on purpose.
const registrationOpen = () => process.env.ALLOW_REGISTRATION !== '0';

// Eight, not six.
//
// Six is two guesses' worth of entropy short of anything, and this is the only
// credential in the system — there is no second factor and no device trust. It
// applies to new passwords only; nobody is locked out of an account they
// already have.
const MIN_PASSWORD = 8;

// Ordered before the throttle deliberately. With registration closed, running
// the rate limiter first meant a blocked attempt still consumed throttle budget
// and came back with "too many accounts created from here" — which is both the
// wrong reason and a misleading one, since no account was or could be created.
function registrationEnabled(req, res, next) {
  if (registrationOpen()) return next();
  res.status(403).json({
    error: 'Accounts are created by the administrator. Ask them for an invite link.',
  });
}

router.post('/register', registrationEnabled, signupRateLimit, (req, res) => {
  const { name, email, password, exam_track } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are required.' });
  }
  if (password.length < MIN_PASSWORD) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters.` });
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
    pacing: 'off',
    pacing_minutes: 4,
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
      pacing: user.pacing || 'off',
      pacing_minutes: user.pacing_minutes ?? 4,
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
  if (!new_password || String(new_password).length < MIN_PASSWORD) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters.` });
  }
  const reset = findValidReset(db, req.params.token);
  if (!reset) return res.status(404).json({ error: 'This reset link is no longer valid.' });

  consumeReset(db, {
    resetId: reset.id,
    userId: reset.user_id,
    passwordHash: bcrypt.hashSync(String(new_password), 10),
  });

  const user = db
    .prepare('SELECT id, name, email, role, exam_track, pacing, pacing_minutes FROM users WHERE id = ?')
    .get(reset.user_id);

  // A reset is the recovery path for someone locked out, so it clears that
  // account's failed-attempt counter — otherwise they'd set a new password and
  // still be throttled out of using it.
  clearForEmail(user.email);

  res.json({ ok: true, token: signToken(user), user });
});

// Who am I, NOW.
//
// This used to hand back the decoded token, which made it a mirror rather than
// an answer: the token lives thirty days, so any setting changed since login —
// or changed on another device — came back at its old value. Paced learning made
// that visible, because the account page seeds its control from here and showed
// "Off" for a student whose pace was set.
//
// Reading the row costs one indexed lookup on app load, and it is the one
// endpoint whose whole job is to be current.
router.get('/me', requireAuth, (req, res) => {
  const user = db
    .prepare('SELECT id, name, email, role, exam_track, pacing, pacing_minutes FROM users WHERE id = ?')
    .get(req.user.id);
  if (!user) return res.status(401).json({ error: 'Account no longer exists.' });
  res.json({ user });
});

// Update your own name, exam track and/or password.
//
// Email is deliberately not editable: it's the login identity, so changing it
// belongs with an admin rather than behind a form with no verification step.
// A password change requires the current password even though the caller is
// authenticated — a token left live on a borrowed device shouldn't be enough
// to lock the real owner out.
router.put('/me', requireAuth, (req, res) => {
  const { name, exam_track, pacing, pacing_minutes, current_password, new_password } = req.body || {};
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

  // Paced learning. Changing it takes effect on the next request and never
  // touches a clock that is already running — turning it off unlocks whatever
  // was waiting, turning it on does not retroactively lock what was open.
  if (pacing !== undefined) {
    if (!PACING_MODES.includes(pacing)) {
      return res.status(400).json({ error: `Pace must be one of ${PACING_MODES.join(', ')}.` });
    }
    updates.push('pacing = ?');
    values.push(pacing);
  }

  // The student's own reading time. Saved whichever mode is selected, so
  // choosing a preset and coming back to 'Your own time' finds the number they
  // set rather than the default.
  if (pacing_minutes !== undefined) {
    const n = Math.round(Number(pacing_minutes));
    if (!Number.isFinite(n) || n < MIN_MINUTES || n > MAX_MINUTES) {
      return res
        .status(400)
        .json({ error: `Your own reading time must be between ${MIN_MINUTES} and ${MAX_MINUTES} minutes.` });
    }
    updates.push('pacing_minutes = ?');
    values.push(n);
  }

  if (new_password !== undefined && new_password !== '') {
    if (String(new_password).length < MIN_PASSWORD) {
      return res
        .status(400)
        .json({ error: `New password must be at least ${MIN_PASSWORD} characters.` });
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
    .prepare('SELECT id, name, email, role, exam_track, pacing, pacing_minutes FROM users WHERE id = ?')
    .get(req.user.id);
  // Both the name and the track are baked into the JWT (the navbar and the
  // lens read them from there), so a save has to hand back a fresh token or
  // the header keeps showing the old values.
  res.json({ user, token: signToken(user) });
});

module.exports = router;
