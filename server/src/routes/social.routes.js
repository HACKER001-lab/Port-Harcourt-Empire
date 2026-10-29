const crypto = require("crypto");
const express = require("express");
const { query, tx } = require("../db");
const { getConfig } = require("../config");
const { asyncHandler, bad, conflict, forbidden, notFound } = require("../errors");
const { requireAccount, requireVerified, requireActive, rateLimit } = require("../auth");
const { withCharacter } = require("../session");
const { settleCharacter, applyMoney, spendEnergy, writeFeed, privateCharacter } = require("../game");
const { validateIdempotencyKey, requireObject } = require("../validate");

const router = express.Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const guard = [requireAccount, requireVerified, requireActive];

/* ------------------------------------------------------------ friends */
router.get("/friends", requireAccount, asyncHandler(async (req, res) => {
  const result = await withCharacter(req, async ({ client, character }) => {
    const { rows } = await client.query(
      `SELECT f.id, f.status, f.requester_character_id, f.addressee_character_id, f.created_at,
              rc.display_name AS requester_name, rc.avatar AS requester_avatar,
              ac.display_name AS addressee_name, ac.avatar AS addressee_avatar
         FROM friendships f
         JOIN characters rc ON rc.id = f.requester_character_id
         JOIN characters ac ON ac.id = f.addressee_character_id
        WHERE f.requester_character_id = $1 OR f.addressee_character_id = $1
        ORDER BY f.updated_at DESC LIMIT 50`,
      [character.id]
    );
    return { rows, myId: character.id };
  });

  const shape = (r) => {
    const incoming = r.addressee_character_id === result.myId;
    return {
      id: r.id,
      status: r.status,
      incoming,
      direction: incoming ? "in" : "out",
      other: incoming
        ? { id: r.requester_character_id, name: r.requester_name, avatar: r.requester_avatar }
        : { id: r.addressee_character_id, name: r.addressee_name, avatar: r.addressee_avatar },
      createdAt: r.created_at
    };
  };
  const shaped = result.rows.map(shape);
  res.json({
    friends: shaped.filter((f) => f.status === "accepted"),
    incoming: shaped.filter((f) => f.status === "pending" && f.incoming),
    outgoing: shaped.filter((f) => f.status === "pending" && !f.incoming),
    blocked: shaped.filter((f) => f.status === "blocked")
  });
}));

router.post("/friends/request", guard, asyncHandler(async (req, res) => {
  const body = requireObject(req.body);
  const targetId = String(body.characterId || "");
  if (!UUID_RE.test(targetId)) throw bad("INVALID_PLAYER", "Choose a valid player.");
  rateLimit(`friend:${req.account.id}`, 20, 60 * 60 * 1000);

  const result = await withCharacter(req, async ({ client, character }) => {
    if (character.id === targetId) throw bad("SELF_REQUEST", "You cannot add yourself.");
    const target = await client.query("SELECT id, discoverable FROM characters WHERE id = $1", [targetId]);
    if (!target.rows[0] || !target.rows[0].discoverable) throw notFound("That player could not be found.");
    const existing = await client.query(
      `SELECT * FROM friendships
        WHERE (requester_character_id = $1 AND addressee_character_id = $2)
           OR (requester_character_id = $2 AND addressee_character_id = $1)`,
      [character.id, targetId]
    );
    if (existing.rows[0]) {
      return { friendship: existing.rows[0], existing: true };
    }
    const inserted = await client.query(
      `INSERT INTO friendships (requester_character_id, addressee_character_id)
       VALUES ($1, $2) ON CONFLICT (requester_character_id, addressee_character_id) DO NOTHING
       RETURNING *`,
      [character.id, targetId]
    );
    return { friendship: inserted.rows[0], existing: false };
  });

  res.status(existingStatus(result) ? 200 : 201).json({
    id: result.friendship.id,
    status: result.friendship.status,
    duplicated: Boolean(result.existing)
  });
}));

function existingStatus(result) {
  return Boolean(result.existing);
}

router.post("/friends/respond", guard, asyncHandler(async (req, res) => {
  const body = requireObject(req.body);
  const requestId = String(body.requestId || "");
  if (!UUID_RE.test(requestId)) throw bad("INVALID_REQUEST", "That request is not valid.");
  const action = String(body.action || "");
  const status = { accept: "accepted", decline: "declined", block: "blocked" }[action];
  if (!status) throw bad("INVALID_ACTION", "Action must be accept, decline or block.");

  const result = await withCharacter(req, async ({ client, character }) => {
    const { rows } = await client.query("SELECT * FROM friendships WHERE id = $1", [requestId]);
    if (!rows[0]) throw notFound("That request does not exist.");
    if (rows[0].addressee_character_id !== character.id) {
      throw forbidden("NOT_ADDRESSEE", "Only the recipient can respond to this request.");
    }
    if (rows[0].status !== "pending" && status !== "blocked") {
      throw conflict("ALREADY_RESOLVED", "That request was already answered.");
    }
    const updated = await client.query(
      "UPDATE friendships SET status = $2, updated_at = now() WHERE id = $1 RETURNING *",
      [requestId, status]
    );
    return updated.rows[0];
  });

  res.json({ id: result.id, status: result.status });
}));

/* ------------------------------------------------------------ duels */
function powerOf(c) {
  return c.acting_skill * 2 + Math.floor(c.charm / 2) + Math.floor(c.fame / 10) + crypto.randomInt(0, 21);
}

router.get("/duels", requireAccount, asyncHandler(async (req, res) => {
  const result = await withCharacter(req, async ({ client, character, cfg }) => {
    const { rows } = await client.query(
      `SELECT d.*, cc.display_name AS challenger_name, oc.display_name AS opponent_name,
              dd.name AS district_name
         FROM duels d
         JOIN characters cc ON cc.id = d.challenger_id
         JOIN characters oc ON oc.id = d.opponent_id
         JOIN districts dd ON dd.id = d.district_id
        WHERE d.challenger_id = $1 OR d.opponent_id = $1
        ORDER BY d.created_at DESC LIMIT 20`,
      [character.id]
    );
    return { rows, myId: character.id, cfg };
  });
  res.json({
    history: result.rows.map((d) => ({
      id: d.id,
      won: d.winner_id === result.myId,
      challenger: { id: d.challenger_id, name: d.challenger_name },
      opponent: { id: d.opponent_id, name: d.opponent_name },
      district: d.district_name,
      challengerPower: d.challenger_power,
      opponentPower: d.opponent_power,
      rounds: d.rounds,
      createdAt: d.created_at
    })),
    rules: {
      cooldownSeconds: result.cfg.duel_cooldown_seconds,
      dailyCap: result.cfg.duel_daily_cap,
      energyCost: result.cfg.duel_energy_cost,
      winReward: result.cfg.duel_win_reward,
      lossCost: result.cfg.duel_loss_cost
    }
  });
}));

router.post("/duels", guard, asyncHandler(async (req, res) => {
  const body = requireObject(req.body);
  const opponentId = String(body.opponentId || "");
  if (!UUID_RE.test(opponentId)) throw bad("INVALID_OPPONENT", "Choose a valid opponent.");
  const key = validateIdempotencyKey(body.idempotencyKey);
  rateLimit(`duel:${req.account.id}`, 15, 10 * 60 * 1000);

  const cfg = await getConfig(query);
  const result = await tx(async (client) => {
    const mine = await client.query("SELECT id FROM characters WHERE account_id = $1", [req.account.id]);
    if (!mine.rows[0]) throw bad("NO_CHARACTER", "This account has no character yet.");
    const myId = mine.rows[0].id;
    if (myId === opponentId) throw bad("SELF_DUEL", "You cannot challenge yourself.");

    const duplicate = await client.query(
      "SELECT * FROM duels WHERE challenger_id = $1 AND idempotency_key = $2",
      [myId, key]
    );
    if (duplicate.rows[0]) {
      return { duplicated: true, duel: duplicate.rows[0], myId };
    }

    const settled = {};
    for (const id of [myId, opponentId].sort()) {
      settled[id] = await settleCharacter(client, id, cfg);
    }
    const me = settled[myId].character;
    const opponent = settled[opponentId].character;
    if (!opponent.discoverable) throw notFound("That player could not be found.");

    const district = await client.query("SELECT * FROM districts WHERE id = $1", [me.district_id]);
    if (!district.rows[0]) throw notFound("District not found.");
    if (district.rows[0].safe_zone) throw forbidden("SAFE_ZONE", "Duels are not allowed in this district.");
    if (opponent.district_id !== me.district_id) throw bad("NOT_LOCAL", "Your opponent is in another district.");

    const cooldown = await client.query(
      `SELECT 1 FROM duels
        WHERE created_at > now() - ($1 || ' seconds')::interval
          AND ((challenger_id = $2 AND opponent_id = $3) OR (challenger_id = $3 AND opponent_id = $2))
        LIMIT 1`,
      [String(cfg.duel_cooldown_seconds), myId, opponentId]
    );
    if (cooldown.rows[0]) throw conflict("DUEL_COOLDOWN", "You fought this player recently. Wait before a rematch.");

    const daily = await client.query(
      "SELECT count(*)::int AS n FROM duels WHERE challenger_id = $1 AND created_at > now() - interval '1 day'",
      [myId]
    );
    if (daily.rows[0].n >= cfg.duel_daily_cap) throw forbidden("DUEL_LIMIT", "You have reached today's duel limit.");

    const againstThem = await client.query(
      `SELECT count(*)::int AS n FROM duels
        WHERE challenger_id = $1 AND opponent_id = $2 AND created_at > now() - interval '1 day'`,
      [myId, opponentId]
    );
    if (againstThem.rows[0].n >= 3) throw forbidden("TARGET_LIMIT", "You have challenged this player enough today.");

    if (me.energy < cfg.duel_energy_cost) throw bad("INSUFFICIENT_ENERGY", "You are too tired to fight.");
    if (opponent.energy < 5) throw conflict("OPPONENT_UNAVAILABLE", "That player is too exhausted to fight.");

    const myPower = powerOf(me);
    const theirPower = powerOf(opponent);
    const iWon = myPower >= theirPower;
    const winnerId = iWon ? myId : opponentId;
    const loserChar = iWon ? opponent : me;
    const winnerChar = iWon ? me : opponent;

    const inserted = await client.query(
      `INSERT INTO duels (challenger_id, opponent_id, district_id, winner_id, rounds,
                          challenger_power, opponent_power, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        myId, opponentId, me.district_id, winnerId,
        JSON.stringify([{ challengerPower: myPower, opponentPower: theirPower }]),
        myPower, theirPower, key
      ]
    );
    const duelId = inserted.rows[0].id;

    await applyMoney(client, winnerChar, BigInt(cfg.duel_win_reward), {
      kind: "duel_reward",
      ref: duelId,
      idempotencyKey: `duel:${duelId}:win`,
      meta: { opponent: loserChar.id }
    });
    const loss = Math.min(cfg.duel_loss_cost, Number(loserChar.money));
    if (loss > 0) {
      await applyMoney(client, loserChar, -BigInt(loss), {
        kind: "duel_loss",
        ref: duelId,
        idempotencyKey: `duel:${duelId}:loss`,
        meta: { winner: winnerChar.id }
      });
    }
    await spendEnergy(client, me, cfg.duel_energy_cost, settled[myId].unlimited);
    await spendEnergy(client, opponent, cfg.duel_energy_cost, settled[opponentId].unlimited);

    await client.query(
      `UPDATE characters SET duel_wins = duel_wins + CASE WHEN id = $1 THEN 1 ELSE 0 END,
              duel_losses = duel_losses + CASE WHEN id = $2 THEN 1 ELSE 0 END,
              fame = fame + CASE WHEN id = $1 THEN 2 ELSE 0 END,
              updated_at = now()
        WHERE id = ANY($3::uuid[])`,
      [winnerId, loserChar.id, [myId, opponentId]]
    );

    await writeFeed(client, {
      kind: "duel",
      characterId: myId,
      districtId: me.district_id,
      message: `${winnerChar.display_name} won a duel against ${loserChar.display_name} in ${district.rows[0].name}.`
    });

    return {
      duplicated: false,
      duel: inserted.rows[0],
      myId,
      won: iWon,
      opponentName: opponent.display_name,
      reward: iWon ? cfg.duel_win_reward : 0,
      loss: iWon ? 0 : loss
    };
  });

  const fresh = await query("SELECT * FROM characters WHERE id = $1", [result.myId]);
  res.status(result.duplicated ? 200 : 201).json({
    duplicated: Boolean(result.duplicated),
    duel: {
      id: result.duel.id,
      won: result.duel.winner_id === result.myId,
      challengerPower: result.duel.challenger_power,
      opponentPower: result.duel.opponent_power,
      rounds: result.duel.rounds
    },
    reward: result.reward || 0,
    character: fresh.rows[0] ? privateCharacter(fresh.rows[0]) : null
  });
}));

router.get("/rankings", asyncHandler(async (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const { rows } = await query(
    `SELECT c.id, c.display_name, c.avatar, c.fame, c.duel_wins, c.duel_losses, c.age,
            d.slug AS district_slug, d.name AS district_name
       FROM characters c JOIN districts d ON d.id = c.district_id
      WHERE c.discoverable = true
      ORDER BY c.duel_wins DESC, c.fame DESC, c.created_at ASC
      LIMIT $1`,
    [limit]
  );
  res.json({
    items: rows.map((r, i) => ({
      rank: i + 1,
      id: r.id,
      displayName: r.display_name,
      avatar: r.avatar,
      fame: r.fame,
      wins: r.duel_wins,
      losses: r.duel_losses,
      age: r.age,
      district: r.district_name
    }))
  });
}));

module.exports = router;
