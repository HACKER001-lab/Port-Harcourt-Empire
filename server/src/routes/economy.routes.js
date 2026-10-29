const express = require("express");
const { query, tx } = require("../db");
const { getConfig } = require("../config");
const { asyncHandler, bad, notFound, forbidden } = require("../errors");
const { requireAccount, requireVerified, requireActive, rateLimit } = require("../auth");
const { withCharacter } = require("../session");
const { settleCharacter, applyMoney, privateCharacter, writeFeed } = require("../game");
const { validateIdempotencyKey, requireObject } = require("../validate");

const router = express.Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const guard = [requireAccount, requireVerified, requireActive];

router.get("/wallet", requireAccount, asyncHandler(async (req, res) => {
  const result = await withCharacter(req, async ({ client, character, unlimited, cfg, clock }) => {
    const { rows } = await client.query(
      `SELECT id, delta, balance_after, kind, ref, meta, created_at
         FROM ledger WHERE character_id = $1 ORDER BY id DESC LIMIT 50`,
      [character.id]
    );
    return { rows, character, unlimited, cfg, now: clock.now };
  });

  res.json({
    character: privateCharacter(result.character),
    overrides: Object.entries(result.unlimited).filter(([, v]) => v).map(([k]) => k),
    rules: {
      transferFeePct: result.cfg.transfer_fee_pct,
      transferMinFee: result.cfg.transfer_min_fee,
      transferDailyCap: result.cfg.transfer_daily_cap
    },
    entries: result.rows.map((r) => ({
      id: r.id,
      delta: Number(r.delta),
      balanceAfter: Number(r.balance_after),
      kind: r.kind,
      ref: r.ref,
      meta: r.meta,
      createdAt: r.created_at
    }))
  });
}));

router.get("/transfers", requireAccount, asyncHandler(async (req, res) => {
  const result = await withCharacter(req, async ({ client, character }) => {
    const sent = await client.query(
      `SELECT t.id, t.amount, t.fee, t.created_at, c.display_name AS other_name, c.avatar AS other_avatar
         FROM transfers t JOIN characters c ON c.id = t.to_character_id
        WHERE t.from_character_id = $1 ORDER BY t.created_at DESC LIMIT 20`,
      [character.id]
    );
    const received = await client.query(
      `SELECT t.id, t.amount, t.fee, t.created_at, c.display_name AS other_name, c.avatar AS other_avatar
         FROM transfers t JOIN characters c ON c.id = t.from_character_id
        WHERE t.to_character_id = $1 ORDER BY t.created_at DESC LIMIT 20`,
      [character.id]
    );
    return { sent: sent.rows, received: received.rows };
  });
  res.json({
    sent: result.sent.map((t) => ({ ...t, amount: Number(t.amount), fee: Number(t.fee) })),
    received: result.received.map((t) => ({ ...t, amount: Number(t.amount), fee: Number(t.fee) }))
  });
}));

/**
 * Player-to-player transfer. Both character rows are locked in id order so two
 * simultaneous transfers between the same pair cannot deadlock, and the unique
 * (sender, idempotency_key) row makes a retry return the original receipt.
 */
router.post("/transfers", guard, asyncHandler(async (req, res) => {
  const body = requireObject(req.body);
  const toCharacterId = String(body.toCharacterId || "");
  if (!UUID_RE.test(toCharacterId)) throw bad("INVALID_RECIPIENT", "Choose a valid recipient.");
  const amount = Number(body.amount);
  if (!Number.isInteger(amount) || amount < 100) throw bad("INVALID_AMOUNT", "Minimum transfer is ₦100.");
  if (amount > 100000000) throw bad("INVALID_AMOUNT", "Maximum single transfer is ₦100,000,000.");
  const key = validateIdempotencyKey(body.idempotencyKey);
  rateLimit(`transfer:${req.account.id}`, 20, 10 * 60 * 1000);

  const cfg = await getConfig(query);
  const result = await tx(async (client) => {
    const mine = await client.query("SELECT id FROM characters WHERE account_id = $1", [req.account.id]);
    if (!mine.rows[0]) throw bad("NO_CHARACTER", "This account has no character yet.");
    const myId = mine.rows[0].id;
    if (myId === toCharacterId) throw bad("SELF_TRANSFER", "You cannot send money to yourself.");

    const ids = [myId, toCharacterId].sort();
    const settled = {};
    for (const id of ids) {
      const s = await settleCharacter(client, id, cfg);
      settled[id] = s;
    }
    const sender = settled[myId].character;
    const recipient = settled[toCharacterId].character;

    const duplicate = await client.query(
      "SELECT id FROM transfers WHERE from_character_id = $1 AND idempotency_key = $2",
      [myId, key]
    );
    if (duplicate.rows[0]) {
      return { duplicated: true, transferId: duplicate.rows[0].id, sender, recipient, amount: null, fee: null };
    }

    const today = await client.query(
      "SELECT COALESCE(SUM(amount), 0) AS total FROM transfers WHERE from_character_id = $1 AND created_at > now() - interval '1 day'",
      [myId]
    );
    if (Number(today.rows[0].total) + amount > cfg.transfer_daily_cap) {
      throw forbidden("TRANSFER_LIMIT", "That would exceed your daily transfer limit.");
    }

    const fee = Math.max(cfg.transfer_min_fee, Math.floor((amount * cfg.transfer_fee_pct) / 100));
    const transfer = await client.query(
      `INSERT INTO transfers (from_character_id, to_character_id, amount, fee, idempotency_key)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (from_character_id, idempotency_key) DO NOTHING
       RETURNING id`,
      [myId, toCharacterId, amount, fee, key]
    );
    if (!transfer.rows[0]) {
      const existing = await client.query(
        "SELECT id FROM transfers WHERE from_character_id = $1 AND idempotency_key = $2",
        [myId, key]
      );
      return { duplicated: true, transferId: existing.rows[0].id, sender, recipient, amount: null, fee: null };
    }

    const debit = await applyMoney(client, sender, -BigInt(amount + fee), {
      kind: "transfer_out",
      ref: transfer.rows[0].id,
      idempotencyKey: `transfer:${transfer.rows[0].id}`,
      meta: { to: toCharacterId, amount, fee },
      unlimited: settled[myId].unlimited
    });
    if (!debit.applied) throw bad("TRANSFER_FAILED", "That transfer was already processed.");

    await applyMoney(client, recipient, BigInt(amount), {
      kind: "transfer_in",
      ref: transfer.rows[0].id,
      idempotencyKey: `transfer-in:${transfer.rows[0].id}`,
      meta: { from: myId, fee }
    });

    await writeFeed(client, {
      kind: "transfer",
      characterId: myId,
      districtId: sender.district_id,
      message: `${sender.display_name} sent money to ${recipient.display_name}.`
    });

    return { duplicated: false, transferId: transfer.rows[0].id, sender, recipient, amount, fee };
  });

  res.status(201).json({
    duplicated: Boolean(result.duplicated),
    transferId: result.transferId,
    amount: result.amount,
    fee: result.fee,
    character: privateCharacter(await reloadCharacter(result.sender.id))
  });
}));

async function reloadCharacter(id) {
  const { rows } = await query("SELECT * FROM characters WHERE id = $1", [id]);
  if (!rows[0]) throw notFound("Character not found.");
  return rows[0];
}

module.exports = router;
