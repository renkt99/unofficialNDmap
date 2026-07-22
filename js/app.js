/*
 * app.js — map bootstrap, building layer, POI layer, layers control.
 * Exposes window.NDMap, a shared namespace used by panel.js / locate.js / search.js.
 */
(function () {
  'use strict';

  // Keep in sync with scripts/bounds.mjs BOUNDS — this file has no bundler
  // so it can't import that module directly. scripts/validate-data.mjs
  // parses this literal and fails CI if it drifts from bounds.mjs.
  var CAMPUS_BOUNDS = L.latLngBounds(
    [-32.0585, 115.7408],
    [-32.0522, 115.7465]
  );

  // Fixed rotation (via vendored leaflet-rotate) so building east/west walls
  // are vertical, matching the official PDF map. 20° = the Fremantle street
  // grid's offset from north (dominant footprint edge bearing ≈ 70°).
  var MAP_BEARING = 20;

  // Shared by the map's own maxZoom and the tile layer's maxZoom/maxNativeZoom
  // below — the CARTO Positron raster tiles top out at 19 too.
  var MAX_ZOOM = 19;

  var map = L.map('map', {
    center: [-32.0554, 115.7437],
    zoom: 17,
    minZoom: 16,
    maxZoom: MAX_ZOOM,
    // Padded: with the strict bounds, a phone viewport at minZoom already
    // spans more latitude than the campus, pinning the centre so panInside
    // (search.js) can never pull a highlighted building out from under the
    // bottom-sheet panel. The pad gives pan slack; campusBounds stays strict.
    maxBounds: CAMPUS_BOUNDS.pad(0.5),
    maxBoundsViscosity: 1.0,
    zoomControl: false,
    rotate: true,
    bearing: MAP_BEARING,
    // Rotation is fixed: suppress leaflet-rotate's user-facing rotation UI
    // and gestures (rotateControl + shiftKeyRotate default to ON).
    rotateControl: false,
    shiftKeyRotate: false,
    touchRotate: false
  });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: MAX_ZOOM,
    maxNativeZoom: MAX_ZOOM
  }).addTo(map);

  L.control.zoom({ position: 'bottomright' }).addTo(map);
  // Stays 'bottomleft' — bottomright was tried and rejected: it already
  // holds the zoom control + #locate-btn (a plain positioned div, not a
  // Leaflet control), and #locate-btn shares the bottom-right corner
  // container's z-index (1000) but is later in DOM order, so it painted over
  // the attribution text with no clean way to reorder it short of retuning
  // #locate-btn's pixel offsets around Leaflet's control stack height.
  // Instead, css/app.css shifts the licence-required OSM/CARTO attribution
  // clear of the desktop detail panel (left-docked, 320px, z-index 1300) via
  // a fixed left margin at the desktop breakpoint — independent of whether
  // the panel is open, so no JS state coupling is needed — and raises its
  // z-index above the mobile bottom sheet so it stays visible (composited
  // over the sheet) when that's open too. See the comment there.
  map.attributionControl.setPosition('bottomleft');

  // Must match the @media (min-width: 768px) breakpoints in css/app.css.
  var DESKTOP_MIN_WIDTH = 768;
  var isDesktop = window.matchMedia('(min-width: ' + DESKTOP_MIN_WIDTH + 'px)').matches;

  // Shared namespace other modules attach to.
  var NDMap = (window.NDMap = {
    map: map,
    campusBounds: CAMPUS_BOUNDS,
    buildingsById: {},
    buildingsData: null,
    selectedRef: null
  });

  // Escapes &, <, >, ", ' for safe insertion into innerHTML. Used throughout
  // panel.js and search.js wherever building/POI data is rendered as HTML.
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  NDMap.escapeHtml = escapeHtml;

  // ---- toast --------------------------------------------------------------
  // Shared here (rather than locate.js, its original home) since app.js
  // loads first and other modules — the buildings-load failure path below,
  // locate.js — all need it.

  var toastEl = document.getElementById('toast');
  var toastTimer = null;
  var TOAST_DEFAULT_DURATION_MS = 4000;
  // Shows `message` in the bottom toast for `duration` ms (defaults to
  // TOAST_DEFAULT_DURATION_MS), replacing/resetting any toast already shown.
  function showToast(message, duration) {
    toastEl.textContent = message;
    toastEl.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.add('hidden');
    }, duration || TOAST_DEFAULT_DURATION_MS);
  }
  NDMap.showToast = showToast;

  // ---- Building styling ----------------------------------------------

  // Brand colors — must match --navy (#002c61) and --navy-mid / --accent-blue
  // (#005cab) in css/app.css. Kept as JS constants rather than read from CSS
  // custom properties because Leaflet vector layer styles need plain color
  // strings, not var() references.
  var COLOR_NAVY = '#002c61';
  var COLOR_UNI_BLUE = '#005cab';

  function baseStyle(feature) {
    if (feature.properties.kind === 'courtyard') {
      return {
        color: COLOR_UNI_BLUE,
        weight: 1,
        opacity: 1,
        fillColor: '#69b3e3',
        fillOpacity: 0.9
      };
    }
    return {
      color: COLOR_NAVY,
      weight: 1,
      opacity: 1,
      fillColor: COLOR_UNI_BLUE,
      fillOpacity: 0.92
    };
  }

  // Selection highlight (search result / tapped building) — gold, so the
  // selected footprint is unmistakable against the blue buildings and the
  // beige context layer.
  function highlightStyle(feature) {
    return {
      color: COLOR_NAVY,
      weight: 2,
      opacity: 1,
      fillColor: '#ffc72c',
      fillOpacity: 0.95
    };
  }

  function pointStyle(feature) {
    var s = baseStyle(feature);
    s.radius = 8;
    return s;
  }

  function pointHighlightStyle(feature) {
    var s = highlightStyle(feature);
    s.radius = 10;
    return s;
  }

  // ---- Highlight / selection API (used by panel.js & search.js) ------

  // Restores the currently-selected building (NDMap.selectedRef, if any) to
  // its normal style and clears the selection. No-op if nothing is selected.
  NDMap.clearHighlight = function () {
    if (!NDMap.selectedRef) return;
    var entry = NDMap.buildingsById[NDMap.selectedRef];
    if (entry) {
      var layer = entry.layer;
      var style = layer.setRadius ? pointStyle(entry.feature) : baseStyle(entry.feature);
      layer.setStyle(style);
    }
    NDMap.selectedRef = null;
  };

  // Clears any existing highlight, then applies the gold highlight style to
  // the building with the given `ref` (a no-op if `ref` isn't known) and
  // records it as NDMap.selectedRef.
  NDMap.highlightBuilding = function (ref) {
    NDMap.clearHighlight();
    var entry = NDMap.buildingsById[ref];
    if (!entry) return;
    var layer = entry.layer;
    var style = layer.setRadius ? pointHighlightStyle(entry.feature) : highlightStyle(entry.feature);
    layer.setStyle(style);
    if (layer.bringToFront) layer.bringToFront();
    NDMap.selectedRef = ref;
  };

  // ---- Building label (permanent NDxx ref tooltip) --------------------
  // Refs only — names and contents live in the tap/click detail panel.

  function buildingLabelHtml(feature) {
    var ref = feature.properties.ref || '';
    return '<span class="label-ref">' + escapeHtml(ref) + '</span>';
  }

  // ---- Map background click closes the detail panel -------------------

  map.on('click', function () {
    if (NDMap.closePanel) NDMap.closePanel();
  });

  // ---- POI icons --------------------------------------------------------

  function poiIcon(kind) {
    var glyph, cls;
    if (kind === 'parking') {
      glyph = 'P';
      cls = 'poi-parking';
    } else {
      glyph = '🚌'; // bus emoji
      cls = 'poi-bus';
    }
    return L.divIcon({
      className: 'poi-icon-wrap',
      html: '<div class="poi-badge ' + cls + '">' + glyph + '</div>',
      iconSize: [26, 26],
      iconAnchor: [13, 13]
    });
  }

  function poiFilter(kind) {
    return function (feature) {
      return feature.properties && feature.properties.kind === kind;
    };
  }

  function bindPoiTooltip(feature, layer) {
    var name = feature.properties && feature.properties.name;
    if (name) {
      layer.bindTooltip(escapeHtml(name), { direction: 'top', offset: [0, -10] });
    }
  }

  // ---- Load data --------------------------------------------------------

  var buildingsPromise = fetch('data/buildings.geojson')
    .then(function (res) {
      if (!res.ok) throw new Error('buildings.geojson HTTP ' + res.status);
      return res.json();
    })
    .catch(function (err) {
      console.error('Failed to load buildings.geojson', err);
      showToast("Couldn't load building data — try reloading");
      return null;
    });

  // Non-campus buildings, drawn as muted beige blocks beneath the ND
  // buildings — the raster basemap's own footprints are too bright against
  // the cream tint. Non-interactive context only.
  var contextPromise = fetch('data/context-buildings.geojson')
    .then(function (res) {
      if (!res.ok) throw new Error('context-buildings.geojson HTTP ' + res.status);
      return res.json();
    })
    .catch(function (err) {
      console.warn('Context buildings layer unavailable', err);
      return null;
    });

  var poisPromise = fetch('data/pois.geojson')
    .then(function (res) {
      if (!res.ok) throw new Error('pois.geojson HTTP ' + res.status);
      return res.json();
    })
    .catch(function (err) {
      console.warn('POI layer unavailable', err);
      return null;
    });

  Promise.all([buildingsPromise, poisPromise, contextPromise]).then(function (results) {
    var buildingsData = results[0];
    var poisData = results[1];
    var contextData = results[2];
    var overlays = {};

    if (contextData) {
      // Added first so it renders beneath the ND building layer.
      L.geoJSON(contextData, {
        interactive: false,
        style: {
          color: '#dcc9b8',
          weight: 0.6,
          opacity: 1,
          fillColor: '#e8d8c9',
          fillOpacity: 1
        }
      }).addTo(map);
    }

    if (buildingsData) {
      var buildingsLayer = L.geoJSON(buildingsData, {
        pointToLayer: function (feature, latlng) {
          return L.circleMarker(latlng, pointStyle(feature));
        },
        style: baseStyle,
        onEachFeature: function (feature, layer) {
          var ref = feature.properties && feature.properties.ref;
          if (!ref) return;
          NDMap.buildingsById[ref] = { feature: feature, layer: layer };
          layer.bindTooltip(buildingLabelHtml(feature), {
            permanent: true,
            direction: 'center',
            className: 'building-label',
            interactive: false
          });
          layer.on('click', function (e) {
            L.DomEvent.stopPropagation(e);
            if (NDMap.openPanel) NDMap.openPanel(feature, layer);
          });
        }
      }).addTo(map);

      NDMap.buildingsData = buildingsData;
      NDMap.buildingsLayer = buildingsLayer;
      overlays['Buildings'] = buildingsLayer;

      // Re-anchor each label at the footprint's pole of inaccessibility
      // (properties.labelPoint, precomputed by scripts/build-geojson.mjs) —
      // Leaflet's default polygon centre sits off-centre, or outside, on
      // L-shaped footprints. Must run after addTo(map): permanent tooltips
      // only get a latlng once they open.
      Object.keys(NDMap.buildingsById).forEach(function (ref) {
        var entry = NDMap.buildingsById[ref];
        var lp = entry.feature.properties.labelPoint;
        var tooltip = entry.layer.getTooltip && entry.layer.getTooltip();
        if (lp && tooltip) tooltip.setLatLng([lp[1], lp[0]]);
      });

      // Zoom-gate the ref pills: at minZoom 16 all 40 labels collide into an
      // unreadable pile in the dense campus core (UX-009 screenshots), so
      // they only render from LABEL_MIN_ZOOM up. CSS does the hiding via a
      // class on the map container — cheaper than opening/closing 40
      // permanent tooltips on every zoom.
      var LABEL_MIN_ZOOM = 17;
      function updateLabelVisibility() {
        var el = map.getContainer();
        if (map.getZoom() < LABEL_MIN_ZOOM) {
          L.DomUtil.addClass(el, 'hide-building-labels');
        } else {
          L.DomUtil.removeClass(el, 'hide-building-labels');
        }
      }
      map.on('zoomend', updateLabelVisibility);
      updateLabelVisibility();

      document.dispatchEvent(new CustomEvent('ndmap:buildings-ready', { detail: buildingsData }));
    }

    if (poisData) {
      var parkingLayer = L.geoJSON(poisData, {
        filter: poiFilter('parking'),
        pointToLayer: function (feature, latlng) {
          return L.marker(latlng, { icon: poiIcon('parking') });
        },
        onEachFeature: bindPoiTooltip
      }).addTo(map);

      var busLayer = L.geoJSON(poisData, {
        filter: poiFilter('bus_stop'),
        pointToLayer: function (feature, latlng) {
          return L.marker(latlng, { icon: poiIcon('bus_stop') });
        },
        onEachFeature: bindPoiTooltip
      }).addTo(map);

      NDMap.poiLayers = { parking: parkingLayer, bus_stop: busLayer };
      overlays['Parking'] = parkingLayer;
      overlays['Bus stops'] = busLayer;
    }

    if (Object.keys(overlays).length) {
      L.control
        .layers(null, overlays, { collapsed: !isDesktop, position: 'topright' })
        .addTo(map);
    }
  });

  // ---- Info (ⓘ) control + modal --------------------------------------

  var InfoControl = L.Control.extend({
    options: { position: 'topright' },
    onAdd: function () {
      var container = L.DomUtil.create('div', 'leaflet-bar ndmap-info-control');
      var link = L.DomUtil.create('a', '', container);
      link.href = '#';
      link.innerHTML = 'ⓘ';
      link.title = 'About this map';
      link.setAttribute('role', 'button');
      link.setAttribute('aria-label', 'About this map');
      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.on(link, 'click', function (e) {
        L.DomEvent.preventDefault(e);
        openInfoModal();
      });
      return container;
    }
  });
  map.addControl(new InfoControl());

  var infoModalEl = document.getElementById('info-modal');
  var infoModalBackdropEl = document.getElementById('info-modal-backdrop');
  var infoModalCloseBtn = document.getElementById('info-modal-close');

  // Element to return focus to on close (the info control's anchor) —
  // captured only on the closed-to-open transition, same rationale as
  // panel.js's previousFocus.
  var infoPreviousFocus = null;

  function openInfoModal() {
    var wasOpen = !infoModalEl.classList.contains('hidden');
    infoModalEl.classList.remove('hidden');
    infoModalBackdropEl.classList.remove('hidden');
    if (!wasOpen) infoPreviousFocus = document.activeElement;
    // Deferred to the next tick for the same reason as panel.js's
    // openPanel: the info control is a keyboard-focusable <a>, and moving
    // focus to the close button synchronously within its Enter/Space
    // activation would let that same keypress's keyup land on the button
    // and self-trigger a click, instantly closing the modal.
    setTimeout(function () {
      if (infoModalCloseBtn.focus) infoModalCloseBtn.focus();
    }, 0);
  }
  function closeInfoModal() {
    if (infoModalEl.classList.contains('hidden')) return;
    infoModalEl.classList.add('hidden');
    infoModalBackdropEl.classList.add('hidden');

    var toFocus = infoPreviousFocus;
    infoPreviousFocus = null;
    if (toFocus && document.contains(toFocus) && toFocus.focus) {
      try {
        toFocus.focus();
      } catch (err) {
        /* not focusable — leave focus wherever the browser puts it */
      }
    }
  }
  infoModalCloseBtn.addEventListener('click', closeInfoModal);
  infoModalBackdropEl.addEventListener('click', closeInfoModal);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeInfoModal();
  });
})();
