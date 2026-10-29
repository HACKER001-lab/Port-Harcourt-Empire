// Authentication: scrypt password hashes, database-backed sessions in an
// httpOnly cookie, verified-email gate for write actions, role checks.

const crypto = require("crypto");
const { query } = require("./db");
const { HttpError, unauthorized, forbidden } = require("./errors");

const SESSION_COOKIE = "gcr_session";
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

/* ------------------------------------------------------------ passwords */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltB64, hashB64] = String(stored).split("$");
    if (scheme !== "scrypt") return false;
    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(hashB64, "base64");
    const actual = crypto.scryptSync(password, salt, expected.length, {
      N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024
    });
    return crypto.timingSafeEqual(expected, actual);
  } catch (_) {
    return false;
  }
}

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const newToken = () => crypto.randomBytes(32).toString("base64url");

/* ------------------------------------------------------------ cookies */
function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.COOKIE_SECURE === "1",
  path: "/",
  maxAge: SESSION_TTL_MS
});

async function createSession(accountId, req, res) {
  const token = newToken();
  await query(
    `INSERT INTO sessions (account_id, token_hash, user_agent, expires_at)
     VALUES ($1, $2, $3, now() + interval '30 days')`,
    [accountId, sha256(token), String(req.headers["user-agent"] || "").slice(0, 300)]
  );
  res.cookie(SESSION_COOKIE, token, cookieOptions());
  return token;
}

async function revokeCurrentSession(req, res) {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) {
    await query("UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL", [sha256(token)]);
  }
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

async function revokeOtherSessions(accountId, req) {
  const token = readCookie(req, SESSION_COOKIE);
  await query(
    "UPDATE sessions SET revoked_at = now() WHERE account_id = $1 AND revoked_at IS NULL AND token_hash <> $2",
    [accountId, sha256(token || "")]
  );
}

/* ------------------------------------------------------------ tokens */
async function issueToken(accountId, kind, ttlMinutes) {
  const token = newToken();
  await query(
    `INSERT INTO auth_tokens (account_id, kind, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + ($4 || ' minutes')::interval)`,
    [accountId, kind, sha256(token), String(ttlMinutes)]
  );
  return token;
}

async function consumeToken(token, kind) {
  if (!token || typeof token !== "string") return null;
  const { rows } = await query(
    `UPDATE auth_tokens SET used_at = now()
      WHERE token_hash = $1 AND kind = $2 AND used_at IS NULL AND expires_at > now()
      RETURNING account_id`,
    [sha256(token), kind]
  );
  return rows[0] ? rows[0].account_id : null;
}

/* ------------------------------------------------------------ middleware */
async function loadSession(req, _res, next) {
  try {
    req.account = null;
    req.sessionId = null;
    const token = readCookie(req, SESSION_COOKIE);
    if (!token) return next();
    const { rows } = await query(
      `SELECT a.id, a.email, a.role, a.status, a.email_verified_at, a.created_at, s.id AS session_id,
              s.expires_at
         FROM sessions s JOIN accounts a ON a.id = s.account_id
        WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
      [sha256(token)]
    );
    if (rows[0]) {
      req.account = rows[0];
      req.sessionId = rows[0].session_id;
      query("UPDATE sessions SET last_seen_at = now() WHERE id = $1 AND last_seen_at < now() - interval '5 minutes'", [
        rows[0].session_id
      ]).catch(() => {});
    }
    next();
  } catch (err) {
    next(err);
  }
}

function requireAccount(req, _res, next) {
  if (!req.account) return next(unauthorized());
  if (req.account.status === "banned") {
    return next(forbidden("ACCOUNT_BANNED", "This account is banned. Contact support."));
  }
  next();
}

function requireVerified(req, _res, next) {
  if (!req.account) return next(unauthorized());
  if (!req.account.email_verified_at) {
    return next(forbidden("EMAIL_UNVERIFIED", "Verify your email address to play online."));
  }
  next();
}

function requireAdmin(req, _res, next) {
  if (!req.account) return next(unauthorized());
  if (req.account.role !== "admin") return next(forbidden("FORBIDDEN", "Administrator access required."));
  next();
}

function requireActive(req, _res, next) {
  if (!req.account) return next(unauthorized());
  if (req.account.status !== "active") {
    return next(forbidden("ACCOUNT_RESTRICTED", "This account is suspended."));
  }
  next();
}

/** State-changing requests must carry the client header; blocks cross-site forms. */
function requireWrite(req, _res, next) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  if (req.get("x-requested-with") !== "gcr") {
    return next(new HttpError(403, "CSRF_CHECK_FAILED", "Request blocked: missing application header."));
  }
  const origin = req.get("origin");
  const allowed = String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (origin && allowed.length && !allowed.includes(origin)) {
    return next(new HttpError(403, "ORIGIN_NOT_ALLOWED", "Request blocked: origin not allowed."));
  }
  next();
}

/* ------------------------------------------------------------ rate limits */
const buckets = new Map();

/** Development/test only: clear counters so repeated test runs start clean. */
function resetRateLimits() {
  buckets.clear();
}

function rateLimit(key, max, windowMs) {
  const now = Date.now();
  if (buckets.size > 10000) buckets.clear();
  const hits = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    const retry = Math.ceil((windowMs - (now - hits[0])) / 1000);
    throw new HttpError(429, "RATE_LIMITED", `Too many attempts. Try again in ${retry}s.`);
  }
  hits.push(now);
  buckets.set(key, hits);
}

module.exports = {
  SESSION_COOKIE,
  hashPassword,
  verifyPassword,
  createSession,
  revokeCurrentSession,
  revokeOtherSessions,
  issueToken,
  consumeToken,
  loadSession,
  requireAccount,
  requireVerified,
  requireAdmin,
  requireActive,
  requireWrite,
  rateLimit,
  resetRateLimits,
  sha256
};
