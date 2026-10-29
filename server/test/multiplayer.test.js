/* Multiplayer integration tests — two (or more) real accounts against the
   running API and database. Run inside the api container:
     docker compose -f docker-compose.base44.yml exec api node --test test/
*/

const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { promoteToAdmin } = require("../src/provisioning");

const BASE = process.env.API_BASE || "http://127.0.0.1:4000";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const PASSWORD = "TestPassw0rd!";

const state = {};

async function call(path, { method = "GET", body, cookie, noCsrf = false, headers = {} } = {}) {
  const h = { "content-type": "application/json", ...headers };
  if (!noCsrf) h["x-requested-with"] = "gcr";
  if (cookie) h.cookie = cookie;
  const res = await fetch(BASE + path, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) { json = text; }
  return { status: res.status, body: json, headers: res.headers, setCookie: res.headers.getSetCookie ? res.headers.getSetCookie() : [] };
}

function cookieOf(res) {
  const raw = res.setCookie[0] || "";
  return raw.split(";")[0];
}

async function outboxToken(email, kind) {
  const res = await call("/api/dev/outbox");
  assert.equal(res.status, 200, "dev outbox must be available in the sandbox");
  const item = res.body.items.find((m) => m.to_email === email && m.subject.toLowerCase().includes(kind));
  assert.ok(item, `expected a ${kind} message for ${email}`);
  const match = item.body.match(/#(?:verify|reset)\/([A-Za-z0-9_-]+)/);
  assert.ok(match, "message must contain a token link");
  return match[1];
}

async function registerPlayer(label, extra = {}) {
  const email = `t-${label}-${stamp}@example.com`;
  const displayName = extra.displayName || `Tester ${label} ${stamp.slice(-4)}`.slice(0, 20);
  const reg = await call("/api/auth/register", { method: "POST", body: { email, password: PASSWORD, displayName } });
  assert.equal(reg.status, 201, `register ${label}: ${JSON.stringify(reg.body)}`);
  const cookie = cookieOf(reg);
  const token = await outboxToken(email, "verify");
  const verified = await call("/api/auth/verify-email", { method: "POST", body: { token } });
  assert.equal(verified.status, 200);
  const me = await call("/api/auth/me", { cookie });
  assert.equal(me.status, 200);
  return {
    label,
    email,
    password: PASSWORD,
    displayName,
    cookie,
    accountId: me.body.account.id,
    characterId: me.body.character.id,
    money: me.body.character.money
  };
}

const key = (name) => `${name}-${stamp}`.slice(0, 90);

before(async () => {
  const reset = await call("/api/dev/reset-limits", { method: "POST", body: {} });
  assert.equal(reset.status, 200, "dev rate-limit reset must be available");
  const health = await call("/api/health");
  assert.equal(health.status, 200);
});

test("registers, verifies and rejects unverified writes", async () => {
  const email = `t-unverified-${stamp}@example.com`;
  const reg = await call("/api/auth/register", {
    method: "POST",
    body: { email, password: PASSWORD, displayName: `Unverified ${stamp.slice(-4)}` }
  });
  assert.equal(reg.status, 201);
  assert.equal(reg.body.account.emailVerified, false);
  assert.match(reg.setCookie[0], /HttpOnly/);
  assert.equal(reg.body.account.password_hash, undefined);

  const cookie = cookieOf(reg);
  const blocked = await call("/api/activities", {
    method: "POST",
    cookie,
    body: { kind: "delivery_shift", idempotencyKey: key("blocked") }
  });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error, "EMAIL_UNVERIFIED");

  const token = await outboxToken(email, "verify");
  const verified = await call("/api/auth/verify-email", { method: "POST", body: { token } });
  assert.equal(verified.status, 200);
  const reused = await call("/api/auth/verify-email", { method: "POST", body: { token } });
  assert.equal(reused.status, 400, "verification tokens are single-use");
});

test("rejects cross-site writes without the application header", async () => {
  const player = await registerPlayer("csrf");
  const res = await call("/api/activities", {
    method: "POST",
    cookie: player.cookie,
    noCsrf: true,
    body: { kind: "delivery_shift", idempotencyKey: key("csrf") }
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.error, "CSRF_CHECK_FAILED");
});

test("login, logout and session invalidation", async () => {
  const a = await registerPlayer("auth-a");
  state.a = a;

  const bad = await call("/api/auth/login", { method: "POST", body: { email: a.email, password: "WrongPass123" } });
  assert.equal(bad.status, 401);

  const login = await call("/api/auth/login", { method: "POST", body: { email: a.email, password: PASSWORD } });
  assert.equal(login.status, 200);
  assert.equal(login.body.character.id, a.characterId);

  const cookie = cookieOf(login);
  const me = await call("/api/auth/me", { cookie });
  assert.equal(me.status, 200);
  assert.equal(me.body.account.id, a.accountId);

  const out = await call("/api/auth/logout", { method: "POST", cookie });
  assert.equal(out.status, 204);
  const after = await call("/api/auth/me", { cookie });
  assert.equal(after.status, 401);
});

test("password recovery resets credentials and revokes sessions", async () => {
  const p = await registerPlayer("recovery");
  const forgot = await call("/api/auth/forgot-password", { method: "POST", body: { email: p.email } });
  assert.equal(forgot.status, 200);
  const unknown = await call("/api/auth/forgot-password", { method: "POST", body: { email: `nobody-${stamp}@example.com` } });
  assert.equal(unknown.status, 200, "no account enumeration");

  const token = await outboxToken(p.email, "reset");
  const newPassword = "BrandNewPass9";
  const reset = await call("/api/auth/reset-password", { method: "POST", body: { token, password: newPassword } });
  assert.equal(reset.status, 200);

  const oldSession = await call("/api/auth/me", { cookie: p.cookie });
  assert.equal(oldSession.status, 401, "reset signs out existing sessions");

  const login = await call("/api/auth/login", { method: "POST", body: { email: p.email, password: newPassword } });
  assert.equal(login.status, 200);
  const old = await call("/api/auth/login", { method: "POST", body: { email: p.email, password: PASSWORD } });
  assert.equal(old.status, 401);
});

test("characters are separate and private fields stay private", async () => {
  const b = await registerPlayer("auth-b");
  state.b = b;
  assert.notEqual(state.a.characterId, state.b.characterId);

  const me = await call("/api/auth/me", { cookie: state.a.cookie });
  assert.equal(me.body.account.email, state.a.email);
  assert.equal(me.body.character.id, state.a.characterId);
  assert.ok(me.body.character.money >= 0);

  const profile = await call(`/api/players/${state.b.characterId}`);
  assert.equal(profile.status, 200);
  assert.equal(profile.body.player.id, state.b.characterId);
  assert.equal(profile.body.player.money, null, "finances are hidden by default");
  assert.equal(profile.body.player.email, undefined);
  assert.equal(profile.body.account, undefined);

  const directory = await call(`/api/players?q=${encodeURIComponent(state.b.displayName)}`);
  assert.equal(directory.status, 200);
  assert.ok(directory.body.items.some((p) => p.id === state.b.characterId));
  assert.ok(directory.body.items.length <= 20);

  const unauth = await call("/api/auth/me");
  assert.equal(unauth.status, 401);

  const badId = await call("/api/players/not-a-uuid");
  assert.equal(badId.status, 400);

  const ladder = await call("/api/rankings?limit=5");
  assert.equal(ladder.status, 200);
  assert.ok(Array.isArray(ladder.body.items));
});

test("a player cannot modify another character or grant themselves fields", async () => {
  const before = await call("/api/auth/me", { cookie: state.b.cookie });
  const rename = await call("/api/me/character", {
    method: "PATCH",
    cookie: state.a.cookie,
    body: { displayName: `Renamed ${stamp.slice(-4)}` }
  });
  assert.equal(rename.status, 200);
  const afterB = await call("/api/auth/me", { cookie: state.b.cookie });
  assert.equal(afterB.body.character.displayName, before.body.character.displayName);

  const cheat = await call("/api/me/character", {
    method: "PATCH",
    cookie: state.a.cookie,
    body: { money: 999999999 }
  });
  assert.equal(cheat.status, 400);
  const afterCheat = await call("/api/auth/me", { cookie: state.a.cookie });
  assert.ok(afterCheat.body.character.money < 999999999);
});

test("transfers move money once, reject overdrafts and duplicates", async () => {
  const before = await call("/api/auth/me", { cookie: state.a.cookie });
  const amount = 1000;
  const transfer = await call("/api/transfers", {
    method: "POST",
    cookie: state.a.cookie,
    body: { toCharacterId: state.b.characterId, amount, idempotencyKey: key("transfer-1") }
  });
  assert.equal(transfer.status, 201, JSON.stringify(transfer.body));
  const after = await call("/api/auth/me", { cookie: state.a.cookie });
  const bAfter = await call("/api/auth/me", { cookie: state.b.cookie });
  const fee = transfer.body.fee;
  assert.equal(before.body.character.money - after.body.character.money, amount + fee);
  assert.equal(bAfter.body.character.money - state.b.money, amount);

  const duplicate = await call("/api/transfers", {
    method: "POST",
    cookie: state.a.cookie,
    body: { toCharacterId: state.b.characterId, amount, idempotencyKey: key("transfer-1") }
  });
  assert.equal(duplicate.status, 201);
  assert.equal(duplicate.body.duplicated, true);
  const afterDup = await call("/api/auth/me", { cookie: state.a.cookie });
  assert.equal(afterDup.body.character.money, after.body.character.money, "duplicate transfer must not charge twice");

  const overdraft = await call("/api/transfers", {
    method: "POST",
    cookie: state.a.cookie,
    body: { toCharacterId: state.b.characterId, amount: 1000000, idempotencyKey: key("overdraft") }
  });
  assert.equal(overdraft.status, 400);
  assert.equal(overdraft.body.error, "INSUFFICIENT_FUNDS");

  const self = await call("/api/transfers", {
    method: "POST",
    cookie: state.a.cookie,
    body: { toCharacterId: state.a.characterId, amount: 100, idempotencyKey: key("self") }
  });
  assert.equal(self.status, 400);

  const negative = await call("/api/transfers", {
    method: "POST",
    cookie: state.a.cookie,
    body: { toCharacterId: state.b.characterId, amount: -500, idempotencyKey: key("negative") }
  });
  assert.equal(negative.status, 400);

  const ledger = await call("/api/wallet", { cookie: state.a.cookie });
  assert.equal(ledger.status, 200);
  assert.ok(ledger.body.entries.some((e) => e.kind === "transfer_out"));
});

test("parallel duplicate transfer requests debit once", async () => {
  const amount = 200;
  const body = { toCharacterId: state.b.characterId, amount, idempotencyKey: key("parallel") };
  const before = await call("/api/auth/me", { cookie: state.a.cookie });
  const [r1, r2] = await Promise.all([
    call("/api/transfers", { method: "POST", cookie: state.a.cookie, body }),
    call("/api/transfers", { method: "POST", cookie: state.a.cookie, body })
  ]);
  assert.ok([200, 201].includes(r1.status));
  assert.ok([200, 201].includes(r2.status));
  const after = await call("/api/auth/me", { cookie: state.a.cookie });
  const fee = r1.body.fee;
  assert.equal(before.body.character.money - after.body.character.money, amount + fee);
});

test("shared world and server-authoritative travel", async () => {
  const world = await call("/api/world");
  assert.equal(world.status, 200);
  assert.equal(world.body.cities[0].slug, "port-harcourt");
  assert.equal(world.body.districts.length, 9);
  assert.ok(world.body.clock.serverNow);
  state.districts = world.body.districts;

  const me = await call("/api/auth/me", { cookie: state.a.cookie });
  const target = world.body.districts.find((d) => d.id !== me.body.character.districtId && !d.safe_zone);
  const travel = await call("/api/actions/travel", {
    method: "POST",
    cookie: state.a.cookie,
    body: { districtId: target.id }
  });
  assert.equal(travel.status, 200, JSON.stringify(travel.body));
  assert.equal(travel.body.district.id, target.id);
  assert.ok(travel.body.fare > 0);
  assert.ok(travel.body.character.money < me.body.character.money);
  assert.equal(travel.body.character.energy, me.body.character.energy - 3);

  const again = await call("/api/actions/travel", {
    method: "POST",
    cookie: state.a.cookie,
    body: { districtId: target.id }
  });
  assert.equal(again.status, 400);
  assert.equal(again.body.error, "ALREADY_THERE");

  const bad = await call("/api/actions/travel", { method: "POST", cookie: state.a.cookie, body: { districtId: "nope" } });
  assert.equal(bad.status, 400);

  const world2 = await call("/api/world");
  assert.deepEqual(world2.body.districts.map((d) => d.id), world.body.districts.map((d) => d.id));
});

test("activities use server time, cannot double-reward, and settle offline", async () => {
  const start = await call("/api/activities", {
    method: "POST",
    cookie: state.a.cookie,
    body: { kind: "delivery_shift", idempotencyKey: key("activity-1"), endsAt: "2000-01-01T00:00:00Z", startedAt: "2000-01-01T00:00:00Z" }
  });
  assert.equal(start.status, 201, JSON.stringify(start.body));
  const seconds = (new Date(start.body.activity.endsAt) - Date.now()) / 1000;
  assert.ok(seconds > 80 && seconds < 95, `server must ignore client timestamps (got ${seconds}s)`);

  const duplicate = await call("/api/activities", {
    method: "POST",
    cookie: state.a.cookie,
    body: { kind: "delivery_shift", idempotencyKey: key("activity-1") }
  });
  assert.equal(duplicate.body.duplicated, true);
  const list = await call("/api/activities", { cookie: state.a.cookie });
  assert.equal(list.body.activities.filter((x) => x.status === "pending").length, 1);

  const second = await call("/api/activities", {
    method: "POST",
    cookie: state.a.cookie,
    body: { kind: "delivery_shift", idempotencyKey: key("activity-2") }
  });
  assert.equal(second.status, 409);

  const early = await call(`/api/activities/${start.body.activity.id}/claim`, {
    method: "POST",
    cookie: state.a.cookie,
    body: {}
  });
  assert.equal(early.status, 409);
  assert.equal(early.body.error, "NOT_FINISHED");

  const before = await call("/api/auth/me", { cookie: state.a.cookie });

  // Controlled fixture: make the activity due without touching the world clock.
  await pool.query("UPDATE activities SET ends_at = now() - interval '1 second' WHERE id = $1", [start.body.activity.id]);
  const claim = await call(`/api/activities/${start.body.activity.id}/claim`, {
    method: "POST",
    cookie: state.a.cookie,
    body: {}
  });
  assert.equal(claim.status, 200);
  assert.equal(claim.body.activity.status, "completed");
  assert.equal(claim.body.character.money, before.body.character.money + 900);

  const again = await call(`/api/activities/${start.body.activity.id}/claim`, {
    method: "POST",
    cookie: state.a.cookie,
    body: {}
  });
  assert.equal(again.body.character.money, claim.body.character.money, "settlement must not pay twice");
});

test("admin authority is required and audited", async () => {
  const denied = await call("/api/admin/overview", { cookie: state.a.cookie });
  assert.equal(denied.status, 403);

  const admin = await registerPlayer("admin");
  await promoteToAdmin(admin.email);
  state.admin = admin;

  const overview = await call("/api/admin/overview", { cookie: admin.cookie });
  assert.equal(overview.status, 200);
  assert.ok(overview.body.characters >= 2);

  const before = await call("/api/auth/me", { cookie: state.a.cookie });
  const grant = await call(`/api/admin/players/${state.a.characterId}/grant`, {
    method: "POST",
    cookie: admin.cookie,
    body: { resource: "money", amount: 100000, reason: "test grant", idempotencyKey: key("grant-1") }
  });
  assert.equal(grant.status, 200, JSON.stringify(grant.body));
  assert.equal(grant.body.character.money, before.body.character.money + 100000);

  const duplicate = await call(`/api/admin/players/${state.a.characterId}/grant`, {
    method: "POST",
    cookie: admin.cookie,
    body: { resource: "money", amount: 100000, reason: "test grant", idempotencyKey: key("grant-1") }
  });
  assert.equal(duplicate.body.duplicated, true);

  const noReason = await call(`/api/admin/players/${state.a.characterId}/grant`, {
    method: "POST",
    cookie: admin.cookie,
    body: { resource: "money", amount: 500, reason: "x", idempotencyKey: key("grant-2") }
  });
  assert.equal(noReason.status, 400);

  const audit = await call("/api/admin/audit", { cookie: admin.cookie });
  assert.equal(audit.status, 200);
  assert.ok(audit.body.items.some((i) => i.action === "grant_money" && i.actor_email === admin.email));

  const selfModerate = await call(`/api/admin/players/${admin.characterId}/status`, {
    method: "POST",
    cookie: admin.cookie,
    body: { status: "banned", reason: "self test" }
  });
  assert.equal(selfModerate.status, 403);
});

test("business ownership, revenue and duplicate protection", async () => {
  const poor = await registerPlayer("poor");
  const attempt = await call("/api/businesses", {
    method: "POST",
    cookie: poor.cookie,
    body: { typeCode: "food_stand", name: "Poor Kitchen", idempotencyKey: key("poor-biz") }
  });
  assert.equal(attempt.status, 400);
  assert.equal(attempt.body.error, "INSUFFICIENT_FUNDS");

  const me = await call("/api/auth/me", { cookie: state.a.cookie });
  const create = await call("/api/businesses", {
    method: "POST",
    cookie: state.a.cookie,
    body: { typeCode: "food_stand", name: "Test Kitchen", idempotencyKey: key("biz-1") }
  });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  state.businessId = create.body.business.id;
  const paid = await call("/api/auth/me", { cookie: state.a.cookie });
  assert.equal(paid.body.character.money, me.body.character.money - 25000);

  const duplicate = await call("/api/businesses", {
    method: "POST",
    cookie: state.a.cookie,
    body: { typeCode: "food_stand", name: "Test Kitchen", idempotencyKey: key("biz-1") }
  });
  assert.equal(duplicate.body.duplicated, true);
  const mine = await call("/api/businesses/mine", { cookie: state.a.cookie });
  assert.equal(mine.body.items.length, 1);

  const parallelBody = { typeCode: "laundry", name: "Test Laundry", idempotencyKey: key("biz-parallel") };
  const [p1, p2] = await Promise.all([
    call("/api/businesses", { method: "POST", cookie: state.a.cookie, body: parallelBody }),
    call("/api/businesses", { method: "POST", cookie: state.a.cookie, body: parallelBody })
  ]);
  assert.ok([200, 201].includes(p1.status) && [200, 201].includes(p2.status));
  const mine2 = await call("/api/businesses/mine", { cookie: state.a.cookie });
  assert.equal(mine2.body.items.length, 2, "parallel duplicate purchase creates one business");

  const early = await call(`/api/businesses/${state.businessId}/collect`, {
    method: "POST",
    cookie: state.a.cookie,
    body: {}
  });
  assert.equal(early.status, 400);
  assert.equal(early.body.error, "NOTHING_TO_COLLECT");

  await pool.query("UPDATE businesses SET last_collected_at = now() - interval '6 hours' WHERE id = $1", [state.businessId]);
  const collect = await call(`/api/businesses/${state.businessId}/collect`, {
    method: "POST",
    cookie: state.a.cookie,
    body: {}
  });
  assert.equal(collect.status, 200, JSON.stringify(collect.body));
  assert.ok(collect.body.collected > 0);
  const collectAgain = await call(`/api/businesses/${state.businessId}/collect`, {
    method: "POST",
    cookie: state.a.cookie,
    body: {}
  });
  assert.equal(collectAgain.status, 400);

  const notOwner = await call(`/api/businesses/${state.businessId}/upgrade`, {
    method: "POST",
    cookie: state.b.cookie,
    body: { idempotencyKey: key("steal-upgrade") }
  });
  assert.equal(notOwner.status, 403);

  const upgrade = await call(`/api/businesses/${state.businessId}/upgrade`, {
    method: "POST",
    cookie: state.a.cookie,
    body: { idempotencyKey: key("upgrade-1") }
  });
  assert.equal(upgrade.status, 200);
  assert.equal(upgrade.body.business.level, 2);

  const publicList = await call("/api/businesses");
  assert.ok(publicList.body.items.some((b) => b.id === state.businessId && b.owner_id === state.a.characterId));
});

test("friendships and duels are server-resolved with limits", async () => {
  const request = await call("/api/friends/request", {
    method: "POST",
    cookie: state.a.cookie,
    body: { characterId: state.b.characterId }
  });
  assert.equal(request.status, 201);
  const dup = await call("/api/friends/request", {
    method: "POST",
    cookie: state.a.cookie,
    body: { characterId: state.b.characterId }
  });
  assert.equal(dup.status, 200);
  assert.equal(dup.body.duplicated, true);

  const mediate = await registerPlayer("mediate");
  const wrong = await call("/api/friends/respond", {
    method: "POST",
    cookie: mediate.cookie,
    body: { requestId: request.body.id, action: "accept" }
  });
  assert.equal(wrong.status, 403);

  const accept = await call("/api/friends/respond", {
    method: "POST",
    cookie: state.b.cookie,
    body: { requestId: request.body.id, action: "accept" }
  });
  assert.equal(accept.status, 200);
  const friends = await call("/api/friends", { cookie: state.a.cookie });
  assert.ok(friends.body.friends.some((f) => f.other.id === state.b.characterId));

  // Safe district first.
  const safeDuel = await call("/api/duels", {
    method: "POST",
    cookie: state.a.cookie,
    body: { opponentId: state.b.characterId, idempotencyKey: key("duel-safe") }
  });
  assert.equal([400, 403, 409].includes(safeDuel.status), true, JSON.stringify(safeDuel.body));

  // Move both players to the same non-safe district.
  const target = state.districts.find((d) => !d.safe_zone);
  for (const p of [state.a, state.b]) {
    const me = await call("/api/auth/me", { cookie: p.cookie });
    if (me.body.character.districtId !== target.id) {
      const t = await call("/api/actions/travel", { method: "POST", cookie: p.cookie, body: { districtId: target.id } });
      assert.equal(t.status, 200, JSON.stringify(t.body));
    }
  }

  const duel = await call("/api/duels", {
    method: "POST",
    cookie: state.a.cookie,
    body: { opponentId: state.b.characterId, idempotencyKey: key("duel-1") }
  });
  assert.equal(duel.status, 201, JSON.stringify(duel.body));
  assert.equal(typeof duel.body.duel.won, "boolean");

  const duplicateDuel = await call("/api/duels", {
    method: "POST",
    cookie: state.a.cookie,
    body: { opponentId: state.b.characterId, idempotencyKey: key("duel-1") }
  });
  assert.equal(duplicateDuel.body.duplicated, true);

  const cooldown = await call("/api/duels", {
    method: "POST",
    cookie: state.a.cookie,
    body: { opponentId: state.b.characterId, idempotencyKey: key("duel-2") }
  });
  assert.equal(cooldown.status, 409);
  assert.equal(cooldown.body.error, "DUEL_COOLDOWN");

  const history = await call("/api/duels", { cookie: state.a.cookie });
  assert.ok(history.body.history.length >= 1);
});

test("admin overrides are explicit, revocable and skip resource costs", async () => {
  const on = await call(`/api/admin/players/${state.a.characterId}/override`, {
    method: "POST",
    cookie: state.admin.cookie,
    body: { resource: "money", unlimited: true, reason: "override test" }
  });
  assert.equal(on.status, 200, JSON.stringify(on.body));
  assert.equal(on.body.override.unlimited, true);

  const before = await call("/api/auth/me", { cookie: state.a.cookie });
  const bought = await call("/api/businesses", {
    method: "POST",
    cookie: state.a.cookie,
    body: { typeCode: "barbershop", name: "Override Cuts", idempotencyKey: key("biz-override") }
  });
  assert.equal(bought.status, 201, JSON.stringify(bought.body));
  const after = await call("/api/auth/me", { cookie: state.a.cookie });
  assert.equal(after.body.character.money, before.body.character.money, "unlimited money skips deductions");

  const off = await call(`/api/admin/players/${state.a.characterId}/override`, {
    method: "POST",
    cookie: state.admin.cookie,
    body: { resource: "money", unlimited: false, reason: "override test end" }
  });
  assert.equal(off.status, 200);
  assert.equal(off.body.override, null);

  const topUp = await call(`/api/admin/players/${state.a.characterId}/grant`, {
    method: "POST",
    cookie: state.admin.cookie,
    body: { resource: "money", amount: 100000, reason: "normal purchase test", idempotencyKey: key("grant-2") }
  });
  assert.equal(topUp.status, 200);

  const before2 = await call("/api/auth/me", { cookie: state.a.cookie });
  const bought2 = await call("/api/businesses", {
    method: "POST",
    cookie: state.a.cookie,
    body: { typeCode: "laundry", name: "Normal Wash", idempotencyKey: key("biz-normal") }
  });
  assert.equal(bought2.status, 201);
  const after2 = await call("/api/auth/me", { cookie: state.a.cookie });
  assert.equal(after2.body.character.money, before2.body.character.money - 40000);

  const audit = await call("/api/admin/audit", { cookie: state.admin.cookie });
  assert.ok(audit.body.items.some((i) => i.action === "override_on_money"));
  assert.ok(audit.body.items.some((i) => i.action === "override_off_money"));
});

test("moderation revokes sessions and protects administrators", async () => {
  const victim = await registerPlayer("suspend");
  const suspended = await call(`/api/admin/players/${victim.characterId}/status`, {
    method: "POST",
    cookie: state.admin.cookie,
    body: { status: "suspended", reason: "test suspension" }
  });
  assert.equal(suspended.status, 200);
  const blocked = await call("/api/auth/me", { cookie: victim.cookie });
  assert.equal(blocked.status, 401, "suspension revokes the session");

  const reactivated = await call(`/api/admin/players/${victim.characterId}/status`, {
    method: "POST",
    cookie: state.admin.cookie,
    body: { status: "active", reason: "test release" }
  });
  assert.equal(reactivated.status, 200);

  const renamed = await call(`/api/admin/players/${victim.characterId}/rename`, {
    method: "POST",
    cookie: state.admin.cookie,
    body: { displayName: `Moderated ${stamp.slice(-4)}`, reason: "inappropriate display name" }
  });
  assert.equal(renamed.status, 200);

  const adminTarget = await call(`/api/admin/players/${state.admin.characterId}/status`, {
    method: "POST",
    cookie: state.admin.cookie,
    body: { status: "banned", reason: "should be blocked" }
  });
  assert.equal(adminTarget.status, 403);
});

test("local save migration is validated, capped and one-time", async () => {
  const c = await registerPlayer("migrate");
  const malformed = await call("/api/migrate/save", {
    method: "POST",
    cookie: c.cookie,
    body: { save: { nope: true } }
  });
  assert.equal(malformed.status, 400);

  const imported = await call("/api/migrate/save", {
    method: "POST",
    cookie: c.cookie,
    body: {
      save: {
        player: {
          name: `Imported ${stamp.slice(-4)}`,
          money: 999999999,
          age: 25,
          week: 1200,
          energy: 50,
          health: 90,
          happiness: 70,
          fame: 320,
          actingSkill: 14,
          iq: 30,
          charm: 44,
          education: "university",
          rep: 12,
          awards: ["Golden Star", "Best Newcomer"],
          wardrobe: { tops: ["x"] }
        }
      }
    }
  });
  assert.equal(imported.status, 200, JSON.stringify(imported.body));
  assert.equal(imported.body.character.money, 2000000);
  assert.ok(imported.body.warnings.length > 0);
  assert.equal(imported.body.importedAwards, 2);
  assert.equal(imported.body.character.age, 25);

  const profile = await call(`/api/players/${c.characterId}`);
  assert.equal(profile.body.achievements.length, 2);

  const second = await call("/api/migrate/save", {
    method: "POST",
    cookie: c.cookie,
    body: { save: { player: { money: 1 } } }
  });
  assert.equal(second.status, 409);
  assert.equal(second.body.error, "ALREADY_IMPORTED");

  const me = await call("/api/auth/me", { cookie: c.cookie });
  assert.equal(me.body.character.money, 2000000, "a second import cannot overwrite server progress");

  const status = await call("/api/migrate/status", { cookie: c.cookie });
  assert.equal(status.body.imported, true);
});

test("private fields are hidden from discovery and injection is inert", async () => {
  const p = await registerPlayer("privacy");
  const hide = await call("/api/me/character", {
    method: "PATCH",
    cookie: p.cookie,
    body: { discoverable: false }
  });
  assert.equal(hide.status, 200);
  const hidden = await call(`/api/players/${p.characterId}`);
  assert.equal(hidden.status, 404);
  const search = await call(`/api/players?q=${encodeURIComponent(p.displayName)}`);
  assert.ok(!search.body.items.some((x) => x.id === p.characterId));

  const injection = await call(`/api/players?q=${encodeURIComponent("%' OR 1=1--")}`);
  assert.equal(injection.status, 200);
  assert.equal(injection.body.items.length, 0);

  const show = await call("/api/me/character", {
    method: "PATCH",
    cookie: p.cookie,
    body: { discoverable: true, showFinances: true, showLocation: false }
  });
  assert.equal(show.status, 200);
  const profile = await call(`/api/players/${p.characterId}`);
  assert.equal(profile.body.player.district, null, "location hidden by preference");
  assert.equal(typeof profile.body.player.money, "number", "finances visible when enabled");
});

test("feed reflects shared-world activity", async () => {
  const feed = await call("/api/feed?limit=30");
  assert.equal(feed.status, 200);
  assert.ok(feed.body.items.length > 0);
  assert.ok(feed.body.items.some((i) => i.kind === "business_opened"));
});

test("invalid payloads are rejected without exposing internals", async () => {
  const badJson = await fetch(BASE + "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-requested-with": "gcr" },
    body: "{not json"
  });
  assert.equal(badJson.status, 400);
  const body = await badJson.json();
  assert.equal(body.error, "INVALID_JSON");
  assert.equal(body.stack, undefined);

  const weak = await call("/api/auth/register", {
    method: "POST",
    body: { email: `weak-${stamp}@example.com`, password: "short", displayName: "Weak Pass" }
  });
  assert.equal(weak.status, 400);
  assert.equal(weak.body.error, "WEAK_PASSWORD");

  const markupName = await call("/api/auth/register", {
    method: "POST",
    body: { email: `markup-${stamp}@example.com`, password: PASSWORD, displayName: "<script>x</script>" }
  });
  assert.equal(markupName.status, 400);
});

test("cleanup: remove test accounts created by this run", async () => {
  const { rowCount } = await pool.query("DELETE FROM accounts WHERE email LIKE $1", [`t-%-${stamp}@example.com`]);
  assert.ok(rowCount >= 5);
  await pool.end();
});
