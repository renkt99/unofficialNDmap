/*
 * locate.js — GPS "blue dot" locate control.
 *
 * Button behaviour (mirrors the common "my location" UX pattern):
 *  - not watching        -> tap starts watchPosition and begins following
 *  - watching + following -> tap stops watching entirely, removes the dot
 *  - watching, not following (user panned away) -> tap re-centers / resumes following
 *
 * Resilience: some platforms (notably iOS Safari) let an active watchPosition
 * go silently dormant after the first fix — no further success or error
 * callbacks ever fire. TIMEOUT errors trigger an immediate watch restart, and
 * a watchdog timer catches the fully-silent case, both transparently
 * restarting the watch (the automated version of a manual disable/re-enable).
 */
(function () {
  'use strict';

  if (!window.NDMap) {
    throw new Error('NDMap missing: js/app.js must load before js/locate.js');
  }
  var NDMap = window.NDMap;
  var map = NDMap.map;

  // watchPosition options (see startWatching below). maximumAge is 0 (never
  // accept a cached fix) because live tracking must always reflect a fresh
  // reading, not a stale one from before the watch was (re)started.
  var GEO_TIMEOUT_MS = 15000;

  // Watchdog: if no watchPosition callback (success or error) has fired in
  // this long while watching, the platform's watch has likely gone silently
  // dormant (the reported bug — no error, no update, ever, until the user
  // manually toggles the button). Checked every WATCHDOG_INTERVAL_MS.
  // WATCHDOG_STALL_MS is deliberately greater than GEO_TIMEOUT_MS so a
  // spec-compliant platform recovers via the TIMEOUT error path first; the
  // watchdog only catches the platforms that don't even deliver that.
  var WATCHDOG_INTERVAL_MS = 5000;
  var WATCHDOG_STALL_MS = 25000;

  var watching = false;
  var following = false;
  var watchId = null;
  var firstFix = true;
  var lastLatLng = null;
  var lastCallbackAt = 0;
  var watchdogTimer = null;

  var dotMarker = null;
  var accuracyCircle = null;

  var gpsIcon = L.divIcon({
    className: 'gps-dot-wrap',
    html: '<div class="gps-dot-pulse"></div><div class="gps-dot"></div>',
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  });

  // showToast lives in app.js (NDMap.showToast) since app.js loads first.
  var showToast = NDMap.showToast;

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
    lastCallbackAt = Date.now();
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
    lastCallbackAt = Date.now();

    if (err && err.code === err.PERMISSION_DENIED) {
      showToast('Location permission denied');
      stopWatching();
      return;
    }

    if (err && err.code === err.TIMEOUT) {
      // Recover the watch (see WATCHDOG_STALL_MS comment above). Only toast
      // while still acquiring the first fix — after that, per-update
      // timeouts are routine (e.g. stationary indoors) and shouldn't nag.
      if (firstFix) {
        showToast('Location request timed out');
      }
      restartWatch();
      return;
    }

    // POSITION_UNAVAILABLE and anything else: transient GPS blips mid-walk
    // shouldn't toast; the watch stays alive and the next good fix updates
    // the dot. Only toast while still acquiring the first fix.
    if (firstFix) {
      var message = (err && err.code === err.POSITION_UNAVAILABLE) ?
        'Location unavailable' : 'Unable to determine location';
      showToast(message);
    }
  }

  // ---- start / stop ---------------------------------------------------------

  function geoOptions() {
    return {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: GEO_TIMEOUT_MS
    };
  }

  // Transparently restart an active watch (clearWatch + watchPosition with
  // the same callbacks/options). Does not touch watching/following/firstFix
  // or the dot/button — from the user's perspective tracking never stopped.
  // Restarting a watch that already has permission never re-prompts.
  function restartWatch() {
    if (!watching) {
      return;
    }
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
    }
    watchId = navigator.geolocation.watchPosition(onPosition, onError, geoOptions());
  }

  function startWatching() {
    if (!('geolocation' in navigator)) {
      showToast('Geolocation not supported on this device');
      return;
    }
    watching = true;
    following = true;
    firstFix = true;
    lastCallbackAt = Date.now();
    updateButtonVisual();
    watchId = navigator.geolocation.watchPosition(onPosition, onError, geoOptions());

    watchdogTimer = setInterval(function () {
      if (watching && (Date.now() - lastCallbackAt) > WATCHDOG_STALL_MS) {
        restartWatch();
        lastCallbackAt = Date.now();
      }
    }, WATCHDOG_INTERVAL_MS);
  }

  function stopWatching() {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    if (watchdogTimer !== null) {
      clearInterval(watchdogTimer);
      watchdogTimer = null;
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
