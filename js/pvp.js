/* ============================================================
   ARENA — training and combat progression

   Everything here mutates real state and is reflected in the save:
   training costs money and energy and raises a stat immediately;
   sparring resolves from stats and writes a result to the record.
   No button is decorative and no outcome is decided by a countdown.

   NOTE: resolution is local while the game is single-player. With
   accounts, the same actions must be validated and resolved on the
   server (see docs/ARCHITECTURE.md §7).
   ============================================================ */

window.VIEWS = window.VIEWS || {};

const TRAINING_PLANS = [
  { id: "power", label: "Strength drills", stat: "power", gain: 3, cost: 1200, energy: 12, detail: "Raw force behind every strike." },
  { id: "technique", label: "Technique lab", stat: "technique", gain: 3, cost: 1800, energy: 10, detail: "Footwork, timing and defence." },
  { id: "stamina", label: "Conditioning", stat: "stamina", gain: 3, cost: 900, energy: 14, detail: "Keeps you standing in later rounds." }
];

function ensureCombat() {
  if (!state.combat) {
    state.combat = { power: 18, technique: 16, stamina: 20, points: 0, wins: 0, losses: 0, history: [] };
  }
  const c = state.combat;
  ["power", "technique", "stamina", "points", "wins", "losses"].forEach(function (k) {
    if (typeof c[k] !== "number") c[k] = 0;
  });
  if (!Array.isArray(c.history)) c.history = [];
}

function gearBonus() {
  const eq = (state.player && state.player.equipped) || {};
  return Object.keys(eq).filter(function (k) { return !!eq[k]; }).length * 3;
}

function combatRating() {
  const c = state.combat;
  return Math.round(c.power * 0.5 + c.technique * 0.3 + c.stamina * 0.2 + gearBonus());
}

function combatTier() {
  const pts = state.combat.points;
  if (pts >= 160) return "Legend";
  if (pts >= 80) return "Gold";
  if (pts >= 30) return "Silver";
  return "Bronze";
}

function trainingPlan(id) {
  return TRAINING_PLANS.find(p => p.id === id);
}

function doTraining(id) {
  ensureCombat();
  const plan = trainingPlan(id);
  if (!plan) return;
  if (state.player.money < plan.cost) { toast("Need " + fmtN(plan.cost) + " for that session.", "warn"); return; }
  if (state.player.energy < plan.energy) { toast("Not enough energy — rest first.", "warn"); return; }

  state.player.money -= plan.cost;
  state.player.energy = clamp(state.player.energy - plan.energy, 0, 100);
  state.combat[plan.stat] += plan.gain;
  state.combat.history.unshift({
    type: "Training",
    label: plan.label,
    result: "+" + plan.gain + " " + plan.stat,
    week: state.player.week,
    age: state.player.age
  });
  state.combat.history = state.combat.history.slice(0, 12);
  logEvent("🥊 " + plan.label + " — " + plan.stat + " is now " + state.combat[plan.stat] + ".");
  toast(plan.label + ": +" + plan.gain + " " + plan.stat + ".", "success");
  save();
  render();
}

function sparringOpponents() {
  if ((!Array.isArray(state.rivals) || !state.rivals.length) && typeof ensureRivals === "function") {
    ensureRivals();
  }
  const rivals = Array.isArray(state.rivals) && state.rivals.length ? state.rivals : [];
  return rivals.slice(0, 4).map(function (r) {
    return { name: r.name, rating: 16 + Math.round((r.fame || 100) / 40) };
  });
}

function sparWith(index) {
  ensureCombat();
  const opponents = sparringOpponents();
  const opp = opponents[index] || sparringOpponents()[0];
  if (!opp) { toast("No opponent available yet.", "warn"); return; }
  if (state.player.energy < 10) { toast("Not enough energy to spar.", "warn"); return; }
  if (state.player.money < 500) { toast("Sparring entry is ₦500.", "warn"); return; }

  const mine = combatRating() + (Math.random() * 20 - 10);
  const theirs = opp.rating + (Math.random() * 20 - 10);
  const won = mine >= theirs;

  state.player.money -= 500;
  state.player.energy = clamp(state.player.energy - 10, 0, 100);

  if (won) {
    state.combat.wins += 1;
    state.combat.points += 10;
    state.player.fame += 1;
    state.player.money += 1700; // purse
    toast("🥊 Beat " + opp.name + " — purse " + fmtN(1700) + ".", "success");
  } else {
    state.combat.losses += 1;
    state.combat.points = Math.max(0, state.combat.points - 5);
    toast("Lost to " + opp.name + ". Back to the gym.", "warn");
  }

  state.combat.history.unshift({
    type: "Sparring",
    label: opp.name,
    result: won ? "Win" : "Loss",
    week: state.player.week,
    age: state.player.age
  });
  state.combat.history = state.combat.history.slice(0, 12);
  logEvent((won ? "🏆 Sparring win" : "🥀 Sparring loss") + " against " + opp.name + ".");
  save();
  render();
}

function rankingsRows() {
  ensureCombat();
  const rows = sparringOpponents().map(function (o) {
    return { name: o.name, rating: o.rating, you: false };
  });
  rows.push({ name: state.player.name + " (you)", rating: combatRating(), you: true });
  rows.sort(function (a, b) { return b.rating - a.rating; });
  return rows;
}

function viewArena() {
  ensureCombat();
  const c = state.combat;

  const plans = TRAINING_PLANS.map(function (p) {
    const affordable = state.player.money >= p.cost && state.player.energy >= p.energy;
    return '<div class="activity-row">' +
      '<div class="activity-icon">🥊</div>' +
      '<div class="activity-body">' +
        '<div class="activity-title">' + p.label + '</div>' +
        '<div class="activity-meta">+' + p.gain + ' ' + p.stat + ' · ' + fmtN(p.cost) + ' · −' + p.energy + ' energy</div>' +
        '<div class="activity-meta">' + p.detail + '</div>' +
      '</div>' +
      '<button class="btn sm" ' + (affordable ? '' : 'disabled ') + 'onclick="doTraining(\'' + p.id + '\')">Train</button>' +
    '</div>';
  }).join("");

  const opponents = sparringOpponents();
  const sparButtons = opponents.length
    ? opponents.map(function (o, i) {
        return '<button class="btn ghost sm" onclick="sparWith(' + i + ')">vs ' + o.name + ' · ' + o.rating + '</button>';
      }).join("")
    : '<span class="chip">No opponents yet</span>';

  const rankings = rankingsRows().map(function (r, i) {
    return '<div class="rank-row' + (r.you ? " you" : "") + '">' +
      '<span class="rank-pos">' + (i + 1) + '</span>' +
      '<span class="rank-name">' + r.name + '</span>' +
      '<span class="rank-score">' + r.rating + '</span>' +
    '</div>';
  }).join("");

  const equippedCount = Object.keys((state.player && state.player.equipped) || {})
    .filter(function (k) { return !!state.player.equipped[k]; }).length;

  const history = c.history.length
    ? c.history.map(function (h) {
        return '<div class="rank-row">' +
          '<span class="rank-pos">' + (h.type === "Sparring" ? "⚔" : "🏋") + '</span>' +
          '<span class="rank-name">' + h.label + '</span>' +
          '<span class="rank-score">' + h.result + ' · wk ' + h.week + '</span>' +
        '</div>';
      }).join("")
    : '<div class="notice neutral">No fights yet. Train, then take a sparring bout.</div>';

  return '' +
    '<div class="page-head">' +
      '<div class="page-eyebrow">Arena</div>' +
      '<div class="page-title">Combat progression</div>' +
      '<div class="page-sub">Train your attributes, take sparring bouts and climb the local ladder.</div>' +
    '</div>' +

    '<div class="card" style="margin-bottom:16px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:14px">' +
        '<div>' +
          '<div class="page-eyebrow">Rating</div>' +
          '<div style="font-family:Georgia,serif;font-size:32px;color:var(--text)">' + combatRating() + '</div>' +
        '</div>' +
        '<span class="chip warn">' + combatTier() + ' tier · ' + c.points + ' pts</span>' +
      '</div>' +
      '<div class="stat-grid">' +
        '<div class="stat-tile"><div class="k">Power</div><div class="v">' + c.power + '</div></div>' +
        '<div class="stat-tile"><div class="k">Technique</div><div class="v">' + c.technique + '</div></div>' +
        '<div class="stat-tile"><div class="k">Stamina</div><div class="v">' + c.stamina + '</div></div>' +
        '<div class="stat-tile"><div class="k">Record</div><div class="v">' + c.wins + '–' + c.losses + '</div></div>' +
      '</div>' +
      '<div class="card-sub" style="margin:12px 0 0">Equipment bonus +' + gearBonus() +
        ' from ' + equippedCount + ' equipped piece' + (equippedCount === 1 ? '' : 's') +
        '. Visit the wardrobe to equip more.</div>' +
    '</div>' +

    '<div class="card" style="margin-bottom:16px">' +
      '<div class="card-title">Training</div>' +
      '<div class="card-sub">Each session takes effect immediately — money and energy are spent now.</div>' +
      plans +
    '</div>' +

    '<div class="card" style="margin-bottom:16px">' +
      '<div class="card-title">Sparring</div>' +
      '<div class="card-sub">₦500 entry, −10 energy. Win the bout and take a ₦1,700 purse and ranking points.</div>' +
      '<div class="btn-row">' + sparButtons + '</div>' +
    '</div>' +

    '<div class="card" style="margin-bottom:16px">' +
      '<div class="card-title">Local rankings</div>' +
      '<div class="card-sub">Sparring partners are the city rivals you already know.</div>' +
      rankings +
    '</div>' +

    '<div class="card">' +
      '<div class="card-title">Recent history</div>' +
      '<div class="card-sub">Last twelve training sessions and bouts.</div>' +
      history +
      '<div class="notice warn" style="margin-top:14px">' +
        '<div><strong>Single-player resolution.</strong> Bouts are settled in this browser from your stats. ' +
        'When accounts ship, match outcomes and rewards must be resolved and audited on the server — this screen ' +
        'stays the same, only the authority behind it changes.</div>' +
      '</div>' +
    '</div>';
}

window.VIEWS.arena = viewArena;
