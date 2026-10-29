// Server-side validation. Every rule here is the authority; the client mirror
// exists only to give the player faster feedback.

const { bad } = require("./errors");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 .'_-]*$/;
const KEY_RE = /^[A-Za-z0-9:_.-]{8,100}$/;

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) {
    throw bad("INVALID_EMAIL", "Enter a valid email address.");
  }
  return email;
}

function validatePassword(value) {
  const password = String(value || "");
  if (password.length < 10) throw bad("WEAK_PASSWORD", "Password must be at least 10 characters.");
  if (password.length > 200) throw bad("WEAK_PASSWORD", "Password must be 200 characters or fewer.");
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw bad("WEAK_PASSWORD", "Password must include a letter and a number.");
  }
  return password;
}

function validateName(value, { min = 3, max = 20, field = "display name" } = {}) {
  const name = String(value || "").trim().replace(/\s+/g, " ");
  if (name.length < min || name.length > max) {
    throw bad("INVALID_NAME", `Your ${field} must be ${min}-${max} characters.`);
  }
  if (!NAME_RE.test(name)) {
    throw bad("INVALID_NAME", `Your ${field} can use letters, numbers, spaces and . ' _ - only.`);
  }
  return name;
}

function validateAvatar(value) {
  const avatar = String(value || "").trim();
  if (!avatar) return "🌟";
  if (Array.from(avatar).length > 4 || /[<>&"\\/]/.test(avatar)) {
    throw bad("INVALID_AVATAR", "Choose a short emoji for your avatar.");
  }
  return avatar;
}

function validateIdempotencyKey(value) {
  const key = String(value || "").trim();
  if (!KEY_RE.test(key)) {
    throw bad("INVALID_IDEMPOTENCY_KEY", "A valid request id is required for this action.");
  }
  return key;
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function requireObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw bad("INVALID_BODY", "A JSON object is required.");
  }
  return value;
}

module.exports = {
  normalizeEmail,
  validatePassword,
  validateName,
  validateAvatar,
  validateIdempotencyKey,
  clampInt,
  requireObject
};
