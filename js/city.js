/* ============================================================
   CITY MAP — data-driven, fictionalised Port Harcourt
   Adding another city means adding another entry to CITY_DATA:
   districts carry their own positions, venues and links, so no
   new rendering code is needed.
   ============================================================ */

window.VIEWS = window.VIEWS || {};

const CITY_DATA = {
  "port-harcourt": {
    id: "port-harcourt",
    name: "Port Harcourt",
    eyebrow: "Garden City · Rivers State",
    note: "District positions are stylised for gameplay. They are not surveyed boundaries, and the venues are fictional unless stated otherwise.",
    districts: [
      {
        id: "mile3-market", name: "Mile 3 Market", glyph: "🏪", x: 12, y: 26,
        venues: [
          { name: "Mile 3 Market", kind: "Trading & clothing", icon: "🧺", view: "wardrobe" },
          { name: "Transport hub", kind: "Buses and keke", icon: "🚌", view: "travel" },
          { name: "Street food row", kind: "Cheap food", icon: "🍲", view: "life" }
        ]
      },
      {
        id: "rumuola", name: "Rumuola", glyph: "🏘️", x: 130, y: 26,
        venues: [
          { name: "Residential estates", kind: "Housing", icon: "🏠", view: "houses" },
          { name: "Neighbourhood gym", kind: "Training", icon: "🥊", view: "arena" },
          { name: "Pharmacy", kind: "Health", icon: "💊", view: "life" }
        ]
      },
      {
        id: "choba-uni", name: "Choba / University", glyph: "🎓", x: 248, y: 26,
        venues: [
          { name: "University campus", kind: "Education", icon: "🎓", view: "school" },
          { name: "Student union", kind: "Meet people", icon: "👥", view: "meet" },
          { name: "Campus studio", kind: "Auditions", icon: "🎭", view: "auditions" }
        ]
      },
      {
        id: "diobu", name: "Diobu / Mile 1", glyph: "🏚️", x: 12, y: 136,
        venues: [
          { name: "Family home", kind: "Family", icon: "👨‍👩‍👧", view: "family" },
          { name: "Street corner", kind: "Meet people", icon: "👥", view: "meet" },
          { name: "Mechanic workshop", kind: "Lifestyle", icon: "🔧", view: "life" }
        ]
      },
      {
        id: "old-gra", name: "Old GRA & Centre", glyph: "🏛️", x: 130, y: 136,
        venues: [
          { name: "City hall", kind: "Press & public life", icon: "📸", view: "press" },
          { name: "Business tower", kind: "Work", icon: "💼", view: "jobs" },
          { name: "Grand hotel", kind: "Luxury", icon: "💎", view: "luxury" }
        ]
      },
      {
        id: "trans-amadi", name: "Trans-Amadi", glyph: "🏭", x: 248, y: 136,
        venues: [
          { name: "Industrial park", kind: "Work", icon: "🏭", view: "jobs" },
          { name: "Logistics yard", kind: "Travel", icon: "🚚", view: "travel" },
          { name: "Works canteen", kind: "Lifestyle", icon: "🍛", view: "life" }
        ]
      },
      {
        id: "borokiri", name: "Borokiri Waterfront", glyph: "⚓", x: 12, y: 250,
        venues: [
          { name: "Waterfront pier", kind: "River travel", icon: "⛴️", view: "travel" },
          { name: "Fish market", kind: "Housing & trade", icon: "🐟", view: "houses" },
          { name: "Waterfront chapel", kind: "Church", icon: "⛪", view: "church" }
        ]
      },
      {
        id: "entertainment", name: "Entertainment Strip", glyph: "🎭", x: 130, y: 250,
        venues: [
          { name: "Film studio", kind: "Auditions", icon: "🎬", view: "auditions" },
          { name: "Arena & gym", kind: "Fight training", icon: "✦", view: "arena" },
          { name: "Nightclub", kind: "Press & social", icon: "🎶", view: "press" }
        ]
      },
      {
        id: "airport-road", name: "Airport Road", glyph: "✈️", x: 248, y: 250,
        venues: [
          { name: "Airport", kind: "Travel out of town", icon: "✈️", view: "travel" },
          { name: "Casino lounge", kind: "Phone → betting", icon: "🎲", view: "phone" },
          { name: "Hotel lounge", kind: "Dating", icon: "🥂", view: "love" }
        ]
      }
    ],
    routes: [
      ["mile3-market", "rumuola"], ["rumuola", "choba-uni"],
      ["diobu", "old-gra"], ["old-gra", "trans-amadi"],
      ["borokiri", "entertainment"], ["entertainment", "airport-road"],
      ["mile3-market", "diobu"], ["rumuola", "old-gra"], ["choba-uni", "trans-amadi"],
      ["diobu", "borokiri"], ["old-gra", "entertainment"], ["trans-amadi", "airport-road"],
      ["borokiri", "old-gra"], ["mile3-market", "old-gra"]
    ]
  }
};

/* A second city as proof the shape scales; not yet reachable in play. */
const CITY_PLACEHOLDERS = [{ id: "lagos", name: "Lagos", eyebrow: "Island & mainland", status: "planned" }];

let selectedDistrict = null;

function activeCity() {
  return CITY_DATA["port-harcourt"];
}

function ensureCityState() {
  if (!state.player.district) state.player.district = "old-gra";
  const city = activeCity();
  if (!city.districts.some(d => d.id === state.player.district)) {
    state.player.district = "old-gra";
  }
}

/* The signed-in character's district is authoritative on the server. This maps
   it to the map's slug so the shared location is what the map highlights. */
function onlineDistrictSlug() {
  if (typeof GCR === "undefined" || !GCR.signedIn || !GCR.signedIn()) return null;
  var c = GCR.character();
  var w = GCR.world && GCR.world.data;
  if (!c || !w) return null;
  var d = w.districts.find(function (x) { return x.id === c.districtId; });
  return d ? d.slug : null;
}

function districtById(id) {
  return activeCity().districts.find(d => d.id === id);
}

function districtCentre(d) {
  return { x: d.x + 50, y: d.y + 36 };
}

function seatDistance(aId, bId) {
  const a = districtById(aId), b = districtById(bId);
  if (!a || !b) return 0;
  const pa = districtCentre(a), pb = districtCentre(b);
  return Math.round(Math.sqrt(Math.pow(pa.x - pb.x, 2) + Math.pow(pa.y - pb.y, 2)));
}

function fareTo(dId) {
  var rules = (typeof GCR !== "undefined" && GCR.world && GCR.world.data) ? GCR.world.data.rules : null;
  var base = rules ? rules.travelBaseFare : 120;
  var per = rules ? rules.travelFarePerUnit : 12;
  return base + seatDistance(state.player.district, dId) * per;
}

function cityMapSvg() {
  const city = activeCity();
  const here = state.player.district;

  const routes = city.routes.map(function (pair) {
    const a = districtById(pair[0]), b = districtById(pair[1]);
    if (!a || !b) return "";
    const pa = districtCentre(a), pb = districtCentre(b);
    return '<line class="route" x1="' + pa.x + '" y1="' + pa.y + '" x2="' + pb.x + '" y2="' + pb.y + '"/>';
  }).join("");

  const districts = city.districts.map(function (d) {
    const active = selectedDistrict === d.id;
    const isHere = here === d.id;
    return '<g class="district' + (active ? " active" : "") + '" role="button" tabindex="0" ' +
      'aria-label="' + d.name + '" onclick="selectDistrict(\'' + d.id + '\')">' +
      '<title>' + d.name + (isHere ? " (you are here)" : "") + '</title>' +
      '<rect x="' + d.x + '" y="' + d.y + '" width="100" height="72" rx="10"/>' +
      '<text class="glyph" x="' + (d.x + 50) + '" y="' + (d.y + 30) + '">' + d.glyph + '</text>' +
      '<text x="' + (d.x + 50) + '" y="' + (d.y + 48) + '">' + d.name.split(" / ")[0] + '</text>' +
      (isHere ? '<text x="' + (d.x + 50) + '" y="' + (d.y + 61) + '" style="font-size:8px;fill:#146b57">● here</text>' : "") +
      '</g>';
  }).join("");

  return '<svg class="map-svg" viewBox="0 0 360 470" role="img" aria-label="Map of Port Harcourt districts">' +
    '<rect class="land" x="0" y="0" width="360" height="470" rx="12"/>' +
    '<path class="water" d="M0 352 H360 V470 H0 Z"/>' +
    '<path class="water" d="M110 352 C104 300 112 240 108 190 L124 190 C128 250 118 300 126 352 Z"/>' +
    '<text x="180" y="400" style="font-family:Inter,sans-serif;font-size:9px;fill:#6b8b9b;letter-spacing:.16em">BONNY RIVER CREEKS</text>' +
    routes + districts +
    '</svg>';
}

function viewCity() {
  const shared = onlineDistrictSlug();
  ensureCityState();
  if (shared) state.player.district = shared;
  if (typeof GCR !== "undefined" && GCR.signedIn && GCR.signedIn() && !GCR.world.data) {
    GCR.loadWorld().then(function () { GCR.reload(); });
  }
  const city = activeCity();
  if (!selectedDistrict || !districtById(selectedDistrict)) selectedDistrict = state.player.district;
  const district = districtById(selectedDistrict);
  const here = state.player.district === district.id;
  const fare = fareTo(district.id);

  const venues = district.venues.map(function (v) {
    return '<div class="venue-row">' +
      '<div class="venue-icon">' + v.icon + '</div>' +
      '<div style="flex:1;min-width:0">' +
        '<div class="venue-name">' + v.name + '</div>' +
        '<div class="venue-kind">' + v.kind + '</div>' +
      '</div>' +
      '<button class="btn ghost sm" onclick="switchView(\'' + v.view + '\')">Open</button>' +
    '</div>';
  }).join("");

  return '' +
    '<div class="page-head">' +
      '<div class="page-eyebrow">' + city.eyebrow + '</div>' +
      '<div class="page-title">' + city.name + '</div>' +
      '<div class="page-sub">Tap a district to see its venues. Travel costs a fare and drains a little energy.</div>' +
    '</div>' +

    '<div class="map-frame" style="margin-bottom:16px">' + cityMapSvg() + '</div>' +

    '<div class="card" style="margin-bottom:16px">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">' +
        '<div>' +
          '<div class="page-eyebrow">District</div>' +
          '<div class="card-title" style="margin-bottom:2px">' + district.name + '</div>' +
          '<div class="card-sub" style="margin-bottom:0">' +
            (here ? "You are currently here." : seatDistance(state.player.district, district.id) + " map units away") +
          '</div>' +
        '</div>' +
        (here ? '<span class="chip ok">You are here</span>' : '<span class="chip warn">Fare ' + fmtN(fare) + '</span>') +
      '</div>' +

      '<div style="margin-top:8px">' + venues + '</div>' +

      '<div class="btn-row" style="margin-top:14px">' +
        (here
          ? '<button class="btn ghost" disabled>Already here</button>'
          : '<button class="btn" onclick="travelToDistrict(\'' + district.id + '\')">Travel to ' + district.name + ' · ' + fmtN(fare) + '</button>') +
      '</div>' +
      (shared
        ? '<div class="notice neutral" style="margin-top:12px">Your shared-world location is stored on the server. Fares, energy and travel timing are validated there.</div>' +
          '<div class="btn-row" style="margin-top:8px">' +
            '<button class="btn ghost sm" onclick="switchView(\'businesses\')">Player businesses here</button>' +
            '<button class="btn ghost sm" onclick="switchView(\'players\')">Players here</button>' +
          '</div>'
        : "") +
    '</div>' +

    '<div class="card">' +
      '<div class="card-title">City expansion</div>' +
      '<div class="card-sub">The map is data-driven — each city is a set of districts, venues and routes.</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
        '<span class="chip ok">Port Harcourt · live</span>' +
        CITY_PLACEHOLDERS.map(c => '<span class="chip">' + c.name + ' · planned</span>').join("") +
      '</div>' +
      '<div class="notice neutral" style="margin-top:12px">' + city.note + '</div>' +
    '</div>';
}

function selectDistrict(id) {
  selectedDistrict = id;
  render();
}

async function travelToDistrict(id) {
  ensureCityState();
  if (id === state.player.district) { toast("You are already there.", "warn"); return; }

  /* Signed in: the server decides the fare, the energy cost and whether the
     move is allowed. The client only asks. */
  if (typeof GCR !== "undefined" && GCR.signedIn && GCR.signedIn()) {
    try {
      const world = await GCR.loadWorld();
      const target = world && world.districts.find(function (d) { return d.slug === id; });
      if (!target) { toast("That district is not part of the shared world.", "warn"); return; }
      const res = await GCR.api("/actions/travel", { method: "POST", body: { districtId: target.id } });
      GCR.applyCharacter(res.character);
      state.player.district = id;
      selectedDistrict = id;
      toast("Arrived in " + res.district.name + " · fare " + GCR.money(res.fare) + ".", "success");
      GCR.reload();
    } catch (e) {
      GCR.fail(e);
    }
    return;
  }

  const fare = fareTo(id);
  if (state.player.money < fare) { toast("Not enough money for the fare.", "warn"); return; }
  if (state.player.energy < 3) { toast("Too tired to travel. Rest first.", "warn"); return; }

  const target = districtById(id);
  state.player.money -= fare;
  state.player.energy = clamp(state.player.energy - 3, 0, 100);
  state.player.district = id;
  logEvent("🚕 Travelled to " + target.name + " (" + fmtN(fare) + ").");
  toast("Arrived in " + target.name + ".", "success");
  selectedDistrict = id;
  save();
  render();
}

window.VIEWS.city = viewCity;
