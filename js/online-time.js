/* ============================================================
   SERVER ACTIVITIES PANEL (used by the Time screen)
   Start an activity, leave, come back: the server settles it.
   The countdown here is display only — it never pays anything.
   ============================================================ */

GCR.data = GCR.data || {};
GCR.data.onlineTime = { data: null, loaded: false, loading: false, error: null, busy: false };

async function loadOnlineTime() {
  var s = GCR.data.onlineTime;
  if (s.loading) return;
  s.loading = true;
  try {
    s.data = await GCR.api("/activities");
    s.loaded = true;
    s.error = null;
    if (s.data && s.data.character) GCR.applyCharacter(s.data.character);
  } catch (e) {
    s.error = e.message;
  } finally {
    s.loading = false;
    GCR.reload();
  }
}

window.gcrStartActivity = async function (kind) {
  var s = GCR.data.onlineTime;
  if (s.busy) return;
  s.busy = true;
  try {
    var res = await GCR.api("/activities", { method: "POST", body: { kind: kind, idempotencyKey: GCR.key("activity") } });
    if (res.character) GCR.applyCharacter(res.character);
    s.loaded = false;
    GCR.toast(res.duplicated ? "That activity was already started." : "Started: " + res.activity.title, "success");
    if (GCR.session.me) await GCR.refreshSession();
    loadOnlineTime();
  } catch (e) {
    GCR.fail(e);
  } finally {
    s.busy = false;
  }
};

window.gcrClaimActivity = async function (id) {
  var s = GCR.data.onlineTime;
  if (s.busy) return;
  s.busy = true;
  try {
    var res = await GCR.api("/activities/" + id + "/claim", { method: "POST", body: {} });
    if (res.character) GCR.applyCharacter(res.character);
    s.loaded = false;
    GCR.toast(res.activity.status === "completed" ? "Activity settled." : "Not finished yet.", res.activity.status === "completed" ? "success" : "warn");
    if (GCR.session.me) await GCR.refreshSession();
    loadOnlineTime();
  } catch (e) {
    GCR.fail(e);
  } finally {
    s.busy = false;
  }
};

function remainingLabel(iso) {
  var ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "ready to settle";
  var s = Math.round(ms / 1000);
  return s < 60 ? s + "s left" : Math.round(s / 60) + "m left";
}

GCR.onlineTimePanel = function () {
  if (!GCR.signedIn || !GCR.signedIn()) return "";
  var s = GCR.data.onlineTime;
  if (!s.loaded && !s.loading) loadOnlineTime();

  var account = GCR.account();
  if (account && !account.emailVerified) {
    return '<div class="card" style="margin-bottom:16px">' +
      '<div class="card-title">Online activities</div>' +
      '<div class="notice warn">Verify your email to start server-side activities. Your sign-in works, but shared-economy actions are locked.</div>' +
      '<div class="btn-row"><button class="btn ghost" onclick="switchView(\'account\')">Open account</button></div></div>';
  }

  if (!s.data) {
    return '<div class="card" style="margin-bottom:16px"><div class="card-title">Online activities</div>' +
      '<div class="card-sub">' + (s.error ? GCR.esc(s.error) : "Loading server activities…") + "</div></div>";
  }

  var pending = s.data.activities.filter(function (a) { return a.status === "pending"; });
  var clock = s.data.serverNow ? new Date(s.data.serverNow) : new Date();

  var pendingHtml = pending.length
    ? pending.map(function (a) {
        return '<div class="activity-row">' +
          '<div class="activity-icon">⏱</div>' +
          '<div class="activity-body">' +
            '<div class="activity-title">' + GCR.esc(a.title) + "</div>" +
            '<div class="activity-meta">' + remainingLabel(a.endsAt) + " · pays " + GCR.money(a.rewardMoney) + "</div>" +
          "</div>" +
          '<button class="btn ghost sm" onclick="gcrClaimActivity(\'' + a.id + '\')">Settle</button>' +
        "</div>";
      }).join("")
    : '<div class="card-sub">Nothing running. Start something below — it continues while the game is closed.</div>';

  var catalog = s.data.catalog.map(function (c) {
    var bits = [];
    bits.push(Math.round(c.durationSeconds / 60) + "m");
    if (c.energyCost) bits.push(c.energyCost + " energy");
    if (c.moneyCost) bits.push(GCR.money(c.moneyCost));
    if (c.rewardMoney) bits.push("pays " + GCR.money(c.rewardMoney));
    return '<div class="activity-row">' +
      '<div class="activity-body">' +
        '<div class="activity-title">' + GCR.esc(c.title) + "</div>" +
        '<div class="activity-meta">' + bits.join(" · ") + "</div>" +
      "</div>" +
      '<button class="btn sm" onclick="gcrStartActivity(\'' + c.kind + '\')">Start</button>' +
    "</div>";
  }).join("");

  return '<div class="card" style="margin-bottom:16px">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">' +
        "<div>" +
          '<div class="card-title">Online activities</div>' +
          '<div class="card-sub">Server day ' + (GCR.session.me ? GCR.session.me.world.gameDay : "—") +
            " · " + clock.toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" }) +
            " server time. Rewards are paid by settlement, not by this countdown.</div>" +
        "</div>" +
        '<span class="chip ok">Server-authoritative</span>' +
      "</div>" +
      '<div style="margin-top:8px">' + pendingHtml + "</div>" +
      '<div class="page-eyebrow" style="margin-top:16px">Available</div>' + catalog +
    "</div>";
};
