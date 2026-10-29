/* ============================================================
   ACCOUNT, SIGN-IN, RECOVERY AND CLOUD SAVE
   Real forms against the real API. No fake success state.
   ============================================================ */

window.VIEWS = window.VIEWS || {};

GCR.authFlow = { token: null, kind: null, busy: false };

window.gcrSetBusy = function (busy) {
  GCR.authFlow.busy = busy;
};

window.gcrLogin = async function () {
  var email = (document.getElementById("gcr-email") || {}).value || "";
  var pass = (document.getElementById("gcr-password") || {}).value || "";
  if (!email || !pass) return GCR.toast("Enter your email and password.", "warn");
  try {
    gcrSetBusy(true);
    await GCR.api("/auth/login", { method: "POST", body: { email: email, password: pass } });
    await GCR.refreshSession();
    await GCR.loadWorld();
    if (typeof state !== "undefined") state.view = "account";
    GCR.toast("Signed in.", "success");
    GCR.reload();
  } catch (e) {
    GCR.fail(e);
  } finally {
    gcrSetBusy(false);
  }
};

window.gcrRegister = async function () {
  var name = (document.getElementById("gcr-name") || {}).value || "";
  var email = (document.getElementById("gcr-reg-email") || {}).value || "";
  var pass = (document.getElementById("gcr-reg-password") || {}).value || "";
  try {
    gcrSetBusy(true);
    var res = await GCR.api("/auth/register", {
      method: "POST",
      body: { email: email, password: pass, displayName: name }
    });
    await GCR.refreshSession();
    await GCR.loadWorld();
    if (typeof state !== "undefined") state.view = "account";
    GCR.toast("Account created. Verify your email to play online.", "success");
    if (res.emailDelivery === "dev-outbox") {
      GCR.toast("Sandbox mode: open the development mail to verify.", "warn");
    }
    GCR.reload();
  } catch (e) {
    GCR.fail(e);
  } finally {
    gcrSetBusy(false);
  }
};

window.gcrLogout = async function () {
  try {
    await GCR.api("/auth/logout", { method: "POST" });
  } catch (e) {}
  GCR.session.me = null;
  GCR.toast("Signed out.", "success");
  GCR.reload();
};

window.gcrForgot = async function () {
  var email = (document.getElementById("gcr-forgot-email") || {}).value || "";
  try {
    var res = await GCR.api("/auth/forgot-password", { method: "POST", body: { email: email } });
    GCR.toast(res.message, "success");
  } catch (e) {
    GCR.fail(e);
  }
};

window.gcrResetPassword = async function () {
  var pass = (document.getElementById("gcr-reset-password") || {}).value || "";
  var confirm = (document.getElementById("gcr-reset-confirm") || {}).value || "";
  if (pass !== confirm) return GCR.toast("Passwords do not match.", "warn");
  try {
    await GCR.api("/auth/reset-password", { method: "POST", body: { token: GCR.authFlow.token, password: pass } });
    GCR.authFlow.token = null;
    GCR.authFlow.kind = null;
    GCR.toast("Password updated. Sign in with the new password.", "success");
    GCR.reload();
  } catch (e) {
    GCR.fail(e);
  }
};

window.gcrResendVerification = async function () {
  try {
    var res = await GCR.api("/auth/resend-verification", { method: "POST" });
    GCR.toast(res.emailDelivery === "dev-outbox" ? "Verification stored in the development mail." : "Verification email sent.", "success");
    GCR.reload();
  } catch (e) {
    GCR.fail(e);
  }
};

window.gcrOpenOutbox = async function () {
  try {
    var res = await GCR.api("/dev/outbox");
    var html = '<div class="page-title">Development mail</div>' +
      '<div class="page-sub" style="margin-bottom:14px">No SMTP account is configured, so verification and reset links are captured here. This screen does not exist in production.</div>';
    if (!res.items.length) {
      html += '<div class="notice neutral">No messages yet.</div>';
    } else {
      res.items.forEach(function (m) {
        var link = (m.body.match(/https?:\/\/[^\s]+#(?:verify|reset)\/[A-Za-z0-9_-]+/) || [])[0] || "";
        html += '<div class="card" style="margin-bottom:10px">' +
          '<div style="font-weight:600;color:var(--text)">' + GCR.esc(m.subject) + "</div>" +
          '<div style="font-size:12px;color:var(--muted);margin:4px 0 8px">' + GCR.esc(m.to_email) + " · " + GCR.when(m.created_at) + "</div>" +
          '<pre style="white-space:pre-wrap;word-break:break-all;font-size:11px;color:var(--muted);margin:0 0 10px">' + GCR.esc(m.body) + "</pre>" +
          (link
            ? '<button class="btn sm" onclick="gcrOpenMailLink(\'' + link.replace(/'/g, "%27") + '\')">Open this link</button>'
            : "") +
          "</div>";
      });
    }
    html += '<div class="btn-row"><button class="btn ghost" onclick="closeModal()">Close</button></div>';
    openModal(html);
  } catch (e) {
    GCR.fail(e);
  }
};

window.gcrOpenMailLink = function (url) {
  location.href = url;
};

/* ------------------------------------------------------------ character */
window.gcrSaveCharacter = async function () {
  var name = (document.getElementById("gcr-char-name") || {}).value || "";
  var avatar = (document.getElementById("gcr-char-avatar") || {}).value || "";
  var discoverable = document.getElementById("gcr-privacy-discover");
  var finances = document.getElementById("gcr-privacy-money");
  var locationEl = document.getElementById("gcr-privacy-location");
  try {
    var res = await GCR.api("/me/character", {
      method: "PATCH",
      body: {
        displayName: name,
        avatar: avatar,
        discoverable: discoverable ? discoverable.checked : true,
        showFinances: finances ? finances.checked : false,
        showLocation: locationEl ? locationEl.checked : true
      }
    });
    GCR.applyCharacter(res.character);
    GCR.toast("Character updated.", "success");
    GCR.reload();
  } catch (e) {
    GCR.fail(e);
  }
};

window.gcrChangePassword = async function () {
  var current = (document.getElementById("gcr-pw-current") || {}).value || "";
  var next = (document.getElementById("gcr-pw-new") || {}).value || "";
  try {
    await GCR.api("/auth/change-password", { method: "POST", body: { currentPassword: current, newPassword: next } });
    GCR.toast("Password changed.", "success");
    GCR.reload();
  } catch (e) {
    GCR.fail(e);
  }
};

/* ------------------------------------------------------------ migration */
window.gcrImportSave = async function () {
  if (typeof state === "undefined" || !state.player) return;
  if (!confirm("Copy your local story progress into your online character? Your local save stays on this device and this can only be done once.")) return;
  var p = state.player;
  var awards = Array.isArray(p.awards)
    ? p.awards.map(function (a) { return typeof a === "string" ? a : (a && a.name) || ""; }).filter(Boolean).slice(0, 20)
    : [];
  var save = {
    player: {
      name: p.name,
      look: p.look,
      money: p.money,
      age: p.age,
      week: p.week,
      energy: p.energy,
      health: p.health,
      happiness: p.happiness,
      fame: p.fame,
      actingSkill: p.actingSkill,
      iq: p.iq,
      charm: p.charm,
      education: p.education,
      rep: p.rep,
      awards: awards
    }
  };
  try {
    var res = await GCR.api("/migrate/save", { method: "POST", body: { save: save } });
    await GCR.refreshSession();
    var note = res.warnings && res.warnings.length ? " Notes: " + res.warnings.join(" ") : "";
    GCR.toast("Progress imported." + note, res.warnings && res.warnings.length ? "warn" : "success");
    GCR.reload();
  } catch (e) {
    if (e.code === "ALREADY_IMPORTED") {
      GCR.toast("Already imported. Server progress is never overwritten.", "warn");
    } else {
      GCR.fail(e);
    }
  }
};

/* ------------------------------------------------------------ view */
function authCardSignIn() {
  return '<div class="card" style="margin-bottom:16px">' +
    '<div class="card-title">Sign in</div>' +
    '<div class="card-sub">Your character, money and businesses live on the server.</div>' +
    GCR.field("gcr-email", "Email", { type: "email", autocomplete: "email", placeholder: "you@example.com" }) +
    GCR.field("gcr-password", "Password", { type: "password", autocomplete: "current-password" }) +
    '<div class="btn-row"><button class="btn" onclick="gcrLogin()">Sign in</button></div>' +
    '<div class="notice neutral" style="margin-top:12px">' +
      '<div style="margin-bottom:6px">Forgot your password?</div>' +
      GCR.field("gcr-forgot-email", "Email for reset link", { type: "email", placeholder: "you@example.com" }) +
      '<button class="btn ghost sm" onclick="gcrForgot()">Send reset link</button>' +
    '</div>' +
  '</div>';
}

function authCardRegister() {
  return '<div class="card" style="margin-bottom:16px">' +
    '<div class="card-title">Create an account</div>' +
    '<div class="card-sub">One character per account. Email + password, verified by email.</div>' +
    GCR.field("gcr-name", "Character name", { maxlength: 20, placeholder: "3-20 characters" }) +
    GCR.field("gcr-reg-email", "Email", { type: "email", autocomplete: "email", placeholder: "you@example.com" }) +
    GCR.field("gcr-reg-password", "Password", { type: "password", autocomplete: "new-password", placeholder: "10+ characters, letters and numbers" }) +
    '<div class="btn-row"><button class="btn" onclick="gcrRegister()">Create account</button></div>' +
  '</div>';
}

function authCardSignedOut() {
  return '<div class="page-head">' +
      '<div class="page-eyebrow">Online city</div>' +
      '<div class="page-title">Your account</div>' +
      '<div class="page-sub">Sign in to play the shared world, or create an account in a minute.</div>' +
    '</div>' +
    (GCR.session.error ? '<div class="notice warn" style="margin-bottom:16px">' + GCR.esc(GCR.session.error) + "</div>" : "") +
    authCardSignIn() + authCardRegister();
}

function cardVerification(account) {
  if (account.emailVerified) {
    return '<div class="card" style="margin-bottom:16px">' +
      '<div class="card-title">Email verified</div>' +
      '<div class="card-sub">Your account can take part in the shared economy.</div>' +
      '<span class="chip ok">Verified</span></div>';
  }
  return '<div class="card" style="margin-bottom:16px">' +
    '<div class="card-title">Verify your email</div>' +
    '<div class="card-sub">Online actions are locked until your email is verified. This protects other players.</div>' +
    '<div class="btn-row">' +
      '<button class="btn" onclick="gcrResendVerification()">Send verification email</button>' +
      '<button class="btn ghost" onclick="gcrOpenOutbox()">Open development mail</button>' +
    '</div></div>';
}

function cardCharacter(character) {
  return '<div class="card" style="margin-bottom:16px">' +
    '<div class="card-title">Character</div>' +
    '<div class="card-sub">Your public identity and privacy. Account email is never shown on your profile.</div>' +
    GCR.field("gcr-char-name", "Display name", { value: character.displayName, maxlength: 20 }) +
    GCR.field("gcr-char-avatar", "Avatar emoji", { value: character.avatar, maxlength: 4 }) +
    '<label class="locked-field" style="cursor:pointer">' +
      '<div><div style="font-weight:600;color:var(--text)">Discoverable</div>' +
      '<div style="font-size:11px">Appear in the player directory and profile search.</div></div>' +
      '<input type="checkbox" id="gcr-privacy-discover" ' + (character.discoverable ? "checked" : "") + " /></label>" +
    '<label class="locked-field" style="cursor:pointer">' +
      '<div><div style="font-weight:600;color:var(--text)">Show my balance</div>' +
      '<div style="font-size:11px">Off by default. Private by choice, not by URL obscurity.</div></div>' +
      '<input type="checkbox" id="gcr-privacy-money" ' + (character.showFinances ? "checked" : "") + " /></label>" +
    '<label class="locked-field" style="cursor:pointer">' +
      '<div><div style="font-weight:600;color:var(--text)">Show my district</div>' +
      '<div style="font-size:11px">Turn off to keep your current location off your public profile.</div></div>' +
      '<input type="checkbox" id="gcr-privacy-location" ' + (character.showLocation ? "checked" : "") + " /></label>" +
    '<div class="btn-row" style="margin-top:14px">' +
      '<button class="btn" onclick="gcrSaveCharacter()">Save character</button>' +
      '<button class="btn ghost" onclick="switchView(\'players\')">Open player directory</button>' +
    '</div></div>';
}

function cardMigrate(character) {
  var imported = Boolean(character.importedAt);
  return '<div class="card" style="margin-bottom:16px">' +
    '<div class="card-title">Cloud save</div>' +
    '<div class="card-sub">Your online character is the server copy. The solo story in this browser stays separate unless you import it.</div>' +
    (imported
      ? '<span class="chip ok">Local progress imported ' + GCR.when(character.importedAt) + "</span>" +
        '<div class="notice neutral" style="margin-top:12px">Server progress is never overwritten by a second import. Your browser save is untouched.</div>'
      : '<div class="notice neutral" style="margin-bottom:12px">Importing copies age, week, money (capped), stats, education and awards. ' +
        'The local save is kept on this device and is never deleted.</div>' +
        '<div class="btn-row"><button class="btn" onclick="gcrImportSave()">Import local progress</button></div>') +
    "</div>";
}

function cardPassword() {
  return '<div class="card" style="margin-bottom:16px">' +
    '<div class="card-title">Password</div>' +
    '<div class="card-sub">Changing it signs out your other devices.</div>' +
    GCR.field("gcr-pw-current", "Current password", { type: "password", autocomplete: "current-password" }) +
    GCR.field("gcr-pw-new", "New password", { type: "password", autocomplete: "new-password" }) +
    '<div class="btn-row"><button class="btn ghost" onclick="gcrChangePassword()">Change password</button></div></div>';
}

function cardResetForm() {
  return '<div class="page-head">' +
      '<div class="page-eyebrow">Account recovery</div>' +
      '<div class="page-title">Choose a new password</div>' +
      '<div class="page-sub">This link is single-use and expires after 60 minutes.</div>' +
    "</div>" +
    '<div class="card">' +
      GCR.field("gcr-reset-password", "New password", { type: "password", autocomplete: "new-password", placeholder: "10+ characters, letters and numbers" }) +
      GCR.field("gcr-reset-confirm", "Repeat new password", { type: "password", autocomplete: "new-password" }) +
      '<div class="btn-row"><button class="btn" onclick="gcrResetPassword()">Set new password</button>' +
      '<button class="btn ghost" onclick="GCR.authFlow.token=null;GCR.reload()">Cancel</button></div>' +
    "</div>";
}

function viewAccount() {
  if (GCR.authFlow.kind === "reset" && GCR.authFlow.token) return cardResetForm();

  if (!GCR.session.ready) {
    return '<div class="page-head"><div class="page-title">Account</div>' +
      '<div class="page-sub">Connecting to the server…</div></div>';
  }
  if (!GCR.signedIn()) return authCardSignedOut();

  var account = GCR.account();
  var character = GCR.character();

  return '<div class="page-head">' +
      '<div class="page-eyebrow">Account</div>' +
      '<div class="page-title">' + GCR.esc(account.email) + '</div>' +
      '<div class="page-sub">' + (account.role === "admin" ? "Administrator" : "Player") + " · member since " + GCR.date(account.createdAt) + "</div>" +
    "</div>" +
    (character ? GCR.characterHeader() : '<div class="notice warn" style="margin-bottom:16px">This account has no character.</div>') +
    cardVerification(account) +
    (character ? cardCharacter(character) : "") +
    (character ? cardMigrate(character) : "") +
    cardPassword() +
    '<div class="card" style="margin-bottom:16px">' +
      '<div class="card-title">Solo story (this browser)</div>' +
      '<div class="card-sub">The original life simulation is local to this device and is not part of the shared world.</div>' +
      '<div class="btn-row">' +
        '<button class="btn ghost" onclick="exportSave()">Export local save</button>' +
        '<button class="btn ghost" onclick="if(confirm(\'Delete this local save and start over?\')) resetGame()">Reset local save</button>' +
      "</div>" +
    "</div>" +
    '<div class="card">' +
      '<div class="card-title">Session</div>' +
      '<div class="btn-row">' +
        '<button class="btn ghost" onclick="gcrOpenOutbox()">Development mail</button>' +
        (GCR.isAdmin() ? '<button class="btn ghost" onclick="switchView(\'admin\')">Administration</button>' : "") +
        '<button class="btn ghost" onclick="gcrLogout()">Sign out</button>' +
      "</div>" +
    "</div>";
}

window.VIEWS.account = viewAccount;

/* ------------------------------------------------------------ link handling */
document.addEventListener("DOMContentLoaded", function () {
  var match = /^#(verify|reset)\/([A-Za-z0-9_-]+)$/.exec(location.hash || "");
  if (!match) return;
  var kind = match[1];
  var token = match[2];
  if (typeof state !== "undefined") state.view = "account";

  if (kind === "verify") {
    GCR.api("/auth/verify-email", { method: "POST", body: { token: token } })
      .then(function () {
        GCR.toast("Email verified.", "success");
        return GCR.refreshSession();
      })
      .catch(function (err) { GCR.fail(err); })
      .finally(function () {
        try { history.replaceState(null, "", location.pathname); } catch (e) {}
        GCR.reload();
      });
  } else {
    GCR.authFlow.kind = "reset";
    GCR.authFlow.token = token;
    try { history.replaceState(null, "", location.pathname); } catch (e) {}
    GCR.reload();
  }
});
