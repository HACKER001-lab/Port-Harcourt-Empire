const express = require("express");
const { query, tx, waitForDb } = require("./db");
const { getConfig } = require("./config");
const { HttpError } = require("./errors");
const { loadSession, requireWrite } = require("./auth");
const { settleCharacter } = require("./game");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "128kb" }));
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  next();
});

app.get("/api/health", async (_req, res) => {
  try {
    await query("SELECT 1");
    res.json({ ok: true, service: "gcr-api" });
  } catch (err) {
    res.status(503).json({ ok: false, error: "DB_UNAVAILABLE" });
  }
});

app.use("/api", loadSession, requireWrite);

app.use("/api/auth", require("./routes/auth.routes"));
app.use("/api", require("./routes/world.routes"));
app.use("/api", require("./routes/game.routes"));
app.use("/api", require("./routes/economy.routes"));
app.use("/api", require("./routes/social.routes"));
app.use("/api/migrate", require("./routes/migrate.routes"));
app.use("/api/admin", require("./routes/admin.routes"));
app.use("/api/dev", require("./routes/dev.routes"));

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "NOT_FOUND", message: "No such endpoint." });
});

app.use((err, _req, res, _next) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.code, message: err.message });
  }
  if (err && err.type === "entity.too.large") {
    return res.status(413).json({ error: "PAYLOAD_TOO_LARGE", message: "That request is too large." });
  }
  if (err && err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "INVALID_JSON", message: "The request body is not valid JSON." });
  }
  console.error("[api] unhandled:", err);
  res.status(500).json({ error: "INTERNAL_ERROR", message: "Something went wrong." });
});

/* Background settlement: offline activities and business upkeep progress even
   when nobody has the game open. The API is the only writer, one instance. */
const SWEEP_MS = Number(process.env.SETTLE_SWEEP_MS || 60000);

async function sweep() {
  try {
    const cfg = await getConfig(query);
    const { rows } = await query(
      `SELECT DISTINCT character_id FROM (
         SELECT character_id FROM activities WHERE status = 'pending' AND ends_at <= now()
         UNION
         SELECT owner_character_id FROM businesses WHERE status = 'open' AND last_collected_at < now() - interval '2 hours'
         UNION
         SELECT id FROM characters WHERE last_settled_at < now() - interval '10 minutes'
       ) due LIMIT 300`
    );
    for (const row of rows) {
      await tx((client) => settleCharacter(client, row.character_id, cfg)).catch((err) => {
        console.warn("[settle] failed for", row.character_id, "-", err.message);
      });
    }
  } catch (err) {
    console.warn("[settle] sweep failed:", err.message);
  }
}

const port = Number(process.env.PORT || 4000);

waitForDb()
  .then(() => {
    app.listen(port, "0.0.0.0", () => console.log(`[api] listening on :${port}`));
    if (process.env.SETTLE_WORKER !== "0") {
      setInterval(sweep, SWEEP_MS);
      console.log(`[settle] background sweep every ${SWEEP_MS}ms`);
    }
  })
  .catch((err) => {
    console.error("[api] cannot start:", err.message);
    process.exit(1);
  });

module.exports = app;
