/* ============================================================
   ACCOUNT & ADMINISTRATION
   These screens are deliberately honest: the authentication service
   and the server-side admin authority do not exist yet, so nothing
   here pretends to log in or to grant privileges.
   ============================================================ */

window.VIEWS = window.VIEWS || {};

const AUTH_CAPABILITIES = [
  { label: "Email address", desc: "Unique account identifier" },
  { label: "Password", desc: "Hashed server-side, never stored in this browser" },
  { label: "Email verification", desc: "Confirm ownership before play" },
  { label: "Password recovery", desc: "Secure reset link by email" },
  { label: "Persistent sessions", desc: "httpOnly cookie, survives reload" }
];

function viewAccount() {
  const p = state.player;

  return '' +
    '<div class="page-head">' +
      '<div class="page-eyebrow">Account</div>' +
      '<div class="page-title">Your account</div>' +
      '<div class="page-sub">Playing as ' + escHtml(p.name) + ' · saved in this browser only.</div>' +
    '</div>' +

    '<div class="notice warn" style="margin-bottom:16px">' +
      '<div><strong>Accounts are not connected yet.</strong> Registration, login and password recovery need the ' +
      'authentication service from the multiplayer phase. This screen is the prepared interface — it will not ' +
      'pretend to sign you in.</div>' +
    '</div>' +

    '<div class="card" style="margin-bottom:16px">' +
      '<div class="card-title">Sign-in capabilities</div>' +
      '<div class="card-sub">Everything below is blocked on the same backend work.</div>' +
      '<div class="control-list">' +
        AUTH_CAPABILITIES.map(function (c) {
          return '<div class="locked-field">' +
            '<div><div style="font-weight:600;color:var(--text)">' + c.label + '</div>' +
            '<div style="font-size:11px">' + c.desc + '</div></div>' +
            '<span class="chip">Server required</span>' +
          '</div>';
        }).join("") +
      '</div>' +
      '<div class="btn-row" style="margin-top:14px">' +
        '<button class="btn" disabled>Create account</button>' +
        '<button class="btn ghost" disabled>Sign in</button>' +
        '<button class="btn ghost" disabled>Reset password</button>' +
      '</div>' +
    '</div>' +

    '<div class="card" style="margin-bottom:16px">' +
      '<div class="card-title">Preferences</div>' +
      '<div class="card-sub">Light mode is the default; dark mode is optional.</div>' +
      '<div class="btn-row">' +
        '<button class="theme-toggle" data-theme-toggle onclick="toggleTheme()">☾ Dark mode</button>' +
      '</div>' +
    '</div>' +

    '<div class="card" style="margin-bottom:16px">' +
      '<div class="card-title">Your save</div>' +
      '<div class="card-sub">Stored locally in this browser. Export it before clearing site data.</div>' +
      '<div class="stat-grid" style="margin-bottom:12px">' +
        '<div class="stat-tile"><div class="k">Age</div><div class="v">' + p.age + '</div></div>' +
        '<div class="stat-tile"><div class="k">Money</div><div class="v">' + fmtN(p.money) + '</div></div>' +
        '<div class="stat-tile"><div class="k">Week</div><div class="v">' + p.week + '</div></div>' +
      '</div>' +
      '<div class="btn-row">' +
        '<button class="btn ghost" onclick="exportSave()">Export save (.json)</button>' +
        '<button class="btn ghost" onclick="if(confirm(\'Delete this local save and start over?\')) resetGame()">Reset progress</button>' +
      '</div>' +
    '</div>' +

    '<div class="card">' +
      '<div class="card-title">Administration</div>' +
      '<div class="card-sub">Separate from player navigation and never self-service.</div>' +
      '<button class="btn ghost" onclick="switchView(\'admin\')">Open administration console</button>' +
      '<div class="notice neutral" style="margin-top:12px">There is no admin registration and no shared admin password. ' +
      'Access will require a verified administrator role checked by the server.</div>' +
    '</div>';
}

function exportSave() {
  try {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "garden-city-save.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    toast("Save exported.", "success");
  } catch (e) {
    toast("Could not export the save.", "warn");
  }
}

const ADMIN_CAPABILITIES = [
  { label: "Player search", desc: "Find an account by name, email or id" },
  { label: "Account inspection", desc: "Character state, balances, ledger history" },
  { label: "Moderation", desc: "Suspend, restore, reason required" },
  { label: "Resource adjustment", desc: "Credit or debit through audited server rules" },
  { label: "Unlimited-resource override", desc: "Per-player flag with expiry and reason" },
  { label: "Game configuration", desc: "Economy rates, event schedules, clock" },
  { label: "Audit log", desc: "Every administrative action, immutable" }
];

function viewAdmin() {
  return '' +
    '<div class="page-head">' +
      '<div class="page-eyebrow">Administration</div>' +
      '<div class="page-title">Operations console</div>' +
      '<div class="page-sub">Restricted area. Player navigation never links here.</div>' +
    '</div>' +

    '<div class="notice warn" style="margin-bottom:16px">' +
      '<div><strong>No administrator session.</strong> Administrator access is granted by a server-side role check ' +
      'against a verified account. This console has no data and every control is disabled until that authority exists — ' +
      'there is no local password prompt and no client-side cheat path.</div>' +
    '</div>' +

    '<div class="card" style="margin-bottom:16px">' +
      '<div class="card-title">Planned controls</div>' +
      '<div class="card-sub">Interface prepared; all actions require the server.</div>' +
      ADMIN_CAPABILITIES.map(function (c) {
        return '<div class="admin-row">' +
          '<div><div class="label">' + c.label + '</div><div class="desc">' + c.desc + '</div></div>' +
          '<span class="chip">Locked</span>' +
        '</div>';
      }).join("") +
    '</div>' +

    '<div class="card">' +
      '<div class="card-title">Access model</div>' +
      '<div class="card-sub">How administrators will actually be authorised.</div>' +
      '<div class="control-list">' +
        '<div class="locked-field"><div>Role stored on the account, checked server-side</div><span class="chip info">Planned</span></div>' +
        '<div class="locked-field"><div>Overrides enforced by the economy functions, not the client</div><span class="chip info">Planned</span></div>' +
        '<div class="locked-field"><div>Every action written to an immutable audit log</div><span class="chip info">Planned</span></div>' +
      '</div>' +
      '<div class="btn-row" style="margin-top:14px">' +
        '<button class="btn ghost" onclick="switchView(\'home\')">Back to the game</button>' +
      '</div>' +
    '</div>';
}

window.VIEWS.account = viewAccount;
window.VIEWS.admin = viewAdmin;
