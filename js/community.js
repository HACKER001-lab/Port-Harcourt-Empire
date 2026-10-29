/* ============================================================
   PLAYER DIRECTORY, PUBLIC PROFILES, FRIENDS AND RANKINGS
   Everything here reads the shared world through /api.
   ============================================================ */

window.VIEWS = window.VIEWS || {};
GCR.data = GCR.data || {};

GCR.data.players = { items: [], q: "", page: 1, loaded: false, loading: false, error: null };
GCR.data.profile = { id: null, data: null, loading: false, error: null };
GCR.data.rankings = { items: [], loaded: false, loading: false };
GCR.data.feed = { items: [], loaded: false, loading: false };
GCR.data.friends = { data: null, loaded: false, loading: false };

async function loadPlayers() {
  var s = GCR.data.players;
  if (s.loading) return;
  s.loading = true;
  s.error = null;
  try {
    var res = await GCR.api("/players?q=" + encodeURIComponent(s.q) + "&page=" + s.page + "&limit=15");
    s.items = res.items;
    s.loaded = true;
  } catch (e) {
    s.error = e.message;
  } finally {
    s.loading = false;
    GCR.reload();
  }
}

async function loadRankings() {
  var s = GCR.data.rankings;
  if (s.loading) return;
  s.loading = true;
  try {
    var res = await GCR.api("/rankings?limit=10");
    s.items = res.items;
  } catch (e) {
  } finally {
    s.loading = false;
    s.loaded = true;
    GCR.reload();
  }
}

async function loadFeed() {
  var s = GCR.data.feed;
  if (s.loading) return;
  s.loading = true;
  try {
    var res = await GCR.api("/feed?limit=12");
    s.items = res.items;
  } catch (e) {
  } finally {
    s.loading = false;
    s.loaded = true;
    GCR.reload();
  }
}

async function loadFriends() {
  var s = GCR.data.friends;
  if (s.loading) return;
  s.loading = true;
  try {
    s.data = await GCR.api("/friends");
  } catch (e) {
    s.data = null;
  } finally {
    s.loading = false;
    s.loaded = true;
    GCR.reload();
  }
}

window.gcrSearchPlayers = function () {
  var input = document.getElementById("gcr-player-search");
  var s = GCR.data.players;
  s.q = (input && input.value ? input.value : "").trim();
  s.page = 1;
  s.loaded = false;
  loadPlayers();
};

window.gcrPlayerPage = function (delta) {
  var s = GCR.data.players;
  var next = s.page + delta;
  if (next < 1) return;
  s.page = next;
  s.loaded = false;
  loadPlayers();
};

window.openPlayerProfile = function (id) {
  GCR.data.profile = { id: id, data: null, loading: false, error: null };
  if (typeof state !== "undefined") state.view = "player";
  loadProfile(id);
};

async function loadProfile(id) {
  var p = GCR.data.profile;
  if (p.loading) return;
  p.loading = true;
  try {
    p.data = await GCR.api("/players/" + id);
  } catch (e) {
    p.error = e.message;
  } finally {
    p.loading = false;
    GCR.reload();
  }
}

window.gcrAddFriend = async function (id) {
  try {
    await GCR.api("/friends/request", { method: "POST", body: { characterId: id } });
    GCR.toast("Request sent.", "success");
    loadProfile(id);
  } catch (e) {
    GCR.fail(e);
  }
};

window.gcrRespondFriend = async function (id, action) {
  try {
    await GCR.api("/friends/respond", { method: "POST", body: { requestId: id, action: action } });
    GCR.toast("Request " + action + "ed.", "success");
    GCR.data.friends.loaded = false;
    loadFriends();
  } catch (e) {
    GCR.fail(e);
  }
};

window.gcrPrefillTransfer = function (id, name) {
  GCR.data.walletPrefill = { id: id, name: name };
  switchView("wallet");
};

window.gcrChallenge = async function (id) {
  if (!confirm("Challenge this player to a duel? Both players lose energy and a result is recorded.")) return;
  try {
    var res = await GCR.api("/duels", { method: "POST", body: { opponentId: id, idempotencyKey: GCR.key("duel") } });
    GCR.applyCharacter(res.character);
    GCR.toast(res.duel.won ? "You won the duel." : "You lost the duel.", res.duel.won ? "success" : "warn");
    loadProfile(id);
  } catch (e) {
    GCR.fail(e);
  }
};

/* ------------------------------------------------------------ directory */
function playerRow(p) {
  return '<div class="venue-row" style="cursor:pointer" onclick="openPlayerProfile(\'' + p.id + '\')">' +
    '<div class="venue-icon">' + GCR.esc(p.avatar) + "</div>" +
    '<div style="flex:1;min-width:0">' +
      '<div class="venue-name">' + GCR.esc(p.displayName) + "</div>" +
      '<div class="venue-kind">' + (p.district ? GCR.esc(p.district.name) : "Location private") +
        " · Age " + p.age + " · Fame " + Number(p.fame).toLocaleString() + "</div>" +
    "</div>" +
    '<span class="chip">' + (p.businessCount || 0) + " biz</span>" +
  "</div>";
}

function viewPlayers() {
  if (!GCR.session.ready) return '<div class="page-head"><div class="page-title">Players</div><div class="page-sub">Connecting…</div></div>';
  if (!GCR.signedIn()) return GCR.requireSignIn("Player discovery needs an account.");

  var s = GCR.data.players;
  if (!s.loaded && !s.loading) loadPlayers();
  if (!GCR.data.rankings.loaded) loadRankings();
  if (!GCR.data.feed.loaded) loadFeed();
  if (!GCR.data.friends.loaded) loadFriends();

  var friends = GCR.data.friends.data;

  var incoming = friends && friends.incoming.length
    ? '<div class="card" style="margin-bottom:16px">' +
        '<div class="card-title">Friend requests</div>' +
        friends.incoming.map(function (f) {
          return '<div class="activity-row"><div style="flex:1">' +
            '<div class="activity-title">' + GCR.esc(f.other.avatar) + " " + GCR.esc(f.other.name) + "</div>" +
            '<div class="activity-meta">wants to connect · ' + GCR.when(f.createdAt) + "</div></div>" +
            '<div class="btn-row" style="gap:6px">' +
              '<button class="btn sm" onclick="gcrRespondFriend(\'' + f.id + '\',\'accept\')">Accept</button>' +
              '<button class="btn ghost sm" onclick="gcrRespondFriend(\'' + f.id + '\',\'decline\')">Decline</button>' +
            "</div></div>";
        }).join("") +
      "</div>"
    : "";

  var list = s.loading && !s.loaded
    ? '<div class="card"><div class="card-sub">Loading players…</div></div>'
    : s.error
      ? '<div class="notice warn">' + GCR.esc(s.error) + "</div>"
      : s.items.length
        ? '<div class="card">' + s.items.map(playerRow).join("") +
          '<div class="btn-row" style="margin-top:12px">' +
            '<button class="btn ghost sm" onclick="gcrPlayerPage(-1)">Previous</button>' +
            '<span class="chip">Page ' + s.page + "</span>" +
            '<button class="btn ghost sm" onclick="gcrPlayerPage(1)">Next</button>' +
          "</div></div>"
        : '<div class="card"><div class="card-sub">No players match that search.</div></div>';

  var rankings = GCR.data.rankings.items.length
    ? '<div class="card" style="margin-bottom:16px"><div class="card-title">Arena rankings</div>' +
      GCR.data.rankings.items.map(function (r) {
        return '<div class="rank-row" style="cursor:pointer" onclick="openPlayerProfile(\'' + r.id + '\')">' +
          '<div class="rank-num">' + r.rank + "</div>" +
          '<div style="flex:1"><div style="font-weight:600;color:var(--text)">' + GCR.esc(r.avatar) + " " + GCR.esc(r.displayName) + "</div>" +
          '<div class="venue-kind">' + r.wins + "W · " + r.losses + "L · " + GCR.esc(r.district || "Port Harcourt") + "</div></div>" +
          '<div class="chip">' + Number(r.fame).toLocaleString() + " fame</div></div>";
      }).join("") + "</div>"
    : "";

  var feed = GCR.data.feed.items.length
    ? '<div class="card"><div class="card-title">City feed</div>' +
      GCR.data.feed.items.map(function (f) {
        return '<div class="activity-row"><div style="flex:1">' +
          '<div class="activity-title">' + GCR.esc(f.message) + "</div>" +
          '<div class="activity-meta">' + GCR.esc(f.district_name || "Port Harcourt") + " · " + GCR.when(f.created_at) + "</div></div></div>";
      }).join("") + "</div>"
    : "";

  return '<div class="page-head">' +
      '<div class="page-eyebrow">Shared world</div>' +
      '<div class="page-title">Players</div>' +
      '<div class="page-sub">Real accounts in the same Port Harcourt. Profiles show only what each player allows.</div>' +
    "</div>" +
    GCR.characterHeader() +
    '<div class="card" style="margin-bottom:16px">' +
      '<div class="card-title">Find a player</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
        '<input id="gcr-player-search" class="line-input" style="flex:1;min-width:160px" placeholder="Search display names" value="' + GCR.esc(s.q) + '" />' +
        '<button class="btn" onclick="gcrSearchPlayers()">Search</button>' +
      "</div></div>" +
    incoming + rankings + list + feed;
}

window.VIEWS.players = viewPlayers;

/* ------------------------------------------------------------ profile */
function profileStat(k, v) {
  return '<div class="stat-tile"><div class="k">' + k + '</div><div class="v">' + v + "</div></div>";
}

function viewPlayer() {
  if (!GCR.signedIn()) return GCR.requireSignIn("Profiles need an account.");
  var p = GCR.data.profile;
  if (!p.data && !p.loading) {
    if (p.id) loadProfile(p.id);
    return '<div class="page-head"><div class="page-title">Profile</div><div class="page-sub">Loading…</div></div>';
  }
  if (p.error) {
    return '<div class="page-head"><div class="page-title">Profile</div></div>' +
      '<div class="notice warn">' + GCR.esc(p.error) + "</div>" +
      '<div class="btn-row"><button class="btn ghost" onclick="switchView(\'players\')">Back to players</button></div>';
  }
  if (!p.data) return '<div class="page-head"><div class="page-title">Profile</div><div class="page-sub">Loading…</div></div>';

  var d = p.data;
  var pl = d.player;
  var isMe = GCR.character() && pl.id === GCR.character().id;

  var friendAction = "";
  if (!isMe) {
    if (!d.friendStatus) {
      friendAction = '<button class="btn ghost" onclick="gcrAddFriend(\'' + pl.id + '\')">Add friend</button>';
    } else if (d.friendStatus.status === "pending" && d.friendStatus.incoming) {
      friendAction = '<button class="btn" onclick="gcrRespondFriend(\'' + d.friendStatus.id + '\',\'accept\')">Accept request</button>' +
        '<button class="btn ghost" onclick="gcrRespondFriend(\'' + d.friendStatus.id + '\',\'decline\')">Decline</button>';
    } else {
      friendAction = '<span class="chip ' + (d.friendStatus.status === "accepted" ? "ok" : "") + '">' +
        GCR.esc(d.friendStatus.status === "accepted" ? "Friends" : "Request " + d.friendStatus.status) + "</span>";
    }
  }

  var businesses = d.businesses.length
    ? '<div class="card" style="margin-bottom:16px"><div class="card-title">Businesses</div>' +
      d.businesses.map(function (b) {
        return '<div class="venue-row"><div class="venue-icon">' + GCR.esc(b.icon) + "</div>" +
          '<div style="flex:1"><div class="venue-name">' + GCR.esc(b.name) + "</div>" +
          '<div class="venue-kind">' + GCR.esc(b.type_name) + " · " + GCR.esc(b.district_name) + "</div></div>" +
          '<span class="chip">Lv ' + b.level + "</span></div>";
      }).join("") + "</div>"
    : "";

  var achievements = d.achievements.length
    ? '<div class="card" style="margin-bottom:16px"><div class="card-title">Achievements</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
      d.achievements.map(function (a) { return '<span class="chip ok">' + GCR.esc(a.label) + "</span>"; }).join("") +
      "</div></div>"
    : "";

  var duelRecord = d.duels.length
    ? '<div class="card" style="margin-bottom:16px"><div class="card-title">Combat history</div>' +
      d.duels.map(function (x) {
        var won = x.winner_id === pl.id;
        return '<div class="activity-row"><div style="flex:1">' +
          '<div class="activity-title">' + GCR.esc(won ? "Victory" : "Defeat") + " vs " +
          GCR.esc(x.challenger_name === pl.displayName ? x.opponent_name : x.challenger_name) + "</div>" +
          '<div class="activity-meta">' + GCR.when(x.created_at) + "</div></div>" +
          '<span class="chip ' + (won ? "ok" : "bad") + '">' + (won ? "Win" : "Loss") + "</span></div>";
      }).join("") + "</div>"
    : "";

  return '<div class="page-head">' +
      '<div class="page-eyebrow">Player profile</div>' +
      '<div class="page-title">' + GCR.esc(pl.avatar) + " " + GCR.esc(pl.displayName) + "</div>" +
      '<div class="page-sub">' + (pl.district ? GCR.esc(pl.district.name) : "Location private") +
        " · Age " + pl.age + " · Joined " + GCR.date(pl.createdAt) + "</div>" +
    "</div>" +
    '<div class="card" style="margin-bottom:16px">' +
      '<div class="stat-grid" style="grid-template-columns:repeat(2,1fr)">' +
        profileStat("Fame", Number(pl.fame).toLocaleString()) +
        profileStat("Reputation", pl.reputation) +
        profileStat("Acting skill", pl.actingSkill) +
        profileStat("Charm", pl.charm) +
        profileStat("Duels", pl.duelWins + "W / " + pl.duelLosses + "L") +
        profileStat("Balance", pl.money === null ? "Private" : GCR.money(pl.money)) +
      "</div>" +
      '<div class="btn-row" style="margin-top:14px">' +
        (isMe ? "" : friendAction) +
        (isMe ? "" : '<button class="btn ghost" onclick="gcrPrefillTransfer(\'' + pl.id + '\',\'' + GCR.esc(pl.displayName).replace(/'/g, "") + '\')">Send money</button>') +
        (isMe ? "" : '<button class="btn ghost" onclick="gcrChallenge(\'' + pl.id + '\')">Challenge to duel</button>') +
        '<button class="btn ghost" onclick="switchView(\'players\')">Back</button>' +
      "</div>" +
    "</div>" +
    businesses + achievements + duelRecord +
    '<div class="notice neutral">Email addresses, tokens and account records are never part of a public profile. ' +
    "Duels only resolve in non-safe districts and are rate-limited.</div>";
}

window.VIEWS.player = viewPlayer;
