/* ============================================================
   BUSINESSES — owned venues in the shared city
   Costs, revenue and upgrades are decided by the server.
   ============================================================ */

window.VIEWS = window.VIEWS || {};
GCR.data = GCR.data || {};

GCR.data.mine = { items: [], loaded: false, loading: false, error: null };
GCR.data.market = { items: [], loaded: false, loading: false, error: null };
GCR.data.bizBusy = false;

async function loadMine() {
  var s = GCR.data.mine;
  if (s.loading) return;
  s.loading = true;
  try {
    var res = await GCR.api("/businesses/mine");
    s.items = res.items;
    s.loaded = true;
    s.error = null;
  } catch (e) {
    s.error = e.message;
  } finally {
    s.loading = false;
    GCR.reload();
  }
}

async function loadMarket() {
  var s = GCR.data.market;
  if (s.loading) return;
  s.loading = true;
  try {
    var res = await GCR.api("/businesses?limit=20");
    s.items = res.items;
    s.loaded = true;
    s.error = null;
  } catch (e) {
    s.error = e.message;
  } finally {
    s.loading = false;
    GCR.reload();
  }
}

window.gcrOpenBusiness = async function () {
  if (GCR.data.bizBusy) return;
  var typeSelect = document.getElementById("gcr-biz-type");
  var nameInput = document.getElementById("gcr-biz-name");
  var typeCode = typeSelect ? typeSelect.value : "";
  var name = nameInput ? nameInput.value.trim() : "";
  if (!typeCode) return GCR.toast("Choose a business type.", "warn");
  if (name.length < 3) return GCR.toast("Give the business a name of 3+ characters.", "warn");
  GCR.data.bizBusy = true;
  try {
    var res = await GCR.api("/businesses", {
      method: "POST",
      body: { typeCode: typeCode, name: name, idempotencyKey: GCR.key("biz") }
    });
    await GCR.refreshSession();
    GCR.data.mine.loaded = false;
    GCR.data.market.loaded = false;
    GCR.data.bizDraft = { name: "", type: null };
    GCR.toast("Business opened.", "success");
    GCR.reload();
  } catch (e) {
    GCR.fail(e);
  } finally {
    GCR.data.bizBusy = false;
  }
};

window.gcrCollectBusiness = async function (id) {
  if (GCR.data.bizBusy) return;
  GCR.data.bizBusy = true;
  try {
    var res = await GCR.api("/businesses/" + id + "/collect", { method: "POST", body: {} });
    GCR.applyCharacter(res.character);
    GCR.data.mine.loaded = false;
    GCR.toast("Collected " + GCR.money(res.collected) + ".", "success");
    GCR.reload();
  } catch (e) {
    GCR.fail(e);
  } finally {
    GCR.data.bizBusy = false;
  }
};

window.gcrUpgradeBusiness = async function (id) {
  if (GCR.data.bizBusy) return;
  if (!confirm("Upgrade this business? The server charges the listed cost.")) return;
  GCR.data.bizBusy = true;
  try {
    var res = await GCR.api("/businesses/" + id + "/upgrade", {
      method: "POST",
      body: { idempotencyKey: GCR.key("upgrade") }
    });
    await GCR.refreshSession();
    GCR.data.mine.loaded = false;
    GCR.toast(res.duplicated ? "Already upgraded." : "Upgraded to level " + res.business.level + ".", "success");
    GCR.reload();
  } catch (e) {
    GCR.fail(e);
  } finally {
    GCR.data.bizBusy = false;
  }
};

function mineRow(b) {
  return '<div class="card" style="margin-bottom:10px">' +
    '<div style="display:flex;gap:10px;align-items:flex-start">' +
      '<div class="venue-icon">' + GCR.esc(b.type.icon) + "</div>" +
      '<div style="flex:1;min-width:0">' +
        '<div class="venue-name">' + GCR.esc(b.name) + "</div>" +
        '<div class="venue-kind">' + GCR.esc(b.type.name) + " · " + GCR.esc(b.district.name) + " · Level " + b.level + "</div>" +
      "</div>" +
      '<span class="chip ok">' + GCR.money(b.pendingRevenue) + "</span>" +
    "</div>" +
    '<div class="btn-row" style="margin-top:10px">' +
      '<button class="btn sm" onclick="gcrCollectBusiness(\'' + b.id + '\')">Collect revenue</button>' +
      '<button class="btn ghost sm" onclick="gcrUpgradeBusiness(\'' + b.id + '\')">Upgrade · ' + GCR.money(b.upgradeCost) + "</button>" +
    "</div>" +
    '<div style="font-size:11px;color:var(--muted);margin-top:6px">Lifetime revenue ' + GCR.money(b.totalRevenue) +
      " · collecting caps at " + "24h" + " of accrual.</div>" +
  "</div>";
}

function viewBusinesses() {
  if (!GCR.session.ready) return '<div class="page-head"><div class="page-title">Businesses</div><div class="page-sub">Connecting…</div></div>';
  if (!GCR.signedIn()) return GCR.requireSignIn("Businesses belong to accounts.");

  /* Keep whatever the player typed if a background load re-renders the view. */
  var nameEl = document.getElementById("gcr-biz-name");
  var typeEl = document.getElementById("gcr-biz-type");
  if (nameEl || typeEl) {
    GCR.data.bizDraft = { name: nameEl ? nameEl.value : "", type: typeEl ? typeEl.value : null };
  }
  var draft = GCR.data.bizDraft || { name: "", type: null };

  if (!GCR.data.mine.loaded && !GCR.data.mine.loading) loadMine();
  if (!GCR.data.market.loaded && !GCR.data.market.loading) loadMarket();
  if (!GCR.world.data) {
    GCR.loadWorld().then(function () { GCR.reload(); });
  }

  var world = GCR.world.data;
  var mine = GCR.data.mine;
  var market = GCR.data.market;

  var typeOptions = world
    ? world.businessTypes.map(function (t) {
        return '<option value="' + t.code + '"' + (draft.type === t.code ? " selected" : "") + ">" + GCR.esc(t.name) + " — " + GCR.money(t.cost) +
          " · earns " + GCR.money(t.base_revenue) + "/day</option>";
      }).join("")
    : "";

  var mineList = mine.loading && !mine.loaded
    ? '<div class="card"><div class="card-sub">Loading your businesses…</div></div>'
    : mine.error
      ? '<div class="notice warn">' + GCR.esc(mine.error) + "</div>"
      : mine.items.length
        ? mine.items.map(mineRow).join("")
        : '<div class="card"><div class="card-sub">You do not own a business yet. Start with a food stand.</div></div>';

  var marketList = market.items.length
    ? '<div class="card">' +
      market.items.map(function (b) {
        return '<div class="venue-row" style="cursor:pointer" onclick="openPlayerProfile(\'' + b.owner_id + '\')">' +
          '<div class="venue-icon">' + GCR.esc(b.icon) + "</div>" +
          '<div style="flex:1;min-width:0">' +
            '<div class="venue-name">' + GCR.esc(b.name) + "</div>" +
            '<div class="venue-kind">' + GCR.esc(b.type_name) + " · " + GCR.esc(b.district_name) + " · " + GCR.esc(b.owner_name) + "</div>" +
          "</div>" +
          '<span class="chip">Lv ' + b.level + "</span>" +
        "</div>";
      }).join("") + "</div>"
    : '<div class="card"><div class="card-sub">No public businesses yet. Yours would appear here.</div></div>';

  return '<div class="page-head">' +
      '<div class="page-eyebrow">Shared economy</div>' +
      '<div class="page-title">Businesses</div>' +
      '<div class="page-sub">Your venues in Port Harcourt. Revenue accrues while you are away and is paid only when the server validates it.</div>' +
    "</div>" +
    GCR.characterHeader() +
    '<div class="card" style="margin-bottom:16px">' +
      '<div class="card-title">Your businesses</div>' +
      '<div class="card-sub">Maximum five. Upkeep is charged by settlement, not by the browser.</div>' +
      mineList +
    "</div>" +
    '<div class="card" style="margin-bottom:16px">' +
      '<div class="card-title">Open a business</div>' +
      '<div class="card-sub">It opens where you are standing. The price is fixed by the catalogue.</div>' +
      (world
        ? '<div class="field"><label for="gcr-biz-type">Type</label><select id="gcr-biz-type">' + typeOptions + "</select></div>" +
          GCR.field("gcr-biz-name", "Business name", { maxlength: 30, placeholder: "e.g. Mama Eka Kitchen", value: draft.name }) +
          '<div class="btn-row"><button class="btn" onclick="gcrOpenBusiness()">Open business</button></div>'
        : '<div class="card-sub">Loading catalogue…</div>') +
    "</div>" +
    '<div class="card">' +
      '<div class="card-title">Businesses in the city</div>' +
      '<div class="card-sub">Owned by real players. Tap one to see the owner.</div>' +
      marketList +
    "</div>";
}

window.VIEWS.businesses = viewBusinesses;
