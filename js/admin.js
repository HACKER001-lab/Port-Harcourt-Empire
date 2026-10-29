/* ============================================================
   ADMINISTRATION
   Only rendered for a verified administrator session. Every action
   is a server-validated, audited call — hiding a button is not the
   control, the role check is.
   ============================================================ */

window.VIEWS = window.VIEWS || {};
GCR.data = GCR.data || {};

GCR.data.admin = {
  overview: null,
  players: [],
  query: "",
  selectedId: null,
  detail: null,
  audit: [],
  loaded: false,
  loading: false,
  detailLoading: false,
  busy: false,
  error: null
};

async function loadAdmin() {
  var s = GCR.data.admin;
  if (s.loading) return;
  s.loading = true;
  try {
    var results = await Promise.all([
      GCR.api("/admin/overview"),
      GCR.api("/admin/players?q=" + encodeURIComponent(s.query) + "&limit=20"),
      GCR.api("/admin/audit?limit=20")
    ]);
    s.overview = results[0];
    s.players = results[1].items;
    s.audit = results[2].items;
    s.loaded = true;
    s.error = null;
  } catch (e) {
    s.error = e.message;
  } finally {
    s.loading = false;
    GCR.reload();
  }
}

async function loadAdminDetail(id) {
  var s = GCR.data.admin;
  s.detailLoading = true;
  s.selectedId = id;
  try {
    s.detail = await GCR.api("/admin/players/" + id);
  } catch (e) {
    GCR.fail(e);
  } finally {
    s.detailLoading = false;
    GCR.reload();
  }
}

function adminReason() {
  var el = document.getElementById("gcr-admin-reason");
  var reason = el ? el.value.trim() : "";
  if (reason.length < 3) {
    GCR.toast("A reason (3+ characters) is required and is recorded in the audit log.", "warn");
    return null;
  }
  return reason;
}

window.gcrAdminSearch = function () {
  var input = document.getElementById("gcr-admin-search");
  var s = GCR.data.admin;
  s.query = (input && input.value ? input.value : "").trim();
  s.loaded = false;
  loadAdmin();
};

window.gcrAdminSelect = function (id) {
  loadAdminDetail(id);
};

window.gcrAdminGrant = async function (resource) {
  var s = GCR.data.admin;
  if (!s.selectedId || s.busy) return;
  var reason = adminReason();
  if (!reason) return;
  var amountEl = document.getElementById("gcr-admin-amount");
  var amount = Math.trunc(Number(amountEl ? amountEl.value : 0));
  if (!amount) return GCR.toast("Enter a non-zero amount.", "warn");
  s.busy = true;
  try {
    await GCR.api("/admin/players/" + s.selectedId + "/grant", {
      method: "POST",
      body: { resource: resource, amount: amount, reason: reason, idempotencyKey: GCR.key("grant") }
    });
    GCR.toast(resource + " adjusted.", "success");
    s.loaded = false;
    loadAdmin();
    loadAdminDetail(s.selectedId);
  } catch (e) {
    GCR.fail(e);
  } finally {
    s.busy = false;
  }
};

window.gcrAdminOverride = async function (on) {
  var s = GCR.data.admin;
  if (!s.selectedId || s.busy) return;
  var reason = adminReason();
  if (!reason) return;
  var resourceEl = document.getElementById("gcr-admin-resource");
  var resource = resourceEl ? resourceEl.value : "money";
  var hoursEl = document.getElementById("gcr-admin-hours");
  var hours = Math.trunc(Number(hoursEl ? hoursEl.value : 0));
  var body = { resource: resource, unlimited: Boolean(on), reason: reason };
  if (on && hours > 0) body.expiresAt = new Date(Date.now() + hours * 3600 * 1000).toISOString();

  s.busy = true;
  try {
    await GCR.api("/admin/players/" + s.selectedId + "/override", { method: "POST", body: body });
    GCR.toast(on ? "Override enabled." : "Override revoked.", "success");
    s.loaded = false;
    loadAdmin();
    loadAdminDetail(s.selectedId);
  } catch (e) {
    GCR.fail(e);
  } finally {
    s.busy = false;
  }
};

window.gcrAdminStatus = async function (status) {
  var s = GCR.data.admin;
  if (!s.selectedId || s.busy) return;
  var reason = adminReason();
  if (!reason) return;
  if (!confirm("Set this account to " + status + "?")) return;
  s.busy = true;
  try {
    await GCR.api("/admin/players/" + s.selectedId + "/status", {
      method: "POST",
      body: { status: status, reason: reason }
    });
    GCR.toast("Account set to " + status + ".", "success");
    s.loaded = false;
    loadAdmin();
    loadAdminDetail(s.selectedId);
  } catch (e) {
    GCR.fail(e);
  } finally {
    s.busy = false;
  }
};

window.gcrAdminRename = async function () {
  var s = GCR.data.admin;
  if (!s.selectedId || s.busy) return;
  var reason = adminReason();
  if (!reason) return;
  var nameEl = document.getElementById("gcr-admin-name");
  var name = nameEl ? nameEl.value.trim() : "";
  if (name.length < 3) return GCR.toast("Enter a display name of 3+ characters.", "warn");
  s.busy = true;
  try {
    await GCR.api("/admin/players/" + s.selectedId + "/rename", {
      method: "POST",
      body: { displayName: name, reason: reason }
    });
    GCR.toast("Display name updated.", "success");
    s.loaded = false;
    loadAdmin();
    loadAdminDetail(s.selectedId);
  } catch (e) {
    GCR.fail(e);
  } finally {
    s.busy = false;
  }
};

function adminPlayerRow(p) {
  var active = GCR.data.admin.selectedId === p.id;
  return '<div class="venue-row" style="cursor:pointer' + (active ? ";background:rgba(20,107,87,.06)" : "") +
    '" onclick="gcrAdminSelect(\'' + p.id + '\')">' +
    '<div class="venue-icon">' + GCR.esc(p.avatar) + "</div>" +
    '<div style="flex:1;min-width:0">' +
      '<div class="venue-name">' + GCR.esc(p.displayName) + " · " + GCR.esc(p.email) + "</div>" +
      '<div class="venue-kind">' + GCR.esc(p.role) + " · " + GCR.esc(p.status) + " · " + GCR.money(p.money) + "</div>" +
    "</div>" +
    '<span class="chip ' + (p.status === "active" ? "ok" : "bad") + '">' + GCR.esc(p.status) + "</span>" +
  "</div>";
}

function adminDetail(d) {
  if (!d) return '<div class="card-sub">Select a player to inspect their account.</div>';
  var c = d.character;
  return '<div class="card" style="margin-bottom:16px">' +
      '<div class="card-title">' + GCR.esc(c.avatar) + " " + GCR.esc(c.displayName) + "</div>" +
      '<div class="card-sub">' + GCR.esc(d.account.email) + " · " + GCR.esc(d.account.role) + " · " + GCR.esc(d.account.status) + "</div>" +
      '<div class="stat-grid" style="grid-template-columns:repeat(2,1fr);margin-bottom:12px">' +
        '<div class="stat-tile"><div class="k">Money</div><div class="v">' + GCR.money(c.money) + "</div></div>" +
        '<div class="stat-tile"><div class="k">Energy</div><div class="v">' + c.energy + "</div></div>" +
        '<div class="stat-tile"><div class="k">Health</div><div class="v">' + c.health + "</div></div>" +
        '<div class="stat-tile"><div class="k">Fame</div><div class="v">' + c.fame + "</div></div>" +
      "</div>" +
      (d.overrides.length
        ? '<div class="notice neutral" style="margin-bottom:12px">Unlimited: ' +
          d.overrides.map(function (o) {
            return GCR.esc(o.resource) + (o.expires_at ? " (until " + GCR.date(o.expires_at) + ")" : "");
          }).join(", ") + "</div>"
        : "") +
      '<div class="field"><label for="gcr-admin-reason">Reason (recorded)</label>' +
        '<input id="gcr-admin-reason" maxlength="200" placeholder="Why is this change being made?" /></div>' +
      '<div class="field"><label for="gcr-admin-amount">Amount (money / energy / health)</label>' +
        '<input id="gcr-admin-amount" type="number" placeholder="e.g. 50000" /></div>' +
      '<div class="btn-row">' +
        '<button class="btn sm" onclick="gcrAdminGrant(\'money\')">Adjust money</button>' +
        '<button class="btn ghost sm" onclick="gcrAdminGrant(\'energy\')">Adjust energy</button>' +
        '<button class="btn ghost sm" onclick="gcrAdminGrant(\'health\')">Adjust health</button>' +
      "</div>" +
      '<div class="page-eyebrow" style="margin-top:16px">Unlimited overrides</div>' +
      '<div class="field"><label for="gcr-admin-resource">Resource</label>' +
        '<select id="gcr-admin-resource"><option value="money">Money</option><option value="energy">Energy</option><option value="health">Health</option></select></div>' +
      '<div class="field"><label for="gcr-admin-hours">Expires in hours (blank = permanent)</label>' +
        '<input id="gcr-admin-hours" type="number" placeholder="24" /></div>' +
      '<div class="btn-row">' +
        '<button class="btn sm" onclick="gcrAdminOverride(true)">Enable override</button>' +
        '<button class="btn ghost sm" onclick="gcrAdminOverride(false)">Revoke override</button>' +
      "</div>" +
      '<div class="page-eyebrow" style="margin-top:16px">Moderation</div>' +
      '<div class="field"><label for="gcr-admin-name">Display name</label>' +
        '<input id="gcr-admin-name" maxlength="20" value="' + GCR.esc(c.displayName) + '" /></div>' +
      '<div class="btn-row">' +
        '<button class="btn ghost sm" onclick="gcrAdminRename()">Rename</button>' +
        '<button class="btn ghost sm" onclick="gcrAdminStatus(\'suspended\')">Suspend</button>' +
        '<button class="btn ghost sm" onclick="gcrAdminStatus(\'banned\')">Ban</button>' +
        '<button class="btn ghost sm" onclick="gcrAdminStatus(\'active\')">Restore</button>' +
      "</div>" +
    "</div>" +
    '<div class="card" style="margin-bottom:16px"><div class="card-title">Recent ledger</div>' +
      (d.ledger.length
        ? d.ledger.map(function (l) {
            return '<div class="activity-row"><div style="flex:1">' +
              '<div class="activity-title">' + GCR.esc(l.kind) + "</div>" +
              '<div class="activity-meta">' + GCR.date(l.createdAt) + " · balance " + GCR.money(l.balanceAfter) + "</div></div>" +
              '<span class="chip">' + (l.delta > 0 ? "+" : "") + GCR.money(l.delta) + "</span></div>";
          }).join("")
        : '<div class="card-sub">No entries.</div>') +
    "</div>" +
    '<div class="card"><div class="card-title">Audit for this account</div>' +
      (d.auditLog.length
        ? d.auditLog.map(function (a) {
            return '<div class="activity-row"><div style="flex:1">' +
              '<div class="activity-title">' + GCR.esc(a.action) + "</div>" +
              '<div class="activity-meta">' + GCR.esc(a.reason) + " · " + GCR.date(a.created_at) + "</div></div></div>";
          }).join("")
        : '<div class="card-sub">No administrative actions recorded.</div>') +
    "</div>";
}

function viewAdmin() {
  if (!GCR.session.ready) return '<div class="page-head"><div class="page-title">Administration</div><div class="page-sub">Connecting…</div></div>';
  if (!GCR.signedIn() || !GCR.isAdmin()) {
    return '<div class="page-head"><div class="page-eyebrow">Restricted</div>' +
      '<div class="page-title">Administration</div>' +
      '<div class="page-sub">This console requires an administrator role checked by the server.</div></div>' +
      '<div class="card"><div class="notice warn">Access denied. Ordinary accounts cannot read or change other players\' records. ' +
      'If you run this deployment, promote an existing account with <code>node scripts/provision-admin.js</code>.</div>' +
      '<div class="btn-row"><button class="btn ghost" onclick="switchView(\'home\')">Back to the game</button></div></div>';
  }

  var s = GCR.data.admin;
  if (!s.loaded && !s.loading) loadAdmin();

  var overview = s.overview
    ? '<div class="stat-grid" style="margin-bottom:16px">' +
        '<div class="stat-tile"><div class="k">Accounts</div><div class="v">' + s.overview.accounts + "</div></div>" +
        '<div class="stat-tile"><div class="k">Characters</div><div class="v">' + s.overview.characters + "</div></div>" +
        '<div class="stat-tile"><div class="k">Businesses</div><div class="v">' + s.overview.openBusinesses + "</div></div>" +
        '<div class="stat-tile"><div class="k">Duels 24h</div><div class="v">' + s.overview.duels24h + "</div></div>" +
        '<div class="stat-tile"><div class="k">Transfers 24h</div><div class="v">' + s.overview.transfers24h + "</div></div>" +
        '<div class="stat-tile"><div class="k">Money supply</div><div class="v">' + GCR.money(s.overview.totalMoney) + "</div></div>" +
      "</div>"
    : "";

  var players = s.players.length
    ? s.players.map(adminPlayerRow).join("")
    : '<div class="card-sub">No players match.</div>';

  var audit = s.audit.length
    ? s.audit.map(function (a) {
        return '<div class="activity-row"><div style="flex:1">' +
          '<div class="activity-title">' + GCR.esc(a.action) + " · " + GCR.esc(a.actor_email || "system") + "</div>" +
          '<div class="activity-meta">' + GCR.esc(a.target_email || "—") + " · " + GCR.esc(a.reason) + " · " + GCR.date(a.created_at) + "</div></div></div>";
      }).join("")
    : '<div class="card-sub">No audit entries yet.</div>';

  return '<div class="page-head">' +
      '<div class="page-eyebrow">Operations</div>' +
      '<div class="page-title">Administration</div>' +
      '<div class="page-sub">Server-verified administrator session. Every change below is audited with your account, the target, the reason and before/after values.</div>' +
    "</div>" +
    (s.error ? '<div class="notice warn" style="margin-bottom:16px">' + GCR.esc(s.error) + "</div>" : "") +
    overview +
    '<div class="card" style="margin-bottom:16px">' +
      '<div class="card-title">Players</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">' +
        '<input id="gcr-admin-search" class="line-input" style="flex:1;min-width:160px" placeholder="Search name or email" value="' + GCR.esc(s.query) + '" />' +
        '<button class="btn" onclick="gcrAdminSearch()">Search</button>' +
        '<button class="btn ghost" onclick="GCR.data.admin.loaded=false;loadAdmin()">Refresh</button>' +
      "</div>" +
      players +
    "</div>" +
    (s.detailLoading ? '<div class="card"><div class="card-sub">Loading account…</div></div>' : adminDetail(s.detail)) +
    '<div class="card"><div class="card-title">Audit log</div>' + audit + "</div>";
}

window.VIEWS.admin = viewAdmin;
