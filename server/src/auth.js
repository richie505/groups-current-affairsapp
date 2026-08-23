const jwt = require('jsonwebtoken');

const DEV_SECRET = 'dev-only-secret-change-me';
const JWT_SECRET = process.env.JWT_SECRET || DEV_SECRET;

// A WARNING WAS NOT ENOUGH, AND THE REASON IS IN THIS APP'S OWN HISTORY.
//
// The fallback above is a working secret, so an app running on it behaves
// exactly like one running on a real one. That is how this app signed every
// token it ever issued with a string published in its own source: the .env was
// never loaded, nothing broke, and the one line of evidence was a console
// warning in a log nobody reads on a server nobody watches.
//
// A warning is the right shape for development, where the fallback is a
// convenience and the developer is the only user. It is the wrong shape for
// production, where "anyone can mint an admin token" is not a note. So in
// production the process refuses to start, which is the only signal that
// cannot be scrolled past.
//
// NODE_ENV is the switch because it is the one every host already sets. A
// deployment that forgets to set it gets the warning and the development
// secret, which is the same behaviour as before this check existed — this can
// only ever make things stricter, never looser.
if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error(
      '[auth] FATAL: JWT_SECRET is not set and NODE_ENV=production.\n' +
        '       Without it every session token is signed with a secret published in this\n' +
        '       repository, so anyone who has read the source can mint an admin token.\n' +
        '       Generate one and put it in the repo-root .env:\n' +
        '         node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"\n' +
        '       Changing it logs every existing session out, which is expected and correct.'
    );
    process.exit(1);
  }
  console.warn(
    '[auth] JWT_SECRET is not set — falling back to the development secret, which is ' +
      'in the source. Anyone can mint a token. Set it in the repo-root .env before ' +
      'this is reachable by anyone but you.'
  );
}

// A secret that is set but is the published one is the same hole with an extra
// step, and it is an easy accident: copy .env.example, paste the string from a
// comment, ship it.
if (process.env.JWT_SECRET === DEV_SECRET && process.env.NODE_ENV === 'production') {
  console.error('[auth] FATAL: JWT_SECRET is set to the development secret from the source.');
  process.exit(1);
}
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
