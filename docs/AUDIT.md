# Technical & Gameplay Audit — Port Harcourt Empire / TAMUNOIYANA

Date: 2026-10-29 · Branch audited: `base44/setup-ad0b8085` (HEAD `ca0e982`, 181 days old)
Scope: everything available in the repository. Nothing was changed in production.

---

## A. Current architecture

| Aspect | Reality |
|---|---|
| Application type | **Single-file browser application**: one `index.html` (4,650 lines, 251,110 bytes) + `README.md`. No `package.json`, no build step, no bundler, no server code, no tests, no CI, no `vercel.json`, no `.gitignore`. |
| Runtime | Static file. Vercel serves `index.html` as-is; the sandbox serves it with nginx for development. |
| View layer | String-template rendering: every screen is a function returning an HTML string, injected with `innerHTML`. 22 views dispatched by a `fns[state.view]` map (`render()`, line 2203). |
| Interaction | ~90 inline `onclick="fn()"` attributes; two global `document.addEventListener` delegates. |
| State | One mutable global `state` object (line 893), ~60 player fields + rival/feud/agency/family/luxury/clock sub-objects. |
| Persistence | `localStorage["tamunoiyana-save-v2"]`; `save()` = `JSON.stringify` into the key, `load()` = `Object.assign(state, parsed)`. |
| Auth / network | **None.** Zero `fetch`/XHR calls. No API integration of any kind. |
| Content | ~30 data tables (films, houses, partners, agencies, rival roster, phone/laptop/wardrobe catalogues, cities, university courses, auditions, people pool, crypto, dark-web listings). |
| External asset | Google Fonts stylesheet only (Cinzel + Inter). Renders acceptably without it. |
| History | The repo **once had** a TypeScript scaffold — `package.json`, `tsconfig.json`, `api.ts`, `index.ts`, `custom-fetch.ts`, `api.schemas.ts`, `hello.ts`, `src.zip`, `scripts.zip`, `actor-life.zip`, `post-merge.sh`. All were deleted; only `index.html` survived. The deleted `api.ts`/`hello.ts` indicate an abandoned Vercel serverless-API attempt, not a working backend. |

**Live vs repo:** the production site (251,110 bytes, `<title>TAMUNOIYANA — Garden City Stardom</title>`) is byte-for-byte the committed `index.html`. Deployment and repository are consistent; production runs exactly this code.

## B. Existing features and where they live

| Feature | Implementation | Verdict |
|---|---|---|
| Character creation (name, gender, look, birthplace) | `startGame()` 4548, `#intro` markup 683 | **Preserve** |
| Age & week progression | `advanceWeek()` 1021, `onAgeUp()` 3147 | **Redesign** (server clock) |
| Real-time clock (5 s = 1 game hour) | `realTimeTick()` 1167, `advanceGameHours()` 1183, `updateClock()` 1207 | **Redesign** (server-authoritative) |
| Education, exams, projects | `SCHOOL_STAGES` 980, `enroll()`, `takeExam()`, `doSchoolProject()`, `openQuiz()` | **Preserve**, validate server-side |
| Acting career, auditions, films, agencies | `FILMS`, `acceptFilm()`, `performScene()`, `finishJob()`, `AGENCIES`, `signWithAgency()`, `attemptAudition()` | **Preserve / Improve** |
| Money, spending, lifestyle | `fmtN()`, `rest/gym/therapy/eatOut/vacation` 2045 | **Preserve**, server ledger |
| Gambling: casino, sports betting, crypto | `playSlots/Roulette/Dice/Blackjack`, `placeBet()`, `buyCrypto()`, `advanceWeek` price drift | **Redesign** — server RNG + ledger required |
| Hacking / "dark web" mini-games | `renderHacking()`, `hackTarget()`, `renderDarkWeb()`, `HACK_TARGETS`, `DARKWEB_LISTINGS` | **Redesign / rename** — thematic moderation risk, needs server resolution |
| Health, happiness, energy, IQ, charm | `state.player`, decay in `advanceWeek` | **Preserve** |
| Fame, followers, posts, scandal | `socialMedia`, `postUpdate()`, `checkAwards()`, `SCANDAL_HEADLINES` | **Preserve → Integrate into multiplayer** |
| Paparazzi, press conferences, PR, bodyguard | `triggerPaparazzi()`, `openDodgeGame()`, `holdPressConference()`, `publicistDamage()`, `hireBodyguard()` | **Preserve** |
| Housing | `HOUSES` 844, `buyHouse()`, `moveTo()` | **Preserve → Integrate** (owned property) |
| Relationships, marriage, children | `PARTNERS`, `date()`, `proposeMarriage()`, `tryForBaby()`, `deliverBaby()`, `divorce()`, `CONVO_TOPICS` | **Preserve → Integrate** (player marriage) |
| Rivals & feuds | `RIVAL_ROSTER`, `rivalShade()`, `clapBack()`, `feudShowdown()`, `offerOliveBranch()` | **Redesign → PvP** |
| Events, inbox, news ticker | `randomEvent()`, `pushInbox()`, `generateRandomMessage()`, `buildNewsTrack()`, `dynamicHeadlines()` | **Improve** (real city feed) |
| Devices: phone & laptop OS shells | `viewPhone()` 3352, `viewLaptop()` 3834, app routers | **Preserve** as UI shell |
| Wardrobe & equipment | `WARDROBE_CATALOG`, `buyOutfit()`, `equipOutfit()` | **Preserve** (cosmetic, later PvP gear) |
| Travel | `CITIES` 3235, `travelTo()` 4297 | **Redesign → district map** |
| Church, blessings, wedding | `viewChurch()`, `donateChurch()`, `churchWedding()` | **Preserve → community/leadership path** |
| Meet people / dating pool | `PEOPLE_POOL`, `generatePerson()`, `metPass()`, `metFlirt()` | **Redesign** (real players) |
| "AURA" AI assistant | `generateAIReply()` 3762 — keyword matching, **not an AI model** | **Improve or relabel** |
| Awards, Hall of Fame, Wrapped | `AWARDS_LIST`, `checkAwards()`, `viewHOF()`, `viewHOFWrapped()` | **Preserve** |
| Admin cheats | `promptAdmin()`, `adminCheat()` — **dead code, see C1** | **Remove/Replace** with server admin |

Nothing substantial needs to be thrown away: the content, progression curves and life-sim systems are the project's real asset.

## C. Confirmed bugs

**C1 — Dead code after the document closes (lines 4618–4650).**
`promptAdmin()` and `adminCheat()` sit *after* `</html>` (line 4617), outside the `<script>` block, so they are never parsed as functions. The HTML parser turns them into text at the end of `<body>`. Nothing calls them (no `onclick` references), and `adminCheat()` writes `p.godMode`, a field that does not exist in `state`. Today this is harmless dead text — and conveniently it means **no client-side cheats are exposed** — but it is broken code that will confuse anyone reading the admin section, and it must never be revived client-side.

**C2 — Player name is interpolated into HTML unescaped.**
`startGame()` takes the free-text `#cc-name` and stores it verbatim. It is then interpolated into `innerHTML` in ~10 places without escaping, e.g. `.hero-name` (`${p.name}`, line 2250), the social profile handle (2517), the laptop prompt (3875), headlines (3085–3089) and the AI greeting (3721). The codebase already has an `escapeHtml()` helper and uses it for post text — the name path was simply missed. The input is capped at 22 characters, which bounds (but does not eliminate) what a payload can be: a 21-character `<svg/onload=…>` fits. Harmless while the save is local-only; **a stored XSS the moment a name is shared in multiplayer**, so it must be fixed before any social feature ships.
Verification: reproduced in the running app — a character named `<svg/onload=name=1>` (19 chars, no quotes) was accepted and the header rendered a live `<svg onload="name=1">` **element**, i.e. the name is parsed as HTML rather than shown as text. The handler itself did not fire in the preview browser for that vector, and an `<img onerror>`-style payload (which would fire) exceeds the 22-character input cap. So today the exploitable surface through the creation form is markup injection, not script execution; the sink becomes a full stored XSS the moment names arrive from a server that does not length-cap them. A client-side `maxlength` is not a security boundary.

**C3 — Duplicate `escapeHtml` with different behaviour (lines 2533 and 3742).**
Two declarations of the same name; the later one (which does **not** escape `"` or `'`) wins for the whole file due to hoisting. Currently only used for text nodes so no live breakage, but it is a trap for attribute contexts.

**C4 — Silent save failures.**
`save()` and `load()` wrap everything in `try/catch` and swallow the error. A full quota (localStorage ~5 MB), private-mode block, or corrupt JSON leaves the player with no save and no message — they keep playing and lose everything on refresh.

**C5 — Save schema has no versioning, only defensive patching.**
`load()` does a shallow `Object.assign`, so nested objects (e.g. `socialMedia`, `wardrobe`) are replaced wholesale. New nested fields require hand-written defaults in a growing list in `DOMContentLoaded` (4550–4575). One unguarded access remains: `state.player.socialMedia.tiktok` throws at boot if a save predates `socialMedia` entirely. `SAVE_KEY` has no schema version, so the next structural change cannot migrate old saves.

**C6 — Two clocks can double-advance the same period.**
The manual "Next Week" button (`advanceWeek`) and the real-time rollover (`advanceGameHours` → `advanceWeek` when `gameDay > 7`) are independent. Manual advances do not reset `gameDay`, so a player who presses "Next Week" repeatedly still has the clock fire a week shortly after. Pacing is inconsistent rather than broken, but it becomes untenable once the server owns time.

**C7 — Full re-render every in-game hour.**
`advanceGameHours()` calls `render()` once per tick that crosses an hour (i.e. every 5 real seconds), replacing `#content` wholesale. Any half-typed input outside the one re-bound compose textarea loses focus/state on the next tick.

## D. Mobile UX and accessibility

Verified at 375 px (close to the 428 px preview): the shell renders correctly with **no document-level horizontal overflow** on either the creation screen or the home screen. Remaining issues:

- **Zero `aria-*` attributes and zero `alt` text** in 4,650 lines. Interactive elements are `<div>`/`<button>` with emoji glyphs and no accessible names; modals have no roles or focus trapping.
- **`<meta viewport maximum-scale=1>`** blocks pinch-zoom — a direct WCAG failure for low-vision users.
- The top stats strip overflows into a horizontally-clipped row at narrow widths; the age/level pills are pushed out of the visible area.
- **20 bottom-nav buttons** in one bar: touch targets far below the 44 px minimum and no grouping. This is the single biggest mobile UX problem and it grows with every new feature.
- Dense inline styles (`style="…"` on hundreds of elements) make responsive tuning per-screen instead of global; there are no design tokens beyond the `:root` palette.
- Colour contrast of muted text (`--muted: #9aa0b4`) on glass panels has not been measured; the gold-on-dark accent is the safest and the pink/purple chips are the riskiest.
- Dark-only palette, while the product direction now calls for **light mode as default**.

## E. Save-system limitations (why it cannot become multiplayer)

1. **Client authority.** Every balance, stat and ownership record lives in a JSON blob the player controls; the console or a text editor edits it. There is no notion of a trusted value.
2. **No identity.** A save is anonymised to the browser profile — clearing site data destroys the account, and two devices cannot share a life.
3. **No cross-player existence.** Rivals, partners, fans and news are generated strings (`RIVAL_ROSTER`, `generatePerson`); nothing can be seen, traded with, or remembered.
4. **Clock forgery.** `realTime` derives game time from `Date.now()` stored *inside* the save; changing the system clock or the blob fast-forwards the economy. The offline cap (12 h) and the >6 h rewind are client-side heuristics.
5. **No audit trail, no moderation.** There is no way to detect or undo an economic exploit.
6. **Growth ceiling.** ~5 MB quota and a synchronous `JSON.stringify` of the entire world each action; a shared city cannot be serialised into a save file.

What should be kept: the state *shape* is a good spec for the server schema, and the flat "everything about one life" model imports cleanly once a `players` row and a child-record set exist.

## F–J

The target architecture, map model, migration strategy, deployment/security posture and phased plan are in [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## Verification record (what was actually run)

| Check | Result |
|---|---|
| `docker compose up` → nginx:alpine serving the repo files | **Passed** — container `healthy`, `GET /` 200, `GET /branding.js` 200, served bytes contain the bind-mounted source (not a prebuilt bundle). |
| Character creation → game shell | **Passed** — filled name, clicked "Be Born Into Greatness"; `#intro` hidden, `#app` visible, hero name rendered, stats bar populated, 20 nav buttons, live clock ticking, save written to storage. |
| Branding config (`branding.js`) | **Passed** — title, meta description, wordmark, logo letter and both taglines populated from the preset; `setBrandPreset('reign')` swapped identity live and reverted cleanly. |
| Console errors during the flow | **Passed** — none. |
| Name interpolation (AUDIT C2) | **Confirmed** — a 19-char `<svg/onload=name=1>` name produced a live `<svg>` element in the header; handler execution not observed for that vector, and firing payloads exceed the 22-char input cap. |
| Mobile layout at 375 px | **Passed for no document overflow**; density/zoom issues listed in D. |
| Live-vs-repo consistency | **Passed** — production HTML is byte-identical to the committed file. |
| Existing tests / lint / build | **Not applicable** — the repo defines none. |
| Multiplayer, auth, admin, PvP, server clock | **Not implemented by design** (this phase is audit + foundation). |

Test data was removed after the run; no pre-existing save was overwritten.
