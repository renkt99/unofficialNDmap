/*
 * app.js — map bootstrap, building layer, POI layer, layers control.
 * Exposes window.NDMap, a shared namespace used by panel.js / locate.js / search.js.
 */
(function () {
  'use strict';

  // Keep in sync with scripts/bounds.mjs BOUNDS — this file has no bundler
  // so it can't import that module directly.
  var CAMPUS_BOUNDS = L.latLngBounds(
    [-32.0585, 115.7408],
    [-32.0522, 115.7465]
  );

  // Fixed rotation (via vendored leaflet-rotate) so building east/west walls
  // are vertical, matching the official PDF map. 20° = the Fremantle street
  // grid's offset from north (dominant footprint edge bearing ≈ 70°).
  var MAP_BEARING = 20;

  var map = L.map('map', {
    center: [-32.0554, 115.7437],
    zoom: 17,
    minZoom: 16,
    maxZoom: 19,
    maxBounds: CAMPUS_BOUNDS,
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
    maxZoom: 19,
    maxNativeZoom: 19
  }).addTo(map);

  L.control.zoom({ position: 'bottomright' }).addTo(map);
  map.attributionControl.setPosition('bottomleft');

  var isDesktop = window.matchMedia('(min-width: 768px)').matches;

  // Shared namespace other modules attach to.
  var NDMap = (window.NDMap = {
    map: map,
    campusBounds: CAMPUS_BOUNDS,
    buildingsById: {},
    buildingsData: null,
    selectedRef: null
  });

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  NDMap.escapeHtml = escapeHtml;

  // ---- Building styling ----------------------------------------------

  function baseStyle(feature) {
    if (feature.properties.kind === 'courtyard') {
      return {
        color: '#005cab',
        weight: 1,
        opacity: 1,
        fillColor: '#69b3e3',
        fillOpacity: 0.9
      };
    }
    return {
      color: '#002c61',
      weight: 1,
      opacity: 1,
      fillColor: '#005cab',
      fillOpacity: 0.92
    };
  }

  function highlightStyle(feature) {
    if (feature.properties.kind === 'courtyard') {
      return {
        color: '#002c61',
        weight: 2,
        opacity: 1,
        fillColor: '#005cab',
        fillOpacity: 0.96
      };
    }
    return {
      color: '#002c61',
      weight: 2,
      opacity: 1,
      fillColor: '#002c61',
      fillOpacity: 0.96
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

  // ---- Building label (permanent tooltip pill) ------------------------

  function buildingLabelHtml(feature) {
    var ref = feature.properties.ref || '';
    var name = feature.properties.name || '';
    return (
      '<span class="label-ref">' + escapeHtml(ref) + '</span>' +
      '<span class="label-name">' + escapeHtml(name) + '</span>'
    );
  }

  // Show a building's name line only when its footprint is big enough on
  // screen to hold it (measured per building on every zoom). Point-fallback
  // buildings never show names on the map — the panel and search cover them.
  var NAME_MIN_PX = { width: 76, height: 40 };
  function updateLabelFit() {
    Object.keys(NDMap.buildingsById).forEach(function (ref) {
      var layer = NDMap.buildingsById[ref].layer;
      var tooltip = layer.getTooltip && layer.getTooltip();
      var el = tooltip && tooltip.getElement && tooltip.getElement();
      if (!el) return;
      var fits = false;
      if (layer.getBounds) {
        var b = layer.getBounds();
        var nw = map.latLngToLayerPoint(b.getNorthWest());
        var se = map.latLngToLayerPoint(b.getSouthEast());
        fits =
          Math.abs(se.x - nw.x) >= NAME_MIN_PX.width &&
          Math.abs(se.y - nw.y) >= NAME_MIN_PX.height;
      }
      L.DomUtil[fits ? 'addClass' : 'removeClass'](el, 'show-name');
    });
  }
  map.on('zoomend', updateLabelFit);

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
      updateLabelFit();
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

  function openInfoModal() {
    document.getElementById('info-modal').classList.remove('hidden');
    document.getElementById('info-modal-backdrop').classList.remove('hidden');
  }
  function closeInfoModal() {
    document.getElementById('info-modal').classList.add('hidden');
    document.getElementById('info-modal-backdrop').classList.add('hidden');
  }
  document.getElementById('info-modal-close').addEventListener('click', closeInfoModal);
  document.getElementById('info-modal-backdrop').addEventListener('click', closeInfoModal);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeInfoModal();
  });
})();
