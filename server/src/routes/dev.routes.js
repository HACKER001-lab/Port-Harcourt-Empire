// Development-only helpers. Every route here is unavailable unless
// MAIL_OUTBOX_DEV=1, which is set only in the sandbox compose file.

const express = require("express");
const { query } = require("../db");
const { asyncHandler, notFound } = require("../errors");
const { devOutbox } = require("../mail");
const { resetRateLimits } = require("../auth");

const router = express.Router();

router.use((_req, _res, next) => next(devOutbox ? undefined : notFound("Not available.")));

router.get("/outbox", asyncHandler(async (_req, res) => {
  const { rows } = await query(
    "SELECT id, to_email, subject, body, created_at FROM mail_outbox ORDER BY id DESC LIMIT 10"
  );
  res.json({
    note: "Development mail outbox. Configure SMTP_* secrets for real delivery.",
    items: rows
  });
}));

router.post("/reset-limits", asyncHandler(async (_req, res) => {
  resetRateLimits();
  res.json({ ok: true });
}));

module.exports = router;
