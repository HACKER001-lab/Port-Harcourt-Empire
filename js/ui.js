/* ============================================================
   NAVIGATION + THEME SHELL
   Replaces the 20-button bottom bar with five primary tabs and a
   grouped "All destinations" sheet.
   ============================================================ */

window.VIEWS = window.VIEWS || {};

const PRIMARY_NAV = [
  { id: "home", label: "Home", icon: "⌂" },
  { id: "city", label: "City", icon: "◈" },
  { id: "activities", label: "Time", icon: "◔" },
  { id: "arena", label: "Arena", icon: "✦" },
  { id: "more", label: "More", icon: "⋯" }
];

const NAV_GROUPS = [
  {
    title: "Work & study",
    items: [
      { id: "school", label: "School", icon: "🎓" },
      { id: "jobs", label: "Acting work", icon: "🎬" },
      { id: "auditions", label: "Auditions", icon: "🎭" },
      { id: "agency", label: "Agency", icon: "💼" }
    ]
  },
  {
    title: "City & travel",
    items: [
      { id: "travel", label: "Travel (classic)", icon: "✈️" },
      { id: "church", label: "Church", icon: "⛪" }
    ]
  },
  {
    title: "Social life",
    items: [
      { id: "meet", label: "Meet people", icon: "👥" },
      { id: "love", label: "Love", icon: "❤️" },
      { id: "family", label: "Family", icon: "👨‍👩‍👧" },
      { id: "rivals", label: "Rivals", icon: "⚔️" },
      { id: "press", label: "Press", icon: "📸" },
      { id: "social", label: "Social feed", icon: "📣" }
    ]
  },
  {
    title: "Money & property",
    items: [
      { id: "houses", label: "Housing", icon: "🏘️" },
      { id: "luxury", label: "Luxury", icon: "💎" },
      { id: "life", label: "Lifestyle", icon: "💆" }
    ]
  },
  {
    title: "Devices",
    items: [
      { id: "phone", label: "Phone", icon: "📱" },
      { id: "laptop", label: "Laptop", icon: "💻" },
      { id: "wardrobe", label: "Wardrobe", icon: "👗" }
    ]
  },
  {
    title: "Online city",
    items: [
      { id: "players", label: "Players", icon: "🫂" },
      { id: "businesses", label: "Businesses", icon: "🏪" },
      { id: "wallet", label: "Wallet", icon: "🏦" }
    ]
  },
  {
    title: "Legacy & account",
    items: [
      { id: "awards", label: "Awards", icon: "🏆" },
      { id: "hof", label: "Legacy", icon: "👑" },
      { id: "account", label: "Account", icon: "⚙️" }
    ]
  }
];

const SECONDARY_NAV = NAV_GROUPS.reduce(function (acc, g) { return acc.concat(g.items); }, []);

function openMoreMenu() {
  var html = '<div class="page-title">All destinations</div>' +
    '<div class="page-sub" style="margin-bottom:16px">Every part of the game, grouped.</div>';

  NAV_GROUPS.forEach(function (group) {
    html += '<div style="margin-top:16px">' +
      '<div class="page-eyebrow">' + group.title + '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">' +
      group.items.map(function (item) {
        return '<button class="btn ghost" style="justify-content:flex-start;text-align:left;padding:10px 12px;font-size:12px" ' +
          'onclick="closeModal();switchView(\'' + item.id + '\')">' +
          '<span style="margin-right:6px">' + item.icon + '</span>' + item.label + '</button>';
      }).join('') +
      '</div></div>';
  });

  /* Administration is only offered to a verified administrator session.
     The server still enforces the role on every call. */
  if (typeof GCR !== "undefined" && GCR.isAdmin && GCR.isAdmin()) {
    html += '<div style="margin-top:16px">' +
      '<div class="page-eyebrow">Operations</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">' +
      '<button class="btn ghost" style="justify-content:flex-start;text-align:left;padding:10px 12px;font-size:12px" ' +
      'onclick="closeModal();switchView(\'admin\')"><span style="margin-right:6px">🛡️</span>Administration</button>' +
      '</div></div>';
  }

  html += '<div class="btn-row" style="margin-top:20px">' +
    '<button class="btn ghost" onclick="closeModal()">Close</button></div>';

  openModal(html);
}

/* ---- theme ---- */
function currentTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}
function toggleTheme() {
  var next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try { localStorage.setItem("gcr-theme", next); } catch (e) {}
  if (typeof window.__refreshThemeButtons === "function") window.__refreshThemeButtons();
  if (typeof render === "function" && state && state.player && state.player.name) render();
}

window.__refreshThemeButtons = function () {
  var label = currentTheme() === "dark" ? "☀ Light" : "☾ Dark";
  document.querySelectorAll("[data-theme-toggle]").forEach(function (el) {
    el.textContent = label;
  });
};

/* Restore saved theme preference (dark is opt-in; light is the default). */
(function restoreTheme() {
  var saved = null;
  try { saved = localStorage.getItem("gcr-theme"); } catch (e) {}
  document.documentElement.setAttribute("data-theme", saved === "dark" ? "dark" : "light");
})();

document.addEventListener("DOMContentLoaded", function () {
  window.__refreshThemeButtons();

  /* Separate administration route — never linked from player navigation. */
  if (location.hash === "#admin" && typeof switchView === "function") {
    switchView("admin");
  }
});
