/* ============================================================
   WALLET — balance, transfers and the ledger
   Balances only change through server-recorded entries.
   ============================================================ */

window.VIEWS = window.VIEWS || {};
GCR.data = GCR.data || {};

GCR.data.wallet = { data: null, loaded: false, loading: false, error: null };
GCR.data.transfers = { data: null, loaded: false, loading: false };
GCR.data.recipients = { items: [], loaded: false, loading: false };
GCR.data.walletBusy = false;

async function loadWallet() {
  var s = GCR.data.wallet;
  if (s.loading) return;
  s.loading = true;
  try {
    s.data = await GCR.api("/wallet");
    s.loaded = true;
    s.error = null;
  } catch (e) {
    s.error = e.message;
  } finally {
    s.loading = false;
    GCR.reload();
  }
}

async function loadTransfers() {
  var s = GCR.data.transfers;
  if (s.loading) return;
  s.loading = true;
  try {
    s.data = await GCR.api("/transfers");
  } catch (e) {
  } finally {
    s.loading = false;
    s.loaded = true;
    GCR.reload();
  }
}

async function loadRecipients() {
  var s = GCR.data.recipients;
  if (s.loading) return;
  s.loading = true;
  try {
    var res = await GCR.api("/players?limit=20");
    var me = GCR.character();
    s.items = res.items.filter(function (p) { return !me || p.id !== me.id; });
  } catch (e) {
  } finally {
    s.loading = false;
    s.loaded = true;
    GCR.reload();
  }
}

window.gcrSendTransfer = async function () {
  if (GCR.data.walletBusy) return;
  var select = document.getElementById("gcr-transfer-to");
  var amountInput = document.getElementById("gcr-transfer-amount");
  var to = select ? select.value : "";
  var amount = Math.floor(Number(amountInput ? amountInput.value : 0));
  if (!to) return GCR.toast("Choose a recipient.", "warn");
  if (!amount || amount < 100) return GCR.toast("Minimum transfer is ₦100.", "warn");
  if (!confirm("Send " + GCR.money(amount) + " plus the transfer fee?")) return;

  GCR.data.walletBusy = true;
  try {
    var res = await GCR.api("/transfers", {
      method: "POST",
      body: { toCharacterId: to, amount: amount, idempotencyKey: GCR.key("transfer") }
    });
    GCR.applyCharacter(res.character);
    GCR.data.wallet.loaded = false;
    GCR.data.transfers.loaded = false;
    GCR.toast(res.duplicated ? "That transfer was already processed." : "Sent " + GCR.money(amount) + ".", "success");
    GCR.data.walletPrefill = null;
    GCR.data.transferDraft = { amount: "", to: null };
    GCR.reload();
  } catch (e) {
    GCR.fail(e);
  } finally {
    GCR.data.walletBusy = false;
  }
};

function ledgerRow(entry) {
  var positive = entry.delta > 0;
  var label = {
    transfer_in: "Received",
    transfer_out: "Sent",
    business_revenue: "Business revenue",
    business_purchase: "Business purchase",
    business_upgrade: "Business upgrade",
    business_upkeep: "Business upkeep",
    activity_cost: "Activity cost",
    activity_reward: "Activity payout",
    travel_fare: "Travel fare",
    duel_reward: "Duel reward",
    duel_loss: "Duel loss",
    save_import: "Save import",
    admin_grant: "Admin adjustment"
  }[entry.kind] || entry.kind;

  return '<div class="activity-row">' +
    '<div style="flex:1;min-width:0">' +
      '<div class="activity-title">' + GCR.esc(label) + (entry.meta && entry.meta.title ? " · " + GCR.esc(entry.meta.title) : "") + "</div>" +
      '<div class="activity-meta">' + GCR.date(entry.createdAt) + " · balance " + GCR.money(entry.balanceAfter) + "</div>" +
    "</div>" +
    '<span class="chip ' + (positive ? "ok" : "") + '">' + (positive ? "+" : "") + GCR.money(entry.delta) + "</span>" +
  "</div>";
}

function viewWallet() {
  if (!GCR.session.ready) return '<div class="page-head"><div class="page-title">Wallet</div><div class="page-sub">Connecting…</div></div>';
  if (!GCR.signedIn()) return GCR.requireSignIn("Your wallet belongs to your account.");

  /* Keep typed values if a background load re-renders the view. */
  var amountEl = document.getElementById("gcr-transfer-amount");
  var toEl = document.getElementById("gcr-transfer-to");
  if (amountEl || toEl) {
    GCR.data.transferDraft = { amount: amountEl ? amountEl.value : "", to: toEl ? toEl.value : null };
  }
  var draft = GCR.data.transferDraft || { amount: "", to: null };

  if (!GCR.data.wallet.loaded && !GCR.data.wallet.loading) loadWallet();
  if (!GCR.data.transfers.loaded && !GCR.data.transfers.loading) loadTransfers();
  if (!GCR.data.recipients.loaded && !GCR.data.recipients.loading) loadRecipients();

  var w = GCR.data.wallet;
  var prefill = GCR.data.walletPrefill;
  var recipients = GCR.data.recipients.items;

  var options = recipients.map(function (p) {
    var wanted = prefill ? prefill.id : draft.to;
    var selected = wanted === p.id ? " selected" : "";
    return '<option value="' + p.id + '"' + selected + ">" + GCR.esc(p.displayName) +
      (p.district ? " · " + GCR.esc(p.district.name) : "") + "</option>";
  }).join("");

  var entries = w.data && w.data.entries.length
    ? w.data.entries.map(ledgerRow).join("")
    : '<div class="card-sub">No transactions yet.</div>';

  var sent = GCR.data.transfers.data && GCR.data.transfers.data.sent.length
    ? GCR.data.transfers.data.sent.map(function (t) {
        return '<div class="activity-row"><div style="flex:1">' +
          '<div class="activity-title">To ' + GCR.esc(t.other_avatar) + " " + GCR.esc(t.other_name) + "</div>" +
          '<div class="activity-meta">' + GCR.date(t.created_at) + " · fee " + GCR.money(t.fee) + "</div></div>" +
          '<span class="chip">' + GCR.money(t.amount) + "</span></div>";
      }).join("")
    : '<div class="card-sub">No transfers sent.</div>';

  return '<div class="page-head">' +
      '<div class="page-eyebrow">Shared economy</div>' +
      '<div class="page-title">Wallet</div>' +
      '<div class="page-sub">Balances are a running record of server-side ledger entries, not a number the browser can set.</div>' +
    "</div>" +
    GCR.characterHeader() +
    (w.error ? '<div class="notice warn" style="margin-bottom:16px">' + GCR.esc(w.error) + "</div>" : "") +
    '<div class="card" style="margin-bottom:16px">' +
      '<div class="card-title">Send money</div>' +
      '<div class="card-sub">A fee applies. The server checks your balance, the daily limit and duplicate requests.</div>' +
      (recipients.length
        ? '<div class="field"><label for="gcr-transfer-to">Recipient</label><select id="gcr-transfer-to">' + options + "</select></div>"
        : '<div class="card-sub">No other players are discoverable yet.</div>') +
      GCR.field("gcr-transfer-amount", "Amount (₦)", { type: "number", placeholder: "1000", value: draft.amount }) +
      (w.data
        ? '<div style="font-size:11px;color:var(--muted);margin-bottom:10px">Fee ' + w.data.rules.transferFeePct +
          "% (min " + GCR.money(w.data.rules.transferMinFee) + ") · daily cap " + GCR.money(w.data.rules.transferDailyCap) + "</div>"
        : "") +
      '<div class="btn-row"><button class="btn" onclick="gcrSendTransfer()">Send</button></div>' +
    "</div>" +
    '<div class="card" style="margin-bottom:16px">' +
      '<div class="card-title">Recent activity</div>' + entries +
    "</div>" +
    '<div class="card">' +
      '<div class="card-title">Transfers sent</div>' + sent +
    "</div>";
}

window.VIEWS.wallet = viewWallet;
