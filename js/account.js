/* ============================================================
   LOCAL STORY SAVE UTILITIES
   The account and administration screens now live in js/auth.js and
   js/admin.js and talk to the real API. This file keeps only the
   browser-save helpers the solo story uses.
   ============================================================ */

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
