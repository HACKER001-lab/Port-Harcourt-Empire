# AGENTS.md — Port Harcourt Empire / Garden City: Reign

## What this repo is

A **static browser game**. `index.html` (~4,660 lines) still holds the original markup, CSS and game logic; a new interface layer sits on top of it in `css/` and `js/`. No build step, no package manager, no test suite, no CI. Deployment is static hosting on Vercel.

Runtime files:

| File | Role |
|---|---|
| `index.html` | The original game: state, save/load, all life-sim systems and views. |
| `css/theme-light.css` | **Light design system (default).** Loaded after the inline `<style>`, so it wins by cascade. Dark mode is an opt-in block at the end of this file. |
| `js/ui.js` | Primary navigation (`PRIMARY_NAV`), the grouped "More" sheet (`NAV_GROUPS`), theme toggle. |
| `js/game-time.js` | `GameClock` adapter + Time & Activities screen. |
| `js/city.js` | Data-driven city/district map + district travel. |
| `js/pvp.js` | Arena: training, sparring, rankings, history. |
| `js/account.js` | Account screen (auth interface) and the locked administration console. |
| `branding.js` | Display name, wordmark, tagline, metadata presets. |

## Run it

```bash
docker compose -f docker-compose.base44.yml up -d
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/   # expect 200
```

nginx serves explicit bind-mounts of `index.html`, `branding.js`, `css/` and `js/`. **A new top-level asset directory must be added to the `volumes:` list in `docker-compose.base44.yml`**, or it 404s in the preview despite existing in the repo.

Health probe: `wget -q -O /dev/null http://127.0.0.1/` inside the container.

## How the new layer plugs in

- `render()` (in `index.html`) consults `window.VIEWS[state.view]` first, then the legacy `fns` map. New screens therefore register with `window.VIEWS.<id> = viewFn` and need no edits to the original view dispatch.
- The bottom bar renders `PRIMARY_NAV` (Home, City, Time, Arena, More). Every other destination lives in `NAV_GROUPS` and opens through `openMoreMenu()`. Adding a screen = add it to the right `NAV_GROUPS` entry and register the view.
- Theme: light is the default at `:root`; `html[data-theme="dark"]` switches. `js/ui.js` persists the choice in `localStorage["gcr-theme"]`. Dark-mode overrides for the light surface rules live in the **last block of `theme-light.css`** — keep them last, both sides use `!important`.
- Style helpers available to new screens: `.page-head/.page-eyebrow/.page-title/.page-sub`, `.card`, `.stat-grid/.stat-tile`, `.chip` (`ok|warn|bad|info`), `.notice` (`warn|neutral`), `.activity-row`, `.progress`, `.rank-row`, `.venue-row`, `.map-*`, `.locked-field`, `.admin-row`, `.theme-toggle`.

## Honest boundaries (do not fake these)

- `GameClock.mode` is `"local"`. Time comes from the save, not a server. Rewards are never paid from a countdown in the new layer; it only reports existing settled state.
- The Account screen shows a **disabled** auth interface: there is no authentication provider yet, so there are no working login forms and no fake success states.
- The administration console is reachable at `#admin` / `switchView('admin')` and is **deny-all**: no local password, no public registration, every control locked. Real authority must be a server-side role check.
- Arena bouts resolve locally from stats (single-player). Server-side resolution and auditing come with the backend.

## Verifying behaviour

No automated tests. In the preview:

1. Light mode is default: `.hero` and `.live-clock` compute to `rgb(255,255,255)`; body is `rgb(244,246,248)`.
2. Toggle dark mode: `.hero` and `.live-clock` become `rgb(23,32,38)` with light ink, and every surface must be legible.
3. Five nav tabs; "More" opens a grouped sheet with 22 destinations.
4. City: 9 districts, tapping one shows venues; "Travel to …" deducts a fare and energy and changes `state.player.district`.
5. Time: clock tiles + "In progress" list; the local-clock warning must be visible.
6. Arena: training spends money/energy and raises the stat; sparring writes a win/loss and history entry (opponents come from `ensureRivals()`, called lazily by `sparringOpponents()`).
7. Account/Admin: notices present, auth buttons disabled, 7 locked admin rows.
8. No console errors; no horizontal overflow at 375 px on any screen.
9. Starting the game overwrites the save — back up `localStorage["tamunoiyana-save-v2"]` first and restore it after.

## Quirks worth knowing before editing

- **Dead code after `</html>`**: `promptAdmin()` / `adminCheat()` are outside the script block (never defined, never called). Leave them dead.
- **Two `escapeHtml` declarations** (the later, weaker one wins). `js/game-time.js` defines its own `escHtml` — use that in new code.
- **Player name is interpolated into `innerHTML` unescaped** in the original views. Escape anything player-supplied in new markup.
- **`state` is a single mutable global** persisted with `JSON.stringify` under `tamunoiyana-save-v2`; `load()` is a shallow `Object.assign`, so new nested fields need explicit defaults.
- **Two time systems coexist**: manual `advanceWeek()` and the real-time tick, which re-renders on every in-game hour.
- `generateAIReply()` is keyword matching, not a model. Don't call it AI in product copy.
- No secrets are required; nothing in the client calls an external API.

## Sandbox / preview specifics

- `BASE44_PREVIEW_MODE` is passed to the service but unused: static nginx has no host/origin allowlisting, so no sandbox-only code path exists.
- There is no hot-reload server; refresh re-fetches the bind-mounted files. Call `reload_preview` after edits.

## Audit and plan

`docs/AUDIT.md` (architecture audit, feature inventory, confirmed defects, accessibility) and `docs/ARCHITECTURE.md` (multiplayer target, world clock, auth, admin, PvP, map, migration, phases).
