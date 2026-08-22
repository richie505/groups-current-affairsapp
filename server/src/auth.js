const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
const TOKEN_TTL = '30d';

// exam_track rides in the token because the track lens decides what every
// screen renders — reading it from a separate request would mean the first
// paint after a reload shows the wrong lane and then flips.
function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
      name: user.name,
      email: user.email,
      exam_track: user.exam_track || 'both',
      // The pacing setting rides in the token for the same reason the track
      // does: the item page decides whether to show a reading clock on first
      // paint, and fetching it separately would mean the clock appears a beat
      // after the notes.
      pacing: user.pacing || 'off',
      pacing_minutes: user.pacing_minutes ?? 4,
    },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not logged in.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired, please log in again.' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}

module.exports = { signToken, requireAuth, requireAdmin, JWT_SECRET };
