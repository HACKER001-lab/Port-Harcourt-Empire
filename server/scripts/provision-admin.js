/* Promote an existing account to administrator.
   Usage: node scripts/provision-admin.js player@example.com
   There is no default admin and no password baked in. */

const { promoteToAdmin } = require("../src/provisioning");
const { pool } = require("../src/db");

const email = process.argv[2];

if (!email) {
  console.error("Usage: node scripts/provision-admin.js <registered-email>");
  process.exit(1);
}

promoteToAdmin(email)
  .then((row) => {
    console.log(`[admin] ${row.email} is now an administrator (${row.role}).`);
  })
  .catch((err) => {
    console.error(`[admin] ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
