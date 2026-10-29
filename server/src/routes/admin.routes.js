const express = require("express");
const { query, tx } = require("../db");
const { getConfig } = require("../config");
const { asyncHandler, bad, notFound, forbidden } = require("../errors");
const { requireAccount, requireAdmin, requireActive, rateLimit } = require("../auth");
const { settleCharacter, applyMoney, privateCharacter, activeOverrides } = require("../game");
const { validateIdempotencyKey, validateName, requireObject } = require("../validate");

const router = express.Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESOURCES = new Set(["money", "energy", "health"]);

router.use(requireAccount, requireActive, requireAdmin);

async function audit(client, { actorId, targetAccountId, action, reason, before, after }) {
  await client.query(
    `INSERT INTO admin_audit_log (actor_account_id, target_account_id, action, reason, before, after)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [actorId, targetAccountId, action, reason || "", JSON.stringify(before || {}), JSON.stringify(after || {})]
  );
}

function requireReason(value) {
  const reason = String(value || "").trim();
  if (reason.length < 3 || reason.length > 240) throw bad("REASON_REQUIRED", "A reason (3-240 characters) is required.");
  return reason;
}

async function targetCharacter(client, characterId) {
  const { rows } = await client.query(
    `SELECT c.*, a.email, a.role, a.status AS account_status
       FROM characters c JOIN accounts a ON a.id = c.account_id WHERE c.id = $1`,
    [characterId]
  );
  if (!rows[0]) throw notFound("Player not found.");
  return rows[0];
}

/* ------------------------------------------------------------ read */
router.get("/players", asyncHandler(async (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 60);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 25));
  const params = [];
  let where = "1 = 1";
  if (q) {
    params.push(`%${q}%`);
    where = `(c.display_name ILIKE $1 OR a.email ILIKE $1)`;
  }
  params.push(limit);
  const { rows } = await query(
    `SELECT c.id, c.display_name, c.avatar, c.age, c.money, c.energy, c.health, c.fame,
            c.duel_wins, c.duel_losses, c.discoverable, a.email, a.role, a.status AS account_status,
            d.name AS district_name,
            (SELECT count(*)::int FROM businesses b WHERE b.owner_character_id = c.id) AS business_count
       FROM characters c
       JOIN accounts a ON a.id = c.account_id
       JOIN districts d ON d.id = c.district_id
      WHERE ${where}
      ORDER BY c.created_at DESC LIMIT $${params.length}`,
    params
  );
  res.json({
    items: rows.map((r) => ({
      id: r.id,
      displayName: r.display_name,
      avatar: r.avatar,
      age: r.age,
      money: Number(r.money),
      energy: r.energy,
      health: r.health,
      fame: r.fame,
      wins: r.duel_wins,
      losses: r.duel_losses,
      discoverable: r.discoverable,
      email: r.email,
      role: r.role,
      status: r.account_status,
      district: r.district_name,
      businessCount: r.business_count
    }))
  });
}));

router.get("/players/:characterId", asyncHandler(async (req, res) => {
  if (!UUID_RE.test(req.params.characterId)) throw bad("INVALID_ID", "Invalid player id.");
  const cfg = await getConfig(query);
  const data = await tx(async (client) => {
    const character = await targetCharacter(client, req.params.characterId);
    const settled = await settleCharacter(client, character.id, cfg);
    const overrides = await activeOverrides(client, character.id);
    const ledger = await client.query(
      "SELECT id, delta, balance_after, kind, ref, meta, created_at FROM ledger WHERE character_id = $1 ORDER BY id DESC LIMIT 25",
      [character.id]
    );
    const auditRows = await client.query(
      "SELECT id, action, reason, before, after, created_at FROM admin_audit_log WHERE target_account_id = $1 ORDER BY id DESC LIMIT 20",
      [character.account_id]
    );
    return { character, settled, overrides, ledger: ledger.rows, audit: auditRows.rows };
  });

  res.json({
    account: {
      id: data.character.account_id,
      email: data.character.email,
      role: data.character.role,
      status: data.character.account_status
    },
    character: privateCharacter(data.settled.character),
    overrides: data.overrides,
    ledger: data.ledger.map((l) => ({
      id: l.id,
      delta: Number(l.delta),
      balanceAfter: Number(l.balance_after),
      kind: l.kind,
      ref: l.ref,
      meta: l.meta,
      createdAt: l.created_at
    })),
    auditLog: data.audit
  });
}));

router.get("/audit", asyncHandler(async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const { rows } = await query(
    `SELECT l.id, l.action, l.reason, l.before, l.after, l.created_at,
            actor.email AS actor_email, target.email AS target_email
       FROM admin_audit_log l
       LEFT JOIN accounts actor ON actor.id = l.actor_account_id
       LEFT JOIN accounts target ON target.id = l.target_account_id
      ORDER BY l.id DESC LIMIT $1`,
    [limit]
  );
  res.json({ items: rows });
}));

router.get("/ledger", asyncHandler(async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const params = [limit];
  let where = "1 = 1";
  if (req.query.characterId && UUID_RE.test(req.query.characterId)) {
    params.unshift(req.query.characterId);
    where = "character_id = $1";
  }
  const { rows } = await query(
    `SELECT l.id, l.character_id, c.display_name, l.delta, l.balance_after, l.kind, l.meta, l.created_at
       FROM ledger l JOIN characters c ON c.id = l.character_id
      WHERE ${where} ORDER BY l.id DESC LIMIT $${params.length}`,
    params
  );
  res.json({
    items: rows.map((r) => ({ ...r, delta: Number(r.delta), balance_after: Number(r.balance_after) }))
  });
}));

router.get("/overview", asyncHandler(async (_req, res) => {
  const [accounts, characters, businesses, duels, transfers, money] = await Promise.all([
    query("SELECT count(*)::int AS n FROM accounts"),
    query("SELECT count(*)::int AS n FROM characters"),
    query("SELECT count(*)::int AS n FROM businesses WHERE status = 'open'"),
    query("SELECT count(*)::int AS n FROM duels WHERE created_at > now() - interval '1 day'"),
    query("SELECT count(*)::int AS n, COALESCE(SUM(amount),0) AS total FROM transfers WHERE created_at > now() - interval '1 day'"),
    query("SELECT COALESCE(SUM(money),0) AS total FROM characters")
  ]);
  res.json({
    accounts: accounts.rows[0].n,
    characters: characters.rows[0].n,
    openBusinesses: businesses.rows[0].n,
    duels24h: duels.rows[0].n,
    transfers24h: transfers.rows[0].n,
    transferVolume24h: Number(transfers.rows[0].total),
    totalMoney: Number(money.rows[0].total)
  });
}));

/* ------------------------------------------------------------ mutations */
router.post("/players/:characterId/grant", asyncHandler(async (req, res) => {
  if (!UUID_RE.test(req.params.characterId)) throw bad("INVALID_ID", "Invalid player id.");
  rateLimit(`admin-grant:${req.account.id}`, 60, 10 * 60 * 1000);
  const body = requireObject(req.body);
  const resource = String(body.resource || "");
  if (!RESOURCES.has(resource)) throw bad("INVALID_RESOURCE", "Resource must be money, energy or health.");
  const reason = requireReason(body.reason);
  const amount = Number(body.amount);
  if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 100000000) {
    throw bad("INVALID_AMOUNT", "Amount must be a non-zero integer within ±100,000,000.");
  }
  const key = body.idempotencyKey ? validateIdempotencyKey(body.idempotencyKey) : null;

  const cfg = await getConfig(query);
  const result = await tx(async (client) => {
    const character = await targetCharacter(client, req.params.characterId);
    const settled = await settleCharacter(client, character.id, cfg);
    const before = { money: Number(settled.character.money), energy: settled.character.energy, health: settled.character.health };

    if (resource === "money") {
      if (!key) throw bad("IDEMPOTENCY_REQUIRED", "A request id is required for money adjustments.");
      const applied = await applyMoney(client, settled.character, BigInt(amount), {
        kind: "admin_grant",
        ref: req.account.id,
        idempotencyKey: `admin:${key}`,
        meta: { admin: req.account.email, reason },
        unlimited: settled.unlimited
      });
      if (!applied.applied) {
        return { duplicated: true, before, after: before, character: settled.character };
      }
    } else {
      const column = resource === "energy" ? "energy" : "health";
      const next = Math.min(100, Math.max(0, before[resource] + amount));
      await client.query(`UPDATE characters SET ${column} = $2, updated_at = now() WHERE id = $1`, [settled.character.id, next]);
      settled.character[resource] = next;
    }

    const after = {
      money: Number(settled.character.money),
      energy: settled.character.energy,
      health: settled.character.health
    };
    await audit(client, {
      actorId: req.account.id,
      targetAccountId: character.account_id,
      action: `grant_${resource}`,
      reason,
      before,
      after: { ...after, amount }
    });
    return { duplicated: false, before, after, character: settled.character };
  });

  res.json({
    duplicated: result.duplicated,
    before: result.before,
    after: result.after,
    character: privateCharacter(result.character)
  });
}));

router.post("/players/:characterId/override", asyncHandler(async (req, res) => {
  if (!UUID_RE.test(req.params.characterId)) throw bad("INVALID_ID", "Invalid player id.");
  rateLimit(`admin-override:${req.account.id}`, 60, 10 * 60 * 1000);
  const body = requireObject(req.body);
  const resource = String(body.resource || "");
  if (!RESOURCES.has(resource)) throw bad("INVALID_RESOURCE", "Resource must be money, energy or health.");
  const unlimited = Boolean(body.unlimited);
  const reason = requireReason(body.reason);
  let expiresAt = null;
  if (body.expiresAt) {
    const parsed = new Date(body.expiresAt);
    if (Number.isNaN(parsed.getTime())) throw bad("INVALID_EXPIRY", "Expiry must be a valid date.");
    if (parsed.getTime() <= Date.now()) throw bad("INVALID_EXPIRY", "Expiry must be in the future.");
    expiresAt = parsed.toISOString();
  }

  const result = await tx(async (client) => {
    const character = await targetCharacter(client, req.params.characterId);
    const previous = await client.query(
      `SELECT resource, unlimited, expires_at FROM admin_overrides
        WHERE character_id = $1 AND resource = $2 AND revoked_at IS NULL`,
      [character.id, resource]
    );
    await client.query(
      "UPDATE admin_overrides SET revoked_at = now() WHERE character_id = $1 AND resource = $2 AND revoked_at IS NULL",
      [character.id, resource]
    );
    let created = null;
    if (unlimited) {
      const inserted = await client.query(
        `INSERT INTO admin_overrides (character_id, resource, unlimited, granted_by, reason, expires_at)
         VALUES ($1, $2, true, $3, $4, $5) RETURNING resource, unlimited, expires_at, reason`,
        [character.id, resource, req.account.id, reason, expiresAt]
      );
      created = inserted.rows[0];
    }
    await audit(client, {
      actorId: req.account.id,
      targetAccountId: character.account_id,
      action: unlimited ? `override_on_${resource}` : `override_off_${resource}`,
      reason,
      before: previous.rows[0] || {},
      after: created || { unlimited: false }
    });
    if (resource === "energy" || resource === "health") {
      const next = unlimited ? 100 : character[resource];
      await client.query(`UPDATE characters SET ${resource} = $2, updated_at = now() WHERE id = $1`, [character.id, next]);
    }
    return { created, character, overrides: await activeOverrides(client, character.id) };
  });

  res.json({ override: result.created, overrides: result.overrides, character: privateCharacter(result.character) });
}));

router.post("/players/:characterId/status", asyncHandler(async (req, res) => {
  if (!UUID_RE.test(req.params.characterId)) throw bad("INVALID_ID", "Invalid player id.");
  const body = requireObject(req.body);
  const status = String(body.status || "");
  if (!["active", "suspended", "banned"].includes(status)) throw bad("INVALID_STATUS", "Status must be active, suspended or banned.");
  const reason = requireReason(body.reason);

  const result = await tx(async (client) => {
    const character = await targetCharacter(client, req.params.characterId);
    if (character.role === "admin") throw forbidden("PROTECTED_ACCOUNT", "Administrator accounts cannot be moderated here.");
    const before = { status: character.account_status };
    await client.query("UPDATE accounts SET status = $2, updated_at = now() WHERE id = $1", [character.account_id, status]);
    if (status !== "active") {
      await client.query("UPDATE sessions SET revoked_at = now() WHERE account_id = $1 AND revoked_at IS NULL", [character.account_id]);
    }
    await audit(client, {
      actorId: req.account.id,
      targetAccountId: character.account_id,
      action: `set_status_${status}`,
      reason,
      before,
      after: { status }
    });
    return { status };
  });

  res.json(result);
}));

router.post("/players/:characterId/rename", asyncHandler(async (req, res) => {
  if (!UUID_RE.test(req.params.characterId)) throw bad("INVALID_ID", "Invalid player id.");
  const body = requireObject(req.body);
  const name = validateName(body.displayName);
  const reason = requireReason(body.reason);

  const result = await tx(async (client) => {
    const character = await targetCharacter(client, req.params.characterId);
    const before = { displayName: character.display_name };
    await client.query("UPDATE characters SET display_name = $2, updated_at = now() WHERE id = $1", [character.id, name]);
    await audit(client, {
      actorId: req.account.id,
      targetAccountId: character.account_id,
      action: "rename_player",
      reason,
      before,
      after: { displayName: name }
    });
    return { before, after: { displayName: name } };
  });

  res.json(result);
}));

module.exports = router;
