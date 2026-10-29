// Transactional email: verification links and password resets.
// Production requires SMTP_* secrets. Without them the app still runs and
// verification links are written to a dev-only outbox so the flow is testable.

const nodemailer = require("nodemailer");

const hasSmtp = Boolean(process.env.SMTP_HOST && process.env.SMTP_PORT);
const devOutbox = process.env.MAIL_OUTBOX_DEV === "1";
const from = process.env.MAIL_FROM || "no-reply@gardencity.example";

const transport = hasSmtp
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: String(process.env.SMTP_SECURE || "") === "1",
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined
    })
  : null;

function publicBaseUrl() {
  if (process.env.PUBLIC_APP_URL) return process.env.PUBLIC_APP_URL.replace(/\/$/, "");
  if (process.env.BASE44_PUBLIC_HOST_SUFFIX) return `https://3000-${process.env.BASE44_PUBLIC_HOST_SUFFIX}`;
  return "http://localhost:3000";
}

async function sendMail(query, { accountId, to, subject, text }) {
  if (transport) {
    await transport.sendMail({ from, to, subject, text });
    return { delivered: true, channel: "smtp" };
  }
  if (devOutbox) {
    await query(
      "INSERT INTO mail_outbox (account_id, to_email, subject, body) VALUES ($1, $2, $3, $4)",
      [accountId || null, to, subject, text]
    );
    console.log("[mail:dev] stored in outbox:", subject);
    return { delivered: false, channel: "outbox" };
  }
  console.warn("[mail] no transport configured, message not delivered:", subject);
  return { delivered: false, channel: "none" };
}

async function sendVerification(query, account, token) {
  const link = `${publicBaseUrl()}/#verify/${token}`;
  return sendMail(query, {
    accountId: account.id,
    to: account.email,
    subject: "Verify your Garden City: Reign account",
    text: `Welcome to Garden City: Reign.\n\nVerify your email within 24 hours:\n${link}\n\nIf you did not create this account, ignore this message.`
  });
}

async function sendPasswordReset(query, account, token) {
  const link = `${publicBaseUrl()}/#reset/${token}`;
  return sendMail(query, {
    accountId: account.id,
    to: account.email,
    subject: "Reset your Garden City: Reign password",
    text: `A password reset was requested for your account.\n\nReset within 60 minutes:\n${link}\n\nIf this was not you, no action is needed.`
  });
}

module.exports = { sendMail, sendVerification, sendPasswordReset, devOutbox, hasSmtp };
