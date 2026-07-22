/*
 * panel.js — building detail panel (left side panel on desktop, bottom sheet on mobile).
 * Registers NDMap.openPanel(feature, layer) and NDMap.closePanel() on the shared namespace.
 */
(function () {
  'use strict';

  var NDMap = window.NDMap;
  var escapeHtml = NDMap.escapeHtml;

  var panelEl = document.getElementById('detail-panel');
  var backdropEl = document.getElementById('panel-backdrop');
  var contentEl = document.getElementById('panel-content');
  var closeBtn = document.getElementById('panel-close');

  // Element to return focus to on close — captured the first time the panel
  // opens from a closed state, so re-selecting a different building while
  // the panel is already open doesn't clobber the original opener.
  var previousFocus = null;

  function renderFeature(feature) {
    var p = feature.properties || {};
    var html = '';

    html += '<h2 id="panel-title">' + escapeHtml(p.ref) + (p.name ? ' — ' + escapeHtml(p.name) : '') + '</h2>';

    if (p.address) {
      html += '<p class="panel-address">' + escapeHtml(p.address) + '</p>';
    }

    if (p.contents && p.contents.length) {
      html += '<ul class="panel-contents">';
      for (var i = 0; i < p.contents.length; i++) {
        html += '<li>' + escapeHtml(p.contents[i]) + '</li>';
      }
      html += '</ul>';
    }

    if (p.confidence === 'low') {
      html += '<p class="panel-note">Location approximate — not yet verified on the ground.';
      if (p.note) html += ' ' + escapeHtml(p.note);
      html += '</p>';
    } else if (p.note) {
      html += '<p class="panel-note">' + escapeHtml(p.note) + '</p>';
    }

    return html;
  }

  NDMap.openPanel = function (feature, layer) {
    if (!feature) return;
    var wasOpen = !panelEl.classList.contains('hidden');
    contentEl.innerHTML = renderFeature(feature);
    panelEl.classList.remove('hidden');
    panelEl.classList.add('open');
    backdropEl.classList.remove('hidden');
    var ref = feature.properties && feature.properties.ref;
    if (ref) NDMap.highlightBuilding(ref);

    // Remember whatever had focus before the panel took it over, but only
    // on the transition from closed to open — re-opening on a different
    // building while already open keeps the original opener so closing
    // still returns focus to where the user actually came from (e.g. the
    // search input — search.js's selectResult calls inputEl.blur() right
    // after this returns, purely to dismiss the mobile on-screen keyboard;
    // it doesn't affect previousFocus, which was already captured above).
    if (!wasOpen) previousFocus = document.activeElement;

    // Deferred to the next tick: openPanel can run synchronously inside the
    // search box's Enter keydown handler (search.js selectResult). Moving
    // focus to closeBtn *within* that handler would put the button under
    // focus before the same Enter keypress's keyup is dispatched — browsers
    // deliver that keyup to whatever now has focus, and a keyup on a
    // focused <button> synthesizes a click, instantly closing the panel we
    // just opened. Deferring the focus move lets the Enter keyup finish
    // landing on the search input (which has no click default action)
    // before the button becomes focusable.
    setTimeout(function () {
      if (closeBtn.focus) closeBtn.focus();
    }, 0);
  };

  NDMap.closePanel = function () {
    if (panelEl.classList.contains('hidden')) return;
    panelEl.classList.add('hidden');
    panelEl.classList.remove('open');
    backdropEl.classList.add('hidden');
    NDMap.clearHighlight();

    var toFocus = previousFocus;
    previousFocus = null;
    if (toFocus && document.contains(toFocus) && toFocus.focus) {
      try {
        toFocus.focus();
      } catch (err) {
        /* target not focusable (e.g. detached or a non-interactive
           element) — leave focus wherever the browser puts it (body). */
      }
    }
  };

  closeBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    NDMap.closePanel();
  });

  backdropEl.addEventListener('click', function () {
    NDMap.closePanel();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') NDMap.closePanel();
  });
})();
