/* ============================================================
   MULTIPLAYER CLIENT CORE
   One place that talks to /api, holds the signed-in session, and
   knows the shared world. Screens read it; nothing here trusts a
   local value for money, time or ownership.
   ============================================================ */

(function () {
  var GCR = (window.GCR = window.GCR || {});

  /* ---------------------------------------------------------- transport */
  GCR.api = async function (path, opts) {
    var options = opts || {};
    var method = options.method || "GET";
    var headers = Object.assign({ "x-requested-with": "gcr" }, options.headers || {});
    var body;
    if (options.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(options.body);
    }
    var res;
    try {
      res = await fetch("/api" + path, { method: method, headers: headers, credentials: "same-origin", body: body });
    } catch (e) {
      var netErr = new Error("Cannot reach the server. Check your connection and try again.");
      netErr.code = "NETWORK";
      netErr.status = 0;
      throw netErr;
    }
    var text = await res.text();
    var json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
    if (!res.ok) {
      var err = new Error((json && json.message) || "Request failed.");
      err.code = (json && json.error) || "ERROR";
      err.status = res.status;
      throw err;
    }
    return json;
  };

  /* ---------------------------------------------------------- session */
  GCR.session = { me: null, ready: false, error: null, loading: false };

  GCR.onlineViews = ["account", "players", "player", "businesses", "wallet", "admin", "online"];

  GCR.subscribe = function (fn) { (GCR.listeners = GCR.listeners || []).push(fn); };
  GCR.notify = function () {
    (GCR.listeners || []).forEach(function (fn) { try { fn(); } catch (e) {} });
  };

  GCR.refreshSession = async function () {
    if (GCR.session.loading) return GCR.session;
    GCR.session.loading = true;
    try {
      var me = await GCR.api("/auth/me");
      GCR.session.me = me;
      GCR.session.error = null;
    } catch (e) {
      if (e.status === 401) {
        GCR.session.me = null;
      } else {
        GCR.session.error = e.message;
      }
    } finally {
      GCR.session.loading = false;
      GCR.session.ready = true;
    }
    GCR.notify();
    return GCR.session;
  };

  GCR.signedIn = function () { return Boolean(GCR.session.me && GCR.session.me.account); };
  GCR.isAdmin = function () {
    return GCR.signedIn() && GCR.session.me.account.role === "admin";
  };
  GCR.account = function () { return GCR.signedIn() ? GCR.session.me.account : null; };
  GCR.character = function () { return GCR.signedIn() ? GCR.session.me.character : null; };

  /* ---------------------------------------------------------- helpers */
  GCR.key = function (prefix) {
    return (prefix || "req") + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  };
  GCR.money = function (n) { return "₦" + Number(n || 0).toLocaleString("en-NG"); };
  GCR.esc = function (s) {
    return String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  GCR.when = function (iso) {
    if (!iso) return "";
    var d = new Date(iso).getTime();
    if (!d) return "";
    var diff = Math.round((d - Date.now()) / 1000);
    var future = diff > 0;
    diff = Math.abs(diff);
    var label = diff < 60 ? diff + "s" : diff < 3600 ? Math.round(diff / 60) + "m" : Math.round(diff / 3600) + "h";
    return future ? "in " + label : label + " ago";
  };
  GCR.date = function (iso) {
    if (!iso) return "";
    try { return new Date(iso).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" }); } catch (e) { return ""; }
  };
  GCR.toast = function (msg, kind) {
    if (typeof toast === "function") toast(msg, kind || "success");
  };
  GCR.fail = function (err) {
    GCR.toast((err && err.message) || "Something went wrong.", "warn");
    /* An expired or revoked session: drop it so screens show the sign-in state. */
    if (err && err.status === 401) GCR.refreshSession();
  };

  /* ---------------------------------------------------------- shared world */
  GCR.world = { data: null, loading: false };

  GCR.loadWorld = async function () {
    if (GCR.world.data) return GCR.world.data;
    if (GCR.world.loading) return null;
    GCR.world.loading = true;
    try {
      GCR.world.data = await GCR.api("/world");
    } catch (e) {
      GCR.session.error = e.message;
    } finally {
      GCR.world.loading = false;
    }
    return GCR.world.data;
  };

  GCR.districtBySlug = function (slug) {
    var w = GCR.world.data;
    if (!w) return null;
    return w.districts.find(function (d) { return d.slug === slug; }) || null;
  };
  GCR.districtById = function (id) {
    var w = GCR.world.data;
    if (!w) return null;
    return w.districts.find(function (d) { return d.id === id; }) || null;
  };
  GCR.myDistrict = function () {
    var c = GCR.character();
    return c ? GCR.districtById(c.districtId) : null;
  };

  /* ---------------------------------------------------------- shared bits */
  GCR.characterHeader = function () {
    if (!GCR.signedIn()) return "";
    var c = GCR.character();
    if (!c) return "";
    var d = GCR.myDistrict();
    return (
      '<div class="card" style="margin-bottom:16px">' +
        '<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">' +
          '<div style="font-size:34px;line-height:1">' + GCR.esc(c.avatar) + "</div>" +
          '<div style="flex:1;min-width:140px">' +
            '<div style="font-weight:700;font-size:16px;color:var(--text)">' + GCR.esc(c.displayName) + "</div>" +
            '<div style="font-size:12px;color:var(--muted)">' +
              (d ? GCR.esc(d.name) : "Port Harcourt") + " · Age " + c.age + " · Fame " + Number(c.fame).toLocaleString() +
            "</div>" +
          "</div>" +
          '<div style="text-align:right">' +
            '<div style="font-size:12px;color:var(--muted)">Online balance</div>' +
            '<div style="font-weight:800;color:var(--text)">' + GCR.money(c.money) + "</div>" +
          "</div>" +
        "</div>" +
        '<div class="stat-grid" style="margin-top:12px;grid-template-columns:repeat(3,1fr)">' +
          '<div class="stat-tile"><div class="k">Energy</div><div class="v">' + c.energy + "</div></div>" +
          '<div class="stat-tile"><div class="k">Health</div><div class="v">' + c.health + "</div></div>" +
          '<div class="stat-tile"><div class="k">Skill</div><div class="v">' + c.actingSkill + "</div></div>" +
        "</div>" +
        (GCR.session.me.overrides && GCR.session.me.overrides.length
          ? '<div class="notice neutral" style="margin-top:12px">Developer resources enabled: ' +
            GCR.session.me.overrides.map(function (o) { return GCR.esc(o.resource); }).join(", ") +
            ". These are server-side flags and are audited.</div>"
          : "") +
      "</div>"
    );
  };

  GCR.requireSignIn = function (message) {
    return (
      '<div class="page-head"><div class="page-eyebrow">Online city</div>' +
        '<div class="page-title">Sign in required</div>' +
        '<div class="page-sub">' + GCR.esc(message || "This screen reads the shared world.") + "</div></div>" +
      '<div class="card"><div class="card-sub">Accounts keep your character, money, businesses and progress across devices.</div>' +
        '<div class="btn-row"><button class="btn" onclick="switchView(\'account\')">Sign in or create an account</button></div></div>'
    );
  };

  GCR.field = function (id, label, opts) {
    var o = opts || {};
    return '<div class="field"><label for="' + id + '">' + GCR.esc(label) + "</label>" +
      '<input id="' + id + '" type="' + (o.type || "text") + '" ' +
      (o.placeholder ? 'placeholder="' + GCR.esc(o.placeholder) + '" ' : "") +
      (o.value !== undefined ? 'value="' + GCR.esc(o.value) + '" ' : "") +
      (o.maxlength ? 'maxlength="' + o.maxlength + '" ' : "") +
      (o.autocomplete ? 'autocomplete="' + o.autocomplete + '" ' : "") + "/></div>";
  };

  GCR.applyCharacter = function (character) {
    if (!GCR.session.me || !character) return;
    GCR.session.me.character = character;
    GCR.notify();
  };

  /* A pending verification / reset link is handled in js/auth.js. */
  GCR.reload = function () { if (typeof render === "function") render(); };

  document.addEventListener("DOMContentLoaded", function () {
    GCR.refreshSession().then(function () {
      if (typeof render === "function" && window.state && GCR.onlineViews.indexOf(state.view) >= 0) render();
    });
  });
})();
