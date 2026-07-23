# UX & Accessibility Audit Checklist (UX)

The dominant risk is label clutter: the building layer binds a **permanent**
tooltip pill to all 41 building/courtyard features (`js/app.js` `onEachFeature`,
`bindTooltip(..., { permanent: true })`), all visible simultaneously down to
`minZoom: 16` — on a phone screen over a dense campus block that's a lot of
white pills competing for space. The second major gap is the custom search
dropdown (`js/search.js`): it has no combobox/listbox ARIA wiring and no
arrow-key navigation, so keyboard and screen-reader users can select only the
top match, via Enter. Findings from sweeps of this checklist go in
`audits/FINDINGS.md` with prefix `UX`.

## Map readability

- [ ] Confirm on an actual phone (not just desktop devtools) whether the 41
      permanent `.building-label` ref pills overlap or collide in dense
      clusters at `minZoom: 16`/17 (`js/app.js` binds them unconditionally in
      `onEachFeature`; `css/app.css` `.leaflet-tooltip.building-label`). The
      existing `.zoom-detail` class only reveals building *names* at
      zoom>=18 (`js/app.js` `updateZoomClass`, `css/app.css:95-97`) — consider
      also zoom-gating the ref pills themselves (e.g. thin out or hide below
      zoom 17) rather than showing all 41 at once.
- [ ] Check building fill (`fillColor: '#1a3a6b'`, `fillOpacity: 0.25` in
      `baseStyle`, `js/app.js`) against the light CARTO Positron tiles
      (`light_all`, `js/app.js` tile URL) for legibility in bright outdoor
      daylight — a phone screen washed out in sun is the default use case for
      a student walking between buildings.
- [ ] Verify the Leaflet attribution control (bottom-left,
      `map.attributionControl.setPosition('bottomleft')` in `js/app.js`) is
      legible at common phone widths — `css/app.css` has no custom styling for
      `.leaflet-control-attribution`, so it relies entirely on Leaflet's
      default small/low-contrast text, and it sits close to the safe-area
      inset zone.
## Search

- [ ] `#search-input` (`index.html`) has a `placeholder` but no `<label>`,
      `aria-label`, or `role="combobox"` — a screen reader announces no
      accessible name/purpose for the field beyond the placeholder hint, which
      isn't a reliable label substitute.
- [ ] `#search-results` (`js/search.js` `renderResults`) has no
      `role="listbox"`, result rows have no `role="option"`, and there's no
      `aria-expanded`/`aria-controls`/`aria-activedescendant` linking input to
      results — the dropdown and its contents are effectively invisible to
      assistive tech even though it's a live, click-driven results list.
- [ ] `inputEl`'s `keydown` handler (`js/search.js:135-142`) only handles
      `Escape` and `Enter`; there is no `ArrowDown`/`ArrowUp` handling and no
      "active option" highlight state — keyboard users cannot move through
      `currentResults`, and `Enter` always selects `currentResults[0]`
      regardless of which result the user actually wants.
- [ ] Result selection is otherwise mouse/touch-only
      (`resultsEl.addEventListener('click', ...)`, `js/search.js:128-133`) —
      combined with the item above, a keyboard-only user can reach at most the
      first (highest-ranked) match out of up to 8 returned.
- [ ] `#search-results` has `max-height: 60vh` (`css/app.css:181`) — verify on
      iOS Safari with the on-screen keyboard open (which can consume roughly
      40-50% of viewport height) that the results list doesn't get squeezed
      or pushed under the keyboard, especially in the `min-width: 768px`
      layout's narrower 340px container.
- [ ] Check `.result-secondary` (`color: var(--text-muted)` on
      `var(--panel-bg)`, `css/app.css:206-210`) meets WCAG AA 4.5:1 for its
      12px text in both themes — light is `#6b7280` on `#ffffff`, dark is
      `#9aa5b8` on `#17233b`.

## Panel & modals

- [ ] `NDMap.openPanel` (`js/panel.js:45-53`) never moves focus into
      `#detail-panel` (no `.focus()`, no `tabindex` on the panel or its
      heading) — after selecting a search result, `inputEl.blur()` is called
      (`js/search.js:116`) and focus lands nowhere, so keyboard/screen-reader
      users get no indication the panel opened or where they now are.
- [ ] Neither `#detail-panel` nor `#info-modal` (`index.html`) has
      `role="dialog"`, `aria-modal="true"`, or `aria-labelledby` pointing at
      the heading (`#panel-title` exists on the `<h2>` in
      `js/panel.js:20` but nothing references it) — both are structurally
      invisible as dialogs/sheets to assistive tech.
- [ ] `NDMap.closePanel` (`js/panel.js:55-61`) and `closeInfoModal`
      (`js/app.js:313-316`) don't return focus to whatever opened them (search
      input, building shape, or the ⓘ control) — focus is dropped to
      `<body>` on close, forcing screen-reader users to re-navigate from the
      top of the page.
- [ ] Building shapes only bind a `click` handler
      (`layer.on('click', ...)`, `js/app.js` `onEachFeature`) — SVG paths
      rendered by Leaflet aren't natively focusable/tabbable, so there is no
      keyboard path to open a building's panel by interacting with the map
      itself; the search box is the only keyboard-reachable entry point.
- [ ] `#toast` (`index.html`) has no `role="status"` or `aria-live="polite"`,
      so screen readers are never notified of messages like "You're outside
      the campus area" or the geolocation error strings (`js/locate.js`
      `showToast`/`onError`). `showToast`'s duration is a fixed 4000ms with no
      pause-on-interaction — easy to miss while walking and glancing away from
      the phone.

## Location UX

- [ ] Touch targets are undersized relative to the ~44px minimum guideline
      (WCAG 2.5.5, Apple HIG/Material): `#locate-btn` is 40x40px
      (`css/app.css:339-340`), `#panel-close` is 30x30px (`css/app.css:230-231`),
      the ⓘ info control link is 30x30px (`css/app.css:429-430`), and
      `#info-modal-close` is 28x28px (`css/app.css:476-477`) — meaningful for
      one-handed phone use while walking outdoors.
- [ ] `.gps-dot-pulse` (`css/app.css:381-391`) runs an infinite 2s
      scale/opacity `gps-pulse` animation with no `prefers-reduced-motion`
      handling anywhere in `css/app.css` — vestibular-sensitive users get no
      accommodation for the persistently pulsing GPS marker, which is visible
      the entire time location tracking is active.

## Accessibility

- [ ] No `@media (prefers-reduced-motion: reduce)` block exists anywhere in
      `css/app.css` — beyond the GPS pulse above, this also covers the detail
      panel's `transition: transform 0.22s ease` slide (`css/app.css:290`) and
      any future animated affordances; add a blanket rule that disables/shortens
      transitions and animations when the user has motion reduction enabled.
- [ ] No service worker or offline caching is registered anywhere in
      `index.html`/`js/` — tiles and `data/buildings.geojson`
      (fetched in `js/app.js`) go blank with no cached fallback in the campus's
      likely signal dead spots (thick-walled buildings, basements). Note as a
      candidate resilience feature rather than a blocking defect.

## Dark mode

- [ ] The Leaflet tile layer is hardcoded to the light CARTO `light_all`
      basemap (`js/app.js` tile URL) with no dark-tile counterpart, while
      `css/app.css`'s `prefers-color-scheme: dark` block only reskins UI
      chrome (`--bg`, `--panel-bg`, `--text`, `--border`, `--shadow`) — a
      student with system dark mode gets a dark search bar/panel/toast
      floating over a bright white map, worst at night when dark mode is most
      likely to be on and a bright screen is most likely to be a problem.
- [ ] `.leaflet-tooltip.building-label` keeps a hardcoded `background:
      #ffffff` (`css/app.css:63-76`) regardless of theme — currently
      self-consistent only because the basemap also stays light (see above);
      if the basemap mismatch above is ever fixed, confirm the pill background
      gets revisited too rather than staying a stray hardcoded white.
