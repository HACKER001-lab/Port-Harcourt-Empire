/* ============================================================
   GAME TIME & ACTIVITIES
   A single adapter the whole UI reads time from.

   Mode "local" is what ships today: the clock derives from the save.
   When the multiplayer backend lands, `GameClock.mode` becomes
   "server" and `now()` / `activities()` read server-settled values.
   No reward is paid from a client countdown anywhere in this module —
   it only reports existing, already-settled game state.
   ============================================================ */

window.VIEWS = window.VIEWS || {};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const GameClock = {
  mode: "local",

  now: function () {
    var rt = state.realTime || {};
    var day = rt.gameDay || 1;
    var hour = rt.gameHour || 0;
    var minute = rt.gameMinute || 0;
    return {
      weekday: WEEKDAYS[(day - 1) % 7],
      gameDay: day,
      time: String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0"),
      week: state.player.week || 0,
      age: state.player.age || 1,
      source: this.mode
    };
  },

  /* Milliseconds until the next in-game day at the current local pace. */
  msToNextDay: function () {
    var perDay = (typeof REAL_MS_PER_GAME_HOUR === "number" ? REAL_MS_PER_GAME_HOUR : 5000) * 24;
    var last = (state.realTime && state.realTime.lastTick) || Date.now();
    var elapsed = Math.max(0, Date.now() - last);
    return Math.max(0, perDay - (elapsed % perDay));
  },

  /* Everything currently in progress, with how far along it is. */
  activities: function () {
    var list = [];
    var p = state.player;

    if (state.activeJob && state.activeJob.film) {
      var film = state.activeJob.film;
      var done = state.activeJob.dayProgress || 0;
      var total = film.days || 1;
      list.push({
        icon: "🎬",
        title: "Filming — " + film.title,
        status: "In production",
        statusKind: "warn",
        detail: "Day " + done + " of " + total + " · pays " + fmtN(film.pay || 0),
        progress: Math.min(100, Math.round((done / total) * 100))
      });
    }

    var stage = typeof currentStage === "function" ? currentStage() : null;
    if (stage && stage.id !== "none" && stage.id !== "graduated") {
      list.push({
        icon: "🎓",
        title: stage.label,
        status: "Enrolled",
        statusKind: "info",
        detail: fmtN(stage.costPerWeek) + " / week · " + Math.round(p.schoolProgress || 0) + "% complete",
        progress: Math.round(p.schoolProgress || 0)
      });
    }

    if (p.pregnant) {
      var weeks = Math.max(0, (p.week || 0) - (p.pregnancyStartWeek || 0));
      list.push({
        icon: "🤰",
        title: "Pregnancy",
        status: "Week " + weeks + " of 40",
        statusKind: "info",
        detail: "Due in about " + Math.max(0, 40 - weeks) + " weeks of game time",
        progress: Math.min(100, Math.round((weeks / 40) * 100))
      });
    }

    if (p.voiceOverContracts && p.voiceOverContracts.length) {
      list.push({
        icon: "🎙️",
        title: "Voice-over work",
        status: p.voiceOverContracts.length + " active",
        statusKind: "warn",
        detail: "See Phone → Studio for each contract",
        progress: null
      });
    }

    if (p.energy < 40) {
      list.push({
        icon: "🛌",
        title: "Recovery needed",
        status: "Low energy",
        statusKind: "bad",
        detail: "Energy " + Math.round(p.energy) + "% — rest, eat out or take a holiday",
        progress: Math.round(p.energy)
      });
    }

    return list;
  }
};

function viewActivities() {
  var clock = GameClock.now();
  var items = GameClock.activities();
  var p = state.player;
  var secs = Math.ceil(GameClock.msToNextDay() / 1000);

  var html =
    '<div class="page-head">' +
      '<div class="page-eyebrow">World clock</div>' +
      '<div class="page-title">Time &amp; activities</div>' +
      '<div class="page-sub">Game time in the Garden City and everything you currently have running.</div>' +
    '</div>' +

    '<div class="card" style="margin-bottom:16px">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">' +
        '<div>' +
          '<div class="page-eyebrow">' + clock.weekday + ' · Week ' + clock.week + ' · Age ' + clock.age + '</div>' +
          '<div style="font-family:Georgia,serif;font-size:38px;line-height:1.1;color:var(--text)">' + clock.time + '</div>' +
        '</div>' +
        '<span class="chip ' + (clock.source === "server" ? "ok" : "warn") + '">' +
          (clock.source === "server" ? "Server clock" : "Local preview clock") +
        '</span>' +
      '</div>' +
      '<div class="stat-grid" style="margin-top:16px">' +
        '<div class="stat-tile"><div class="k">Next day in</div><div class="v">' + secs + 's</div></div>' +
        '<div class="stat-tile"><div class="k">Energy</div><div class="v">' + Math.round(p.energy) + '%</div></div>' +
        '<div class="stat-tile"><div class="k">Active</div><div class="v">' + items.length + '</div></div>' +
      '</div>' +
      '<div class="btn-row" style="margin-top:14px">' +
        '<button class="btn ghost" onclick="render()">Refresh</button>' +
        '<button class="btn ghost" onclick="switchView(\'home\')">Close-up</button>' +
      '</div>' +
    '</div>' +

    '<div class="card" style="margin-bottom:16px">' +
      '<div class="card-title">In progress</div>' +
      '<div class="card-sub">Scheduled work, study and travel.</div>' +
      (items.length ? items.map(activityRowHtml).join("") :
        '<div class="notice neutral">Nothing is scheduled right now. Take on a film, enrol in school or train at the arena.</div>') +
    '</div>' +

    '<div class="card">' +
      '<div class="card-title">How time will work</div>' +
      '<div class="card-sub">Preparation for the persistent world clock.</div>' +
      '<div class="notice warn">' +
        '<div><strong>Preview clock.</strong> Time currently advances in this browser from your save. When accounts ship, ' +
        'game time is owned by the server, offline progress is settled in the database, and completion is validated ' +
        'server-side — never by a countdown on this page.</div>' +
      '</div>' +
    '</div>';

  return html;
}

function activityRowHtml(item) {
  return '<div class="activity-row">' +
    '<div class="activity-icon">' + item.icon + '</div>' +
    '<div class="activity-body">' +
      '<div class="activity-title">' + escHtml(item.title) + '</div>' +
      '<div class="activity-meta">' + escHtml(item.detail) + '</div>' +
      (item.progress === null ? "" : '<div class="progress"><i style="width:' + item.progress + '%"></i></div>') +
    '</div>' +
    '<span class="chip ' + item.statusKind + '">' + escHtml(item.status) + '</span>' +
  '</div>';
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, function (m) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m];
  });
}

window.VIEWS.activities = viewActivities;
