const express = require("express");
const { query } = require("../db");
const { asyncHandler, bad, conflict, forbidden, notFound } = require("../errors");
const { requireAccount, requireVerified, requireActive, rateLimit } = require("../auth");
const { withCharacter } = require("../session");
const {
  applyMoney, spendEnergy, writeFeed, fareBetween, pendingRevenue,
  privateCharacter, distanceBetween
} = require("../game");
const { ACTIVITIES } = require("../content");
const { validateIdempotencyKey, validateName, validateAvatar, requireObject } = require("../validate");

const router = express.Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const guard = [requireAccount, requireVerified, requireActive];

/* ------------------------------------------------------------ character */
router.patch("/me/character", guard, asyncHandler(async (req, res) => {
  const body = requireObject(req.body);
  const patch = {};
  if (body.displayName !== undefined) {
    rateLimit(`rename:${req.account.id}`, 2, 10 * 60 * 1000);
    patch.display_name = validateName(body.displayName);
  }
  if (body.avatar !== undefined) patch.avatar = validateAvatar(body.avatar);
  if (body.discoverable !== undefined) patch.discoverable = Boolean(body.discoverable);
  if (body.showFinances !== undefined) patch.show_finances = Boolean(body.showFinances);
  if (body.showLocation !== undefined) patch.show_location = Boolean(body.showLocation);
  const fields = Object.keys(patch);
  if (!fields.length) throw bad("NOTHING_TO_UPDATE", "No supported fields were provided.");

  const result = await withCharacter(req, async ({ client, character }) => {
    const sets = fields.map((f, i) => `${f} = $${i + 2}`);
    const values = fields.map((f) => patch[f]);
    const updated = await client.query(
      `UPDATE characters SET ${sets.join(", ")}, updated_at = now() WHERE id = $1 RETURNING *`,
      [character.id, ...values]
    );
    return { character: updated.rows[0] };
  });
  res.json({ character: privateCharacter(result.character) });
}));

/* ------------------------------------------------------------ travel */
router.post("/actions/travel", guard, asyncHandler(async (req, res) => {
  const body = requireObject(req.body);
  const districtId = String(body.districtId || "");
  if (!UUID_RE.test(districtId)) throw bad("INVALID_DISTRICT", "Choose a valid district.");

  const result = await withCharacter(req, async ({ client, character, unlimited, cfg }) => {
    const here = await client.query("SELECT * FROM districts WHERE id = $1", [character.district_id]);
    const target = await client.query("SELECT * FROM districts WHERE id = $1 AND city_id = $2", [districtId, character.city_id]);
    if (!target.rows[0]) throw notFound("That district does not exist in your city.");
    if (target.rows[0].id === character.district_id) throw bad("ALREADY_THERE", "You are already in that district.");

    const fare = fareBetween(cfg, here.rows[0], target.rows[0]);
    await applyMoney(client, character, -BigInt(fare), {
      kind: "travel_fare",
      ref: target.rows[0].id,
      meta: { from: here.rows[0].slug, to: target.rows[0].slug },
      unlimited
    });
    await spendEnergy(client, character, cfg.travel_energy_cost, unlimited);
    const updated = await client.query(
      "UPDATE characters SET district_id = $2, updated_at = now() WHERE id = $1 RETURNING *",
      [character.id, target.rows[0].id]
    );
    return {
      character: updated.rows[0],
      fare,
      distance: distanceBetween(here.rows[0], target.rows[0]),
      district: { id: target.rows[0].id, slug: target.rows[0].slug, name: target.rows[0].name }
    };
  });

  res.json({
    character: privateCharacter(result.character),
    fare: result.fare,
    distance: result.distance,
    district: result.district
  });
}));

/* ------------------------------------------------------------ activities */
router.get("/activities", requireAccount, asyncHandler(async (req, res) => {
  const result = await withCharacter(req, async ({ client, character, clock }) => {
    const { rows } = await client.query(
      `SELECT id, kind, title, started_at, ends_at, status, reward_money, reward_fame, energy_cost, payload
         FROM activities WHERE character_id = $1 ORDER BY started_at DESC LIMIT 10`,
      [character.id]
    );
    return { rows, clock, character };
  });
  res.json({
    catalog: Object.entries(ACTIVITIES).map(([kind, def]) => ({
      kind,
      title: def.title,
      category: def.category,
      durationSeconds: def.durationSeconds,
      energyCost: def.energyCost,
      moneyCost: def.moneyCost,
      rewardMoney: def.rewardMoney,
      minActingSkill: def.minActingSkill,
      minEnergy: def.minEnergy
    })),
    activities: result.rows.map((a) => ({
      id: a.id,
      kind: a.kind,
      title: a.title,
      startedAt: a.started_at,
      endsAt: a.ends_at,
      status: a.status,
      rewardMoney: Number(a.reward_money)
    })),
    serverNow: result.clock.now,
    character: privateCharacter(result.character)
  });
}));

router.post("/activities", guard, asyncHandler(async (req, res) => {
  const body = requireObject(req.body);
  const kind = String(body.kind || "");
  const def = ACTIVITIES[kind];
  if (!def) throw bad("UNKNOWN_ACTIVITY", "That activity does not exist.");
  const key = validateIdempotencyKey(body.idempotencyKey);
  rateLimit(`activity:${req.account.id}`, 30, 10 * 60 * 1000);

  const result = await withCharacter(req, async ({ client, character, unlimited, cfg }) => {
    const existing = await client.query(
      "SELECT * FROM activities WHERE character_id = $1 AND idempotency_key = $2",
      [character.id, key]
    );
    if (existing.rows[0]) return { activity: existing.rows[0], duplicated: true };

    const pending = await client.query(
      "SELECT kind FROM activities WHERE character_id = $1 AND status = 'pending'",
      [character.id]
    );
    if (pending.rows.length >= 2) throw conflict("TOO_MANY_ACTIVITIES", "Finish an activity before starting another.");
    if (pending.rows.some((r) => r.kind === kind)) throw conflict("ACTIVITY_IN_PROGRESS", "That activity is already running.");

    if (character.energy < def.minEnergy) throw bad("INSUFFICIENT_ENERGY", "You are too tired for that.");
    if (character.acting_skill < def.minActingSkill) {
      throw forbidden("REQUIREMENT_NOT_MET", `Needs acting skill ${def.minActingSkill}.`);
    }
    if (def.moneyCost > 0) {
      await applyMoney(client, character, -BigInt(def.moneyCost), {
        kind: "activity_cost",
        ref: kind,
        idempotencyKey: `activity-cost:${key}`,
        meta: { activity: kind },
        unlimited
      });
    }
    await spendEnergy(client, character, def.energyCost, unlimited);

    const inserted = await client.query(
      `INSERT INTO activities
         (character_id, kind, title, started_at, ends_at, energy_cost, reward_money, reward_fame, payload, idempotency_key)
       VALUES ($1, $2, $3, now(), now() + ($4 || ' seconds')::interval, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        character.id, kind, def.title, String(def.durationSeconds), def.energyCost,
        String(def.rewardMoney || 0), def.rewardFame || 0,
        JSON.stringify({ skill: def.rewardSkill || 0, iq: def.rewardIq || 0, energy: def.rewardEnergy || 0 }),
        key
      ]
    );
    return { activity: inserted.rows[0], duplicated: false, character };
  });

  const fresh = await query("SELECT * FROM characters WHERE id = $1", [result.activity.character_id]);
  res.status(201).json({
    duplicated: Boolean(result.duplicated),
    activity: {
      id: result.activity.id,
      kind: result.activity.kind,
      title: result.activity.title,
      startedAt: result.activity.started_at,
      endsAt: result.activity.ends_at,
      status: result.activity.status,
      rewardMoney: Number(result.activity.reward_money)
    },
    character: fresh.rows[0] ? privateCharacter(fresh.rows[0]) : null
  });
}));

router.post("/activities/:id/claim", guard, asyncHandler(async (req, res) => {
  const id = req.params.id;
  if (!UUID_RE.test(id)) throw bad("INVALID_ID", "That activity id is not valid.");

  const result = await withCharacter(req, async ({ client, character }) => {
    const { rows } = await client.query(
      "SELECT * FROM activities WHERE id = $1 AND character_id = $2",
      [id, character.id]
    );
    if (!rows[0]) throw notFound("Activity not found.");
    const activity = rows[0];
    if (activity.status === "pending" && new Date(activity.ends_at) > new Date()) {
      throw conflict("NOT_FINISHED", "That activity has not finished yet.");
    }
    return { activity, character };
  });

  res.json({
    activity: { id: result.activity.id, status: result.activity.status, endsAt: result.activity.ends_at },
    character: privateCharacter(result.character)
  });
}));

/* ------------------------------------------------------------ businesses */
function businessView(row, cfg, now) {
  return {
    id: row.id,
    name: row.name,
    level: row.level,
    status: row.status,
    type: { code: row.type_code, name: row.type_name, icon: row.icon },
    district: { id: row.district_id, slug: row.district_slug, name: row.district_name },
    totalRevenue: Number(row.total_revenue),
    pendingRevenue: pendingRevenue(cfg, row, now),
    openedAt: row.opened_at,
    lastCollectedAt: row.last_collected_at,
    upgradeCost: Number(row.upgrade_cost) * row.level,
    maxLevel: row.max_level
  };
}

router.get("/businesses/mine", requireAccount, asyncHandler(async (req, res) => {
  const result = await withCharacter(req, async ({ client, character, cfg, clock }) => {
    const { rows } = await client.query(
      `SELECT b.*, t.name AS type_name, t.icon, t.base_revenue, t.upgrade_cost, t.max_level,
              d.slug AS district_slug, d.name AS district_name
         FROM businesses b
         JOIN business_types t ON t.code = b.type_code
         JOIN districts d ON d.id = b.district_id
        WHERE b.owner_character_id = $1 ORDER BY b.opened_at DESC`,
      [character.id]
    );
    return { rows, cfg, now: clock.now };
  });
  res.json({ items: result.rows.map((r) => businessView(r, result.cfg, result.now)) });
}));

router.post("/businesses", guard, asyncHandler(async (req, res) => {
  const body = requireObject(req.body);
  const typeCode = String(body.typeCode || "");
  const name = validateName(body.name, { min: 3, max: 30, field: "business name" });
  const key = validateIdempotencyKey(body.idempotencyKey);
  rateLimit(`business:${req.account.id}`, 10, 60 * 60 * 1000);

  const result = await withCharacter(req, async ({ client, character, unlimited, cfg }) => {
    const type = await client.query("SELECT * FROM business_types WHERE code = $1", [typeCode]);
    if (!type.rows[0]) throw bad("UNKNOWN_BUSINESS_TYPE", "That business type does not exist.");

    const existing = await client.query(
      "SELECT id FROM businesses WHERE owner_character_id = $1 AND idempotency_key = $2",
      [character.id, key]
    );
    if (existing.rows[0]) return { businessId: existing.rows[0].id, duplicated: true };

    const count = await client.query("SELECT count(*)::int AS n FROM businesses WHERE owner_character_id = $1", [character.id]);
    if (count.rows[0].n >= 5) throw conflict("BUSINESS_LIMIT", "You already run five businesses.");

    const paid = await applyMoney(client, character, -BigInt(type.rows[0].cost), {
      kind: "business_purchase",
      ref: typeCode,
      idempotencyKey: `business:${key}`,
      meta: { business: name, type: typeCode },
      unlimited
    });
    if (!paid.applied) {
      const raced = await client.query(
        "SELECT id FROM businesses WHERE owner_character_id = $1 AND idempotency_key = $2",
        [character.id, key]
      );
      if (raced.rows[0]) return { businessId: raced.rows[0].id, duplicated: true };
      throw conflict("DUPLICATE_REQUEST", "That purchase was already processed.");
    }

    const inserted = await client.query(
      `INSERT INTO businesses (owner_character_id, type_code, name, district_id, idempotency_key)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [character.id, typeCode, name, character.district_id, key]
    );
    await writeFeed(client, {
      kind: "business_opened",
      characterId: character.id,
      districtId: character.district_id,
      message: `${character.display_name} opened ${name}.`
    });
    return { businessId: inserted.rows[0].id, duplicated: false, cost: Number(type.rows[0].cost) };
  });

  const view = await query(
    `SELECT b.*, t.name AS type_name, t.icon, t.base_revenue, t.upgrade_cost, t.max_level,
            d.slug AS district_slug, d.name AS district_name
       FROM businesses b JOIN business_types t ON t.code = b.type_code
       JOIN districts d ON d.id = b.district_id WHERE b.id = $1`,
    [result.businessId]
  );
  res.status(201).json({
    duplicated: Boolean(result.duplicated),
    cost: result.cost || null,
    business: businessView(view.rows[0], { business_revenue_cap_hours: 24 }, new Date())
  });
}));

router.post("/businesses/:id/collect", guard, asyncHandler(async (req, res) => {
  const id = req.params.id;
  if (!UUID_RE.test(id)) throw bad("INVALID_ID", "That business id is not valid.");
  rateLimit(`collect:${req.account.id}`, 60, 10 * 60 * 1000);

  const result = await withCharacter(req, async ({ client, character, cfg, clock }) => {
    const { rows } = await client.query(
      `SELECT b.*, t.base_revenue FROM businesses b
         JOIN business_types t ON t.code = b.type_code
        WHERE b.id = $1 FOR UPDATE OF b`,
      [id]
    );
    if (!rows[0]) throw notFound("Business not found.");
    if (rows[0].owner_character_id !== character.id) throw forbidden("NOT_OWNER", "That is not your business.");

    const revenue = pendingRevenue(cfg, rows[0], clock.now);
    if (revenue <= 0) throw bad("NOTHING_TO_COLLECT", "No revenue has accrued yet.");

    await applyMoney(client, character, BigInt(revenue), {
      kind: "business_revenue",
      ref: id,
      idempotencyKey: `collect:${id}:${new Date(rows[0].last_collected_at).toISOString()}`,
      meta: { business: rows[0].name }
    });
    await client.query(
      "UPDATE businesses SET last_collected_at = $2, total_revenue = total_revenue + $3 WHERE id = $1",
      [id, clock.now, revenue]
    );
    return { revenue, character };
  });

  const view = await query(
    `SELECT b.*, t.name AS type_name, t.icon, t.base_revenue, t.upgrade_cost, t.max_level,
            d.slug AS district_slug, d.name AS district_name
       FROM businesses b JOIN business_types t ON t.code = b.type_code
       JOIN districts d ON d.id = b.district_id WHERE b.id = $1`,
    [id]
  );
  res.json({
    collected: result.revenue,
    business: businessView(view.rows[0], { business_revenue_cap_hours: 24 }, new Date()),
    character: privateCharacter(result.character)
  });
}));

router.post("/businesses/:id/upgrade", guard, asyncHandler(async (req, res) => {
  const id = req.params.id;
  if (!UUID_RE.test(id)) throw bad("INVALID_ID", "That business id is not valid.");
  const body = requireObject(req.body);
  const key = validateIdempotencyKey(body.idempotencyKey);

  const result = await withCharacter(req, async ({ client, character, unlimited, cfg }) => {
    const { rows } = await client.query(
      `SELECT b.*, t.upgrade_cost, t.max_level FROM businesses b
         JOIN business_types t ON t.code = b.type_code WHERE b.id = $1 FOR UPDATE`,
      [id]
    );
    if (!rows[0]) throw notFound("Business not found.");
    if (rows[0].owner_character_id !== character.id) throw forbidden("NOT_OWNER", "That is not your business.");
    if (rows[0].level >= rows[0].max_level) throw bad("MAX_LEVEL", "This business is fully upgraded.");

    const cost = BigInt(rows[0].upgrade_cost) * BigInt(rows[0].level);
    const paid = await applyMoney(client, character, -cost, {
      kind: "business_upgrade",
      ref: id,
      idempotencyKey: `upgrade:${key}`,
      meta: { business: rows[0].name, level: rows[0].level + 1 },
      unlimited
    });
    if (paid.applied) {
      await client.query("UPDATE businesses SET level = level + 1 WHERE id = $1", [id]);
    }
    return { cost: Number(cost), duplicated: !paid.applied };
  });

  const view = await query(
    `SELECT b.*, t.name AS type_name, t.icon, t.base_revenue, t.upgrade_cost, t.max_level,
            d.slug AS district_slug, d.name AS district_name
       FROM businesses b JOIN business_types t ON t.code = b.type_code
       JOIN districts d ON d.id = b.district_id WHERE b.id = $1`,
    [id]
  );
  res.json({
    duplicated: result.duplicated,
    cost: result.cost,
    business: businessView(view.rows[0], { business_revenue_cap_hours: 24 }, new Date())
  });
}));

module.exports = router;
