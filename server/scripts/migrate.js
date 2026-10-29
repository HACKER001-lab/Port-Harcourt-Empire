/* Versioned schema runner: applies pending .sql files in order, once each. */

const fs = require("fs");
const path = require("path");
const { pool, waitForDb } = require("../src/db");

async function run() {
  await waitForDb();
  const client = await pool.connect();
  try {
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
    );
    const dir = path.join(__dirname, "..", "migrations");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      const done = await client.query("SELECT 1 FROM schema_migrations WHERE version = $1", [file]);
      if (done.rows[0]) {
        console.log(`[migrate] skip ${file}`);
        continue;
      }
      const sql = fs.readFileSync(path.join(dir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.log(`[migrate] applied ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`${file}: ${err.message}`);
      }
    }
    console.log("[migrate] up to date");
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error("[migrate] failed:", err.message);
  process.exit(1);
});
