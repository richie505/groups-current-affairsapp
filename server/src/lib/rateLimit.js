// Login throttling.
//
// The site is public and login was unthrottled, so an attacker could grind
// passwords at whatever rate the box would answer. This makes that expensive
// without putting a wall in front of a student who has genuinely forgotten
// which of their two passwords they used.
//
// In-memory on purpose: one small VPS, one process, and no Redis to run or
// keep alive. A restart forgets everything, which costs an attacker a pause
// and costs a locked-out student nothing.

const WINDOW_MS = 15 * 60 * 1000;
const SWEEP_MS = 5 * 60 * 1000;

// Two limits, deliberately far apart.
//
// Guessing one account's password is the attack worth stopping hard, so the
// per-email limit is tight. The per-IP limit exists only to stop one host
// spraying many accounts, and it has to stay loose: a coaching centre or a
// hostel shares a single NAT address, so a tight IP limit would lock out a
// roomful of students because ten of them mistyped a password that hour.
const MAX_PER_EMAIL = 10;
const MAX_PER_IP = 60;
const limitFor = (key) => (key.startsWith('email:') ? MAX_PER_EMAIL : MAX_PER_IP);

const buckets = new Map(); // key -> { count, firstAt }

function prune(now = Date.now()) {
  for (const [key, b] of buckets) {
    if (now - b.firstAt > WINDOW_MS) buckets.delete(key);
  }
}

// Unref'd so it never holds the process open on shutdown.
const sweeper = setInterval(() => prune(), SWEEP_MS);
if (typeof sweeper.unref === 'function') sweeper.unref();

function bucketFor(key, now) {
  const existing = buckets.get(key);
  if (!existing || now - existing.firstAt > WINDOW_MS) {
    const fresh = { count: 0, firstAt: now };
    buckets.set(key, fresh);
    return fresh;
  }
  return existing;
}

// Keyed on both the IP and the email being tried. IP alone punishes everyone
// behind one college or office NAT the moment a single person fat-fingers a
// password; email alone lets a botnet spread an attack across addresses.
function keysFor(req) {
  const email = String(req.body?.email || '').toLowerCase().trim();
  return [`ip:${req.ip}`, email ? `email:${email}` : null].filter(Boolean);
}

function retryAfterSeconds(keys, now) {
  const waits = keys
    .map((k) => ({ b: buckets.get(k), max: limitFor(k) }))
    .filter(({ b, max }) => b && b.count >= max)
    .map(({ b }) => Math.ceil((WINDOW_MS - (now - b.firstAt)) / 1000));
  return waits.length ? Math.max(...waits) : 0;
}

// Blocks the request when either key is over its limit. Counting happens in
// recordFailure, not here — a correct password must never be held against
// anyone, however many times they got it wrong first.
function loginRateLimit(req, res, next) {
  const now = Date.now();
  const wait = retryAfterSeconds(keysFor(req), now);
  if (wait > 0) {
    res.set('Retry-After', String(wait));
    return res.status(429).json({
      error: `Too many failed sign-in attempts. Try again in ${Math.ceil(wait / 60)} minute${
        Math.ceil(wait / 60) === 1 ? '' : 's'
      }.`,
    });
  }
  next();
}

function recordFailure(req) {
  const now = Date.now();
  for (const key of keysFor(req)) bucketFor(key, now).count += 1;
}

function recordSuccess(req) {
  for (const key of keysFor(req)) buckets.delete(key);
}

// After a password reset, so someone who locked themselves out can actually
// use the password they just set. Scoped to the one account: clearing every
// bucket would let a reset on any account wipe the throttle currently holding
// back an attack on a different one.
function clearForEmail(email) {
  const key = `email:${String(email || '').toLowerCase().trim()}`;
  buckets.delete(key);
}

// resetAll exists for the test harness — the in-memory buckets are shared by
// every request in the process, so without it one test's failures leak into
// the next one's assertions.
function resetAll() {
  buckets.clear();
}

module.exports = {
  loginRateLimit,
  recordFailure,
  recordSuccess,
  clearForEmail,
  resetAll,
  MAX_PER_EMAIL,
  MAX_PER_IP,
  WINDOW_MS,
};
