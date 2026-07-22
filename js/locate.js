/*
 * locate.js — GPS "blue dot" locate control.
 *
 * Button behaviour (mirrors the common "my location" UX pattern):
 *  - not watching        -> tap starts watchPosition and begins following
 *  - watching + following -> tap stops watching entirely, removes the dot
 *  - watching, not following (user panned away) -> tap re-centers / resumes following
 */
(function () {
  'use strict';

  var NDMap = window.NDMap;
  var map = NDMap.map;

  var watching = false;
  var following = false;
  var watchId = null;
  var firstFix = true;
  var lastLatLng = null;

  var dotMarker = null;
  var accuracyCircle = null;

  var gpsIcon = L.divIcon({
    className: 'gps-dot-wrap',
    html: '<div class="gps-dot-pulse"></div><div class="gps-dot"></div>',
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  });

  // ---- toast ------------------------------------------------------------

  var toastEl = document.getElementById('toast');
  var toastTimer = null;
  function showToast(message, duration) {
    toastEl.textContent = message;
    toastEl.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.add('hidden');
    }, duration || 4000);
  }

  // ---- button -------------------------------------------------------------

  var btn = document.createElement('button');
  btn.id = 'locate-btn';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Show my location');
  btn.title = 'Show my location';
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round"><circle cx="12" cy="12" r="3"></circle>' +
    '<line x1="12" y1="1" x2="12" y2="5"></line><line x1="12" y1="19" x2="12" y2="23"></line>' +
    '<line x1="1" y1="12" x2="5" y2="12"></line><line x1="19" y1="12" x2="23" y2="12"></line></svg>';

  document.getElementById('map').appendChild(btn);
  L.DomEvent.disableClickPropagation(btn);
  L.DomEvent.disableScrollPropagation(btn);

  function updateButtonVisual() {
    btn.classList.toggle('active', watching);
    btn.classList.toggle('following', watching && following);
  }

  // ---- dot rendering ------------------------------------------------------

  function drawOrUpdateDot(latlng, accuracy) {
    if (!dotMarker) {
      dotMarker = L.marker(latlng, { icon: gpsIcon, interactive: false, zIndexOffset: 1000 }).addTo(map);
      accuracyCircle = L.circle(latlng, {
        radius: accuracy || 0,
        color: '#3b82f6',
        weight: 1,
        fillColor: '#3b82f6',
        fillOpacity: 0.15,
        interactive: false
      }).addTo(map);
    } else {
      dotMarker.setLatLng(latlng);
      accuracyCircle.setLatLng(latlng);
      accuracyCircle.setRadius(accuracy || 0);
    }
  }

  function removeDot() {
    if (dotMarker) {
      map.removeLayer(dotMarker);
      dotMarker = null;
    }
    if (accuracyCircle) {
      map.removeLayer(accuracyCircle);
      accuracyCircle = null;
    }
  }

  // ---- geolocation callbacks ----------------------------------------------

  function onPosition(pos) {
    var latlng = L.latLng(pos.coords.latitude, pos.coords.longitude);
    lastLatLng = latlng;

    if (!NDMap.campusBounds.contains(latlng)) {
      showToast("You're outside the campus area");
      if (firstFix) {
        // Never got a usable fix at all — treat like a failed locate rather
        // than leaving the button lit for a track that never started.
        stopWatching();
      } else {
        // Was tracking fine and wandered off-campus — keep the watch alive
        // so a later in-bounds fix can resume following, but the dot is
        // gone so the button must stop claiming to be "following".
        removeDot();
        following = false;
        updateButtonVisual();
      }
      firstFix = false;
      return;
    }

    drawOrUpdateDot(latlng, pos.coords.accuracy);

    if (following) {
      map.panTo(latlng);
    }
    firstFix = false;
  }

  function onError(err) {
    var message = 'Unable to determine location';
    if (err && err.code === err.PERMISSION_DENIED) {
      message = 'Location permission denied';
    } else if (err && err.code === err.POSITION_UNAVAILABLE) {
      message = 'Location unavailable';
    } else if (err && err.code === err.TIMEOUT) {
      message = 'Location request timed out';
    }
    showToast(message);
    if (err && err.code === err.PERMISSION_DENIED) {
      stopWatching();
    }
  }

  // ---- start / stop ---------------------------------------------------------

  function startWatching() {
    if (!('geolocation' in navigator)) {
      showToast('Geolocation not supported on this device');
      return;
    }
    watching = true;
    following = true;
    firstFix = true;
    updateButtonVisual();
    watchId = navigator.geolocation.watchPosition(onPosition, onError, {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 15000
    });
  }

  function stopWatching() {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    watching = false;
    following = false;
    removeDot();
    updateButtonVisual();
  }

  btn.addEventListener('click', function () {
    if (!watching) {
      startWatching();
    } else if (!following) {
      if (lastLatLng && NDMap.campusBounds.contains(lastLatLng)) {
        following = true;
        updateButtonVisual();
        map.panTo(lastLatLng);
      } else {
        showToast("You're outside the campus area");
      }
    } else {
      stopWatching();
    }
  });

  // Any user-initiated drag disables following; button tap re-enables it.
  map.on('dragstart', function () {
    if (watching && following) {
      following = false;
      updateButtonVisual();
    }
  });
})();
