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

  var map = L.map('map', {
    center: [-32.0554, 115.7437],
    zoom: 17,
    minZoom: 16,
    maxZoom: 19,
    maxBounds: CAMPUS_BOUNDS,
    maxBoundsViscosity: 1.0,
    zoomControl: false
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

  function updateZoomClass() {
    var el = map.getContainer();
    if (map.getZoom() >= 18) {
      L.DomUtil.addClass(el, 'zoom-detail');
    } else {
      L.DomUtil.removeClass(el, 'zoom-detail');
    }
  }
  map.on('zoomend', updateZoomClass);

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

  var poisPromise = fetch('data/pois.geojson')
    .then(function (res) {
      if (!res.ok) throw new Error('pois.geojson HTTP ' + res.status);
      return res.json();
    })
    .catch(function (err) {
      console.warn('POI layer unavailable', err);
      return null;
    });

  Promise.all([buildingsPromise, poisPromise]).then(function (results) {
    var buildingsData = results[0];
    var poisData = results[1];
    var overlays = {};

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
      updateZoomClass();
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
