# AGENTS.md — Port Harcourt Empire / Garden City: Reign

## What this repo is

A **single-file browser game**: `index.html` (~4,650 lines) is the entire application — markup, CSS and JS inline. There is no build step, no package manager, no test suite, no CI. `README.md` is one line. Deployment is static hosting on Vercel.

Three files matter at runtime:

- `index.html` — the game (everything).
- `branding.js` — display name, wordmark, tagline and metadata presets. Loaded by `<script src="branding.js">` immediately before the main inline script, so it runs after the markup it rewrites. Never move it into `<head>`.
- `docker/nginx.dev.conf` — dev-only static server (no cache) used by `docker-compose.base44.yml`.

## Run it

```bash
docker compose -f docker-compose.base44.yml up -d
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/   # expect 200
```

nginx serves `./index.html` and `./branding.js` through **explicit file bind-mounts**, so there is no rebuild loop. **If you add a new client asset (CSS/JS/image/data file), add it to the `volumes:` list in `docker-compose.base44.yml`** — otherwise it 404s in the preview even though it exists in the repo.

Health probe: `wget -q -O /dev/null http://127.0.0.1/` inside the container (busybox wget; the image has no curl).

## Verifying behaviour

There is no automated test suite. Verify in the preview:

1. Fresh load shows the character creation screen (`#intro`).
2. Fill `#cc-name`, click "Be Born Into Greatness" → `#intro` hides, `#app` appears, `.hero-name` shows the name, `#stats-bar` has money/energy/health pills, `#live-clock` ticks, a save appears in `localStorage["tamunoiyana-save-v2"]`.
3. Console must be clean; the page must not scroll horizontally at 375 px.
4. Branding: `document.title`, `meta[name=description]` and every `[data-brand]` element match `window.BRAND`; `setBrandPreset('reign')` swaps identity live.
5. Clean up: starting the game overwrites the save, so back up `localStorage` first and restore/remove it afterwards.

## Quirks worth knowing before editing

- **Dead code after `</html>`** (lines ~4618–4650): `promptAdmin()` / `adminCheat()` are outside the script block, so they are never defined. They reference an `#adminModal` element that does not exist and a `godMode` field that does not exist in `state`. Leave them dead; real admin controls must be server-side (see `docs/ARCHITECTURE.md` §6).
- **Two `escapeHtml` declarations** exist (both hoisted; the later, weaker one wins). Don't add a third — consolidate when refactoring.
- **Player name is interpolated into `innerHTML` unescaped** in many views (`.hero-name`, social handle, laptop prompt, headlines). Any new markup that renders `state.player.name` (or any player-supplied string) must escape it.
- **State is a single mutable global** (`state`, line ~893) persisted with `JSON.stringify` under `tamunoiyana-save-v2`. `load()` is a shallow `Object.assign`, so new nested fields need explicit defaults in the `DOMContentLoaded` bootstrap block.
- **Two time systems coexist**: manual `advanceWeek()` and a real-time tick (5 s = 1 game hour, 7 game days = 1 week) that calls `render()` on every in-game hour — full `#content` re-render, so input focus can be lost.
- **`generateAIReply()` is keyword matching**, not a language model. Don't describe it as AI in product copy without wiring a real provider.
- The game is dark-only today; light mode is a planned default (`data-theme` is already set by `branding.js`).

## Sandbox / preview specifics

- `BASE44_PREVIEW_MODE` is passed into the service for parity but is **not used**: a static nginx server performs no host or origin allowlisting, so no sandbox-only code path is needed here.
- No secrets are required. The game has no backend, no API keys, and no external data calls (only Google Fonts, which is cosmetic).
- `reload_preview` is required after edits: there is no hot-reload dev server — the page re-fetches the bind-mounted file on refresh only.

## Audit and plan

`docs/AUDIT.md` (architecture, feature inventory, confirmed defects, accessibility) and `docs/ARCHITECTURE.md` (multiplayer target, world clock, auth, admin, PvP, map, migration, phases).
