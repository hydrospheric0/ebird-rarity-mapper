// Cloudflare Worker Backend
const WORKER_BASE_URL = 'https://ebird-rarity-mapper.bartwickel.workers.dev';

const map = L.map("map", {
  center: [37.25, -119.5],
  zoom: 7,
  zoomControl: false,
  zoomAnimation: true,
  fadeAnimation: true,
  markerZoomAnimation: true,
  zoomSnap: 0.25,
  zoomDelta: 0.5,
  wheelDebounceTime: 40,
  wheelPxPerZoomLevel: 180
});

const mapControls = document.querySelector(".map-controls");
if (mapControls) {
  L.DomEvent.disableClickPropagation(mapControls);
  L.DomEvent.disableScrollPropagation(mapControls);
  mapControls.addEventListener("mousedown", (event) => event.stopPropagation());
}

const baseTileOptions = {
  updateWhenIdle: false,
  updateWhenZooming: true,
  keepBuffer: 8
};


map.createPane("labelsPane");
map.getPane("labelsPane").style.zIndex = 430;
map.getPane("labelsPane").style.pointerEvents = "none";

const cartoLabels = L.tileLayer(
  "https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png",
  {
    ...baseTileOptions,
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
    subdomains: "abcd",
    maxZoom: 19,
    pane: "labelsPane"
  }
).addTo(map);

const esriWorldImagery = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  {
    ...baseTileOptions,
    attribution:
      "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics",
    maxZoom: 20
  }
);

const esriWorldTopo = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
  {
    ...baseTileOptions,
    attribution: "Tiles &copy; Esri",
    maxZoom: 18
  }
);

const esriWorldTerrain = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}",
  {
    ...baseTileOptions,
    attribution: "Tiles &copy; Esri",
    maxZoom: 13
  }
).addTo(map);

const openStreetMap = L.tileLayer(
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  {
    ...baseTileOptions,
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19
  }
);

const notReviewedLayer = L.layerGroup().addTo(map);
const acceptedLayer = L.layerGroup().addTo(map);
const abaLayer = L.layerGroup().addTo(map);

map.createPane("countiesPane");
map.getPane("countiesPane").style.zIndex = 460;
map.getPane("countiesPane").style.pointerEvents = "auto";
map.createPane("statesPane");
map.getPane("statesPane").style.zIndex = 470;
map.getPane("statesPane").style.pointerEvents = "none";
map.createPane("highResCountiesPane");
map.getPane("highResCountiesPane").style.zIndex = 480;
map.getPane("highResCountiesPane").style.pointerEvents = "auto";
map.createPane("countyLabelPane");
map.getPane("countyLabelPane").style.zIndex = 900;
map.getPane("countyLabelPane").style.pointerEvents = "none";
map.createPane("markersPane");
map.getPane("markersPane").style.zIndex = 520;
map.createPane("abaMarkersPane");
map.getPane("abaMarkersPane").style.zIndex = 700;

// Ensure tooltips and popups appear above all custom panes
if (map.getPane("tooltipPane")) {
  map.getPane("tooltipPane").style.zIndex = 9999;
}
if (map.getPane("popupPane")) {
  map.getPane("popupPane").style.zIndex = 9998;
}

const stateBaseStyle = {
  color: "#4b5563",
  weight: 2.4,
  opacity: 0.9,
  fillOpacity: 0
};

const stateLayer = L.geoJSON(null, {
  style: stateBaseStyle,
  pane: "statesPane",
  interactive: false
}).addTo(map);

const countyBaseStyle = {
  color: "#1f2937",
  weight: 1.4,
  opacity: 1,
  fillOpacity: 0.03
};

const countyLayer = L.geoJSON(null, {
  style: (feature) => getCountyStyle(feature),
  pane: "countiesPane",
  interactive: true,
  onEachFeature: (feature, layer) => {
    layer.on("click", () => toggleCountySelection(feature, layer));
  }
}).addTo(map);

const highResCountyLayer = L.geoJSON(null, {
  style: (feature) => getCountyStyle(feature),
  pane: "highResCountiesPane",
  interactive: true,
  onEachFeature: (feature, layer) => {
    layer.on("click", () => toggleCountySelection(feature, layer));
  }
});

const countyLabelLayer = L.layerGroup().addTo(map);

function ensureBoundaryVisibility() {
  const useHighRes = highResCountiesToggle && highResCountiesToggle.checked;
  const hasHighRes =
    highResCountyLayer && highResCountyLayer.getLayers().length > 0;
  const showHighRes = useHighRes && hasHighRes;
  setOverlay(stateLayer, true);
  setOverlay(countyLayer, !showHighRes);
  setOverlay(highResCountyLayer, showHighRes);
  if (showHighRes) {
    highResCountyLayer.bringToFront();
  } else {
    countyLayer.bringToFront();
  }
  stateLayer.bringToFront();
  if (selectedCountyLayer) {
    selectedCountyLayer.bringToFront();
  }
}

function applyBoundaryStyles() {
  stateLayer.setStyle(stateBaseStyle);
  countyLayer.setStyle(getCountyStyle);
  highResCountyLayer.setStyle(getCountyStyle);
}

function getCountyStyle(feature) {
  const id = feature?.id || feature?.properties?.id || null;
  const isSelected = selectedCountyId && id && id === selectedCountyId;
  if (isSelected) {
    return {
      ...countyBaseStyle,
      color: "#ef4444",
      weight: 1.8,
      opacity: 1,
      fillOpacity: 0.08
    };
  }
  return { ...countyBaseStyle };
}


[esriWorldImagery, esriWorldTerrain, esriWorldTopo, openStreetMap, cartoLabels].forEach(
  (layer) => {
    layer.on("load", () => ensureBoundaryVisibility());
  }
);

const baseLayers = {
  "Esri World Imagery": esriWorldImagery,
  "Esri World Terrain": esriWorldTerrain,
  "Esri World Topo": esriWorldTopo,
  "OpenStreetMap": openStreetMap
};

const overlayLayers = {
  Labels: cartoLabels,
  "US States": stateLayer,
  "US Counties": countyLayer,
  "Not reviewed": notReviewedLayer,
  Accepted: acceptedLayer,
  "ABA Rarities": abaLayer
};

// Layer control removed per UI request.

const daysInput = document.getElementById("daysBack");
const daysValue = document.getElementById("daysBackValue");
const regionSelect = document.getElementById("regionSelect");
const speciesSelect = document.getElementById("speciesSelect");
const refreshBtn = document.getElementById("refreshBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");
const sightingsBody = document.getElementById("sightingsBody");
const uniqueCountEl = document.getElementById("uniqueCount");
const abaSightingsBody = document.getElementById("abaSightingsBody");
const raritiesQueryEl = document.getElementById("raritiesQuery");
const abaQueryEl = document.getElementById("abaQuery");
const baseLayerRadios = document.querySelectorAll("input[name='basemap']");
const showCountyMap = document.getElementById("showCountyMap");
const showAbaMap = document.getElementById("showAbaMap");
const showSpeciesLabels = document.getElementById("showSpeciesLabels");
const abaCodeMin = document.getElementById("abaCodeMin");
const abaCodeValue = document.getElementById("abaCodeValue");
const countyCodeMin = document.getElementById("countyCodeMin");
const countyCodeValue = document.getElementById("countyCodeValue");
const highResCountiesToggle = document.getElementById("highResCounties");
const selectedRegionTitle = document.getElementById("selectedRegionTitle");
const appTitleHome = document.getElementById("appTitleHome");

const DEFAULT_REGION = "US-CA";
let allData = [];
let abaData = [];
let userMarker = null;
let selectedCounty = null;
let selectedCountyId = null;
let selectedCountyLayer = null;
let activeSpeciesHighlight = null;
let countyResolution = "low";
const countyCache = { low: null, high: null };
let suppressMarkerFitOnce = false;
let stateFeatureByCode = new Map();
let selectedCountyName = null;
let expandedCounties = new Set();

const STATE_CODE_TO_FIPS = {
  AL: "01", AK: "02", AZ: "04", AR: "05", CA: "06", CO: "08", CT: "09",
  DE: "10", DC: "11", FL: "12", GA: "13", HI: "15", ID: "16", IL: "17",
  IN: "18", IA: "19", KS: "20", KY: "21", LA: "22", ME: "23", MD: "24",
  MA: "25", MI: "26", MN: "27", MS: "28", MO: "29", MT: "30", NE: "31",
  NV: "32", NH: "33", NJ: "34", NM: "35", NY: "36", NC: "37", ND: "38",
  OH: "39", OK: "40", OR: "41", PA: "42", RI: "44", SC: "45", SD: "46",
  TN: "47", TX: "48", UT: "49", VT: "50", VA: "51", WA: "53", WV: "54",
  WI: "55", WY: "56"
};

const legend = L.control({ position: "topleft" });
legend.onAdd = function () {
  const div = L.DomUtil.create("div", "leaflet-control legend");
  div.innerHTML =
    "<div class='legend-title'>Legend</div>" +
    "<div><span class='legend-swatch lower48'></span>County with Lower 48 rarity</div>" +
    "<div><span class='legend-swatch notable'></span>County — notable only</div>";
  return div;
};
legend.addTo(map);
L.control.zoom({ position: "topleft" }).addTo(map);

function setStatus(message) {
  if (!statusEl) {
    return;
  }
  statusEl.textContent = message;
}

function updateSelectedRegionTitle() {
  if (!selectedRegionTitle || !regionSelect) {
    return;
  }
  const option = regionSelect.options?.[regionSelect.selectedIndex];
  const label = option ? option.textContent : (regionSelect.value || DEFAULT_REGION);
  selectedRegionTitle.textContent = label || "Selected Region";
}

function updateQueryDisplay(region, back) {
  if (raritiesQueryEl) {
    raritiesQueryEl.textContent =
      `https://api.ebird.org/v2/data/obs/${region}/recent/notable?detail=full&back=30`;
  }
  if (abaQueryEl) {
    abaQueryEl.textContent =
      `https://api.ebird.org/v2/data/obs/US/recent/notable?detail=full&back=7 (filtered to Lower 48, ABA≥3; grouped by species+location)`;
  }
}

function filterByDays(data) {
  const back = daysInput ? Number(daysInput.value) : 7;
  const backDays = Number.isFinite(back) ? Math.max(1, Math.min(30, back)) : 7;
  const cutoff = Date.now() - backDays * 24 * 60 * 60 * 1000;
  return (Array.isArray(data) ? data : []).filter((item) => {
    const dt = parseObsDate(item?.obsDt);
    if (!dt) {
      return true;
    }
    return dt.getTime() >= cutoff;
  });
}

function applyAllFilters() {
  const countyFiltered = filterBySpecies(
    filterCountyByCode(applyCountyFilters(filterByDays(allData)))
  );
  const abaFiltered = filterBySpecies(
    filterAbaByCode(filterByDays(abaData))
  );
  return { countyFiltered, abaFiltered };
}

async function loadAbaMeta() {
  if (!abaCodeMin || !abaCodeValue || !countyCodeMin || !countyCodeValue) {
    return;
  }
  try {
    const response = await fetch(WORKER_BASE_URL + "/api/aba_meta");
    if (!response.ok) {
      throw new Error("Failed to load ABA metadata.");
    }
    const data = await response.json();
    const maxCode = Number(data.maxCode);
    if (Number.isFinite(maxCode)) {
      abaCodeMin.max = String(maxCode);
      countyCodeMin.max = String(maxCode);
      const currentValue = Number(abaCodeMin.value);
      if (!Number.isFinite(currentValue) || currentValue > maxCode) {
        abaCodeMin.value = String(maxCode);
      }
      abaCodeValue.textContent = abaCodeMin.value;

      const countyCurrentValue = Number(countyCodeMin.value);
      if (!Number.isFinite(countyCurrentValue) || countyCurrentValue > maxCode) {
        countyCodeMin.value = String(maxCode);
      }
      countyCodeValue.textContent = countyCodeMin.value;
    }
  } catch (error) {
    console.error(error);
  }
}

function debounce(fn, wait) {
  let timeoutId;
  return (...args) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => fn(...args), wait);
  };
}

function formatDate(obsDt) {
  const parsed = new Date(obsDt);
  if (Number.isNaN(parsed.getTime())) {
    return obsDt || "";
  }
  return `${parsed.getMonth() + 1}/${parsed.getDate()}`;
}

function parseObsDate(obsDt) {
  const parsed = new Date(obsDt);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getStateAbbrev(item) {
  const code = String(item?.subnational1Code || "");
  if (!code) {
    return "";
  }
  if (code.includes("-")) {
    return code.split("-").pop() || "";
  }
  return code;
}

function getCountyName(item) {
  return String(item?.subnational2Name || item?.subnational2Code || "");
}

function normalizeCountyName(value) {
  return String(value || "").trim().toLowerCase();
}

function checklistUrl(subId) {
  return `https://www.ebird.org/ebird/view/checklist/${subId}`;
}

function locationUrl(locId) {
  return locId ? `https://www.ebird.org/hotspot/${locId}` : "";
}

function clearMarkers() {
  notReviewedLayer.clearLayers();
  acceptedLayer.clearLayers();
}

function clearAbaMarkers() {
  abaLayer.clearLayers();
}

const markerIconCache = new Map();

function getPinIcon(fillColor, strokeColor = "#1f2937") {
  const key = `${fillColor}|${strokeColor}`;
  const cached = markerIconCache.get(key);
  if (cached) {
    return cached;
  }
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="26" height="36" viewBox="0 0 26 36">
      <path d="M13 1C7 1 2 6 2 12c0 7.5 11 22 11 22s11-14.5 11-22C24 6 19 1 13 1z" fill="${fillColor}" fill-opacity="0.85" stroke="none" />
      <circle cx="13" cy="12" r="4.2" fill="#ffffff" />
    </svg>
  `.trim();
  const icon = L.divIcon({
    className: "custom-pin-icon",
    html: svg,
    iconSize: [26, 36],
    iconAnchor: [13, 34],
    tooltipAnchor: [0, -28],
    popupAnchor: [0, -28]
  });
  markerIconCache.set(key, icon);
  return icon;
}

function getCircleIcon(fillColor) {
  const key = `circle|${fillColor}`;
  const cached = markerIconCache.get(key);
  if (cached) {
    return cached;
  }
  const size = 24;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${size/2}" cy="${size/2}" r="${size/2 - 2}" fill="${fillColor}" fill-opacity="0.9" stroke="#ffffff" stroke-width="3" />
    </svg>
  `.trim();
  const icon = L.divIcon({
    className: "custom-circle-icon",
    html: svg,
    iconSize: [size, size],
    iconAnchor: [size/2, size/2],
    tooltipAnchor: [0, -size/2],
    popupAnchor: [0, -size/2]
  });
  markerIconCache.set(key, icon);
  return icon;
}

function getClusterIcon(count, fillColor) {
  const size = Math.min(40 + Math.log(count) * 5, 60);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${size/2}" cy="${size/2}" r="${size/2 - 2}" fill="${fillColor}" fill-opacity="0.85" stroke="#ffffff" stroke-width="3" />
      <text x="${size/2}" y="${size/2}" text-anchor="middle" dominant-baseline="central" fill="#ffffff" font-size="${Math.min(size * 0.45, 20)}" font-weight="bold">${count}</text>
    </svg>
  `.trim();
  return L.divIcon({
    className: "custom-cluster-icon",
    html: svg,
    iconSize: [size, size],
    iconAnchor: [size/2, size/2],
    tooltipAnchor: [0, -size/2],
    popupAnchor: [0, -size/2]
  });
}

function renderMarkers(data) {
  // This function is now called by renderAllMarkers
  // Keep it for compatibility but it should not be used directly
}

function renderAbaMarkers(data) {
  // This function is now called by renderAllMarkers
  // Keep it for compatibility but it should not be used directly
}

function renderAllMarkers() {
  // Clear all markers
  clearMarkers();
  clearAbaMarkers();
  
  const highlight = activeSpeciesHighlight
    ? String(activeSpeciesHighlight).toLowerCase()
    : null;
  const highlightMarkers = [];

  // Get filtered data from both sources
  const notableData = getFilteredData();
  const lower48Data = (showAbaMap && showAbaMap.checked) ? getFilteredAbaData() : [];

  // Group all observations by county from both sources
  const countyGroups = new Map();
  
  // Add Notable observations with source tag
  (Array.isArray(notableData) ? notableData : []).forEach((item) => {
    if (item.lat == null || item.lng == null) {
      return;
    }
    const state = getStateAbbrev(item);
    const county = getCountyName(item);
    const countyKey = `${state}|${county}`;
    
    if (!countyGroups.has(countyKey)) {
      countyGroups.set(countyKey, { notable: [], lower48: [] });
    }
    countyGroups.get(countyKey).notable.push(item);
  });
  
  // Add Lower 48 observations with source tag  
  (Array.isArray(lower48Data) ? lower48Data : []).forEach((item) => {
    if (item.lat == null || item.lng == null) {
      return;
    }
    const state = getStateAbbrev(item);
    const county = getCountyName(item);
    const countyKey = `${state}|${county}`;
    
    if (!countyGroups.has(countyKey)) {
      countyGroups.set(countyKey, { notable: [], lower48: [] });
    }
    countyGroups.get(countyKey).lower48.push(item);
  });

  // Determine if we should show individual markers based on county selection
  let selectedCountyState = null;
  if (selectedCounty && selectedCountyName) {
    const countyFips = String(selectedCounty.id || "");
    const stateFips = countyFips.substring(0, 2);
    selectedCountyState = Object.keys(STATE_CODE_TO_FIPS).find(
      (key) => STATE_CODE_TO_FIPS[key] === stateFips
    );
  }

  // Render each county group
  countyGroups.forEach((sources, countyKey) => {
    const [keyState, keyCounty] = countyKey.split("|");
    const isSelectedCounty = selectedCountyState && selectedCountyName && 
      keyState === selectedCountyState && 
      normalizeCountyName(keyCounty) === normalizeCountyName(selectedCountyName);

    const notableItems = sources.notable;
    const lower48Items = sources.lower48;
    const totalCount = notableItems.length + lower48Items.length;
    const hasLower48 = lower48Items.length > 0;

    // Only show individual markers for selected county
    if (isSelectedCounty) {
      const labelCountsByLocation = new Map();
      const labelIndexByLocation = new Map();
      [...notableItems, ...lower48Items].forEach((item) => {
        const key = item?.locId || item?.locName || `${item?.lat},${item?.lng}`;
        if (!key) return;
        labelCountsByLocation.set(key, (labelCountsByLocation.get(key) || 0) + 1);
      });

      const getLabelOffset = (item) => {
        const key = item?.locId || item?.locName || `${item?.lat},${item?.lng}`;
        if (!key) return [8, 0];
        const index = labelIndexByLocation.get(key) || 0;
        const total = labelCountsByLocation.get(key) || 1;
        labelIndexByLocation.set(key, index + 1);
        const centerOffset = ((total - 1) * 12) / 2;
        return [8, index * 12 - centerOffset];
      };

      // Render Notable observations as blue markers
      const bestBySpeciesLocation = new Map();
      notableItems.forEach((item) => {
        const species = item?.comName || "";
        const locKey = item?.locId || item?.locName || "";
        if (!species || !locKey) {
          return;
        }
        const key = `${species}::${locKey}`;
        const nextDate = parseObsDate(item?.obsDt);
        const existing = bestBySpeciesLocation.get(key);
        if (!existing) {
          bestBySpeciesLocation.set(key, item);
          return;
        }
        const existingDate = parseObsDate(existing?.obsDt);
        if (!existingDate || (nextDate && nextDate > existingDate)) {
          bestBySpeciesLocation.set(key, item);
        }
      });

      const locationSpecies = new Map();
      notableItems.forEach((item) => {
        const locKey = item.locId || item.locName || "";
        if (!locKey) return;
        const species = item.comName || "";
        if (!species) return;
        if (!locationSpecies.has(locKey)) {
          locationSpecies.set(locKey, new Set());
        }
        locationSpecies.get(locKey).add(species);
      });

      Array.from(bestBySpeciesLocation.values()).forEach((item) => {
        const reviewed = Number(item.obsReviewed) === 1;
        const valid = Number(item.obsValid) === 1;
        const matchesHighlight = highlight
          ? String(item.comName || "").toLowerCase() === highlight
          : true;
        const locKey = item.locId || item.locName || "";
        const speciesCount = locationSpecies.get(locKey)?.size || 0;
        
        let insideCounty = true;
        if (selectedCounty && typeof turf !== "undefined" && selectedCounty.geometry) {
          try {
            const point = turf.point([Number(item.lng), Number(item.lat)]);
            insideCounty = turf.booleanPointInPolygon(point, selectedCounty);
          } catch (error) {
            console.error(error);
            insideCounty = true;
          }
        }
        
        const abaCode = item.abaCode ?? item.abaRarityCode;
        const baseColor = getAbaColor(abaCode);
        const color = matchesHighlight ? (insideCounty ? baseColor : "#9ca3af") : "#9ca3af";
        const targetLayer = reviewed && valid ? acceptedLayer : notReviewedLayer;

        const marker = L.marker([item.lat, item.lng], {
          pane: "markersPane",
          icon: getCircleIcon(color), // was: getPinIcon(color)
          riseOnHover: true,
          riseOffset: 250
        });

        const locationLink = locationUrl(item.locId);
        const abaBadge = renderAbaCodeBadge(abaCode);
        const statusBadge = renderStatusBadge(isConfirmedObservation(item));
        const checklistLink = `<a href="${checklistUrl(item.subId)}" target="_blank" rel="noopener">Checklist</a>`;
        const locationLinkHtml = locationLink
          ? `<a href="${locationLink}" target="_blank" rel="noopener">Location</a>`
          : (item.locName || "");
        
        const hoverContent = `
          <div style="display: inline-block;">
            <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
              ${abaBadge}
              <div style="font-weight: 600;">${item.comName}</div>
            </div>
            <div style="margin-bottom: 4px;">${statusBadge}</div>
            <div style="font-size: 0.85rem;">${checklistLink}${locationLinkHtml ? " | " + locationLinkHtml : ""}</div>
          </div>
        `;
        
        // Show species label if enabled
        if (showSpeciesLabels && showSpeciesLabels.checked) {
          const labelOffset = getLabelOffset(item);
          marker.bindTooltip(item.comName, {
            permanent: true,
            direction: "right",
            className: "species-label",
            offset: labelOffset
          });
        } else {
          marker.bindTooltip(hoverContent, { sticky: true, direction: "top" });
        }
        
        marker.bindPopup(hoverContent, {
          autoPan: true,
          autoPanPadding: [50, 50],
          closeButton: true,
          maxWidth: 220
        });

        targetLayer.addLayer(marker);
        if (matchesHighlight) {
          highlightMarkers.push(marker);
        }
      });

      // Render Lower 48 observations as red markers
      lower48Items.forEach((item) => {
        const matchesHighlight = highlight
          ? String(item.comName || "").toLowerCase() === highlight
          : true;
        
        let insideCounty = true;
        if (selectedCounty && typeof turf !== "undefined" && selectedCounty.geometry) {
          try {
            const point = turf.point([Number(item.lng), Number(item.lat)]);
            insideCounty = turf.booleanPointInPolygon(point, selectedCounty);
          } catch (error) {
            console.error(error);
            insideCounty = true;
          }
        }
        
        const abaCode = item.abaCode ?? item.abaRarityCode;
        const baseColor = getAbaColor(abaCode);
        const color = matchesHighlight ? (insideCounty ? baseColor : "#9ca3af") : "#9ca3af";
        const marker = L.marker([item.lat, item.lng], {
          pane: "abaMarkersPane",
          icon: getCircleIcon(color), // was: getPinIcon(color)
          riseOnHover: true,
          riseOffset: 250
        });

        const locationLink = locationUrl(item.locId);
        const abaBadge = renderAbaCodeBadge(item.abaCode || item.abaRarityCode);
        const checklistLink = `<a href="${checklistUrl(item.subId)}" target="_blank" rel="noopener">Checklist</a>`;
        const locationLinkHtml = locationLink
          ? `<a href="${locationLink}" target="_blank" rel="noopener">Location</a>`
          : (item.locName || "");
        
        const hoverContent = `
          <div style="display: inline-block;">
            <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
              ${abaBadge}
              <div style="font-weight: 600;">${item.comName}</div>
            </div>
            <div style="font-size: 0.85rem;">${checklistLink}${locationLinkHtml ? " | " + locationLinkHtml : ""}</div>
          </div>
        `;
        
        // Show species label if enabled
        if (showSpeciesLabels && showSpeciesLabels.checked) {
          const labelOffset = getLabelOffset(item);
          marker.bindTooltip(item.comName, {
            permanent: true,
            direction: "right",
            className: "species-label",
            offset: labelOffset
          });
        } else {
          marker.bindTooltip(hoverContent, { sticky: true, direction: "top" });
        }
        
        marker.bindPopup(hoverContent, {
          autoPan: true,
          autoPanPadding: [50, 50],
          closeButton: true,
          maxWidth: 220
        });

        abaLayer.addLayer(marker);
        if (matchesHighlight) {
          highlightMarkers.push(marker);
        }
      });
    } else {
      // Show single cluster marker for collapsed county
      // Use county polygon centroid instead of averaging observation points
      const allItems = [...notableItems, ...lower48Items];
      let centerLat = 0;
      let centerLng = 0;
      
      // Try to find county polygon and use its centroid
      const stateFips = STATE_CODE_TO_FIPS[keyState];
      if (stateFips && typeof turf !== 'undefined') {
        const countyLayerFound = findCountyByName(stateFips, keyCounty);
        if (countyLayerFound && countyLayerFound.feature) {
          try {
            // Use centroid for better visual centering
            const center = turf.centroid(countyLayerFound.feature);
            const coords = center?.geometry?.coordinates;
            if (coords && coords.length === 2) {
              centerLng = coords[0];
              centerLat = coords[1];
            }
          } catch (error) {
            console.error('Error calculating county centroid:', error);
          }
        }
      }
      
      // Fall back to averaging observation points if county polygon not found
      if (centerLat === 0 && centerLng === 0) {
        let latSum = 0, lngSum = 0;
        allItems.forEach(item => {
          latSum += Number(item.lat);
          lngSum += Number(item.lng);
        });
        centerLat = latSum / totalCount;
        centerLng = lngSum / totalCount;
      }
      
      // Check if any item in cluster is highlighted
      const hasHighlight = highlight && allItems.some(item => 
        String(item.comName || "").toLowerCase() === highlight
      );
      
      // Determine color based on highest ABA code in cluster
      let highestAbaCode = 0;
      allItems.forEach(item => {
        const raw = item.abaCode ?? item.abaRarityCode;
        const code = Number(raw);
        if (Number.isFinite(code) && code > highestAbaCode) {
          highestAbaCode = code;
        }
      });
      const color = getAbaColor(highestAbaCode);
      const clusterMarker = L.marker([centerLat, centerLng], {
        pane: "markersPane",
        icon: getClusterIcon(totalCount, color),
        riseOnHover: true,
        riseOffset: 250
      });

      const firstItem = allItems[0];
      const state = getStateAbbrev(firstItem);
      const county = getCountyName(firstItem);
      const tooltipLabel = `<strong>${county}, ${state}</strong><br/>${totalCount} observations`;
      clusterMarker.bindTooltip(tooltipLabel, { sticky: true, direction: "top" });

      // Click to select county and show individual markers
      clusterMarker.on('click', () => {
        selectCountyByName(state, county);
      });

      acceptedLayer.addLayer(clusterMarker);
      if (hasHighlight) {
        highlightMarkers.push(clusterMarker);
      }
    }
  });

  highlightMarkers.forEach((marker) => {
    if (marker && typeof marker.bringToFront === "function") {
      marker.bringToFront();
    } else if (marker && typeof marker.setZIndexOffset === "function") {
      marker.setZIndexOffset(1000);
    }
  });
}

function setBaseLayer(name) {
  const nextLayer = baseLayers[name];
  if (!nextLayer) {
    return;
  }
  Object.values(baseLayers).forEach((layer) => {
    if (map.hasLayer(layer)) {
      map.removeLayer(layer);
    }
  });
  map.addLayer(nextLayer);
}

function setOverlay(layer, enabled) {
  if (!layer) {
    return;
  }
  if (enabled) {
    map.addLayer(layer);
  } else {
    map.removeLayer(layer);
  }
}

function renderSightingsTable(data, emptyMessage) {
  if (!sightingsBody) {
    return;
  }

  if (!Array.isArray(data) || data.length === 0) {
    sightingsBody.innerHTML =
      emptyMessage || "<tr><td colspan='8'>No results</td></tr>";
    return;
  }

  const grouped = new Map();

  data.forEach((item) => {
    const species = item.comName || "";
    const state = getStateAbbrev(item);
    const county = getCountyName(item);
    const key = `${species}::${state}::${county}`;
    const date = parseObsDate(item.obsDt);
    const rawCode = item.abaCode ?? item.abaRarityCode ?? item.abaCode;
    const code = Number(rawCode);
    const abaCode = Number.isFinite(code) ? code : null;
    const lat = Number(item.lat);
    const lng = Number(item.lng);

    if (!grouped.has(key)) {
      grouped.set(key, {
        species,
        state,
        county,
        count: 0,
        first: date,
        last: date,
        abaCode,
        confirmedAny: isConfirmedObservation(item),
        lat: Number.isFinite(lat) ? lat : null,
        lng: Number.isFinite(lng) ? lng : null,
        locId: item.locId || null
      });
    }

    const entry = grouped.get(key);
    entry.count += 1;
    if (!entry.state && state) {
      entry.state = state;
    }
    if (!entry.county && county) {
      entry.county = county;
    }
    if (entry.lat == null && Number.isFinite(lat)) {
      entry.lat = lat;
    }
    if (entry.lng == null && Number.isFinite(lng)) {
      entry.lng = lng;
    }
    if (!entry.locId && item.locId) {
      entry.locId = item.locId;
    }
    entry.confirmedAny = entry.confirmedAny || isConfirmedObservation(item);
    if (abaCode !== null) {
      if (entry.abaCode === null || entry.abaCode === undefined) {
        entry.abaCode = abaCode;
      } else if (abaCode > entry.abaCode) {
        // Keep the HIGHEST (rarest) code for this species+county
        entry.abaCode = abaCode;
      }
    }
    if (date) {
      if (!entry.first || date < entry.first) {
        entry.first = date;
      }
      if (!entry.last || date > entry.last) {
        entry.last = date;
      }
    }
  });

  const rows = Array.from(grouped.values())
    .sort((a, b) => {
      const aCode = Number.isFinite(a.abaCode) ? a.abaCode : -1;
      const bCode = Number.isFinite(b.abaCode) ? b.abaCode : -1;
      if (aCode !== bCode) {
        return bCode - aCode;
      }
      // Sort by state, then county to group nearby observations
      const aState = String(a.state || "").toLowerCase();
      const bState = String(b.state || "").toLowerCase();
      if (aState !== bState) {
        return aState.localeCompare(bState);
      }
      const aCounty = String(a.county || "").toLowerCase();
      const bCounty = String(b.county || "").toLowerCase();
      if (aCounty !== bCounty) {
        return aCounty.localeCompare(bCounty);
      }
      const aTime = a.last ? a.last.getTime() : 0;
      const bTime = b.last ? b.last.getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, 50)
    .map((item, index) => {
      const firstReported = item.first ? formatDate(item.first) : "";
      const lastReported = item.last ? formatDate(item.last) : "";
      const abaBadge = renderAbaCodeBadge(item.abaCode);
      const statusBadge = renderStatusBadge(Boolean(item.confirmedAny));
      const stateCode = item.state || "";
      const stateClickable = stateCode
        ? `<button type="button" class="state-link" data-state="${stateCode}">${stateCode}</button>`
        : "";
      const countyCell = item.county || "";
      const countyClickable = countyCell ? `<button type="button" class="county-link" data-state="${item.state || ""}" data-county="${countyCell}">${countyCell}</button>` : "";
      const rowId = `notable-${index}`;
      return `
        <tr data-row-id="${rowId}" data-lat="${item.lat ?? ""}" data-lng="${item.lng ?? ""}" data-species="${item.species}" data-county="${item.county || ""}" data-state="${item.state || ""}" data-aba="${item.abaCode ?? ""}" data-locid="${item.locId || ""}" data-last="${lastReported}" data-first="${firstReported}" data-confirmed="${item.confirmedAny ? "1" : "0"}">
          <td><div class="species-cell">${abaBadge}<button type="button" class="species-link" data-species="${item.species}" data-lat="${item.lat ?? ""}" data-lng="${item.lng ?? ""}">${item.species}</button></div></td>
          <td class="col-state">${stateClickable}</td>
          <td class="col-county">${countyClickable}</td>
          <td class="col-status">${statusBadge}</td>
          <td>${lastReported}</td>
          <td>${firstReported}</td>
          <td>${item.count}</td>
          <td class="col-checkbox"><input type="checkbox" class="export-checkbox" data-row-id="${rowId}" checked /></td>
        </tr>
      `;
    })
    .join("");

  sightingsBody.innerHTML = rows || "<tr><td colspan='8'>No results</td></tr>";
}

function renderAbaTable(data, emptyMessage) {
  if (!abaSightingsBody) {
    return;
  }

  if (!Array.isArray(data) || data.length === 0) {
    abaSightingsBody.innerHTML =
      emptyMessage || "<tr><td colspan='6'>No results</td></tr>";
    return;
  }

  // Filter by selected county if one is active
  let filteredData = data;
  if (selectedCounty && selectedCountyName) {
    filteredData = applyCountyFilters(data);
  }

  // Group by species+county instead of species+location
  const grouped = new Map();
  filteredData.forEach((item) => {
    const species = item.comName || "";
    const state = getStateAbbrev(item);
    const county = getCountyName(item);
    const key = `${species}::${state}::${county}`;
    const date = parseObsDate(item.lastObsDt || item.obsDt);
    const firstDate = parseObsDate(item.firstObsDt || item.obsDt);
    const rawCode = item.abaCode ?? item.abaRarityCode ?? item.abaCode;
    const code = Number(rawCode);
    const abaCode = Number.isFinite(code) ? code : null;
    const lat = Number(item.lat);
    const lng = Number(item.lng);
    const reportCountRaw = item.reportCount;
    const reportCount = Number.isFinite(Number(reportCountRaw))
      ? Number(reportCountRaw)
      : 1;

    if (!grouped.has(key)) {
      grouped.set(key, {
        species,
        state,
        county,
        count: 0,
        first: firstDate,
        last: date,
        abaCode,
        lat: Number.isFinite(lat) ? lat : null,
        lng: Number.isFinite(lng) ? lng : null,
        locId: item.locId || null
      });
    }

    const entry = grouped.get(key);
    entry.count += reportCount;
    if (!entry.state && state) {
      entry.state = state;
    }
    if (!entry.county && county) {
      entry.county = county;
    }
    if (abaCode !== null) {
      if (entry.abaCode === null || entry.abaCode === undefined) {
        entry.abaCode = abaCode;
      } else if (abaCode > entry.abaCode) {
        // Keep the HIGHEST (rarest) code for this species+location
        entry.abaCode = abaCode;
      }
    }
    if (entry.lat == null && Number.isFinite(lat)) {
      entry.lat = lat;
    }
    if (entry.lng == null && Number.isFinite(lng)) {
      entry.lng = lng;
    }
    if (!entry.locId && item.locId) {
      entry.locId = item.locId;
    }
    if (firstDate && (!entry.first || firstDate < entry.first)) {
      entry.first = firstDate;
    }
    if (date && (!entry.last || date > entry.last)) {
      entry.last = date;
    }
  });

  const rows = Array.from(grouped.values())
    .sort((a, b) => {
      const aCode = Number.isFinite(a.abaCode) ? a.abaCode : -1;
      const bCode = Number.isFinite(b.abaCode) ? b.abaCode : -1;
      if (aCode !== bCode) {
        return bCode - aCode;
      }
      // Sort by state, then county to group nearby observations
      const aState = String(a.state || "").toLowerCase();
      const bState = String(b.state || "").toLowerCase();
      if (aState !== bState) {
        return aState.localeCompare(bState);
      }
      const aCounty = String(a.county || "").toLowerCase();
      const bCounty = String(b.county || "").toLowerCase();
      if (aCounty !== bCounty) {
        return aCounty.localeCompare(bCounty);
      }
      const aTime = a.last ? a.last.getTime() : 0;
      const bTime = b.last ? b.last.getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, 50)
    .map((item, index) => {
      const firstReported = item.first ? formatDate(item.first) : "";
      const lastReported = item.last ? formatDate(item.last) : "";
      const abaBadge = renderAbaCodeBadge(item.abaCode);
      const stateCode = item.state || "";
      const stateClickable = stateCode
        ? `<button type="button" class="state-link" data-state="${stateCode}">${stateCode}</button>`
        : "";
      const countyCell = item.county || "";
      const countyClickable = countyCell ? `<button type="button" class="county-link" data-state="${item.state || ""}" data-county="${countyCell}">${countyCell}</button>` : "";
      const rowId = `aba-${index}`;
      return `
        <tr data-row-id="${rowId}" data-lat="${item.lat ?? ""}" data-lng="${item.lng ?? ""}" data-species="${item.species}" data-county="${item.county || ""}" data-state="${item.state || ""}" data-aba="${item.abaCode ?? ""}" data-locid="${item.locId || ""}" data-last="${lastReported}" data-first="${firstReported}">
          <td><div class="species-cell">${abaBadge}<button type="button" class="species-link" data-species="${item.species}" data-lat="${item.lat ?? ""}" data-lng="${item.lng ?? ""}">${item.species}</button></div></td>
          <td class="col-state">${stateClickable}</td>
          <td class="col-county">${countyClickable}</td>
          <td>${lastReported}</td>
          <td>${firstReported}</td>
          <td>${item.count}</td>
          <td class="col-checkbox"><input type="checkbox" class="export-checkbox" data-row-id="${rowId}" checked /></td>
        </tr>
      `;
    })
    .join("");

  abaSightingsBody.innerHTML = rows || "<tr><td colspan='7'>No results</td></tr>";
}

function getAbaColor(code) {
  const n = Number(code);
  if (!Number.isFinite(n) || n < 1) {
    return "#9ca3af"; // gray for unknown/low
  }
  const safe = Math.round(n);
  switch(safe) {
    case 1: return "#16a34a"; // green
    case 2: return "#4ade80"; // light green
    case 3: return "#facc15"; // yellow
    case 4: return "#fb923c"; // light orange
    case 5: return "#ef4444"; // red
    case 6: return "#ef4444"; // red
    default: return "#9ca3af"; // gray
  }
}

function renderAbaCodeBadge(code) {
  const n = Number(code);
  if (!Number.isFinite(n) || n < 1 || n > 6) {
    return "<span class=\"aba-code-badge aba-code-unknown\" title=\"ABA code unavailable\">N</span>";
  }
  const safe = Math.round(n);
  return `<span class="aba-code-badge aba-code-${safe}" title="ABA code ${safe}">${safe}</span>`;
}

function isConfirmedObservation(item) {
  if (item && typeof item.confirmedAny === "boolean") {
    return item.confirmedAny;
  }
  return Number(item?.obsReviewed) === 1 && Number(item?.obsValid) === 1;
}

function renderStatusBadge(isConfirmed) {
  return isConfirmed
    ? '<span class="status-badge status-confirmed" title="At least one report in this merged group is confirmed">Confirmed</span>'
    : '<span class="status-badge status-unconfirmed" title="No confirmed report in this merged group">Pending</span>';
}

function focusRegionFromStateCode(stateCode) {
  const state = String(stateCode || "").toUpperCase().trim();
  if (!state || !/^[A-Z]{2}$/.test(state)) {
    return;
  }
  const regionCode = `US-${state}`;
  const options = Array.from(regionSelect?.options || []);
  const hasRegion = options.some((opt) => opt.value === regionCode);
  if (!hasRegion) {
    setStatus(`State not available in regions list: ${state}`);
    return;
  }
  regionSelect.value = regionCode;
  regionSelect.dispatchEvent(new Event("change", { bubbles: true }));
}

function filterAbaByCode(data) {
  const minCode = abaCodeMin ? Number(abaCodeMin.value) : 3;
  return data.filter((item) => {
    const raw = item.abaCode ?? item.abaRarityCode ?? item.abaCode;
    const code = Number(raw);
    if (Number.isNaN(code)) {
      return false;
    }
    return code >= minCode;
  });
}

function filterCountyByCode(data) {
  const minCode = countyCodeMin ? Number(countyCodeMin.value) : 3;
  return data.filter((item) => {
    const raw = item.abaCode ?? item.abaRarityCode ?? item.abaCode;
    const code = Number(raw);
    if (Number.isNaN(code)) {
      return false;
    }
    return code >= minCode;
  });
}

function filterByAbaCode(data) {
  const minCode = abaCodeMin ? Number(abaCodeMin.value) : 3;
  return data.filter((item) => {
    const raw = item.abaCode ?? item.abaRarityCode ?? item.abaCode;
    const code = Number(raw);
    if (Number.isNaN(code)) {
      return true;
    }
    return code >= minCode;
  });
}

function updateUniqueCount(data) {
  if (!uniqueCountEl) {
    return;
  }
  const unique = new Set();
  data.forEach((item) => {
    const species = item.comName || "";
    const loc = item.locId || item.locName || "";
    unique.add(`${species}::${loc}`);
  });
  uniqueCountEl.textContent = String(unique.size);
}

function getFilteredData() {
  return filterBySpecies(
    filterCountyByCode(filterByDays(allData))
  );
}

function getFilteredAbaData() {
  return filterBySpecies(
    filterAbaByCode(filterByDays(abaData))
  );
}

function setSpeciesHighlight(speciesName) {
  const next = String(speciesName || "").trim();
  activeSpeciesHighlight = next ? next : null;
  renderAllMarkers();
}

function getAbaCodeForSpecies(speciesName) {
  const name = String(speciesName || "").trim();
  if (!name) {
    return null;
  }
  const codes = [];
  [allData, abaData].forEach((list) => {
    if (!Array.isArray(list)) {
      return;
    }
    list.forEach((item) => {
      if (item && item.comName === name) {
        const raw = item.abaCode ?? item.abaRarityCode ?? item.abaCode;
        const code = Number(raw);
        if (Number.isFinite(code)) {
          codes.push(code);
        }
      }
    });
  });
  if (!codes.length) {
    return null;
  }
  return Math.min(...codes);
}

function zoomToObservationExtent(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return;
  }
  const bounds = L.latLngBounds();
  items.forEach((item) => {
    if (item && Number.isFinite(item.lat) && Number.isFinite(item.lng)) {
      bounds.extend([item.lat, item.lng]);
    }
  });
  if (bounds.isValid()) {
    map.fitBounds(bounds.pad(0.2), { maxZoom: 10 });
  }
}


function updateSpeciesOptions(data) {
  const species = Array.from(new Set(data.map((item) => item.comName))).sort();
  const previousSelection = speciesSelect.value;
  speciesSelect.innerHTML = "";
  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "All species";
  speciesSelect.appendChild(allOption);

  species.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    speciesSelect.appendChild(option);
  });

  if (previousSelection && species.includes(previousSelection)) {
    speciesSelect.value = previousSelection;
  } else {
    speciesSelect.value = "";
  }
}

function filterBySpecies(data) {
  const selected = speciesSelect.value;
  if (!selected) {
    return data;
  }
  return data.filter((item) => item.comName === selected);
}

function filterByCounty(data) {
  if (!selectedCounty) {
    return data;
  }
  if (typeof turf === "undefined") {
    return data;
  }
  if (!selectedCounty.geometry) {
    selectedCounty = null;
    selectedCountyId = null;
    selectedCountyLayer = null;
    return data;
  }
  return data.filter((item) => {
    if (item.lat == null || item.lng == null) {
      return false;
    }
    try {
      const point = turf.point([Number(item.lng), Number(item.lat)]);
      return turf.booleanPointInPolygon(point, selectedCounty);
    } catch (error) {
      console.error(error);
      return true;
    }
  });
}

function filterByCountyName(data) {
  const target = normalizeCountyName(selectedCountyName);
  if (!target) {
    return data;
  }
  return data.filter((item) => {
    const county = normalizeCountyName(getCountyName(item));
    return county === target;
  });
}

function applyCountyFilters(data) {
  const spatial = filterByCounty(data);
  if (selectedCounty && selectedCountyName && spatial.length === 0) {
    return filterByCountyName(data);
  }
  return spatial;
}

function zoomToCountyLayer(layer) {
  if (!layer || typeof layer.getBounds !== "function") {
    return;
  }
  try {
    const bounds = layer.getBounds();
    if (bounds && bounds.isValid && bounds.isValid()) {
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 11 });
    }
  } catch (error) {
    console.error(error);
  }
}

function toggleCountySelection(feature, layer) {
  if (selectedCountyLayer === layer) {
    const label = feature?.properties?.name || feature?.id || "Selected county";
    countyLayer.setStyle(getCountyStyle);
    if (selectedCountyLayer && typeof selectedCountyLayer.bringToFront === "function") {
      selectedCountyLayer.bringToFront();
    }
    setStatus(`Filtering by county: ${label}`);
    zoomToCountyLayer(layer);
  } else {
    selectedCounty = feature;
    selectedCountyId = feature.id || feature.properties?.id || null;
    selectedCountyLayer = layer;
    selectedCountyName = feature.properties?.name || feature.id || null;
    countyLayer.setStyle(getCountyStyle);
    const label = feature.properties?.name || feature.id || "Selected county";
    setStatus(`Filtering by county: ${label}`);
    selectedCountyLayer.bringToFront();
    zoomToCountyLayer(layer);
    if (countyLabelLayer && typeof turf !== "undefined") {
      countyLabelLayer.clearLayers();
      try {
        const center = turf.centerOfMass(feature);
        const coords = center?.geometry?.coordinates;
        if (coords && coords.length === 2) {
          const marker = L.marker([coords[1], coords[0]], {
            pane: "countyLabelPane",
            interactive: false,
            icon: L.divIcon({
              className: "county-label",
              html: `<div class="county-label-text">${label}</div>`,
              iconSize: null
            })
          });
          countyLabelLayer.addLayer(marker);
        }
      } catch (error) {
        console.error(error);
      }
    }
  }
  const filtered = getFilteredData();
  const filteredForTable = filterBySpecies(
    filterCountyByCode(applyCountyFilters(filterByDays(allData)))
  );
  renderSightingsTable(filteredForTable);
  updateUniqueCount(filteredForTable);
  renderAllMarkers();
  const abaFiltered = getFilteredAbaData();
  renderAbaTable(abaFiltered);
}

async function refreshData() {
  const region = regionSelect.value || DEFAULT_REGION;
  const back = daysInput.value;
  setStatus("Loading data...");
  updateQueryDisplay(region, back);
  renderSightingsTable([], "<tr><td colspan='8'>Loading county sightings...</td></tr>");
  renderAbaTable([], "<tr><td colspan='6'>Loading Lower 48 rarities...</td></tr>");

  try {
    const response = await fetch(
      `${WORKER_BASE_URL}/api/rarities?region=${encodeURIComponent(region)}&back=30`
    );
    if (!response.ok) {
      throw new Error("Failed to fetch eBird data.");
    }
    const data = await response.json();
    if (data && data.error) {
      throw new Error(data.error);
    }
    allData = Array.isArray(data) ? data : [];
    updateSpeciesOptions(filterByDays(allData));
    const { countyFiltered, abaFiltered } = applyAllFilters();
    renderSightingsTable(countyFiltered);
    updateUniqueCount(countyFiltered);
    await refreshAbaData(30, { renderMap: showAbaMap?.checked ?? false });
    renderAllMarkers();
    setStatus(`Loaded ${allData.length} sightings.`);
  } catch (error) {
    console.error(error);
    setStatus(`Error loading data: ${error.message}`);
    renderSightingsTable([], `<tr><td colspan='8'>Error loading county data: ${String(error.message || error)}</td></tr>`);
  }
}

async function loadRegions() {
  regionSelect.innerHTML = "";

  const usAllOption = document.createElement("option");
  usAllOption.value = "US";
  usAllOption.textContent = "US — All";
  regionSelect.appendChild(usAllOption);

  const abaOption = document.createElement("option");
  abaOption.value = "ABA";
  abaOption.textContent = "ABA — Checklist Area";
  regionSelect.appendChild(abaOption);

  try {
    const response = await fetch(WORKER_BASE_URL + "/api/regions?country=US");
    if (!response.ok) {
      throw new Error("Failed to fetch regions.");
    }
    const regions = await response.json();
    if (Array.isArray(regions)) {
      regions.forEach((region) => {
        if (!region || !region.code) {
          return;
        }
        const option = document.createElement("option");
        option.value = region.code;
        option.textContent = region.name
          ? `${region.code} — ${region.name}`
          : region.code;
        regionSelect.appendChild(option);
      });
    }
    regionSelect.value = DEFAULT_REGION;
    if (!regionSelect.value && regionSelect.options.length > 0) {
      regionSelect.selectedIndex = 0;
    }
    updateSelectedRegionTitle();
  } catch (error) {
    console.error(error);
    const fallback = document.createElement("option");
    fallback.value = DEFAULT_REGION;
    fallback.textContent = "US-CA — California";
    regionSelect.appendChild(fallback);
    regionSelect.value = DEFAULT_REGION;
    updateSelectedRegionTitle();
    setStatus("Using default region only.");
  }
}

function locateUser() {
  if (!navigator.geolocation) {
    setStatus("Geolocation is not supported by this browser.");
    return;
  }
  map.locate({ setView: true, maxZoom: 10 });
}

async function refreshAbaData(back, options = {}) {
  const renderMap = options.renderMap !== false;
  expandedCounties.clear();
  try {
    const response = await fetch(`${WORKER_BASE_URL}/api/lower48_rarities?minAba=3&back=7`);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || "Failed to fetch Lower 48 data.");
    }
    const data = await response.json();
    if (data && data.error) {
      throw new Error(data.error);
    }
    abaData = Array.isArray(data) ? data : [];
    
    // Apply client-side filters (days, species, ABA code slider)
    const filteredForMap = getFilteredAbaData();
    
    // Always re-render all markers to update unified clustering
    renderAllMarkers();
    
    // Always render table with filtered results
    if (!abaData.length) {
      const source = response.headers.get("X-ABA-Source") || "";
      const version = response.headers.get("X-Data-Version") || "";
      const fetchedAt = response.headers.get("X-Data-Fetched-At") || "";
      const suffixParts = [];
      if (source) suffixParts.push(`source: ${source}`);
      if (version) suffixParts.push(`v${version}`);
      if (fetchedAt) suffixParts.push(`fetched: ${fetchedAt}`);
      const suffix = suffixParts.length ? ` (${suffixParts.join(", ")})` : "";
      renderAbaTable(
        [],
        `<tr><td colspan='6'>No Lower 48 data returned${suffix}.</td></tr>`
      );
    } else {
      // Render table with filtered data
      renderAbaTable(
        filteredForMap,
        filteredForMap.length === 0
          ? "<tr><td colspan='6'>No results match current filters (try adjusting Days Back or ABA code slider).</td></tr>"
          : undefined
      );
    }
  } catch (error) {
    console.error(error);
    const message = String(error?.message || error);
    setStatus(`Lower 48 overlay error: ${message}`);
    renderAbaTable(
      [],
      `<tr><td colspan='6'>Lower 48 error: ${message}</td></tr>`
    );
  }
}

map.on("locationfound", (event) => {
  if (userMarker) {
    map.removeLayer(userMarker);
  }
  if (userCircle) {
    map.removeLayer(userCircle);
    userCircle = null;
  }
  userMarker = L.circleMarker(event.latlng, {
    radius: 7,
    color: "#22c55e",
    weight: 2,
    fillColor: "#22c55e",
    fillOpacity: 0.9
  })
    .addTo(map)
    .bindPopup("My location")
    .openPopup();
});

map.on("locationerror", () => {
  setStatus("Unable to retrieve your location.");
});

async function loadCountyBoundaries() {
  try {
    if (typeof topojson === "undefined") {
      throw new Error("TopoJSON library not loaded.");
    }
    if (typeof turf === "undefined") {
      throw new Error("Turf.js library not loaded.");
    }
    let desired = getCountyResolutionForZoom(map.getZoom());
    if (desired === countyResolution && countyCache[desired]) {
      applyCountyData(countyCache[desired]);
      return;
    }

    const highUrls = [
      "https://cdn.jsdelivr.net/npm/us-atlas@3/counties-5m.json",
      "https://unpkg.com/us-atlas@3/counties-5m.json",
      "https://cdnjs.cloudflare.com/ajax/libs/us-atlas/3.0.1/counties-5m.json"
    ];
    const lowUrls = [
      "https://cdn.jsdelivr.net/npm/us-atlas@3/counties-10m.json",
      "https://unpkg.com/us-atlas@3/counties-10m.json",
      "https://cdnjs.cloudflare.com/ajax/libs/us-atlas/3.0.1/counties-10m.json"
    ];

    let topoData = null;
    try {
      topoData = await fetchTopoJson(
        desired === "high" ? highUrls : lowUrls,
        "county boundaries"
      );
    } catch (error) {
      if (desired === "high") {
        desired = "low";
        topoData = await fetchTopoJson(lowUrls, "county boundaries");
      } else {
        throw error;
      }
    }
    const geojson = topojson.feature(topoData, topoData.objects.counties);
    countyCache[desired] = geojson;
    countyResolution = desired;
    applyCountyData(geojson);
  } catch (error) {
    console.error(error);
    setStatus("County boundaries unavailable.");
  }
}

function getCountyResolutionForZoom(zoom) {
  return zoom >= 7 ? "high" : "low";
}

function applyCountyData(geojson) {
  countyLayer.clearLayers();
  countyLayer.addData(geojson);
  countyLayer.setStyle(getCountyStyle);
  if (countyLabelLayer) {
    countyLabelLayer.clearLayers();
  }
  applyBoundaryStyles();
  ensureBoundaryVisibility();
  syncCountySelection();
  requestAnimationFrame(() => {
    countyLayer.eachLayer((layer) => {
      if (typeof layer.redraw === "function") {
        layer.redraw();
      }
    });
    ensureBoundaryVisibility();
  });
  setTimeout(() => {
    if (countyLayer.getLayers().length === 0) {
      loadCountyBoundaries();
      return;
    }
    ensureBoundaryVisibility();
  }, 400);
}

const HIGH_RES_MIN_ZOOM = 7;
let highResLoadInFlight = false;

async function loadHighResCounties() {
  if (!highResCountiesToggle || !highResCountiesToggle.checked) {
    return;
  }
  if (typeof osmtogeojson === "undefined") {
    setStatus("High-res counties unavailable (osmtogeojson missing).");
    return;
  }
  const zoom = map.getZoom();
  if (zoom < HIGH_RES_MIN_ZOOM) {
    setStatus("Zoom in for high-res counties.");
    highResCountyLayer.clearLayers();
    return;
  }
  if (highResLoadInFlight) {
    return;
  }
  highResLoadInFlight = true;
  try {
    const bounds = map.getBounds();
    const bbox = `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`;
    const query = `
      [out:json][timeout:25];
      (
        rel["admin_level"="6"]["boundary"="administrative"](${bbox});
      );
      out geom;
    `;
    const response = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: `data=${encodeURIComponent(query)}`
    });
    if (!response.ok) {
      throw new Error(`Overpass error ${response.status}`);
    }
    const data = await response.json();
    const geojson = osmtogeojson(data);
    highResCountyLayer.clearLayers();
    highResCountyLayer.addData(geojson);
    highResCountyLayer.setStyle(getCountyStyle);
    ensureBoundaryVisibility();
    setStatus("High-res counties loaded.");
  } catch (error) {
    console.error(error);
    setStatus("High-res counties unavailable.");
  } finally {
    highResLoadInFlight = false;
  }
}

function syncCountySelection() {
  selectedCounty = null;
  selectedCountyLayer = null;

  if (!selectedCountyId) {
    countyLayer.setStyle(getCountyStyle);
    return;
  }

  countyLayer.eachLayer((layer) => {
    if (layer.feature && layer.feature.id === selectedCountyId) {
      selectedCounty = layer.feature;
      selectedCountyLayer = layer;
    }
  });

  countyLayer.setStyle(getCountyStyle);
}

function findCountyByName(stateFips, countyName) {
  const normalizedTarget = normalizeCountyName(countyName);
  if (!normalizedTarget) return null;
  
  let foundLayer = null;
  countyLayer.eachLayer((layer) => {
    if (foundLayer) return;
    const feature = layer.feature;
    if (!feature) return;
    
    // County features from us-atlas have id like "06001" (state+county FIPS)
    const featureId = String(feature.id || "");
    const featureStateFips = featureId.substring(0, 2);
    
    if (featureStateFips === stateFips) {
      const featureName = normalizeCountyName(feature.properties?.name || "");
      if (featureName === normalizedTarget) {
        foundLayer = layer;
      }
    }
  });
  
  return foundLayer;
}

function selectCountyByName(state, countyName) {
  const stateFips = STATE_CODE_TO_FIPS[state];
  if (!stateFips) {
    setStatus(`Unknown state: ${state}`);
    return;
  }
  
  const layer = findCountyByName(stateFips, countyName);
  if (!layer || !layer.feature) {
    setStatus(`County not found: ${countyName}, ${state}`);
    return;
  }
  
  // Keep selection and always zoom when selecting from table
  if (selectedCountyLayer !== layer) {
    expandedCounties.clear();
    toggleCountySelection(layer.feature, layer);
  }

  zoomToCountyLayer(layer);
}

async function loadStateBoundaries() {
  try {
    if (typeof topojson === "undefined") {
      throw new Error("TopoJSON library not loaded.");
    }
    const urls = [
      "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json",
      "https://unpkg.com/us-atlas@3/states-10m.json",
      "https://cdnjs.cloudflare.com/ajax/libs/us-atlas/3.0.1/states-10m.json"
    ];
    const topoData = await fetchTopoJson(urls, "state boundaries");
    const geojson = topojson.feature(topoData, topoData.objects.states);
    stateLayer.clearLayers();
    stateLayer.addData(geojson);
    stateFeatureByCode = new Map();
    if (geojson && Array.isArray(geojson.features)) {
      geojson.features.forEach((feature) => {
        const fips = String(feature.id || "").padStart(2, "0");
        const code = Object.keys(STATE_CODE_TO_FIPS).find(
          (key) => STATE_CODE_TO_FIPS[key] === fips
        );
        if (code) {
          stateFeatureByCode.set(`US-${code}`, feature);
        }
      });
    }
    applyBoundaryStyles();
    ensureBoundaryVisibility();
  } catch (error) {
    console.error(error);
    setStatus("State boundaries unavailable.");
  }
}

function zoomToRegion(regionCode) {
  const region = String(regionCode || "").toUpperCase();
  const feature = stateFeatureByCode.get(region);
  if (!feature) {
    return;
  }
  try {
    const layer = L.geoJSON(feature);
    const bounds = layer.getBounds();
    if (bounds && bounds.isValid()) {
      map.fitBounds(bounds.pad(0.1), { maxZoom: 7 });
    }
  } catch (error) {
    console.error(error);
  }
}

async function fetchTopoJson(urls, label) {
  let lastError = null;
  for (const url of urls) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`${label} fetch failed (${response.status})`);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`Failed to load ${label}.`);
}

const debouncedRefresh = debounce(refreshData, 400);
const debouncedHighResLoad = debounce(loadHighResCounties, 700);

daysInput.addEventListener("input", () => {
  daysValue.textContent = daysInput.value;
  const { countyFiltered, abaFiltered } = applyAllFilters();
  renderSightingsTable(countyFiltered);
  updateUniqueCount(countyFiltered);
  renderAllMarkers();
  renderAbaTable(
    abaFiltered,
    abaData.length
      ? "<tr><td colspan='6'>No ABA results for current filters.</td></tr>"
      : "<tr><td colspan='6'>No ABA results returned by eBird.</td></tr>"
  );
});
regionSelect.addEventListener("change", () => {
  const region = regionSelect.value || DEFAULT_REGION;
  // County polygons are geographic; if the region changes, clear the county
  // selection so we don't accidentally filter new-region points by an old
  // county shape.
  selectedCounty = null;
  selectedCountyId = null;
  selectedCountyLayer = null;
  selectedCountyName = null;
  if (countyLayer) {
    countyLayer.setStyle(getCountyStyle);
  }
  if (countyLabelLayer) {
    countyLabelLayer.clearLayers();
  }
  updateSelectedRegionTitle();
  suppressMarkerFitOnce = true;
  zoomToRegion(region);
  refreshData();
});
speciesSelect.addEventListener("change", () => {
  const filtered = getFilteredData();
  const filteredForTable = filterBySpecies(
    filterCountyByCode(applyCountyFilters(filterByDays(allData)))
  );
  activeSpeciesHighlight = speciesSelect.value ? speciesSelect.value : null;
  expandedCounties.clear();
  const abaCode = getAbaCodeForSpecies(activeSpeciesHighlight);
  if (abaCodeMin && Number.isFinite(abaCode)) {
    const current = Number(abaCodeMin.value);
    if (Number.isFinite(current) && current > abaCode) {
      abaCodeMin.value = String(abaCode);
      abaCodeValue.textContent = String(abaCode);
    }
  }
  if (countyCodeMin && countyCodeValue && Number.isFinite(abaCode)) {
    const current = Number(countyCodeMin.value);
    if (Number.isFinite(current) && current > abaCode) {
      countyCodeMin.value = String(abaCode);
      countyCodeValue.textContent = String(abaCode);
    }
  }
  renderSightingsTable(filteredForTable);
  updateUniqueCount(filteredForTable);
  renderAllMarkers();
  const abaFiltered = getFilteredAbaData();
  renderAbaTable(abaFiltered);
  zoomToObservationExtent(filteredForTable);
});
refreshBtn.addEventListener("click", () => {
  const region = regionSelect.value || DEFAULT_REGION;
  suppressMarkerFitOnce = true;
  zoomToRegion(region);
  refreshData();
});
clearBtn.addEventListener("click", () => {
  selectedCounty = null;
  selectedCountyId = null;
  selectedCountyLayer = null;
  selectedCountyName = null;
  expandedCounties.clear();
  countyLayer.setStyle(getCountyStyle);
  speciesSelect.value = "";
  activeSpeciesHighlight = null;
  const filtered = getFilteredData();
  renderSightingsTable(filtered);
  updateUniqueCount(filtered);
  renderAllMarkers();
  const abaFiltered = getFilteredAbaData();
  renderAbaTable(abaFiltered);
  setStatus("Filters cleared.");
});

// Google Maps buttons
const googleMapAba = document.getElementById("googleMapAba");
const googleMapNotable = document.getElementById("googleMapNotable");

if (googleMapAba) {
  googleMapAba.addEventListener("click", () => {
    openGoogleMapsWithData("abaSightingsBody");
  });
}

if (googleMapNotable) {
  googleMapNotable.addEventListener("click", () => {
    openGoogleMapsWithData("sightingsBody");
  });
}

// Select all/none checkboxes
const selectAllAba = document.getElementById("selectAllAba");
const selectAllNotable = document.getElementById("selectAllNotable");

if (selectAllAba) {
  selectAllAba.addEventListener("change", (e) => {
    const checkboxes = document.querySelectorAll("#abaSightingsBody .export-checkbox");
    checkboxes.forEach(cb => cb.checked = e.target.checked);
  });
}

if (selectAllNotable) {
  selectAllNotable.addEventListener("change", (e) => {
    const checkboxes = document.querySelectorAll("#sightingsBody .export-checkbox");
    checkboxes.forEach(cb => cb.checked = e.target.checked);
  });
}

function openGoogleMapsWithData(tableBodyId) {
  const tableBody = document.getElementById(tableBodyId);
  if (!tableBody) {
    setStatus("Table not found");
    return;
  }
  
  // Get all checked rows
  const checkedRows = tableBody.querySelectorAll("tr[data-row-id]");
  const locations = [];
  const seen = new Set();
  
  checkedRows.forEach(row => {
    const checkbox = row.querySelector(".export-checkbox");
    if (!checkbox || !checkbox.checked) return;
    
    const lat = Number(row.dataset.lat);
    const lng = Number(row.dataset.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
      if (!seen.has(key)) {
        seen.add(key);
        locations.push({
          lat,
          lng,
          name: row.dataset.species || "Unknown",
          location: "",
          lastDate: row.dataset.last || "",
          firstDate: row.dataset.first || "",
          county: row.dataset.county || "",
          state: row.dataset.state || "",
          abaCode: row.dataset.aba || "",
          checklistId: "",
          locId: row.dataset.locid || ""
        });
      }
    }
  });
  
  if (locations.length === 0) {
    setStatus("No checked locations to export");
    return;
  }
  
  // Generate KML file for Google My Maps import
  const kml = generateKML(locations);
  
  // Create download
  const blob = new Blob([kml], { type: "application/vnd.google-earth.kml+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ebird-rarities-${new Date().toISOString().split('T')[0]}.kml`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  // Open Google My Maps in new tab to help user import
  setTimeout(() => {
    window.open("https://www.google.com/maps/d/", "_blank");
  }, 500);
  
  setStatus(`Downloaded KML file with ${locations.length} location${locations.length > 1 ? 's' : ''}. Import it in Google My Maps (opened in new tab) by clicking "Create a New Map" → "Import".`);
}

function generateKML(locations) {
  const escapeXML = (str) => {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  };
  
  const placemarks = locations.map(loc => {
    const abaColor = loc.abaCode ? getAbaColor(loc.abaCode) : "#999999";
    const checklistLink = loc.checklistId 
      ? `https://ebird.org/checklist/${loc.checklistId}`
      : "";
    const locationLink = loc.locId
      ? `https://ebird.org/hotspot/${loc.locId}`
      : "";
    
    let description = `<![CDATA[
      <b>Species:</b> ${escapeXML(loc.name)}<br/>
      ${locationLink ? `<b>eBird Location:</b> <a href="${locationLink}" target="_blank">View on eBird</a><br/>` : ""}
      ${loc.county ? `<b>County:</b> ${escapeXML(loc.county)}<br/>` : ""}
      ${loc.state ? `<b>State:</b> ${escapeXML(loc.state)}<br/>` : ""}
      ${loc.lastDate ? `<b>Last Seen:</b> ${escapeXML(loc.lastDate)}<br/>` : ""}
      ${loc.firstDate ? `<b>First Seen:</b> ${escapeXML(loc.firstDate)}<br/>` : ""}
      ${loc.abaCode ? `<b>ABA Code:</b> <span style="background: ${abaColor}; color: white; padding: 2px 6px; border-radius: 3px;">${loc.abaCode}</span><br/>` : ""}
      ${checklistLink ? `<b>Checklist:</b> <a href="${checklistLink}" target="_blank">View Checklist</a><br/>` : ""}
    ]]>`;
    
    return `    <Placemark>
      <name>${escapeXML(loc.name)}</name>
      <description>${description}</description>
      <Point>
        <coordinates>${loc.lng},${loc.lat},0</coordinates>
      </Point>
    </Placemark>`;
  }).join("\n");
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>eBird Rarities - ${new Date().toISOString().split('T')[0]}</name>
    <description>Rare bird observations from eBird Rarity Mapper</description>
${placemarks}
  </Document>
</kml>`;
}

baseLayerRadios.forEach((radio) => {
  radio.addEventListener("change", () => {
    if (radio.checked) {
      setBaseLayer(radio.value);
      ensureBoundaryVisibility();
    }
  });
});

if (showCountyMap) {
  showCountyMap.addEventListener("change", () => {
    const enabled = showCountyMap.checked;
    setOverlay(notReviewedLayer, enabled);
    setOverlay(acceptedLayer, enabled);
  });
}

if (highResCountiesToggle) {
  highResCountiesToggle.addEventListener("change", () => {
    if (highResCountiesToggle.checked) {
      highResCountyLayer.addTo(map);
      loadHighResCounties();
    } else {
      highResCountyLayer.clearLayers();
      if (map.hasLayer(highResCountyLayer)) {
        map.removeLayer(highResCountyLayer);
      }
    }
    ensureBoundaryVisibility();
  });
}

if (showAbaMap) {
  showAbaMap.addEventListener("change", () => {
    const enabled = showAbaMap.checked;
    setOverlay(abaLayer, enabled);
    if (enabled) {
      refreshAbaData(daysInput.value, { renderMap: true });
    } else {
      // Re-render unified clustering without Lower 48 data
      renderAllMarkers();
    }
  });
}

if (showSpeciesLabels) {
  showSpeciesLabels.addEventListener("change", () => {
    renderAllMarkers();
  });
}

if (appTitleHome) {
  const reloadPage = () => {
    window.location.reload();
  };
  appTitleHome.addEventListener("click", reloadPage);
  appTitleHome.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      reloadPage();
    }
  });
}

if (showSpeciesLabels) {
  showSpeciesLabels.addEventListener("change", () => {
    renderAllMarkers();
  });
}

if (sightingsBody) {
  sightingsBody.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const stateButton = target.closest(".state-link");
    if (stateButton) {
      const state = stateButton.getAttribute("data-state");
      if (state) {
        focusRegionFromStateCode(state);
      }
      return;
    }
    
    // Check for county link click
    const countyButton = target.closest(".county-link");
    if (countyButton) {
      const state = countyButton.getAttribute("data-state");
      const county = countyButton.getAttribute("data-county");
      if (state && county) {
        selectCountyByName(state, county);
      }
      return;
    }
    
    // Check for species link click
    const button = target.closest(".species-link");
    if (!button) {
      return;
    }
    const lat = Number(button.getAttribute("data-lat"));
    const lng = Number(button.getAttribute("data-lng"));
    const species = button.getAttribute("data-species") || "";
    setSpeciesHighlight(species);
    if (species) {
      setStatus(`Highlighting ${species} on the map.`);
    }
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      map.flyTo([lat, lng], 11, { duration: 0.6 });
    }
  });
}

if (abaSightingsBody) {
  abaSightingsBody.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const stateButton = target.closest(".state-link");
    if (stateButton) {
      const state = stateButton.getAttribute("data-state");
      if (state) {
        focusRegionFromStateCode(state);
      }
      return;
    }
    
    // Check for county link click
    const countyButton = target.closest(".county-link");
    if (countyButton) {
      const state = countyButton.getAttribute("data-state");
      const county = countyButton.getAttribute("data-county");
      if (state && county) {
        selectCountyByName(state, county);
      }
      return;
    }
    
    // Check for species link click
    const button = target.closest(".species-link");
    if (!button) {
      return;
    }
    const lat = Number(button.getAttribute("data-lat"));
    const lng = Number(button.getAttribute("data-lng"));
    const species = button.getAttribute("data-species") || "";
    if (species) {
      setSpeciesHighlight(species);
      setStatus(`Highlighting ${species} on the map.`);
    }
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      map.flyTo([lat, lng], 11, { duration: 0.6 });
    }
  });
}

map.whenReady(async () => {
  setOverlay(cartoLabels, true);
  setOverlay(notReviewedLayer, showCountyMap?.checked ?? true);
  setOverlay(acceptedLayer, showCountyMap?.checked ?? true);
  setOverlay(abaLayer, showAbaMap?.checked ?? true);
  await loadCountyBoundaries();
  await loadStateBoundaries();
  applyBoundaryStyles();
  ensureBoundaryVisibility();
  setTimeout(() => {
    map.invalidateSize();
    applyBoundaryStyles();
    ensureBoundaryVisibility();
  }, 300);
  setTimeout(() => ensureBoundaryVisibility(), 1200);
  if (!abaData.length) {
    refreshAbaData(daysInput.value, { renderMap: showAbaMap?.checked ?? false });
  }
});

window.addEventListener("load", () => {
  map.invalidateSize();
  loadCountyBoundaries();
  loadStateBoundaries();
  applyBoundaryStyles();
  ensureBoundaryVisibility();
});

if (abaCodeMin && abaCodeValue) {
  abaCodeMin.addEventListener("input", () => {
    abaCodeValue.textContent = abaCodeMin.value;
    expandedCounties.clear();
    renderAllMarkers();
    const abaFiltered = getFilteredAbaData();
    renderAbaTable(abaFiltered);
  });
}

if (countyCodeMin && countyCodeValue) {
  countyCodeMin.addEventListener("input", () => {
    countyCodeValue.textContent = countyCodeMin.value;
    const filtered = getFilteredData();
    const filteredForTable = filterBySpecies(
      filterCountyByCode(applyCountyFilters(filterByDays(allData)))
    );
    renderSightingsTable(filteredForTable);
    updateUniqueCount(filteredForTable);
    renderAllMarkers();
  });
}

loadRegions().then(refreshData);
loadAbaMeta();
map.on("zoomend", () => loadCountyBoundaries());
map.on("zoomend", () => applyBoundaryStyles());
map.on("moveend", () => {
  if (highResCountiesToggle && highResCountiesToggle.checked) {
    debouncedHighResLoad();
  }
});
map.on("zoomend", () => {
  if (highResCountiesToggle && highResCountiesToggle.checked) {
    debouncedHighResLoad();
  }
});
