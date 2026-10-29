const { getConfig } = require("./config");
const { query, tx } = require("./db");
const { bad, notFound } = require("./errors");
const { settleCharacter } = require("./game");

function publicAccount(row) {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    emailVerified: Boolean(row.email_verified_at),
    createdAt: row.created_at
  };
}

/**
 * Run `fn` in a transaction with the signed-in player's character settled and
 * locked. Every mutation endpoint uses this so rules read authoritative state.
 */
async function withCharacter(req, fn) {
  const cfg = await getConfig(query);
  return tx(async (client) => {
    const { rows } = await client.query("SELECT id FROM characters WHERE account_id = $1", [req.account.id]);
    if (!rows[0]) throw bad("NO_CHARACTER", "This account has no character yet.");
    const settled = await settleCharacter(client, rows[0].id, cfg);
    const result = await fn({
      client,
      character: settled.character,
      clock: settled.clock,
      unlimited: settled.unlimited,
      cfg
    });
    return result;
  });
}

async function loadCharacterId(accountId) {
  const { rows } = await query("SELECT id FROM characters WHERE account_id = $1", [accountId]);
  if (!rows[0]) throw notFound("Character not found.");
  return rows[0].id;
}

async function readCharacter(client, characterId) {
  const { rows } = await client.query("SELECT * FROM characters WHERE id = $1 FOR UPDATE", [characterId]);
  if (!rows[0]) throw notFound("Player not found.");
  return rows[0];
}

module.exports = { publicAccount, withCharacter, loadCharacterId, readCharacter };
