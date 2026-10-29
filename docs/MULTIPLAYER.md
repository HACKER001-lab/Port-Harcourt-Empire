# Multiplayer Foundation — Implementation Report

Status: **implemented and tested**. This document describes what exists in the
repository, how it is protected, what was exercised, and what is still missing.
It replaces the planning-only sections of `docs/ARCHITECTURE.md` where they
overlap.

---

## 1. Architecture

```
browser (single page, port 3000)
   │  same-origin fetch /api/*  (httpOnly cookie, x-requested-with)
   ▼
nginx ──────────────► Node 22 / Express API (internal :4000)
                        │  rules, auth, transactions
                        ▼
                     Postgres 16  (accounts, characters, world, economy, audit)
```

- Static frontend stays deployable to Vercel unchanged (no build step).
- The API is a long-lived Node service: it owns sessions, transactions and the
  background settlement sweep. Serverless-only hosting would need the sweep
  replaced by a scheduled job.
- No WebSocket/realtime transport. Every screen is an authenticated request;
  shared information is refreshed when opened or when a button is pressed.
  This is documented in the UI copy ("City feed", "Arena rankings").

## 2. Database entities and relationships

| Table | Purpose | Key relationships |
|---|---|---|
| `accounts` | credentials, role, status, verification | 1:1 `characters` |
| `sessions` | hashed session tokens, expiry, revocation | N:1 `accounts` |
| `auth_tokens` | email-verification / password-reset tokens (hashed, single use) | N:1 `accounts` |
| `cities` → `districts` → `locations` | the shared world definition | `characters.district_id`, `businesses.district_id` |
| `characters` | identity, location, money, vitals, stats, privacy | 1:1 `accounts` |
| `character_achievements` | imported/unlocked milestones | N:1 `characters` |
| `ledger` | append-only money movements, unique `(character_id, idempotency_key)` | N:1 `characters` |
| `transfers` | player-to-player receipts, unique `(sender, idempotency_key)` | 2×`characters` |
| `activities` | server-timed work/study, unique `(character_id, idempotency_key)` | N:1 `characters` |
| `business_types` / `businesses` | catalogue and player-owned venues | `businesses.owner_character_id` |
| `friendships` | directed request with status | 2×`characters` |
| `duels` | resolved bouts with powers and RNG transcript | 2×`characters`, `districts` |
| `city_feed` | public shared-world events | optional `characters`/`districts` |
| `admin_overrides` | explicit unlimited-resource flags with expiry | `characters`, `accounts` |
| `admin_audit_log` | immutable admin actions with before/after | `accounts` |
| `game_config` | tunable economy/clock rules | — |
| `save_imports` | one-time local-save import records | `accounts`, `characters` |

Money is never a free-floating integer: `characters.money` is only changed by
ledger entries, and the ledger is the audit trail. Indexes exist for discovery
(`characters.fame`), location (`characters.district`), due work
(`activities(status, ends_at)`), business ownership and per-player ledger reads.

## 3. Authentication

- Email + password. Passwords hashed with **scrypt** (N=16384, random salt),
  timing-safe comparison. Policy: 10–200 chars, letter + digit.
- Sessions: 32-byte token, SHA-256 at rest, httpOnly `gcr_session` cookie,
  SameSite=Lax, 30-day expiry, revocable server-side. `COOKIE_SECURE=1` in
  production.
- Login lockout after 8 failures (15 min) plus per-IP/per-email rate limits.
- **Email verification is required for every write action** (`EMAIL_UNVERIFIED`
  otherwise). Registration still signs the player in and lets them read.
- Password recovery: always-200 request (no account enumeration), single-use
  token, 60-minute expiry, hashed at rest, revokes **all** sessions on use.
- Password change requires the current password and revokes other sessions.
- CSRF: state-changing requests require `x-requested-with: gcr` (cross-site
  forms cannot set it) plus SameSite cookies; optional `ALLOWED_ORIGINS`
  allowlist for deployments with several hosts.
- Identity is always derived from the session. No endpoint accepts a player id
  as proof of identity; `:characterId` values are only targets that are checked
  against the session's own character.

## 4. Persistent characters and save migration

- One character per account, created in `old-gra` with the server-configured
  starting balance. Fields: display name, avatar, age/game week (derived from
  the world clock), city, district, money, energy, health, happiness, fame,
  reputation, acting skill, IQ, charm, education, career, privacy flags, duel
  record, imported-at.
- **Import** (`POST /api/migrate/save`) accepts a validated subset of the local
  save: numbers are clamped (money ≤ ₦2,000,000, age 1–120, week ≤ 6000,
  vitals ≤ 100), unrecognised education values are ignored, awards are capped
  at 20, extra client fields are discarded. The import runs once: a second
  attempt returns `409 ALREADY_IMPORTED` and never overwrites server progress.
  The local save stays in the browser; nothing deletes it.
- Imported money moves through the ledger (`save_import`), so the balance has a
  history.

## 5. Server-authoritative rules

### World clock
`world_state.epoch_started_at` + `game_hour_seconds` (5s per game hour → 120s
per game day). Game day/week/age derive in SQL from the database clock. No
client timestamp is accepted anywhere.

### Settlement
`settleCharacter()` locks the character row, then:
- regenerates energy/health/happiness for elapsed time (capped at 72h offline),
- charges business upkeep per game day,
- completes every activity whose `ends_at` has passed and pays it exactly once,
- advances game week/age and stamps `last_settled_at`.

It runs lazily on every request that touches the character, plus a 60-second
background sweep for due activities and idle characters — so jobs finish while
the player is offline. Duplicate settlement is impossible (row lock +
`last_settled_at`), and each payout also carries a unique ledger key.

### Activities
Five server-defined activities (delivery shift, studio shift, training, course,
rest). The client picks a `kind`; the server owns duration, energy cost, money
cost, requirements and reward. Client-supplied `startedAt`/`endsAt` are ignored
(verified in tests). Duplicate `idempotencyKey` returns the original activity;
the same `kind` cannot run twice; max two concurrent; rewards are paid by
settlement, not by the claim endpoint.

### Travel
Fare = base + distance × per-unit, computed from district coordinates in the
database. Energy cost and district validity are server-side. Client only asks.

### Businesses
Five types (₦25k–₦150k), max five per player, opened in the player's current
district. Purchase, upgrade (cost × current level) and revenue are server
computed. Revenue accrues at `base_revenue × level` per day, capped at 24h, and
is paid only by a collection call that locks the business row. Duplicate
purchase requests (same key, including parallel ones) create one business and
charge once.

### Transfers
Minimum ₦100, max ₦100,000,000, fee = max(₦50, 2%), daily cap ₦5,000,000.
Unique `(sender, idempotency_key)` receipt row is inserted before money moves;
both balances are locked in id order to avoid deadlocks. Verified: duplicates
(sequential and parallel) debit once.

### Duels
Asynchronous instanced bouts resolved in one transaction from stats + server
RNG: same district only, no safe zones, 10-minute pair cooldown, 10 challenges
per day, max 3 against one target per day, energy cost for both, recorded
history, wins/losses/fame. This is **not** a real-time or 3D shooter.

### Overrides
`admin_overrides` rows are read by the economy functions: unlimited money skips
debits (ledger records the requested amount with `override: true`), unlimited
energy/health pins to 100 and skips consumption. Explicit, expirable, revocable,
audited.

## 6. Player profiles and shared world

- `GET /api/players` — discoverable characters only, `ILIKE` search, 15–50 per
  page, ordered by fame, includes business count.
- `GET /api/players/:id` — public profile: name, avatar, age, fame, reputation,
  skills, education, career, duel record, district (only if `show_location`),
  money (only if `show_finances`), achievements, public businesses, duel history.
  Never selects the account email.
- `GET /api/businesses`, `/api/feed`, `/api/rankings` — bounded public lists.
- `city_feed` records joins, business openings, transfers (no amounts) and duel
  results.
- The map's "you are here" marker follows the server character's district when
  signed in; travel is the server-validated call.

## 7. Administration

- Role (`player` / `moderator` / `admin`) on the account, enforced by every
  `/api/admin/*` route. The navigation only *offers* the console to admins; the
  server is the control.
- Capabilities: search, inspect account/character/ledger/audit, grant or deduct
  money/energy/health, enable/revoke unlimited overrides with expiry, suspend/
  ban/restore, rename, view the global audit log and overview metrics.
- Every mutation requires a reason, is executed in a transaction, and writes
  actor, target, action, reason, before and after to `admin_audit_log`.
- Administrator accounts cannot be moderated through the console.
- First admin: `node scripts/provision-admin.js <registered-email>` — no default
  password, no registration shortcut.

## 8. Security controls and adversarial tests

Implemented: scrypt hashes; session tokens hashed; httpOnly/SameSite cookies;
verification gate; CSRF header; login/session lockout; per-action rate limits;
parameterised SQL everywhere; server-side validation and clamps; row locks and
unique idempotency keys; ownership checks on every business/duel/transfer;
admin role checks; audit log; dev outbox gated by `MAIL_OUTBOX_DEV=1`; no secrets
in the client; least-privilege API surface (Codex/`get_connectors_info` not used).

Verified by the integration suite: unauthenticated access (401), unverified
writes (403), cross-account modifications refused, admin actions refused to
players, overdraft and negative amounts refused, duplicate/parallel purchases
and transfers applied once, client timestamps ignored, malformed JSON and markup
names rejected, SQL-injection-shaped search inert, private finances/location
hidden, admin self-protection, suspension revoking sessions.

## 9. Tests performed

Backend (in the `api` container, real Postgres):

```
docker compose -f docker-compose.base44.yml exec -T api node --test test/multiplayer.test.js
# tests 20  pass 20  fail 0
```

The suite creates two or more real accounts, verifies them through the dev
outbox, and covers every flow above including two concurrent requests. It
deletes its own accounts at the end.

Preview (live browser, real API + database): account creation through the form,
`Email verified` after the real verification endpoint, signed-in header,
player directory with two accounts, public profile (email hidden, balance
private), businesses catalogue (5 types) and server refusal of an unaffordable
purchase with the character's balance unchanged, wallet with transfer form and
ledger, `Access denied` for a non-admin on the admin console, server-validated
travel (₦5,000 → ₦3,560, district changed, map updated), zero console errors,
no horizontal overflow at 428px on account/businesses/wallet/players.
Test accounts created for this were deleted afterwards.

Not automatically verified: native `confirm()` dialogs (import, transfer,
upgrade) cannot be driven by the automation, and no second simultaneous human
session was used; those flows are covered by the API suite instead.

## 10. Known limitations

- No realtime presence/chat; feeds refresh on navigation/action.
- Solo story remains local and its money is separate from the online balance.
- PvP is asynchronous, not action combat.
- Email delivery needs SMTP; otherwise only the dev outbox works.
- Moderation covers status/name/resources; there is no report queue UI yet.
- No account deletion or data export endpoint yet.
- Business revenue is simple (no footfall, staff, stock or player purchases).
- Rate limits are in-memory: correct for one API instance, must move to
  Postgres/Redis if the API scales horizontally.
- `GET /api/dev/outbox` exposes recent email bodies when `MAIL_OUTBOX_DEV=1`;
  never enable it in production.

## 11. Deployment and configuration

Environment variables for the API:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | managed Postgres in production |
| `PORT` | no (4000) | |
| `NODE_ENV` | recommended | `production` in production |
| `COOKIE_SECURE` | production | `1` behind HTTPS |
| `ALLOWED_ORIGINS` | optional | comma-separated, for multi-host setups |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | production | verification + reset email |
| `PUBLIC_APP_URL` | production | used to build email links |
| `MAIL_OUTBOX_DEV` | **never** in production | dev only |
| `SETTLE_SWEEP_MS` | optional | default 60000 |

Commands: `node scripts/migrate.js` (versioned migrations, idempotent),
`node scripts/provision-admin.js <email>`, `node --test test/multiplayer.test.js`.
Build: frontend has no build; API image is `server/Dockerfile`.

Deployment status: **not deployed**. The existing Vercel static deployment is
untouched. The API needs a host with a persistent process (Render/Railway/Fly/
a VPS) plus managed Postgres; the background sweep must run there (or as a
scheduled job). No production database, SMTP account or admin has been created —
those require the operator's credentials and explicit authorization.

## 12. Recommended next priorities

1. Move rate limiting to Postgres and add a settlement cron/worker split if the
   API runs more than one instance.
2. Business depth: stock, staff, district footfall, player purchases.
3. Social: report queue, notifications, organisation/guild memberships.
4. Realtime only where it pays for itself (city chat, live duel spectating).
5. Rate-limited PvP matchmaking tiers and a visible combat log.
6. Split the legacy client into modules and remove inline handlers so a CSP can
   be enforced (see `docs/AUDIT.md`).
7. Account deletion/export and a proper moderation policy for the legacy
   gambling/"dark web" content before public multiplayer.
