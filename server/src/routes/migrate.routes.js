const express = require("express");
const { query, tx } = require("../db");
const { getConfig } = require("../config");
const { asyncHandler, bad, conflict } = require("../errors");
const { requireAccount, requireVerified, requireActive } = require("../auth");
const { settleCharacter, applyMoney, privateCharacter } = require("../game");
const { validateName, validateAvatar, clampInt, requireObject } = require("../validate");

const router = express.Router();
const guard = [requireAccount, requireVerified, requireActive];

const EDUCATION = new Set(["none", "primary", "secondary", "university", "acting-academy", "graduated"]);

/**
 * One-time import of the browser save. The client keeps its local copy — this
 * only copies validated values up. A character that already imported is never
 * overwritten by a second, possibly older, snapshot.
 */
router.post("/save", guard, asyncHandler(async (req, res) => {
  const body = requireObject(req.body);
  const save = requireObject(body.save);
  const player = requireObject(save.player);
  const cfg = await getConfig(query);
  const warnings = [];

  const result = await tx(async (client) => {
    const mine = await client.query("SELECT id FROM characters WHERE account_id = $1", [req.account.id]);
    if (!mine.rows[0]) throw bad("NO_CHARACTER", "This account has no character yet.");
    const settled = await settleCharacter(client, mine.rows[0].id, cfg);
    const character = settled.character;

    if (character.imported_at) {
      throw conflict("ALREADY_IMPORTED", "This account has already imported a save. Server progress is never overwritten.");
    }

    let displayName = character.display_name;
    if (player.name !== undefined) {
      try {
        displayName = validateName(player.name, { min: 3, max: 20 });
      } catch (err) {
        warnings.push("Display name was not importable and your account name was kept.");
      }
    }

    let avatar = character.avatar;
    if (player.look !== undefined) {
      try {
        avatar = validateAvatar(player.look);
      } catch (err) {
        warnings.push("Avatar was not importable and your account avatar was kept.");
      }
    }

    const wantedMoney = clampInt(player.money, 0, cfg.max_import_money, 0);
    if (Number(player.money) > cfg.max_import_money) {
      warnings.push(`Money was capped at ₦${cfg.max_import_money.toLocaleString("en-NG")}.`);
    }
    const age = clampInt(player.age, 1, 120, 18);
    const week = clampInt(player.week, 0, 6000, 0);
    const energy = clampInt(player.energy, 0, 100, 100);
    const health = clampInt(player.health, 0, 100, 100);
    const happiness = clampInt(player.happiness, 0, 100, 80);
    const fame = clampInt(player.fame, 0, 100000, 0);
    const actingSkill = clampInt(player.actingSkill, 0, 100, 0);
    const iq = clampInt(player.iq, 0, 200, 5);
    const charm = clampInt(player.charm, 0, 100, 30);
    const reputation = clampInt(player.rep, -100000, 100000, 0);
    let education = character.education;
    if (player.education !== undefined) {
      if (EDUCATION.has(String(player.education))) education = String(player.education);
      else warnings.push("Unrecognised education value was ignored.");
    }
    const career = typeof player.career === "string"
      ? player.career.replace(/[<>]/g, "").slice(0, 40)
      : character.career;

    // Money moves through the ledger so the balance always has a history.
    const delta = BigInt(wantedMoney) - BigInt(character.money);
    if (delta !== 0n) {
      await applyMoney(client, character, delta, {
        kind: "save_import",
        ref: req.account.id,
        idempotencyKey: `import:${req.account.id}`,
        meta: { source: "local-storage", requested: wantedMoney }
      });
    }

    const startAge = Math.max(1, age - Math.floor(week / 52));
    const updated = await client.query(
      `UPDATE characters SET display_name = $2, avatar = $3, age = $4, start_age = $5,
              game_week = $6, energy = $7, health = $8, happiness = $9, fame = $10, acting_skill = $11,
              iq = $12, charm = $13, reputation = $14, education = $15, career = $16,
              imported_at = now(), updated_at = now()
        WHERE id = $1 RETURNING *`,
      [character.id, displayName, avatar, age, startAge, week, energy, health, happiness, fame, actingSkill, iq, charm, reputation, education, career]
    );

    const awards = Array.isArray(player.awards) ? player.awards.slice(0, 20) : [];
    let importedAwards = 0;
    for (const award of awards) {
      const label = String(award || "").replace(/[<>]/g, "").trim().slice(0, 60);
      if (!label) continue;
      const code = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
      if (!code) continue;
      await client.query(
        `INSERT INTO character_achievements (character_id, code, label) VALUES ($1, $2, $3)
         ON CONFLICT (character_id, code) DO NOTHING`,
        [character.id, `legacy-${code}`, label]
      );
      importedAwards++;
    }
    if (Array.isArray(save.player.awards) && save.player.awards.length > 20) {
      warnings.push("Only the first 20 awards were imported.");
    }

    await client.query(
      `INSERT INTO save_imports (account_id, character_id, fields, warnings) VALUES ($1, $2, $3, $4)`,
      [
        req.account.id,
        character.id,
        JSON.stringify({
          money: wantedMoney, age, week, energy, health, happiness, fame, actingSkill, iq, charm, reputation, education
        }),
        JSON.stringify(warnings)
      ]
    );

    return { character: updated.rows[0], importedAwards, warnings };
  });

  res.json({
    ok: true,
    message: "Progress imported. Your local save is still on this device as a backup.",
    warnings: result.warnings,
    importedAwards: result.importedAwards,
    character: privateCharacter(result.character)
  });
}));

router.get("/status", requireAccount, asyncHandler(async (req, res) => {
  const { rows } = await query(
    "SELECT imported_at, updated_at FROM characters WHERE account_id = $1",
    [req.account.id]
  );
  res.json({
    imported: Boolean(rows[0] && rows[0].imported_at),
    importedAt: rows[0] ? rows[0].imported_at : null
  });
}));

module.exports = router;
