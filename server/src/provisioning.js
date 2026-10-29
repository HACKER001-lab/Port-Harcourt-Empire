// Bootstrap the first administrator from an operator-controlled email.
// No default password, no registration shortcut, no privilege by accident.

const { query } = require("./db");

async function promoteToAdmin(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) throw new Error("An email address is required.");
  const { rows } = await query(
    "UPDATE accounts SET role = 'admin', updated_at = now() WHERE email = $1 RETURNING id, email, role",
    [normalized]
  );
  if (!rows[0]) {
    throw new Error(`No account exists for ${normalized}. Register it first, then run this again.`);
  }
  return rows[0];
}

module.exports = { promoteToAdmin };
