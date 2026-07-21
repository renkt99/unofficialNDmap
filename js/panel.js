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
    contentEl.innerHTML = renderFeature(feature);
    panelEl.classList.remove('hidden');
    panelEl.classList.add('open');
    backdropEl.classList.remove('hidden');
    var ref = feature.properties && feature.properties.ref;
    if (ref) NDMap.highlightBuilding(ref);
  };

  NDMap.closePanel = function () {
    if (panelEl.classList.contains('hidden')) return;
    panelEl.classList.add('hidden');
    panelEl.classList.remove('open');
    backdropEl.classList.add('hidden');
    NDMap.clearHighlight();
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
