// Authoritative game rules. Nothing here trusts a client-supplied amount,
// timestamp, price or reward: the caller sends an intent, this module decides.

const crypto = require("crypto");
const { bad, notFound } = require("./errors");

const dayMs = (hourSeconds) => hourSeconds * 24 * 1000;

async function worldClock(client) {
  const { rows } = await client.query("SELECT epoch_started_at, game_hour_seconds, season FROM world_state WHERE id = 1");
  if (!rows[0]) throw new Error("world_state is not seeded");
  const ws = rows[0];
  const { rows: t } = await client.query("SELECT now() AS now");
  const now = t[0].now;
  const msPerDay = dayMs(ws.game_hour_seconds);
  const elapsedMs = Math.max(0, now.getTime() - new Date(ws.epoch_started_at).getTime());
  const gameDay = Math.floor(elapsedMs / msPerDay);
  return {
    now,
    msPerDay,
    daySeconds: ws.game_hour_seconds * 24,
    gameDay,
    gameWeek: Math.floor(gameDay / 7),
    season: ws.season
  };
}

async function unlimitedResources(client, characterId) {
  const { rows } = await client.query(
    `SELECT resource FROM admin_overrides
      WHERE character_id = $1 AND unlimited = true AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > now())`,
    [characterId]
  );
  const out = { money: false, energy: false, health: false };
  for (const r of rows) out[r.resource] = true;
  return out;
}

async function activeOverrides(client, characterId) {
  const { rows } = await client.query(
    `SELECT resource, unlimited, expires_at, reason, created_at FROM admin_overrides
      WHERE character_id = $1 AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > now())
      ORDER BY resource`,
    [characterId]
  );
  return rows;
}

/**
 * Append a ledger row. Returns false when the idempotency key was already used,
 * which is how duplicate purchases/transfers/rewards are rejected.
 */
async function insertLedger(client, characterId, delta, balanceAfter, kind, ref, idempotencyKey, meta) {
  const { rows } = await client.query(
    `INSERT INTO ledger (character_id, delta, balance_after, kind, ref, idempotency_key, meta)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (character_id, idempotency_key) DO NOTHING
     RETURNING id`,
    [characterId, delta.toString(), balanceAfter.toString(), kind, ref || null, idempotencyKey, meta || {}]
  );
  return rows.length > 0;
}

/**
 * Move money for a locked character row. Call inside a transaction that has
 * already run settleCharacter (which takes the row lock).
 */
async function applyMoney(client, character, delta, { kind, ref, idempotencyKey, meta, unlimited }) {
  const amount = BigInt(delta);
  const key = idempotencyKey || `op:${crypto.randomUUID()}`;
  const current = BigInt(character.money);
  const override = amount < 0n && unlimited && unlimited.money;
  const effective = override ? 0n : amount;
  const next = current + effective;
  if (next < 0n) throw bad("INSUFFICIENT_FUNDS", "Not enough money for this action.");

  const entryMeta = override ? { ...(meta || {}), requestedDelta: amount.toString(), override: true } : meta || {};
  const applied = await insertLedger(
    client,
    character.id,
    effective,
    next,
    kind,
    ref,
    key,
    entryMeta
  );
  if (!applied) {
    return { applied: false, duplicate: true, money: current };
  }
  await client.query("UPDATE characters SET money = $2, updated_at = now() WHERE id = $1", [character.id, next.toString()]);
  character.money = next.toString();
  return { applied: true, duplicate: false, money: next };
}

async function spendEnergy(client, character, cost, unlimited) {
  if (!cost) return character.energy;
  if (unlimited && unlimited.energy) return character.energy;
  if (character.energy < cost) throw bad("INSUFFICIENT_ENERGY", "You are too tired. Rest first.");
  const value = character.energy - cost;
  await client.query("UPDATE characters SET energy = $2, updated_at = now() WHERE id = $1", [character.id, value]);
  character.energy = value;
  return value;
}

/**
 * Lazily settle a character: world clock, regeneration, business upkeep and
 * every activity that finished while the player was away. Idempotent because
 * the row lock plus last_settled_at mean each window is processed once.
 */
async function settleCharacter(client, characterId, cfg) {
  const { rows } = await client.query("SELECT * FROM characters WHERE id = $1 FOR UPDATE", [characterId]);
  if (!rows[0]) throw notFound("Character not found.");
  const c = rows[0];

  const clock = await worldClock(client);
  const last = new Date(c.last_settled_at);
  const rawElapsedMs = Math.max(0, clock.now.getTime() - last.getTime());
  const elapsedMs = Math.min(rawElapsedMs, cfg.settle_max_offline_hours * 3600 * 1000);
  const elapsedSec = Math.floor(elapsedMs / 1000);

  const unlimited = await unlimitedResources(client, characterId);
  let energy = unlimited.energy
    ? 100
    : Math.min(100, c.energy + Math.floor(elapsedSec / cfg.energy_regen_seconds));
  let health = unlimited.health
    ? 100
    : Math.min(100, c.health + Math.floor(elapsedSec / cfg.health_regen_seconds));
  let happiness = Math.min(100, c.happiness + Math.floor(elapsedSec / cfg.happiness_regen_seconds));
  let money = BigInt(c.money);
  let skill = c.acting_skill;
  let iq = c.iq;
  let fame = c.fame;

  // Recurring business costs, charged for the settled window (capped).
  const businesses = await client.query(
    `SELECT b.id, b.name, t.upkeep_per_day
       FROM businesses b JOIN business_types t ON t.code = b.type_code
      WHERE b.owner_character_id = $1 AND b.status = 'open'`,
    [characterId]
  );
  const gameDays = Math.min(elapsedSec / clock.daySeconds, cfg.settle_max_offline_hours * 3600 / clock.daySeconds);
  for (const b of businesses.rows) {
    const charge = BigInt(Math.floor(gameDays * Number(b.upkeep_per_day)));
    if (charge <= 0n) continue;
    const pay = charge > money ? money : charge;
    if (pay <= 0n) continue;
    money -= pay;
    await insertLedger(
      client,
      characterId,
      -pay,
      money,
      "business_upkeep",
      b.id,
      `upkeep:${b.id}:${clock.now.toISOString()}`,
      { business: b.name, gameDays: Number(gameDays.toFixed(4)) }
    );
  }

  // Activities that finished while the player was offline.
  const due = await client.query(
    `SELECT * FROM activities
      WHERE character_id = $1 AND status = 'pending' AND ends_at <= $2
      FOR UPDATE`,
    [characterId, clock.now]
  );
  for (const a of due.rows) {
    const payload = a.payload || {};
    const reward = BigInt(a.reward_money);
    if (reward > 0n) {
      money += reward;
      await insertLedger(client, characterId, reward, money, "activity_reward", a.id, `activity:${a.id}`, {
        kind: a.kind,
        title: a.title
      });
    }
    if (a.reward_xp) skill = Math.min(100, skill + a.reward_xp);
    if (payload.iq) iq = Math.min(200, iq + Number(payload.iq));
    if (a.reward_fame) fame += a.reward_fame;
    if (payload.energy) energy = Math.min(100, energy + Number(payload.energy));
    await client.query("UPDATE activities SET status = 'completed', completed_at = $2 WHERE id = $1", [a.id, clock.now]);
  }

  const week = Math.max(c.game_week, clock.gameWeek);
  const age = Math.min(120, c.start_age + Math.floor(week / 52));

  const updated = await client.query(
    `UPDATE characters
        SET money = $2, energy = $3, health = $4, happiness = $5, acting_skill = $6,
            iq = $7, fame = $8, game_week = $9, age = $10, last_settled_at = $11, updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [characterId, money.toString(), energy, health, happiness, skill, iq, fame, week, age, clock.now]
  );

  return { character: updated.rows[0], clock, unlimited, completedActivities: due.rows.length, elapsedSec };
}

async function writeFeed(client, { kind, characterId, districtId, message }) {
  await client.query(
    "INSERT INTO city_feed (kind, character_id, district_id, message) VALUES ($1, $2, $3, $4)",
    [kind, characterId || null, districtId || null, message]
  );
}

function distanceBetween(a, b) {
  const ax = Number(a.map_x) + 50, ay = Number(a.map_y) + 36;
  const bx = Number(b.map_x) + 50, by = Number(b.map_y) + 36;
  return Math.round(Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2));
}

function fareBetween(cfg, a, b) {
  return cfg.travel_base_fare + distanceBetween(a, b) * cfg.travel_fare_per_unit;
}

/** Revenue accrued since the last collection, capped so idling is not a jackpot. */
function pendingRevenue(cfg, business, now) {
  const capMs = cfg.business_revenue_cap_hours * 3600 * 1000;
  const elapsedMs = Math.min(capMs, Math.max(0, now.getTime() - new Date(business.last_collected_at).getTime()));
  const perDay = Number(business.base_revenue) * Number(business.level);
  if (!Number.isFinite(perDay) || perDay <= 0) return 0;
  return Math.floor((perDay * elapsedMs) / (24 * 3600 * 1000));
}

function privateCharacter(row) {
  return {
    id: row.id,
    displayName: row.display_name,
    avatar: row.avatar,
    age: row.age,
    gameWeek: row.game_week,
    cityId: row.city_id,
    districtId: row.district_id,
    money: Number(row.money),
    energy: row.energy,
    health: row.health,
    happiness: row.happiness,
    fame: row.fame,
    reputation: row.reputation,
    actingSkill: row.acting_skill,
    iq: row.iq,
    charm: row.charm,
    education: row.education,
    career: row.career,
    duelWins: row.duel_wins,
    duelLosses: row.duel_losses,
    discoverable: row.discoverable,
    showFinances: row.show_finances,
    showLocation: row.show_location,
    importedAt: row.imported_at,
    createdAt: row.created_at
  };
}

function publicCharacter(row) {
  return {
    id: row.id,
    displayName: row.display_name,
    avatar: row.avatar,
    age: row.age,
    fame: row.fame,
    reputation: row.reputation,
    actingSkill: row.acting_skill,
    charm: row.charm,
    iq: row.iq,
    education: row.education,
    career: row.career,
    duelWins: row.duel_wins,
    duelLosses: row.duel_losses,
    district: row.show_location ? { id: row.district_id, slug: row.district_slug, name: row.district_name } : null,
    money: row.show_finances ? Number(row.money) : null,
    createdAt: row.created_at
  };
}

module.exports = {
  worldClock,
  settleCharacter,
  applyMoney,
  spendEnergy,
  insertLedger,
  unlimitedResources,
  activeOverrides,
  writeFeed,
  distanceBetween,
  fareBetween,
  pendingRevenue,
  privateCharacter,
  publicCharacter
};
