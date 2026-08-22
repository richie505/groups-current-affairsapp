const crypto = require('crypto');

// Admin-issued password resets.
//
// The token is 256 bits of randomness, handed back exactly once when the link
// is created and never stored in the clear — only its SHA-256 lands in the
// database. A dump of the db therefore contains no usable links.
//
// SHA-256 rather than bcrypt here on purpose: this is a high-entropy random
// token, not a human-chosen password, so there is nothing for a slow hash to
// protect against. Guessing it is infeasible either way, and the fast hash
// keeps lookup a plain indexed equality check.

const TTL_HOURS = 24;

const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');

function createResetToken(db, { userId, createdBy }) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + TTL_HOURS * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);

  db.transaction(() => {
    // Issuing a new link retires any outstanding one, so a link sent by
    // mistake — or to the wrong person — stops working the moment the admin
    // generates a replacement.
    db.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL").run(userId);
    db.prepare(
      'INSERT INTO password_resets (user_id, token_hash, expires_at, created_by) VALUES (?, ?, ?, ?)'
    ).run(userId, hash(token), expiresAt, createdBy ?? null);
  })();

  return { token, expiresAt, ttlHours: TTL_HOURS };
}

// Returns the row only if the token exists, hasn't been used and hasn't
// expired. Every failure mode collapses to null — the page that calls this
// says "this link is no longer valid" either way, since telling the holder
// of a bad token *why* it failed tells them nothing they should know.
function findValidReset(db, token) {
  if (!token || typeof token !== 'string') return null;
  return (
    db
      .prepare(
        `SELECT pr.id, pr.user_id, u.name, u.email
           FROM password_resets pr
           JOIN users u ON u.id = pr.user_id
          WHERE pr.token_hash = ?
            AND pr.used_at IS NULL
            AND pr.expires_at > datetime('now')`
      )
      .get(hash(token)) || null
  );
}

function consumeReset(db, { resetId, userId, passwordHash }) {
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId);
    db.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE id = ?").run(resetId);
    // Belt and braces: burn every other outstanding link for this account too,
    // so an older one that was also sent out can't be replayed afterwards.
    db.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL").run(
      userId
    );
  })();
}

module.exports = { createResetToken, findValidReset, consumeReset, TTL_HOURS };
