/* ============================================================
   BRANDING CONFIGURATION — single source of truth for the game's
   public identity (display name, wordmark, tagline, metadata).

   Change ACTIVE_PRESET below, or call setBrandPreset('reign') /
   setBrandPreset('legacy') from the browser console to preview an
   identity without editing the rest of the codebase.

   NOTE: "Garden City: Reign" is a WORKING TITLE, not a final name.
   ============================================================ */
(function () {
  "use strict";

  var PRESETS = {
    /* Identity the game currently ships under. */
    legacy: {
      displayName: "TAMUNOIYANA",
      logoLetter: "T",
      taglineShort: "Garden City Stardom",
      taglineLine: "Garden City Stardom \u00b7 Port Harcourt",
      metaDescription:
        "TAMUNOIYANA \u2014 Garden City Stardom. A Port Harcourt life simulation: grow up, build fame, fortune and family in the Garden City.",
      themeColor: "#05060d",
      theme: "dark",
      workingTitle: false
    },

    /* Redesign working title. Not final; swap the values here when a
       name is chosen and every other file follows. */
    reign: {
      displayName: "GARDEN CITY: REIGN",
      logoLetter: "G",
      taglineShort: "Reign in the Garden City",
      taglineLine: "A Nigerian City-Life Simulation \u00b7 Port Harcourt",
      metaDescription:
        "Garden City: Reign \u2014 a Nigerian multiplayer city-life simulation. Build a life, a business and a legacy in a living Port Harcourt.",
      themeColor: "#0f766e",
      theme: "light",
      workingTitle: true
    }
  };

  var ACTIVE_PRESET = "legacy";

  function setMetaTag(name, content) {
    var el = document.querySelector('meta[name="' + name + '"]');
    if (!el) {
      el = document.createElement("meta");
      el.setAttribute("name", name);
      document.head.appendChild(el);
    }
    el.setAttribute("content", content);
  }

  function applyBranding() {
    var b = window.BRAND;

    document.title = b.displayName + " \u2014 " + b.taglineShort;
    setMetaTag("description", b.metaDescription);
    setMetaTag("theme-color", b.themeColor);
    if (b.workingTitle) setMetaTag("x-game-status", "working-title");
    document.documentElement.dataset.theme = b.theme;

    document.querySelectorAll('[data-brand="letter"]').forEach(function (el) {
      el.textContent = b.logoLetter;
    });
    document.querySelectorAll('[data-brand="name"]').forEach(function (el) {
      el.textContent = b.displayName;
    });
    document.querySelectorAll('[data-brand="tagline-short"]').forEach(function (el) {
      el.textContent = b.taglineShort;
    });
    document.querySelectorAll('[data-brand="tagline-line"]').forEach(function (el) {
      el.textContent = b.taglineLine;
    });
  }

  window.BRAND_PRESETS = PRESETS;
  window.BRAND = Object.assign({ activePreset: ACTIVE_PRESET }, PRESETS[ACTIVE_PRESET]);
  window.setBrandPreset = function (name) {
    if (!PRESETS[name]) {
      console.warn("Unknown brand preset:", name, "Available:", Object.keys(PRESETS));
      return;
    }
    window.BRAND = Object.assign({ activePreset: name }, PRESETS[name]);
    applyBranding();
  };
  window.applyBranding = applyBranding;

  applyBranding();
})();
