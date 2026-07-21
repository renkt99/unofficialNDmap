/*
 * search.js — search box: index ref / name / address / contents, ranked results,
 * select-to-highlight-and-open-panel (no zoom change).
 */
(function () {
  'use strict';

  var NDMap = window.NDMap;
  var escapeHtml = NDMap.escapeHtml;

  var container = document.getElementById('search-container');
  var inputEl = document.getElementById('search-input');
  var resultsEl = document.getElementById('search-results');

  var index = [];
  var currentResults = [];

  function buildIndex(data) {
    index = [];
    if (!data || !data.features) return;
    data.features.forEach(function (feature) {
      var p = feature.properties;
      if (!p || !p.ref) return;
      index.push({ field: 'ref', text: p.ref, ref: p.ref, name: p.name, feature: feature });
      if (p.name) {
        index.push({ field: 'name', text: p.name, ref: p.ref, name: p.name, feature: feature });
      }
      if (p.address) {
        index.push({ field: 'address', text: p.address, ref: p.ref, name: p.name, feature: feature });
      }
      if (p.contents && p.contents.length) {
        p.contents.forEach(function (c) {
          index.push({ field: 'contents', text: c, ref: p.ref, name: p.name, feature: feature });
        });
      }
    });
  }

  if (NDMap.buildingsData) buildIndex(NDMap.buildingsData);
  document.addEventListener('ndmap:buildings-ready', function (e) {
    buildIndex(e.detail);
  });

  function search(query) {
    var q = query.trim().toLowerCase();
    if (!q) return [];

    var refMatches = [];
    var nameMatches = [];
    var otherMatches = [];

    index.forEach(function (item) {
      var textLower = item.text.toLowerCase();
      if (item.field === 'ref') {
        var refLower = item.ref.toLowerCase();
        var refNum = refLower.replace(/^nd/, '');
        if (refLower.indexOf(q) === 0 || refNum.indexOf(q) === 0) {
          refMatches.push(item);
        }
      } else if (item.field === 'name') {
        if (textLower.indexOf(q) !== -1) nameMatches.push(item);
      } else {
        // address + contents share the lowest-priority tier
        if (textLower.indexOf(q) !== -1) otherMatches.push(item);
      }
    });

    return refMatches.concat(nameMatches).concat(otherMatches).slice(0, 8);
  }

  function renderResults(results) {
    if (!results.length) {
      resultsEl.innerHTML = '';
      resultsEl.classList.add('hidden');
      return;
    }
    var html = results
      .map(function (r, i) {
        var secondary = r.ref + (r.name ? ' · ' + r.name : '');
        return (
          '<div class="search-result" data-index="' + i + '">' +
          '<div class="result-primary">' + escapeHtml(r.text) + '</div>' +
          '<div class="result-secondary">' + escapeHtml(secondary) + '</div>' +
          '</div>'
        );
      })
      .join('');
    resultsEl.innerHTML = html;
    resultsEl.classList.remove('hidden');
  }

  function clearResults() {
    currentResults = [];
    resultsEl.innerHTML = '';
    resultsEl.classList.add('hidden');
  }

  function selectResult(item) {
    if (!item) return;
    var entry = NDMap.buildingsById[item.ref];
    var layer = entry && entry.layer;
    var feature = (entry && entry.feature) || item.feature;

    if (NDMap.openPanel) NDMap.openPanel(feature, layer);

    inputEl.value = item.text;
    clearResults();
    inputEl.blur();

    if (layer) {
      // Don't zoom to the result — the gold highlight (applied by openPanel)
      // marks it. Pan at the current zoom so the building sits centred in
      // the map area left visible by the search bar and the detail panel
      // (left side panel on desktop, bottom sheet on mobile). panTo may
      // clamp at maxBounds, in which case the building ends up as close to
      // centred as the bounds allow.
      //
      // Runs after clearResults/blur, on a delay: the top of the visible
      // band is measured from the input box (never the results dropdown,
      // which is still open when a result is tapped), and on phones the
      // on-screen keyboard closing on blur resizes the map — measure after
      // it has settled.
      var props = feature.properties || {};
      var anchor = layer.getLatLng
        ? layer.getLatLng()
        : props.labelPoint
          ? L.latLng(props.labelPoint[1], props.labelPoint[0])
          : layer.getBounds().getCenter();
      setTimeout(function () {
        var map = NDMap.map;
        var size = map.getSize();
        var isDesktop = window.matchMedia('(min-width: 768px)').matches;
        var top = inputEl.getBoundingClientRect().bottom + 10;
        var left = isDesktop ? 320 : 0;
        var bottom = isDesktop ? size.y : size.y * 0.55;
        var target = L.point((left + size.x) / 2, (top + bottom) / 2);
        var delta = map.latLngToContainerPoint(anchor).subtract(target);
        map.panTo(map.containerPointToLatLng(L.point(size.x / 2 + delta.x, size.y / 2 + delta.y)));
      }, 250);
    }
  }

  var debounceTimer = null;
  inputEl.addEventListener('input', function () {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      currentResults = search(inputEl.value);
      renderResults(currentResults);
    }, 120);
  });

  resultsEl.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('.search-result') : null;
    if (!el) return;
    var idx = parseInt(el.getAttribute('data-index'), 10);
    selectResult(currentResults[idx]);
  });

  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      clearResults();
      inputEl.blur();
    } else if (e.key === 'Enter') {
      if (currentResults.length) selectResult(currentResults[0]);
    }
  });

  document.addEventListener('click', function (e) {
    if (!container.contains(e.target)) clearResults();
  });
})();
