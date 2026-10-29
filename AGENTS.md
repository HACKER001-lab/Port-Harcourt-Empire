# AGENTS.md — Garden City: Reign

## What this repo is

A single-page life-sim game with a **real multiplayer backend**.

- `index.html` — the original solo game (state, save, all story systems).
- `css/`, `js/ui.js`, `js/city.js`, `js/pvp.js`, `js/game-time.js` — the redesigned interface layer.
- `js/api.js`, `js/auth.js`, `js/community.js`, `js/businesses.js`, `js/wallet.js`, `js/online-time.js`, `js/admin.js` — the **online layer** that talks to `/api`.
- `server/` — Node 22 + Express + Postgres backend: auth, world clock, economy, businesses, duels, admin, audit.
- `server/migrations/*.sql` — versioned schema; applied by `server/scripts/migrate.js`.

Solo story (browser save) and the shared world (server) are deliberately separate. The only bridge is the one-time save import on the Account screen.

## Run it

```bash
docker compose -f docker-compose.base44.yml up -d --build
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/      # 200
curl -s http://localhost:3000/api/health                            # {"ok":true}
```

Services: `web` (nginx, host **3000**, proxies `/api`), `api` (Node, internal 4000, live source bind-mounts, `node --watch`), `db` (Postgres 16), `migrate` (one-shot). API dependencies are installed in the image (`server/Dockerfile`); changing `server/package.json` requires `--build`.

Migrations run automatically via the `migrate` service. Manually: `docker compose -f docker-compose.base44.yml run --rm migrate`.

nginx serves explicit bind-mounts of `index.html`, `branding.js`, `css/` and `js/`. A new top-level asset directory must be added to `volumes:` or it 404s.

## Tests

```bash
docker compose -f docker-compose.base44.yml exec -T api node --test test/multiplayer.test.js
```

20 integration tests covering registration/verification/login/recovery, character isolation, transfers (including parallel duplicates), travel, activities (server time, no double reward), admin authority/audit/overrides, business purchase/revenue/upgrade, friendships, duels, migration caps, privacy and injection handling. They create and delete their own accounts.

## Make the first administrator

There is no default admin and no admin password anywhere in the code.

```bash
docker compose -f docker-compose.base44.yml exec api node scripts/provision-admin.js you@example.com
```

The account must already exist and be verified. Every admin action requires a reason and is written to `admin_audit_log`.

## Email in development vs production

Verification and reset links are sent by SMTP when `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`MAIL_FROM` exist. Without SMTP (the sandbox default) the API stores the rendered email in `mail_outbox` and `MAIL_OUTBOX_DEV=1` exposes it at `GET /api/dev/outbox` and through “Development mail” on the Account screen. **That outbox is dev-only and must never be enabled in production.** Set `COOKIE_SECURE=1` behind production HTTPS.

## Architecture

- **Auth**: email + password (scrypt, per-password salt), httpOnly `gcr_session` cookie (SameSite=Lax, 30 days), server-side session rows, e-mail verification gate for write actions, password reset (single-use token, 60 min, revokes all sessions), login lockout after repeated failures.
- **Shared world**: `cities` → `districts` → `locations`, one active Port Harcourt with 9 districts. Districts are global; characters hold one location each; businesses are player-owned venues inside a district.
- **World clock**: `world_state.epoch_started_at` + `game_hour_seconds`. Game days/weeks derive in SQL. `settleCharacter()` locks a character and applies regeneration, business upkeep and every due activity since `last_settled_at` — so progress continues while the player is offline. A background sweep in the API settles due characters every 60s.
- **Money**: append-only `ledger` with unique `(character_id, idempotency_key)`; balances are only changed by ledger entries. Transfers insert a `transfers` row with a unique `(sender, idempotency_key)` before moving money.
- **Duels**: server-resolved from stats + server RNG in one transaction; same-district, non-safe-zone, per-pair cooldown, daily caps, energy cost, recorded history.
- **Admin**: `accounts.role` check on every call; grants/overrides/moderations write `admin_audit_log` with actor, target, reason and before/after. Overrides are explicit `admin_overrides` rows with optional expiry, and are read by the economy functions (unlimited money skips debits; unlimited energy/health pins and skips consumption).
- **Privacy**: public profile queries never select `accounts.email`; `discoverable`, `show_finances`, `show_location` are enforced in the query/response, not just hidden in CSS.
- **Client**: all writes go through `GCR.api()` with `credentials: same-origin` and `x-requested-with: gcr`. Views render from `GCR.session` / `GCR.data`; async loads call `GCR.reload()` once. Draft input values are preserved across those reloads (business and wallet forms).

Full detail: `docs/MULTIPLAYER.md`.

## Adding a screen

1. Register `window.VIEWS.<id> = viewFn` in one of the `js/*.js` modules.
2. Add the id to a `NAV_GROUPS` entry in `js/ui.js` (admin stays hidden unless `GCR.isAdmin()`).
3. If it needs data, load through `GCR.api()` and follow the `loaded/loading` + `GCR.reload()` pattern.

## Honest boundaries

- The **solo story** is still local and client-authoritative by design; its money is not the online balance. Do not display it as shared.
- **No realtime transport.** The city feed, directory, profiles, businesses and leaderboard are ordinary authenticated requests refreshed when a screen is opened or a button is pressed. There is no websocket/presence.
- **PvP is asynchronous instanced bouts**, not 3D action. Damage/hit results are not client-supplied.
- **Email delivery** needs SMTP credentials in production; without them only the dev outbox works.
- **Payment providers are not integrated** (Stripe is available in the region if ever needed).
- Saves imported once are never overwritten; a second import is refused by design.
- `docs/AUDIT.md` still lists the legacy client issues (inline handlers, duplicate `escapeHtml`, unescaped name in old views). New code escapes with `GCR.esc`.

## Sandbox / preview specifics

- Single origin: the browser only talks to port 3000; nginx proxies `/api/` to the API, so the session cookie is first-party and no CORS is needed.
- `BASE44_PREVIEW_MODE` is passed to the API but unused: nothing is host- or origin-allowlisted. Keep it that way unless a framework check requires it.
- No hot-reload for static files; the API restarts on `node --watch`. Call `reload_preview` after edits.
- `MAIL_OUTBOX_DEV=1` and dev database credentials are sandbox-only; production needs its own `DATABASE_URL`.

## Quirks worth knowing

- Dead code after `</html>` (`promptAdmin`/`adminCheat`) — leave dead.
- Two `escapeHtml` declarations in `index.html`; new code uses `GCR.esc`.
- `state` is a mutable global persisted under `tamunoiya-save-v2`; the online layer never writes server state from it.
- Player names from the legacy views are interpolated unescaped — escape anything player-supplied in new markup.
- `GCR.onlineTimePanel()` is injected into the existing Time screen; removing it must also remove the call in `js/game-time.js`.
