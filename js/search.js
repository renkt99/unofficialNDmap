/*
 * search.js — search box: index ref / name / address / contents, ranked results,
 * select-to-highlight-and-open-panel (no zoom change).
 */
(function () {
  'use strict';

  if (!window.NDMap) {
    throw new Error('NDMap missing: js/app.js must load before js/search.js');
  }
  var NDMap = window.NDMap;
  var escapeHtml = NDMap.escapeHtml;

  var container = document.getElementById('search-container');
  var inputEl = document.getElementById('search-input');
  var resultsEl = document.getElementById('search-results');
  var panelEl = document.getElementById('detail-panel');

  // Must match the @media (min-width: 768px) breakpoints in css/app.css.
  var DESKTOP_MIN_WIDTH = 768;
  // Input-debounce delay before re-running search() on each keystroke.
  var SEARCH_DEBOUNCE_MS = 120;
  // Delay before panning to a selected result, so the on-screen keyboard
  // (mobile) has settled and layout measurements below are accurate — see
  // the comment inside selectResult()'s setTimeout.
  var PAN_DELAY_MS = 250;

  var index = [];
  var currentResults = [];
  var activeIndex = -1;
  var panTimer = null;

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
    activeIndex = -1;
    inputEl.removeAttribute('aria-activedescendant');
    if (!results.length) {
      resultsEl.innerHTML = '';
      resultsEl.classList.add('hidden');
      inputEl.setAttribute('aria-expanded', 'false');
      return;
    }
    var html = results
      .map(function (r, i) {
        var secondary = r.ref + (r.name ? ' · ' + r.name : '');
        return (
          '<div class="search-result" id="search-option-' + i + '" role="option" aria-selected="false" data-index="' + i + '">' +
          '<div class="result-primary">' + escapeHtml(r.text) + '</div>' +
          '<div class="result-secondary">' + escapeHtml(secondary) + '</div>' +
          '</div>'
        );
      })
      .join('');
    resultsEl.innerHTML = html;
    resultsEl.classList.remove('hidden');
    inputEl.setAttribute('aria-expanded', 'true');
  }

  function setActiveIndex(newIndex) {
    var options = resultsEl.querySelectorAll('.search-result');
    if (!options.length) return;
    if (activeIndex >= 0 && options[activeIndex]) {
      options[activeIndex].classList.remove('active');
      options[activeIndex].setAttribute('aria-selected', 'false');
    }
    activeIndex = newIndex;
    var active = options[activeIndex];
    if (active) {
      active.classList.add('active');
      active.setAttribute('aria-selected', 'true');
      inputEl.setAttribute('aria-activedescendant', active.id);
      if (active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
    } else {
      inputEl.removeAttribute('aria-activedescendant');
    }
  }

  function clearResults() {
    // NOTE: don't clearTimeout(panTimer) in here. selectResult() calls
    // clearResults() itself just before scheduling the pan, and removing the
    // clicked .search-result element (via the innerHTML reset below) detaches
    // it from the document — so the document-level "click outside" listener
    // below sees a detached e.target, treats it as outside #search-container,
    // and re-enters clearResults() later in the same click's bubble phase.
    // Clearing the timer here would cancel the pan we just scheduled.
    // Instead, the pan is invalidated explicitly at the sites that actually
    // represent a stale-layout condition: retyping (input handler) and
    // Escape (keydown handler) below.
    currentResults = [];
    activeIndex = -1;
    resultsEl.innerHTML = '';
    resultsEl.classList.add('hidden');
    inputEl.setAttribute('aria-expanded', 'false');
    inputEl.removeAttribute('aria-activedescendant');
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
      panTimer = setTimeout(function () {
        var map = NDMap.map;
        var size = map.getSize();
        var isDesktop = window.matchMedia('(min-width: ' + DESKTOP_MIN_WIDTH + 'px)').matches;
        var top = inputEl.getBoundingClientRect().bottom + 10;
        // Measure the panel/sheet itself rather than hardcoding its CSS
        // dimensions (320px desktop width / 45% mobile sheet height), so a
        // future CSS resize doesn't silently mis-center results. Read
        // offsetWidth/offsetHeight (untransformed layout box) rather than
        // getBoundingClientRect() — the panel opens via a transform
        // transition, so its rect position (and, with a scale transform,
        // size) can be mid-animation here; offsetWidth/offsetHeight are the
        // final box size regardless of transform and pair with the panel's
        // CSS-anchored side (left edge on desktop, bottom edge on mobile).
        var left = isDesktop ? (panelEl ? panelEl.offsetWidth : 320) : 0;
        var bottom = isDesktop ? size.y : (panelEl ? size.y - panelEl.offsetHeight : size.y * 0.55);
        var target = L.point((left + size.x) / 2, (top + bottom) / 2);
        var delta = map.latLngToContainerPoint(anchor).subtract(target);
        map.panTo(map.containerPointToLatLng(L.point(size.x / 2 + delta.x, size.y / 2 + delta.y)));
      }, PAN_DELAY_MS);
    }
  }

  var debounceTimer = null;
  inputEl.addEventListener('input', function () {
    // Typing invalidates any pan still pending from a previous selection —
    // its layout measurements (e.g. dropdown state) are stale as soon as the
    // user starts editing again.
    clearTimeout(panTimer);
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      currentResults = search(inputEl.value);
      renderResults(currentResults);
    }, SEARCH_DEBOUNCE_MS);
  });

  resultsEl.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('.search-result') : null;
    if (!el) return;
    var idx = parseInt(el.getAttribute('data-index'), 10);
    selectResult(currentResults[idx]);
  });

  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      // Escape doesn't reopen the dropdown, so it can't itself make a
      // pending pan's measured layout stale, but cancel it anyway for the
      // same "the user has moved on" reasoning as the input handler above.
      clearTimeout(panTimer);
      clearResults();
      inputEl.blur();
    } else if (e.key === 'ArrowDown') {
      if (!currentResults.length) return;
      e.preventDefault();
      var nextIndex = activeIndex < currentResults.length - 1 ? activeIndex + 1 : 0;
      setActiveIndex(nextIndex);
    } else if (e.key === 'ArrowUp') {
      if (!currentResults.length) return;
      e.preventDefault();
      var prevIndex = activeIndex > 0 ? activeIndex - 1 : currentResults.length - 1;
      setActiveIndex(prevIndex);
    } else if (e.key === 'Enter') {
      if (currentResults.length) {
        var selectedIndex = activeIndex >= 0 ? activeIndex : 0;
        selectResult(currentResults[selectedIndex]);
      }
    }
  });

  document.addEventListener('click', function (e) {
    // Deliberately doesn't clearTimeout(panTimer) here: selecting a result
    // removes the clicked .search-result element from the DOM (via
    // clearResults() inside selectResult()) before this listener runs, so
    // e.target is detached and container.contains(e.target) is false for a
    // normal, legitimate selection too — clearing the timer here would
    // cancel the pan we just scheduled. Clicking outside the search UI
    // doesn't change the input box position or panel size, so a pending
    // pan's measured layout can't go stale this way regardless.
    if (!container.contains(e.target)) clearResults();
  });
})();
