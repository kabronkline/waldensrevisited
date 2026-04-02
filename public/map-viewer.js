// Interactive Map Viewer — Common Area Easement Overlay
// Lazy-loads Leaflet on first open, mirrors pdf-viewer.js modal pattern

var mapInstance = null;
var mapLayers = {};
var geoWatchId = null;
var geoMarker = null;
var geoAccuracyCircle = null;
var legendVisible = false;

// ============================================================
// METES AND BOUNDS SURVEY DATA
// BK 1559, PG 2106-2108, Delaware County Recorder
// Surveyed: March 15, 2014 by Karen S. Coffman, P.S. 7845
// ============================================================

var ANCHOR_LAT = 40.3187914;
var ANCHOR_LNG = -83.2014584;

function dmsToDecimal(deg, min, sec) {
  return deg + min / 60 + sec / 3600;
}

function surveyBearingToAzimuth(q, deg, min, sec, dir) {
  var angle = dmsToDecimal(deg, min, sec);
  if (q === 'N' && dir === 'E') return angle;
  if (q === 'N' && dir === 'W') return 360 - angle;
  if (q === 'S' && dir === 'E') return 180 - angle;
  if (q === 'S' && dir === 'W') return 180 + angle;
  return 0;
}

function movePoint(lat, lng, azimuthDeg, distanceFeet) {
  var distanceMeters = distanceFeet * 0.3048;
  var R = 6378137;
  var azRad = azimuthDeg * Math.PI / 180;
  var latRad = lat * Math.PI / 180;
  var lngRad = lng * Math.PI / 180;
  var d = distanceMeters / R;
  var newLatRad = Math.asin(
    Math.sin(latRad) * Math.cos(d) +
    Math.cos(latRad) * Math.sin(d) * Math.cos(azRad)
  );
  var newLngRad = lngRad + Math.atan2(
    Math.sin(azRad) * Math.sin(d) * Math.cos(latRad),
    Math.cos(d) - Math.sin(latRad) * Math.sin(newLatRad)
  );
  return [newLatRad * 180 / Math.PI, newLngRad * 180 / Math.PI];
}

var SURVEY_LEGS = [
  { q: 'N', d: 10, m: 56, s: 43, dir: 'W', dist: 85.26, label: 'L1 (to TRUE POB)' },
  { q: 'N', d: 10, m: 56, s: 43, dir: 'W', dist: 20.00, label: 'L2' },
  { q: 'N', d: 79, m: 3, s: 17, dir: 'E', dist: 554.91, label: 'L3' },
  { q: 'N', d: 49, m: 9, s: 50, dir: 'E', dist: 135.59, label: 'L4' },
  { q: 'N', d: 55, m: 49, s: 50, dir: 'W', dist: 154.04, label: 'L5' },
  { q: 'N', d: 15, m: 30, s: 51, dir: 'W', dist: 281.92, label: 'L6' },
  { q: 'N', d: 32, m: 36, s: 55, dir: 'E', dist: 275.78, label: 'L7' },
  { q: 'N', d: 10, m: 20, s: 49, dir: 'W', dist: 142.89, label: 'L8' },
  { q: 'N', d: 62, m: 14, s: 39, dir: 'W', dist: 63.88, label: 'L9' },
  { q: 'S', d: 74, m: 7, s: 25, dir: 'W', dist: 249.94, label: 'L10' },
  { q: 'N', d: 0, m: 46, s: 54, dir: 'W', dist: 233.04, label: 'L11' },
  { q: 'N', d: 74, m: 7, s: 25, dir: 'E', dist: 378.64, label: 'L12' },
  { q: 'S', d: 10, m: 56, s: 43, dir: 'E', dist: 225.84, label: 'L13' },
  { q: 'S', d: 73, m: 42, s: 55, dir: 'W', dist: 47.14, label: 'L14' },
  { q: 'S', d: 31, m: 34, s: 56, dir: 'W', dist: 62.90, label: 'L15' },
  { q: 'S', d: 10, m: 20, s: 49, dir: 'E', dist: 145.45, label: 'L16' },
  { q: 'S', d: 56, m: 38, s: 11, dir: 'E', dist: 287.89, label: 'L17' },
  { q: 'S', d: 1, m: 4, s: 24, dir: 'W', dist: 329.55, label: 'L18' },
  { q: 'S', d: 40, m: 49, s: 1, dir: 'E', dist: 177.65, label: 'L19' },
  { q: 'S', d: 47, m: 6, s: 21, dir: 'W', dist: 198.70, label: 'L20' },
  { q: 'N', d: 47, m: 52, s: 48, dir: 'W', dist: 220.40, label: 'L21' },
  { q: 'S', d: 49, m: 9, s: 50, dir: 'W', dist: 145.26, label: 'L22' },
  { q: 'S', d: 79, m: 3, s: 17, dir: 'W', dist: 560.25, label: 'L23 (to TRUE POB)' }
];

function computeEasementCoords() {
  var pos = [ANCHOR_LAT, ANCHOR_LNG];
  var l1 = SURVEY_LEGS[0];
  var az = surveyBearingToAzimuth(l1.q, l1.d, l1.m, l1.s, l1.dir);
  pos = movePoint(pos[0], pos[1], az, l1.dist);
  var truePOB = [pos[0], pos[1]];
  var coords = [truePOB];
  for (var i = 1; i < SURVEY_LEGS.length; i++) {
    var leg = SURVEY_LEGS[i];
    az = surveyBearingToAzimuth(leg.q, leg.d, leg.m, leg.s, leg.dir);
    pos = movePoint(pos[0], pos[1], az, leg.dist);
    coords.push([pos[0], pos[1]]);
  }
  return { truePOB: truePOB, coords: coords };
}

// ============================================================
// CSS INJECTION
// ============================================================

function injectMapStyles() {
  if (document.getElementById('mapViewerStyles')) return;
  var style = document.createElement('style');
  style.id = 'mapViewerStyles';
  style.textContent =
    '.map-modal-overlay{display:none;position:fixed;inset:0;background:#000;z-index:10000;flex-direction:column}' +
    '.map-modal-overlay.active{display:flex}' +
    '.map-modal-toolbar{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;background:#2e4032;color:#fff;flex-shrink:0;flex-wrap:wrap;gap:8px;z-index:10002}' +
    '.map-modal-toolbar-left{display:flex;align-items:center;gap:12px;flex-shrink:0}' +
    '.map-toolbar-title{font-size:0.85rem;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:300px}' +
    '.map-modal-toolbar-center{display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:center}' +
    '.map-modal-toolbar-right{display:flex;align-items:center;gap:8px;flex-shrink:0;margin-left:auto}' +
    '.map-tb-btn{background:rgba(255,255,255,0.15);border:none;color:#fff;height:36px;border-radius:4px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.2s;padding:0 12px;font-size:0.8rem;gap:6px;font-family:inherit}' +
    '.map-tb-btn:hover{background:rgba(255,255,255,0.25)}' +
    '.map-tb-btn.active{background:rgba(255,255,255,0.3)}' +
    '.map-tb-icon{background:rgba(255,255,255,0.15);border:none;color:#fff;width:36px;height:36px;border-radius:4px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.2s}' +
    '.map-tb-icon:hover{background:rgba(255,255,255,0.25)}' +
    '.map-tb-icon.active{background:rgba(255,255,255,0.3)}' +
    '.map-modal-close{background:rgba(255,255,255,0.15);border:none;color:#fff;width:36px;height:36px;border-radius:4px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.2s}' +
    '.map-modal-close:hover{background:rgba(220,80,80,0.7)}' +
    '#mapContainer{flex:1;position:relative;z-index:10001}' +
    /* Legend panel */
    '.map-legend{position:absolute;bottom:30px;left:10px;background:rgba(250,248,244,0.95);padding:14px 16px;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,0.3);font-size:13px;line-height:1.6;max-width:280px;z-index:10003;font-family:Inter,-apple-system,sans-serif;display:none;max-height:calc(100% - 60px);overflow-y:auto}' +
    '.map-legend.visible{display:block}' +
    '.map-legend h4{margin-bottom:6px;font-size:15px;font-family:"Cormorant Garamond",Georgia,serif;font-weight:600;color:#1a2e23}' +
    '.map-legend-item{display:flex;align-items:center;gap:8px;margin:4px 0}' +
    '.map-legend-swatch{width:20px;height:14px;border-radius:2px;flex-shrink:0}' +
    '.map-legend-divider{border:none;border-top:1px solid #ddd;margin:8px 0}' +
    '.map-legend-details{font-size:11px;color:#5a6b60}' +
    '.map-legend-toggle{cursor:pointer;background:none;border:none;color:#5a6b60;font-size:12px;padding:4px 0;font-family:inherit;text-align:left}' +
    '.map-legend-toggle:hover{color:#1a2e23}' +
    '.map-legend-section{display:none;margin-top:6px}' +
    '.map-legend-section.visible{display:block}' +
    /* Geolocation button */
    '.map-geo-btn{position:absolute;bottom:110px;right:10px;width:40px;height:40px;background:#fff;border:2px solid rgba(0,0,0,0.2);border-radius:4px;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:10003;box-shadow:0 1px 5px rgba(0,0,0,0.3)}' +
    '.map-geo-btn:hover{background:#f4f4f4}' +
    '.map-geo-btn.tracking{background:#e8f4ea}' +
    '.map-geo-btn svg{width:20px;height:20px}' +
    /* Loading overlay */
    '.map-loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);z-index:10004;color:#fff;font-family:Inter,-apple-system,sans-serif;font-size:0.9rem}' +
    '.map-loading-spinner{width:32px;height:32px;border:3px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:mapSpin 0.8s linear infinite;margin-right:12px}' +
    '@keyframes mapSpin{to{transform:rotate(360deg)}}' +
    /* Pulsing geo dot */
    '.map-geo-pulse{width:16px;height:16px;background:#4285f4;border:3px solid #fff;border-radius:50%;box-shadow:0 0 6px rgba(66,133,244,0.6)}' +
    /* Mobile */
    '@media(max-width:768px){' +
      '.map-toolbar-title{display:none}' +
      '.map-modal-toolbar{padding:8px;gap:4px}' +
      '.map-tb-btn{height:32px;padding:0 8px;font-size:0.75rem}' +
      '.map-tb-icon{width:32px;height:32px}' +
      '.map-modal-close{width:32px;height:32px}' +
      '.map-legend{bottom:10px;left:10px;right:10px;max-width:none;border-radius:12px 12px 12px 12px}' +
      '.map-geo-btn{bottom:90px;right:10px;width:36px;height:36px}' +
      '.map-tb-btn .map-btn-label{display:none}' +
    '}';
  document.head.appendChild(style);
}

// ============================================================
// MODAL DOM
// ============================================================

function ensureMapModal() {
  if (document.getElementById('mapModal')) return;
  var overlay = document.createElement('div');
  overlay.className = 'map-modal-overlay';
  overlay.id = 'mapModal';
  overlay.innerHTML =
    '<div class="map-modal-toolbar">' +
      '<div class="map-modal-toolbar-left">' +
        '<span class="map-toolbar-title">Common Area Easement</span>' +
      '</div>' +
      '<div class="map-modal-toolbar-center">' +
        '<button class="map-tb-btn active" id="mapBtnSat" title="Satellite view">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>' +
          '<span class="map-btn-label">Satellite</span>' +
        '</button>' +
        '<button class="map-tb-btn" id="mapBtnStreet" title="Street map view">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>' +
          '<span class="map-btn-label">Map</span>' +
        '</button>' +
        '<span style="width:1px;height:24px;background:rgba(255,255,255,0.2);margin:0 2px"></span>' +
        '<button class="map-tb-icon" id="mapBtnLegend" title="Toggle legend">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>' +
        '</button>' +
        '<button class="map-tb-btn" id="mapBtnSurveyPdf" title="View metes and bounds survey">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>' +
          '<span class="map-btn-label">Survey PDF</span>' +
        '</button>' +
      '</div>' +
      '<div class="map-modal-toolbar-right">' +
        '<button class="map-modal-close" id="mapCloseBtn" title="Close map">' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
        '</button>' +
      '</div>' +
    '</div>' +
    '<div id="mapContainer">' +
      '<div class="map-loading" id="mapLoading">' +
        '<div class="map-loading-spinner"></div>Loading map...' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  document.getElementById('mapCloseBtn').addEventListener('click', closeMapViewer);
  document.getElementById('mapBtnSat').addEventListener('click', function() { switchBaseLayer('satellite'); });
  document.getElementById('mapBtnStreet').addEventListener('click', function() { switchBaseLayer('street'); });
  document.getElementById('mapBtnLegend').addEventListener('click', toggleLegend);
  document.getElementById('mapBtnSurveyPdf').addEventListener('click', function() {
    closeMapViewer();
    setTimeout(function() {
      if (window.openPdfViewer) {
        window.openPdfViewer('/metes-and-bounds-2018.pdf', 'Metes & Bounds of Common Areas \u2014 2018');
      }
    }, 350);
  });
}

// ============================================================
// LEAFLET LAZY LOADING
// ============================================================

function loadLeaflet(callback) {
  if (window.L) { callback(); return; }
  var link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  document.head.appendChild(link);

  var script = document.createElement('script');
  script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
  script.onload = callback;
  document.head.appendChild(script);
}

// ============================================================
// MAP INITIALIZATION
// ============================================================

function buildMap() {
  var container = document.getElementById('mapContainer');

  // Remove loading indicator
  var loading = document.getElementById('mapLoading');
  if (loading) loading.remove();

  // Create map div
  var mapDiv = document.createElement('div');
  mapDiv.id = 'mapLeaflet';
  mapDiv.style.cssText = 'width:100%;height:100%;position:absolute;inset:0;';
  container.appendChild(mapDiv);

  var map = L.map('mapLeaflet', {
    center: [40.3220, -83.2040],
    zoom: 17,
    maxZoom: 20,
    zoomControl: true
  });

  // Base layers
  var satellite = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Tiles &copy; Esri', maxZoom: 20 }
  );
  var roadLabels = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 20, opacity: 0.7 }
  );
  var placeNames = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 20, opacity: 0.8 }
  );
  var osm = L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 }
  );

  satellite.addTo(map);
  roadLabels.addTo(map);
  placeNames.addTo(map);

  mapLayers = { satellite: satellite, roadLabels: roadLabels, placeNames: placeNames, osm: osm };

  // Compute easement
  var survey = computeEasementCoords();
  var truePOB = survey.truePOB;
  var easementCoords = survey.coords;

  // Easement polygon
  var easementPolygon = L.polygon(easementCoords, {
    color: '#e67e22',
    weight: 3,
    opacity: 0.95,
    fillColor: '#f39c12',
    fillOpacity: 0.2,
    dashArray: '10, 5'
  }).addTo(map);

  easementPolygon.bindPopup(
    '<strong>Common Use Easement</strong><br>' +
    'Walden\'s Revisited<br>' +
    'Filed: BK 1559, PG 2106\u20132108<br>' +
    'Surveyed: March 15, 2014<br>' +
    'Surveyor: Karen S. Coffman, P.S. 7845'
  );

  // Anchor marker (commencement point)
  var anchorMarker = L.circleMarker([ANCHOR_LAT, ANCHOR_LNG], {
    radius: 6, color: '#c0392b', fillColor: '#c0392b', fillOpacity: 1, weight: 2
  }).addTo(map);
  anchorMarker.bindPopup(
    '<strong>COMMENCEMENT POINT</strong><br>' +
    'Slocum Rd (TR 168) & Brindle Rd (TR 170)<br>' +
    'centerline intersection'
  );

  // True POB marker
  var pobMarker = L.circleMarker(truePOB, {
    radius: 7, color: '#d4a017', fillColor: '#d4a017', fillOpacity: 1, weight: 2
  }).addTo(map);
  pobMarker.bindPopup(
    '<strong>TRUE POINT OF BEGINNING</strong><br>' +
    'N10\u00b056\'43"W, 85.26 ft from commencement'
  );

  // Vertex markers (hidden by default)
  var vertexGroup = L.layerGroup();
  easementCoords.forEach(function(coord, i) {
    if (i === 0) return;
    var legIdx = i + 1;
    if (legIdx <= 23) {
      L.circleMarker(coord, {
        radius: 3, color: '#fff', fillColor: '#e67e22', fillOpacity: 0.8, weight: 1
      }).bindTooltip('L' + legIdx, {
        permanent: false, direction: 'top'
      }).addTo(vertexGroup);
    }
  });

  // Show vertices by default
  vertexGroup.addTo(map);

  // Scale bar
  L.control.scale({ imperial: true, metric: true }).addTo(map);

  // Fit bounds
  map.fitBounds(easementPolygon.getBounds().pad(0.15));

  // Store references for layer toggling
  mapLayers.vertexGroup = vertexGroup;
  mapLayers.anchorMarker = anchorMarker;
  mapLayers.pobMarker = pobMarker;
  mapLayers.easementPolygon = easementPolygon;

  mapInstance = map;

  // Build legend
  buildLegend(container);

  // Build geolocation button
  buildGeoButton(container);

  // Fix Leaflet rendering after modal show
  setTimeout(function() { map.invalidateSize(); }, 100);
}

// ============================================================
// LEGEND
// ============================================================

function buildLegend(container) {
  var legend = document.createElement('div');
  legend.className = 'map-legend';
  legend.id = 'mapLegend';
  legend.innerHTML =
    '<h4>Common Area Easement</h4>' +
    '<div class="map-legend-item">' +
      '<div class="map-legend-swatch" style="background:rgba(243,156,18,0.25);border:2px dashed #e67e22;"></div>' +
      '<span>Common Use Easement</span>' +
    '</div>' +
    '<div class="map-legend-item">' +
      '<div class="map-legend-swatch" style="background:#c0392b;border-radius:50%;width:14px;height:14px;"></div>' +
      '<span>Commencement Point</span>' +
    '</div>' +
    '<div class="map-legend-item">' +
      '<div class="map-legend-swatch" style="background:#d4a017;border-radius:50%;width:14px;height:14px;"></div>' +
      '<span>True Point of Beginning</span>' +
    '</div>' +
    '<hr class="map-legend-divider">' +
    '<label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;margin:4px 0;">' +
      '<input type="checkbox" id="mapVertexToggle" checked> Show survey vertices (L2\u2013L23)' +
    '</label>' +
    '<hr class="map-legend-divider">' +
    '<button class="map-legend-toggle" id="mapDetailsToggle">Survey details \u25B6</button>' +
    '<div class="map-legend-section" id="mapDetailsSection">' +
      '<div class="map-legend-details">' +
        '<strong>Recording:</strong> BK 1559, PG 2106\u20132108<br>' +
        'Delaware County Recorder<br>' +
        'Filed: 03/13/2018<br>' +
        'Survey Date: 03/15/2014<br>' +
        '<strong>Tracts:</strong> 2, 3, 5, 6, 7, 15<br>' +
        '<hr class="map-legend-divider">' +
        '<strong>Surveyor:</strong><br>' +
        'Karen S. Coffman, P.S. 7845<br>' +
        'Scioto Land Surveying Service<br>' +
        '173 North Sandusky Street<br>' +
        'Delaware, Ohio 43015<br>' +
        '<hr class="map-legend-divider">' +
        '<strong>Legal Description:</strong><br>' +
        'Part of Sub-Lots D & E of Lot 10,<br>' +
        'E. Gill\'s Virginia Military Survey No. 4267<br>' +
        'Scioto Township, Delaware County, Ohio<br>' +
        '<strong>Basis of Bearings:</strong><br>' +
        'Brindle Rd centerline N 10\u00b056\'43" W<br>' +
        'per ORV 1036, Pg 394' +
      '</div>' +
    '</div>';
  container.appendChild(legend);

  document.getElementById('mapVertexToggle').addEventListener('change', function() {
    if (this.checked) {
      mapLayers.vertexGroup.addTo(mapInstance);
    } else {
      mapInstance.removeLayer(mapLayers.vertexGroup);
    }
  });

  document.getElementById('mapDetailsToggle').addEventListener('click', function() {
    var section = document.getElementById('mapDetailsSection');
    var isVisible = section.classList.contains('visible');
    section.classList.toggle('visible');
    this.textContent = isVisible ? 'Survey details \u25B6' : 'Survey details \u25BC';
  });
}

// ============================================================
// GEOLOCATION
// ============================================================

function buildGeoButton(container) {
  var btn = document.createElement('button');
  btn.className = 'map-geo-btn';
  btn.id = 'mapGeoBtn';
  btn.title = 'Show my location';
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#333" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg>';
  container.appendChild(btn);

  btn.addEventListener('click', function() {
    if (geoWatchId !== null) {
      stopGeolocation();
    } else {
      startGeolocation();
    }
  });
}

function startGeolocation() {
  if (!navigator.geolocation) return;
  var btn = document.getElementById('mapGeoBtn');
  if (btn) btn.classList.add('tracking');

  geoWatchId = navigator.geolocation.watchPosition(
    function(pos) {
      var lat = pos.coords.latitude;
      var lng = pos.coords.longitude;
      var acc = pos.coords.accuracy;

      if (geoMarker) {
        geoMarker.setLatLng([lat, lng]);
        if (geoAccuracyCircle) geoAccuracyCircle.setLatLng([lat, lng]).setRadius(acc);
      } else {
        geoMarker = L.marker([lat, lng], {
          icon: L.divIcon({
            className: '',
            html: '<div class="map-geo-pulse"></div>',
            iconSize: [16, 16],
            iconAnchor: [8, 8]
          })
        }).addTo(mapInstance);
        geoAccuracyCircle = L.circle([lat, lng], {
          radius: acc,
          color: '#4285f4',
          fillColor: '#4285f4',
          fillOpacity: 0.1,
          weight: 1
        }).addTo(mapInstance);
        mapInstance.setView([lat, lng], 18);
      }
    },
    function(err) {
      stopGeolocation();
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );
}

function stopGeolocation() {
  if (geoWatchId !== null) {
    navigator.geolocation.clearWatch(geoWatchId);
    geoWatchId = null;
  }
  if (geoMarker) { mapInstance.removeLayer(geoMarker); geoMarker = null; }
  if (geoAccuracyCircle) { mapInstance.removeLayer(geoAccuracyCircle); geoAccuracyCircle = null; }
  var btn = document.getElementById('mapGeoBtn');
  if (btn) btn.classList.remove('tracking');
}

// ============================================================
// BASE LAYER SWITCHING
// ============================================================

function switchBaseLayer(which) {
  if (!mapInstance) return;
  var satBtn = document.getElementById('mapBtnSat');
  var strBtn = document.getElementById('mapBtnStreet');

  if (which === 'satellite') {
    mapInstance.removeLayer(mapLayers.osm);
    mapLayers.satellite.addTo(mapInstance);
    mapLayers.roadLabels.addTo(mapInstance);
    mapLayers.placeNames.addTo(mapInstance);
    satBtn.classList.add('active');
    strBtn.classList.remove('active');
  } else {
    mapInstance.removeLayer(mapLayers.satellite);
    mapInstance.removeLayer(mapLayers.roadLabels);
    mapInstance.removeLayer(mapLayers.placeNames);
    mapLayers.osm.addTo(mapInstance);
    strBtn.classList.add('active');
    satBtn.classList.remove('active');
  }
}

// ============================================================
// LEGEND TOGGLE
// ============================================================

function toggleLegend() {
  var legend = document.getElementById('mapLegend');
  var btn = document.getElementById('mapBtnLegend');
  if (!legend) return;
  legendVisible = !legendVisible;
  legend.classList.toggle('visible', legendVisible);
  if (btn) btn.classList.toggle('active', legendVisible);
}

// ============================================================
// OPEN / CLOSE
// ============================================================

function openMapViewer() {
  injectMapStyles();
  ensureMapModal();
  document.getElementById('mapModal').classList.add('active');
  document.body.style.overflow = 'hidden';

  if (!mapInstance) {
    loadLeaflet(function() {
      buildMap();
    });
  } else {
    setTimeout(function() { mapInstance.invalidateSize(); }, 100);
  }
}

function closeMapViewer() {
  var modal = document.getElementById('mapModal');
  if (modal) modal.classList.remove('active');
  document.body.style.overflow = '';
  stopGeolocation();
}

// Keyboard shortcut
document.addEventListener('keydown', function(e) {
  var modal = document.getElementById('mapModal');
  if (!modal || !modal.classList.contains('active')) return;
  if (e.key === 'Escape') closeMapViewer();
});

// Export
window.openMapViewer = openMapViewer;
window.closeMapViewer = closeMapViewer;
