const express = require("express");
const { query, tx } = require("../db");
const { getConfig } = require("../config");
const { asyncHandler, bad, notFound } = require("../errors");
const { publicCharacter, worldClock, settleCharacter } = require("../game");

const router = express.Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get("/world", asyncHandler(async (_req, res) => {
  const cfg = await getConfig(query);
  const [cities, districts, locations, businessTypes] = await Promise.all([
    query("SELECT id, slug, name, region, is_active FROM cities ORDER BY ordinal"),
    query("SELECT id, city_id, slug, name, description, map_x, map_y, safe_zone FROM districts ORDER BY ordinal"),
    query("SELECT id, district_id, slug, name, kind FROM locations ORDER BY name"),
    query("SELECT code, name, description, icon, cost, base_revenue, upgrade_cost, upkeep_per_day, max_level FROM business_types ORDER BY cost")
  ]);
  const clock = await tx((client) => worldClock(client));
  res.json({
    cities: cities.rows,
    districts: districts.rows,
    locations: locations.rows,
    businessTypes: businessTypes.rows.map((t) => ({
      ...t,
      cost: Number(t.cost),
      base_revenue: Number(t.base_revenue),
      upgrade_cost: Number(t.upgrade_cost),
      upkeep_per_day: Number(t.upkeep_per_day)
    })),
    rules: {
      travelBaseFare: cfg.travel_base_fare,
      travelFarePerUnit: cfg.travel_fare_per_unit,
      travelEnergyCost: cfg.travel_energy_cost,
      transferFeePct: cfg.transfer_fee_pct,
      transferMinFee: cfg.transfer_min_fee,
      businessRevenueCapHours: cfg.business_revenue_cap_hours
    },
    clock: {
      serverNow: clock.now,
      gameDay: clock.gameDay,
      gameWeek: clock.gameWeek,
      daySeconds: clock.daySeconds,
      season: clock.season
    }
  });
}));

router.get("/players", asyncHandler(async (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 40);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const page = Math.max(1, Number(req.query.page) || 1);
  const offset = (page - 1) * limit;

  const params = [];
  let where = "c.discoverable = true";
  if (q) {
    params.push(`%${q}%`);
    where += ` AND c.display_name ILIKE $${params.length}`;
  }
  params.push(limit, offset);

  const { rows } = await query(
    `SELECT c.*, d.slug AS district_slug, d.name AS district_name,
            (SELECT count(*) FROM businesses b WHERE b.owner_character_id = c.id) AS business_count
       FROM characters c
       JOIN districts d ON d.id = c.district_id
      WHERE ${where}
      ORDER BY c.fame DESC, c.created_at ASC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  res.json({
    page,
    limit,
    items: rows.map((row) => ({ ...publicCharacter(row), businessCount: Number(row.business_count) }))
  });
}));

router.get("/players/:id", asyncHandler(async (req, res) => {
  const id = req.params.id;
  if (!UUID_RE.test(id)) throw bad("INVALID_ID", "That player id is not valid.");

  const { rows } = await query(
    `SELECT c.*, d.slug AS district_slug, d.name AS district_name, ci.name AS city_name
       FROM characters c
       JOIN districts d ON d.id = c.district_id
       JOIN cities ci ON ci.id = c.city_id
      WHERE c.id = $1 AND c.discoverable = true`,
    [id]
  );
  if (!rows[0]) throw notFound("That player could not be found.");
  const row = rows[0];

  const [achievements, businesses, duels] = await Promise.all([
    query("SELECT code, label, unlocked_at FROM character_achievements WHERE character_id = $1 ORDER BY unlocked_at DESC LIMIT 24", [id]),
    query(
      `SELECT b.id, b.name, b.level, b.total_revenue, t.code AS type_code, t.name AS type_name, t.icon,
              d.slug AS district_slug, d.name AS district_name
         FROM businesses b
         JOIN business_types t ON t.code = b.type_code
         JOIN districts d ON d.id = b.district_id
        WHERE b.owner_character_id = $1 AND b.status = 'open'
        ORDER BY b.opened_at DESC LIMIT 12`,
      [id]
    ),
    query(
      `SELECT d.id, d.winner_id, d.created_at,
              wc.display_name AS challenger_name, oc.display_name AS opponent_name
         FROM duels d
         JOIN characters wc ON wc.id = d.challenger_id
         JOIN characters oc ON oc.id = d.opponent_id
        WHERE d.challenger_id = $1 OR d.opponent_id = $1
        ORDER BY d.created_at DESC LIMIT 10`,
      [id]
    )
  ]);

  let friendStatus = null;
  if (req.account) {
    const me = await query("SELECT id FROM characters WHERE account_id = $1", [req.account.id]);
    if (me.rows[0]) {
      const status = await query(
        `SELECT id, status, requester_character_id, addressee_character_id FROM friendships
          WHERE (requester_character_id = $1 AND addressee_character_id = $2)
             OR (requester_character_id = $2 AND addressee_character_id = $1)`,
        [me.rows[0].id, id]
      );
      if (status.rows[0]) {
        friendStatus = {
          id: status.rows[0].id,
          status: status.rows[0].status,
          incoming: status.rows[0].addressee_character_id === me.rows[0].id
        };
      }
    }
  }

  res.json({
    player: { ...publicCharacter(row), city: row.city_name },
    achievements: achievements.rows,
    businesses: businesses.rows.map((b) => ({ ...b, total_revenue: Number(b.total_revenue) })),
    duels: duels.rows,
    friendStatus
  });
}));

router.get("/feed", asyncHandler(async (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const { rows } = await query(
    `SELECT f.id, f.kind, f.message, f.created_at, d.name AS district_name
       FROM city_feed f LEFT JOIN districts d ON d.id = f.district_id
      ORDER BY f.created_at DESC LIMIT $1`,
    [limit]
  );
  res.json({ items: rows });
}));

router.get("/businesses", asyncHandler(async (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const params = [];
  let where = "b.status = 'open'";
  if (req.query.district) {
    params.push(String(req.query.district));
    where += ` AND d.slug = $${params.length}`;
  }
  params.push(limit);
  const { rows } = await query(
    `SELECT b.id, b.name, b.level, b.total_revenue, b.opened_at,
            t.code AS type_code, t.name AS type_name, t.icon,
            c.id AS owner_id, c.display_name AS owner_name, c.avatar AS owner_avatar,
            d.slug AS district_slug, d.name AS district_name
       FROM businesses b
       JOIN business_types t ON t.code = b.type_code
       JOIN characters c ON c.id = b.owner_character_id
       JOIN districts d ON d.id = b.district_id
      WHERE ${where}
      ORDER BY b.opened_at DESC LIMIT $${params.length}`,
    params
  );
  res.json({ items: rows.map((b) => ({ ...b, total_revenue: Number(b.total_revenue) })) });
}));

module.exports = router;
