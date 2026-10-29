// Tunable game rules live in game_config so balance changes need no redeploy.
// Values are jsonb numbers; they are cached briefly to keep settlement cheap.

const DEFAULTS = {
  starting_money: 5000,
  max_import_money: 2000000,
  transfer_fee_pct: 2,
  transfer_min_fee: 50,
  transfer_daily_cap: 5000000,
  travel_base_fare: 120,
  travel_fare_per_unit: 12,
  travel_energy_cost: 3,
  energy_regen_seconds: 30,
  health_regen_seconds: 60,
  happiness_regen_seconds: 120,
  settle_max_offline_hours: 72,
  business_revenue_cap_hours: 24,
  duel_cooldown_seconds: 600,
  duel_daily_cap: 10,
  duel_energy_cost: 15,
  duel_win_reward: 1500,
  duel_loss_cost: 500
};

let cache = { at: 0, value: { ...DEFAULTS } };
const TTL_MS = 10000;

async function getConfig(query) {
  if (Date.now() - cache.at < TTL_MS) return cache.value;
  try {
    const { rows } = await query("SELECT key, value FROM game_config");
    const merged = { ...DEFAULTS };
    for (const row of rows) {
      const n = typeof row.value === "number" ? row.value : Number(row.value);
      if (Number.isFinite(n)) merged[row.key] = n;
    }
    cache = { at: Date.now(), value: merged };
  } catch (err) {
    console.warn("[config] falling back to defaults:", err.message);
  }
  return cache.value;
}

module.exports = { getConfig, DEFAULTS };
