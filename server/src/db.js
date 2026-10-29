const { Pool } = require("pg");
const { HttpError } = require("./errors");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: 30000
});

pool.on("error", (err) => console.error("[db] idle client error:", err.message));

function query(text, params) {
  return pool.query(text, params);
}

async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

async function waitForDb(attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    try {
      await pool.query("SELECT 1");
      return true;
    } catch (err) {
      if (i === attempts - 1) throw new HttpError(503, "DB_UNAVAILABLE", "Database is not reachable.");
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

module.exports = { pool, query, tx, waitForDb };
