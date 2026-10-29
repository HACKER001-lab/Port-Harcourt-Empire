const express = require("express");
const { query, tx } = require("../db");
const { getConfig } = require("../config");
const { asyncHandler, bad, conflict, forbidden, unauthorized } = require("../errors");
const {
  hashPassword, verifyPassword, createSession, revokeCurrentSession, revokeOtherSessions,
  issueToken, consumeToken, requireAccount, requireVerified, rateLimit
} = require("../auth");
const { normalizeEmail, validatePassword, validateName, validateAvatar, requireObject, clampInt } = require("../validate");
const { sendVerification, sendPasswordReset, devOutbox } = require("../mail");
const { privateCharacter, settleCharacter, activeOverrides, writeFeed, worldClock } = require("../game");
const { publicAccount } = require("../session");

const router = express.Router();

async function bootstrapCharacter(client, accountId, displayName, avatar, cfg) {
  const { rows } = await client.query(
    `SELECT c.id AS city_id, d.id AS district_id
       FROM cities c JOIN districts d ON d.city_id = c.id
      WHERE c.slug = 'port-harcourt' AND d.slug = 'old-gra'`
  );
  if (!rows[0]) throw new Error("World seed missing (port-harcourt / old-gra)");
  const { city_id, district_id } = rows[0];
  const character = await client.query(
    `INSERT INTO characters (account_id, display_name, avatar, city_id, district_id, money, start_age, age)
     VALUES ($1, $2, $3, $4, $5, $6, 18, 18) RETURNING *`,
    [accountId, displayName, avatar, city_id, district_id, String(cfg.starting_money)]
  );
  await writeFeed(client, {
    kind: "player_joined",
    characterId: character.rows[0].id,
    districtId: district_id,
    message: `${displayName} arrived in Port Harcourt.`
  });
  return character.rows[0];
}

router.post("/register", asyncHandler(async (req, res) => {
  rateLimit(`register:${req.ip}`, 20, 60 * 60 * 1000);
  const body = requireObject(req.body);
  const email = normalizeEmail(body.email);
  const password = validatePassword(body.password);
  const displayName = validateName(body.displayName);
  const avatar = validateAvatar(body.avatar);
  const cfg = await getConfig(query);

  const created = await tx(async (client) => {
    const exists = await client.query("SELECT 1 FROM accounts WHERE email = $1", [email]);
    if (exists.rows[0]) throw conflict("EMAIL_TAKEN", "An account already uses that email address.");
    const account = await client.query(
      `INSERT INTO accounts (email, password_hash) VALUES ($1, $2)
       RETURNING id, email, role, status, email_verified_at, created_at`,
      [email, hashPassword(password)]
    );
    const character = await bootstrapCharacter(client, account.rows[0].id, displayName, avatar, cfg);
    return { account: account.rows[0], character };
  });

  const token = await issueToken(created.account.id, "verify_email", 24 * 60);
  await sendVerification(query, created.account, token);
  await createSession(created.account.id, req, res);
  res.status(201).json({
    account: publicAccount(created.account),
    character: privateCharacter(created.character),
    verificationRequired: true,
    emailDelivery: devOutbox ? "dev-outbox" : "email"
  });
}));

router.post("/login", asyncHandler(async (req, res) => {
  const body = requireObject(req.body);
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  rateLimit(`login-ip:${req.ip}`, 30, 15 * 60 * 1000);
  rateLimit(`login-email:${email}`, 10, 15 * 60 * 1000);

  const { rows } = await query(
    `SELECT id, email, role, status, email_verified_at, created_at, password_hash, failed_logins, locked_until
       FROM accounts WHERE email = $1`,
    [email]
  );
  const account = rows[0];
  if (account && account.locked_until && new Date(account.locked_until) > new Date()) {
    throw forbidden("ACCOUNT_LOCKED", "Too many failed attempts. Try again in a few minutes.");
  }
  if (!account || !verifyPassword(password, account.password_hash)) {
    if (account) {
      await query(
        `UPDATE accounts SET failed_logins = failed_logins + 1,
                locked_until = CASE WHEN failed_logins + 1 >= 8 THEN now() + interval '15 minutes' ELSE locked_until END
          WHERE id = $1`,
        [account.id]
      );
    }
    throw new (require("../errors").HttpError)(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
  }
  if (account.status === "banned") {
    throw forbidden("ACCOUNT_BANNED", "This account is banned. Contact support.");
  }

  await query("UPDATE accounts SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1", [account.id]);
  await createSession(account.id, req, res);

  const cfg = await getConfig(query);
  const settled = await tx(async (client) => {
    const ch = await client.query("SELECT id FROM characters WHERE account_id = $1", [account.id]);
    if (!ch.rows[0]) return null;
    return settleCharacter(client, ch.rows[0].id, cfg);
  });

  res.json({
    account: publicAccount(account),
    character: settled ? privateCharacter(settled.character) : null
  });
}));

router.post("/logout", asyncHandler(async (req, res) => {
  await revokeCurrentSession(req, res);
  res.status(204).end();
}));

router.get("/me", requireAccount, asyncHandler(async (req, res) => {
  const cfg = await getConfig(query);
  const data = await tx(async (client) => {
    const ch = await client.query("SELECT id FROM characters WHERE account_id = $1", [req.account.id]);
    if (!ch.rows[0]) return { character: null, overrides: [], clock: await worldClock(client) };
    const settled = await settleCharacter(client, ch.rows[0].id, cfg);
    const overrides = await activeOverrides(client, ch.rows[0].id);
    return { character: settled.character, overrides, clock: settled.clock };
  });

  res.json({
    account: publicAccount(req.account),
    character: data.character ? privateCharacter(data.character) : null,
    overrides: data.overrides.map((o) => ({
      resource: o.resource,
      unlimited: o.unlimited,
      expiresAt: o.expires_at,
      reason: o.reason
    })),
    world: {
      serverNow: data.clock.now,
      gameDay: data.clock.gameDay,
      gameWeek: data.clock.gameWeek,
      daySeconds: data.clock.daySeconds
    },
    features: { devMailOutbox: devOutbox }
  });
}));

router.post("/verify-email", asyncHandler(async (req, res) => {
  rateLimit(`verify:${req.ip}`, 20, 15 * 60 * 1000);
  const body = requireObject(req.body);
  const accountId = await consumeToken(body.token, "verify_email");
  if (!accountId) throw bad("INVALID_TOKEN", "That verification link is invalid or has expired.");
  await query("UPDATE accounts SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now() WHERE id = $1", [accountId]);
  res.json({ ok: true, emailVerified: true });
}));

router.post("/resend-verification", requireAccount, asyncHandler(async (req, res) => {
  rateLimit(`resend:${req.account.id}`, 3, 60 * 60 * 1000);
  if (req.account.email_verified_at) throw bad("ALREADY_VERIFIED", "This email address is already verified.");
  const token = await issueToken(req.account.id, "verify_email", 24 * 60);
  await sendVerification(query, req.account, token);
  res.json({ ok: true, emailDelivery: devOutbox ? "dev-outbox" : "email" });
}));

router.post("/forgot-password", asyncHandler(async (req, res) => {
  rateLimit(`forgot:${req.ip}`, 6, 15 * 60 * 1000);
  const body = requireObject(req.body);
  const email = normalizeEmail(body.email);
  const { rows } = await query("SELECT id, email FROM accounts WHERE email = $1 AND status <> 'banned'", [email]);
  if (rows[0]) {
    const token = await issueToken(rows[0].id, "reset_password", 60);
    await sendPasswordReset(query, rows[0], token);
  }
  // Same response either way: no account enumeration.
  res.json({ ok: true, message: "If that address has an account, a reset link has been sent." });
}));

router.post("/reset-password", asyncHandler(async (req, res) => {
  rateLimit(`reset:${req.ip}`, 10, 15 * 60 * 1000);
  const body = requireObject(req.body);
  const password = validatePassword(body.password);
  const accountId = await consumeToken(body.token, "reset_password");
  if (!accountId) throw bad("INVALID_TOKEN", "That reset link is invalid or has expired.");
  await query("UPDATE accounts SET password_hash = $2, failed_logins = 0, locked_until = NULL, updated_at = now() WHERE id = $1", [
    accountId, hashPassword(password)
  ]);
  // A reset signs out every existing session.
  await query("UPDATE sessions SET revoked_at = now() WHERE account_id = $1 AND revoked_at IS NULL", [accountId]);
  res.clearCookie("gcr_session", { path: "/" });
  res.json({ ok: true });
}));

router.post("/change-password", requireAccount, requireVerified, asyncHandler(async (req, res) => {
  rateLimit(`change-pw:${req.account.id}`, 5, 60 * 60 * 1000);
  const body = requireObject(req.body);
  const next = validatePassword(body.newPassword);
  const { rows } = await query("SELECT password_hash FROM accounts WHERE id = $1", [req.account.id]);
  if (!rows[0] || !verifyPassword(String(body.currentPassword || ""), rows[0].password_hash)) {
    throw unauthorized("Current password is incorrect.");
  }
  await query("UPDATE accounts SET password_hash = $2, updated_at = now() WHERE id = $1", [req.account.id, hashPassword(next)]);
  await revokeOtherSessions(req.account.id, req);
  res.json({ ok: true });
}));

module.exports = router;
