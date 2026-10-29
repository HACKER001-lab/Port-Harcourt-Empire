# Target Architecture — Garden City: Reign (working title)

Companion to [`docs/AUDIT.md`](./AUDIT.md).

> **Status update.** The multiplayer foundation is now implemented. See
> [`docs/MULTIPLAYER.md`](./MULTIPLAYER.md) for what exists, how it is secured and
> what was tested. Two choices below were revised during implementation: the
> backend is a self-hosted Node + Postgres service (not Supabase Auth/Realtime),
> because authoritative economy rules, row locks and offline settlement need
> ordinary transactions and a persistent process; and realtime is deferred until
> a feature actually needs it — the shipped screens use authenticated requests.
> The remaining sections are kept as the design rationale and the roadmap.

---

## 0. What is already implemented (interface phase)

Shipped in the client, verified in the preview, **no server dependency**:

- Light design system as the default (`css/theme-light.css`), dark mode opt-in, semantic tokens, editorial typography.
- Five-tab navigation with a grouped destination sheet (replaces 20 ungrouped buttons).
- `GameClock` adapter (`js/game-time.js`) — currently `mode: "local"`; the server implementation replaces `now()`/`activities()` without touching the screens that consume them.
- Data-driven city map (`js/city.js`) — 9 fictionalised Port Harcourt districts, routes, venues, fare-based travel, and a placeholder entry proving a second city needs data only.
- Arena (`js/pvp.js`) — training, sparring, ratings, rankings and history on real state, resolved locally.
- Account screen with a **disabled** auth interface, and a deny-all administration console at `#admin`.

Deliberately **not** implemented, because doing so honestly requires the backend:

- No login/registration/recovery that pretends to work (no provider connected).
- No administrative authority in the client (no password gate, no cheats).
- No server-owned clock and no server-validated rewards.

## 1. Guiding constraints

- Keep the existing game **playable and recoverable** while the multiplayer client is built beside it.
- Stay on Vercel where practical; add only services with a free tier and no vendor lock-in for game data.
- No secrets in the client, ever. No client-authoritative money, items, ownership or combat outcomes.
- Smallest stack that can carry the design: one Postgres database, one auth provider, one realtime channel.

## 2. Recommended stack

| Layer | Choice | Why |
|---|---|---|
| Client | Migrate the single file into a Vite + React client (or Next.js App Router) | 4,650 lines of string templates cannot carry a map, realtime feed and PvP. Component boundaries are needed before feature work, not after. |
| Hosting | Vercel (existing) | Already the production host; static + serverless functions cover everything except long-lived sockets. |
| Database | Managed Postgres (Supabase or Neon free tier) | Relational fit for players/economy/ownership; transactions protect money; SQL RPC keeps rules server-side. |
| Auth | Supabase Auth (email + password, email verification, password recovery, refresh sessions) | Meets the mandatory auth list with no custom crypto. Sessions as httpOnly cookies. |
| Realtime | Supabase Realtime (Postgres changes + presence) | Only needed for the city feed, chat and live duels. Everything else is ordinary request/response. |
| Scheduled work | Vercel Cron (or pg_cron in Supabase) hitting a settle endpoint every minute | Offline progression and due events must not depend on a browser. |

**Rejected:** client-only (proven insufficient), Firebase (document model is a poor fit for transactional economy), a custom Node/socket server (extra infra to keep alive), any paid-only BaaS.

## 3. Server-authoritative world clock

The clock is data, not a client timer:

```
world_state: id, epoch_started_at, tick_seconds            -- one row, server-owned
player: last_settled_at, energy, health, happiness, ...
activity: id, player_id, kind, started_at, ends_at, payload, settled_at
```

- **Elapsed time** = `now() - last_settled_at`, computed **in the database**, never from a client timestamp.
- **Lazy settlement**: every read/action calls `settle_player(id)` first, which applies due weeks, job/education progress, energy/happiness drift, business income, loan interest and due events since `last_settled_at`, then stamps `last_settled_at = now()`.
- **Background settlement**: a cron job settles players with activity due, so offline rewards land without the player opening the app, and events fire on schedule.
- **Offline cap** is a server rule (e.g. max 14 days of drift) stored in config — not a client heuristic.
- **Idempotency**: settlement runs inside a transaction keyed by `(player_id, settled_through)` so a double request cannot double-pay; every paid reward gets a `ledger` row with a unique operation id.
- **Client clock is display-only.** The client renders a countdown from a server-provided `server_now` offset; it never advances state.

Applies to: jobs, education, business operations, travel, recovery (energy/hospital), pregnancy/family timers, scheduled events, rent/loan cycles.

## 4. Data model (first cut)

`players` (auth user ↔ character), `player_stats`, `ledger` (append-only money/XP movements), `inventory`, `property`, `business` + `business_orders`, `jobs`, `education`, `relationships` (directed pairs), `organizations` + `memberships`, `locations` (districts/venues, owner_id nullable), `travel_state`, `duels` + `duel_turns`, `rankings` (materialized), `events`, `feed_posts`, `admin_audit_log`, `admin_overrides` (resource, amount/flag, granted_by, expires_at).

Rule: **no table a player writes balance columns directly.** All mutations go through `security definer` SQL functions that validate ownership, cooldowns, price and limits, and write the ledger.

## 5. Auth requirements (mandatory)

Email + password signup, email verification (via SMTP/Resend credential — supplied through the platform secret store, never in the repo), password reset, persistent sessions with refresh, device sign-out, rate-limited login, and a `profiles.role` (`player` | `moderator` | `admin`) enforced by RLS and RPC checks — never by client-side conditionals.

## 6. Administrator dashboard

Server-rendered section behind the `admin` role:
search players, view account + character state, suspend/ban with reason, adjust supported resources (money, energy, items) **through the same audited RPCs as gameplay**, and toggle an explicit unlimited-resource override per player with an expiry and a mandatory reason. Every action appends to `admin_audit_log` (actor, target, action, before/after, timestamp). Overrides are a DB flag read by the economy functions; the client only learns about them as "your account has developer resources enabled".

This replaces the dead `promptAdmin()` client cheat (see AUDIT C1) — that must not be revived.

## 7. PvP combat

Recommended: **asynchronous turn-based duels**, not real-time action.
Server stores a `duel` with both stat snapshots, equipment ids, action list;
each turn is resolved server-side from stats + equipment + a server-stored seed, written in one transaction. Results feed rankings and reputation.

Why: works on serverless, is moddable from a dashboard, has no latency requirement, and fits the existing "feud showdown" concept rather than discarding it.

Anti-abuse: cooldowns, per-day duel caps, tier-based matchmaking (no farming low-level alts), no rewards between accounts sharing a device fingerprint on the same day, and loss streaks that reduce reward gain.

## 8. City map and location architecture

- **2D top-down map** (SVG/CSS layer over a stylised district illustration), not 3D. Touch-first: ≥44 px nodes, pinch-free panning, a district list as the accessible alternative to the map.
- Locations are rows, not hardcoded art: `locations(id, district, name, kind, x, y, owner_id, requirements, services)` so venues can become player-owned without a client release.
- Starting region is a **fictionalised Port Harcourt**: Old GRA / city centre, Diobu & Mile 1 residential, Rumuola/Rumuokoro, market district, UNIPORT/Choba university district, Trans-Amadi industrial, waterfront, entertainment strip. Explicitly fictionalised boundaries — not a claim of real geography.
- Expansion to other Nigerian cities, then international, is a `cities` table plus a district set; no schema change.
- District-level economy (rent, footfall, prices) is a later phase, but the `district` column must exist from day one.

## 9. Visual direction

Light mode as the shipped default, dark as an option. Requires converting the current `:root` palette into semantic tokens (`--surface`, `--ink`, `--accent`, `--positive`) with `data-theme` switching — the existing `branding.js` already sets `data-theme` from the brand preset, so the hook exists. The current dark identity becomes the `dark` theme rather than the only look.

## 10. Migration strategy (no destructive rewrite)

1. **Freeze parity**: keep `index.html` serving production untouched until the new client reaches feature parity for a vertical slice.
2. **Extract data**: move the ~30 content tables into `data/*.json`, shared by both clients.
3. **Import save**: an opt-in one-time importer reads `tamunoiyana-save-v2` in the browser, sends a server-validated snapshot (with caps), and creates the player's character. Money above a sanity ceiling is clamped and logged; the old save is retained locally.
4. **Dual-write period**: only the server writes after import; the legacy client becomes read-only/redirect.
5. **Cut over** behind the existing Vercel project once the vertical slice (create character → do a job → earn → travel → see another player's business) works end to end.

Nothing is deleted from the current game during this phase; `docs/AUDIT.md` §B is the inventory of what must survive.

## 11. Security checklist

- [ ] Remove inline `onclick` handlers so a nonce-based CSP becomes possible (currently impossible with ~90 inline handlers).
- [ ] Escape every interpolation of player-controlled text (AUDIT C2) and delete the duplicate `escapeHtml` (C3).
- [ ] Validate and length-cap every display name server-side; reject markup, not just escape it.
- [ ] Rate-limit every action RPC; enforce cooldowns in SQL, not in the client.
- [ ] httpOnly, SameSite cookies; CSRF protection on state-changing routes; no tokens in `localStorage`.
- [ ] Ledger-first money model — balances are a materialised view of the ledger, never a free-floating integer.
- [ ] Audit log for admin and economy events; alert on anomalous gains.
- [ ] Secrets only via the platform secret store (`/run/base44/app.env` locally); never committed, never shipped to the browser.
- [ ] Moderation policy for the gambling/hacking/"dark web" content; rename or gate it before public multiplayer.

## 12. Phased implementation plan

| Phase | Deliverable | Exit criteria |
|---|---|---|
| **0 — Foundation (this turn)** | Dev environment in Docker, branding config, audit. | App runs in preview from source; identity configurable. |
| **1 — Structural refactor** | Split `index.html` into tokens CSS, `data/` JSON, ES modules; add a test runner + CI; light-mode tokens; fix AUDIT C1–C5, D accessibility blockers. | Same gameplay, lint + tests in CI, light mode default. |
| **2 — Backend foundation** | Postgres schema, Supabase Auth, `settle_player`, save importer, profile + city feed (read-only). | Real accounts; two browsers see each other's characters; clock survives reload and clock tampering. |
| **3 — Server-authoritative life sim** | Jobs, education, travel, energy, money via RPC + ledger; cron settlement. | Client cannot mint money; offline progress settles correctly. |
| **4 — City & economy** | Touch map, districts, player-owned businesses and property, rent/footfall. | A player can open a business another player can visit and buy from. |
| **5 — Social & PvP** | Duel system, rankings, rivalries between real players, organizations. | Two accounts duel; result server-resolved and audited. |
| **6 — Operations** | Admin dashboard, RBAC, audit log, moderation tools, second city. | Admin actions auditable; no client-side cheats remain. |

Each phase ships behind the same Vercel project; production is only promoted with explicit authorization.
