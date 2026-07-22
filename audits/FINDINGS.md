# Audit Findings Ledger

Single source of truth for everything the category audits in this folder have
turned up. Before reporting a finding, **check this ledger first** — if it is
already here as `fixed` or `wontfix`, do not re-surface it. Repeat audit runs
should diff their results against this file and only append genuinely new
findings.

## How to record a finding

One entry per finding, appended under the matching category `##` section, using
this exact template. The template doubles as a self-contained work item — see
"Working a finding" below — so fill it in as if the reader has no other context.

```
### <CAT>-NNN — <imperative one-line title>

- **Status:** open · **Severity:** crit|high|med|low · **Date:** YYYY-MM-DD
- **Location:** `path/to/file.js:line` or `func()`
- **Problem:** The defect/risk and its impact, in one or two sentences.
- **Goal:** The fix as an imperative, self-contained task — exact enough that
  an agent given only this entry knows what to change and where.
- **Done when:** Observable acceptance criteria: behavior, tests, checks.
```

Field rules:

- **ID** — `<CAT>-NNN`, category prefix + zero-padded sequence, never reused.
  Prefixes in this project: `SEC` Security, `COR` Correctness, `CQ` Code
  Quality, `TEST` Testing, `DATA` Data, `UX` UX/Accessibility, `BLD`
  Build/Deployment. Scan the section for the highest existing number.
- **Title** — imperative and specific, not a restatement of the problem.
- **Status** — `open` (confirmed, not yet fixed), `fixed`, or `wontfix`
  (deliberately accepted).
- **Severity** — `crit` / `high` / `med` / `low`. Security and data-loss
  findings default to `high` or above.
- **Date** — `YYYY-MM-DD` the entry was last changed (ISO 8601).
- **Goal / Done when** — present on `open` entries. Keep the goal grounded in
  the suggested fix; keep "Done when" observable (a passing test, a check
  output, a behavior), not "code looks better".

When a finding is resolved, edit its entry **in place** — never delete entries;
the history of what was accepted and why is the point. Update Status + Date and
replace the **Goal** and **Done when** lines with a single line:

- fixed → `- **Resolution:** <what was done + commit SHA or PR#>`
- wontfix → `- **Resolution:** <why it is accepted>`

Keep entries tight: Problem in one or two sentences, deep detail in the commit
message or a linked issue. An empty category section holds a single `_none
yet._` line until its first finding.

## Working a finding (`/goal`)

Every `open` entry is written to be handed off as-is by its ID:

    /goal fix DATA-001 from audits/FINDINGS.md

## SEC — Security

### SEC-001 — Add a meta-tag Content-Security-Policy to index.html

- **Status:** open · **Severity:** low · **Date:** 2026-07-21
- **Location:** `index.html` `<head>` (no CSP present)
- **Problem:** GitHub Pages can't set response headers, so `escapeHtml()` is
  the only XSS defense; a `<meta http-equiv="Content-Security-Policy">` tag is
  the one available backstop and is unused. Verified feasible: no inline
  scripts, no inline `style=""` attributes, no `data:` URIs in the shipped
  markup/CSS (Leaflet needs `style-src 'unsafe-inline'` for its runtime pane
  transforms).
- **Goal:** Add a meta CSP along the lines of `default-src 'self';
  script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'
  https://*.basemaps.cartocdn.com; connect-src 'self'; object-src 'none';
  base-uri 'none'` (note `frame-ancestors` is ignored in meta CSP — omit it),
  then verify the map, tiles, POI icons, and geolocation dot all still work
  with no console CSP violations.
- **Done when:** The tag ships, the deployed site renders fully, and devtools
  shows zero CSP violations during normal use (pan, search, locate, panel).

### SEC-002 — State in the info modal that geolocation never leaves the device

- **Status:** open · **Severity:** low · **Date:** 2026-07-21
- **Location:** `index.html` info-modal text (~line 30); `js/locate.js`
- **Problem:** The locate feature uses device GPS, but the info modal says
  nothing about location handling. Audit confirmed coordinates only feed local
  Leaflet calls and no network path can carry them — a one-line disclosure
  would make that verifiable claim user-visible.
- **Goal:** Add one sentence to the info modal, e.g. "Location: your GPS
  position is used only in your browser to show the blue dot and is never
  sent anywhere."
- **Done when:** The modal shows the sentence and it remains accurate (no
  telemetry code exists).

## COR — Correctness

### COR-001 — Render the P&O Hotel (ND5) courtyard hole instead of dropping it

- **Status:** open · **Severity:** low · **Date:** 2026-07-21
- **Location:** `scripts/build-geojson.mjs` `geometryFor()` (relation branch)
- **Problem:** Multipolygon relations keep only `outer` members; OSM relation
  17256639 (ND5, P&O Hotel) has one `inner` ring, so the building renders as a
  solid polygon with its courtyard filled in. Cosmetic, but silently wrong for
  any future relation with holes.
- **Goal:** In `geometryFor()`, append `inner` member rings as additional rings
  of the containing polygon (GeoJSON Polygon ring 2+ = holes), or at minimum
  `console.warn` when inner members are dropped. Regenerate buildings.geojson.
- **Done when:** ND5 renders with its courtyard cut out on the deployed map and
  a unit test covers a relation with an inner ring.

### COR-002 — Keep the locate button visual in sync with actual tracking state

- **Status:** fixed · **Severity:** med · **Date:** 2026-07-22
- **Location:** `js/locate.js:165-170` (click recenter branch) and
  `js/locate.js:103-108` (`onPosition()` out-of-bounds branch)
- **Problem:** Two paths let the button claim "following" while nothing is
  tracked: (1) the recenter branch sets `following = true` and updates the
  visual before the `lastLatLng`-in-bounds guard, so with a null/out-of-bounds
  last fix the button lights up but no pan happens and no dot exists; (2) an
  out-of-campus fix removes the dot but never calls `updateButtonVisual()`, so
  the button stays "active/following" indefinitely with no dot on the map.
- **Resolution:** In the click recenter branch, `following = true` and
  `updateButtonVisual()` now run only inside the guarded block where
  `lastLatLng` exists and is in bounds; otherwise a toast fires instead of
  flipping the button state silently. In `onPosition()`'s out-of-bounds
  branch, the previously write-only `firstFix` flag is now read: if the very
  first fix is out of bounds, `stopWatching()` runs (clears `active`/
  `following`, matching a failed locate); if a later fix goes out of bounds
  after tracking was already working, the dot is removed and `following` is
  cleared/visual updated while `watching` stays true, so a subsequent
  in-bounds fix can resume following. Verified headless via Chromium CDP
  geolocation overrides for out-of-campus-first-fix, in-campus-fix, and
  mid-track out-of-campus transitions; zero console/page errors (this PR).

### COR-003 — Make CI fail when committed geojson is stale vs the curated source

- **Status:** open · **Severity:** med · **Date:** 2026-07-21
- **Location:** `.github/workflows/ci.yml` (single step:
  `node scripts/validate-data.mjs`)
- **Problem:** CI validates the committed `data/*.geojson` but never runs
  `scripts/build-geojson.mjs`, so editing an existing ref's `osm`/`point`/
  `name`/`contents`/`confidence` in `nd-buildings.json` without regenerating
  passes CI silently (the ref-uniqueness check only catches add/remove drift,
  not content drift).
- **Goal:** Add a CI step that runs `node scripts/build-geojson.mjs` followed
  by `git diff --exit-code data/*.geojson` before validation, failing the
  build when regeneration changes the output.
- **Done when:** A PR that edits `nd-buildings.json` without regenerating the
  geojson fails CI with the diff shown.

### COR-004 — Fail loudly when a relation's outer member lacks geometry

- **Status:** open · **Severity:** low · **Date:** 2026-07-21
- **Location:** `scripts/build-geojson.mjs:33-34` (`geometryFor()`)
- **Problem:** `.filter((m) => m.role === 'outer' && m.geometry)` silently
  drops outer members without a resolved `geometry`; as long as one outer
  survives, the `!outers.length` throw never fires and a partial, wrong-shaped
  footprint is built with no warning. Distinct from COR-001 (inner rings).
- **Goal:** Compare the filtered count against the total `role === 'outer'`
  member count and throw (or at least `console.warn` with the relation id) on
  mismatch.
- **Done when:** A test fixture relation with one geometry-less outer member
  makes the build fail (or warn) instead of silently emitting a partial
  polygon.

### COR-005 — Count and report POIs dropped by the build-time bounds filter

- **Status:** open · **Severity:** low · **Date:** 2026-07-21
- **Location:** `scripts/build-geojson.mjs:225` (POI loop `continue`)
- **Problem:** Out-of-bounds POIs are dropped with a bare `continue`; a
  misconfigured or bad Overpass fetch could zero out most POIs with the only
  signal being a lower feature count in the final console line.
- **Goal:** Track a dropped counter and print it in the summary line; warn
  loudly (non-zero exit is optional) when the dropped share exceeds, say, half
  of the fetched POIs.
- **Done when:** Running the build against a snapshot with mostly
  out-of-bounds POIs prints an explicit dropped-count warning.

### COR-006 — Validate POI properties and ring closure in validate-data.mjs

- **Status:** open · **Severity:** low · **Date:** 2026-07-21
- **Location:** `scripts/validate-data.mjs`
- **Problem:** The validator never checks POI `kind`/`name` presence or
  validity, and never checks that polygon rings are closed — a malformed POI
  or unclosed ring would ship despite CI passing.
- **Goal:** Add checks: every POI feature has a `kind` from the known set and
  a non-empty `name` where required; every polygon ring's first and last
  coordinates are equal.
- **Done when:** Hand-breaking a POI `kind` or unclosing a ring in a scratch
  copy makes `node scripts/validate-data.mjs` fail.

### COR-007 — Cancel the pending search pan when the user types again

- **Status:** open · **Severity:** low · **Date:** 2026-07-21
- **Location:** `js/search.js:129` (250ms `setTimeout` pan) vs the debounced
  input handler (`js/search.js:143-150`)
- **Problem:** Retyping within 250ms of tapping a result can reopen the
  results dropdown before the pending pan fires; the pan callback measures
  layout as of tap time, so the highlighted building can end up centered under
  the reopened dropdown. Cosmetic and self-healing, but a real race.
- **Goal:** Store the pan timeout id and `clearTimeout` it at the top of the
  input handler (or re-measure dropdown visibility inside the pan callback).
- **Done when:** Tapping a result then immediately typing never pans using
  stale layout — verified manually with the dropdown reopened during the
  delay.

### COR-008 — Measure the panel/sheet size instead of hardcoding 320px / 55%

- **Status:** open · **Severity:** low · **Date:** 2026-07-21
- **Location:** `js/search.js:134-135`; duplicates `css/app.css:306`
  (`width: 320px`) and `css/app.css:282` (`height: 45%`)
- **Problem:** The search pan-centering hardcodes the desktop panel width and
  mobile sheet height; a CSS resize silently mis-centers search results with
  no error (currently in sync, drift-prone).
- **Goal:** Measure `#detail-panel` via `getBoundingClientRect()` at pan time
  (the input element is already measured this way), falling back to the
  current constants only if the panel isn't in the DOM.
- **Done when:** Changing the CSS panel width/height still centers search
  results correctly with no JS edit.

## CQ — Code Quality

### CQ-001 — Show a user-visible error when the buildings layer fails to load

- **Status:** fixed · **Severity:** med · **Date:** 2026-07-22
- **Location:** `js/app.js:193-196` (buildings fetch catch); `js/locate.js:35`
  (`showToast`, currently a private closure)
- **Problem:** If `data/buildings.geojson` fails to fetch, the catch only
  `console.error`s and resolves null — the core layer, search index, and
  labels silently never appear with zero on-screen feedback. A toast mechanism
  exists (`showToast` in locate.js) but is not exposed on `NDMap`, so app.js
  can't reuse it.
- **Resolution:** Moved `showToast` into `js/app.js` as `NDMap.showToast`
  (app.js loads first); `js/locate.js` now aliases it instead of keeping a
  private copy. The buildings-fetch catch in `js/app.js` calls
  `NDMap.showToast("Couldn't load building data — try reloading")` alongside
  the existing `console.error`; context/POI fetch failures remain
  console-only (this PR).

### CQ-002 — Harden and document the NDMap cross-file script contract

- **Status:** open · **Severity:** low · **Date:** 2026-07-21
- **Location:** `index.html:35-40` (script tags); `js/panel.js:8-9`,
  `js/search.js:8-9`, `js/locate.js:12-13` (unguarded `window.NDMap` reads);
  `js/app.js:151,259` (asymmetric `if (NDMap.openPanel)` guards)
- **Problem:** The four IIFEs' load-order dependency is documented only in
  app.js's header comment; consumer files dereference `window.NDMap` at load
  time with no existence check, so a script-order change or failed app.js load
  throws an undiagnostic TypeError. app.js's own guards protect against
  panel.js load failure but the reverse direction is unguarded and the
  contract is undocumented.
- **Goal:** Add a "load order matters" comment next to the `<script>` tags in
  index.html; add a one-line existence check with a descriptive throw in
  panel/search/locate; add short JSDoc to the `NDMap.*` contract functions
  (`escapeHtml`, `highlightBuilding`, `clearHighlight`, `openPanel`,
  `closePanel`), noting `openPanel(feature, layer)`'s optional `layer`.
- **Done when:** All three consumers fail with a self-explanatory error when
  app.js is absent, and the contract functions carry JSDoc.

### CQ-003 — Add an automated drift check for CAMPUS_BOUNDS vs bounds.mjs

- **Status:** open · **Severity:** low · **Date:** 2026-07-21
- **Location:** `js/app.js:10-13` (`CAMPUS_BOUNDS`) vs `scripts/bounds.mjs`
  (`BOUNDS`)
- **Problem:** The two remaining hand-copies of the campus bounds are kept in
  sync only by comments (the scripts now import `bounds.mjs`; browser JS
  can't). Nothing catches drift, and CI would pass with mismatched bounds.
- **Goal:** In `scripts/validate-data.mjs`, parse the `CAMPUS_BOUNDS` literal
  out of `js/app.js` (regex is fine — the file is hand-maintained ES5) and
  fail validation if it differs from `BOUNDS` in `bounds.mjs`.
- **Done when:** Editing one copy without the other makes
  `node scripts/validate-data.mjs` (and hence CI) fail.

### CQ-004 — Name and cross-reference duplicated UI constants and magic numbers

- **Status:** open · **Severity:** low · **Date:** 2026-07-21
- **Location:** colors `#002c61`/`#005cab` in `css/app.css:4-7` and
  `js/app.js:75,83,86,96`; breakpoint `768px` in `js/app.js:51`,
  `js/search.js:132`, `css/app.css:146,300`; `maxZoom: 19` in
  `js/app.js:24,44,45`; bare literals `120` (`js/search.js:149`), `250`
  (`js/search.js:129`), `4000` (`js/locate.js:41`), `5000`/`15000`
  (`js/locate.js:146-147`), `45%` (`css/app.css:282`)
- **Problem:** Brand colors and the desktop breakpoint are duplicated between
  CSS and JS with no cross-reference (Leaflet styles can't read CSS custom
  properties), and several timing/size literals have no named constant or
  comment — each is a silent-drift or unexplained-value risk.
- **Goal:** Hoist repeated values to named `var` constants at the top of each
  JS file (pattern already used for `MAP_BEARING`), and add paired "must match
  X" comments between css/app.css and the JS copies of the colors and the
  768px breakpoint, mirroring the bounds.mjs comment convention.
- **Done when:** No repeated raw color/breakpoint/zoom literal in `js/*.js`
  lacks a named constant or a cross-reference comment.

### CQ-005 — Document the ES5-browser vs ESM-scripts convention (and decide on lint)

- **Status:** open · **Severity:** low · **Date:** 2026-07-21
- **Location:** `js/*.js` (ES5 `var`-only IIFEs, verified 0 let/const/arrows)
  vs `scripts/*.mjs` (modern ESM); no lint config anywhere; `ci.yml` runs only
  `validate-data.mjs`
- **Problem:** The two-convention split is consistent but documented nowhere,
  so a contributor could "modernize" the browser files or mix styles with
  nothing to flag it.
- **Goal:** Add a short note to CLAUDE.md/README stating the convention and
  why (browser files ship unbundled and stay ES5-conservative; scripts are
  Node-only ESM). Optionally add a minimal ESLint step to CI later.
- **Done when:** The convention and its rationale are stated in-repo.

### CQ-006 — Bare uncaught errors in build-geojson.mjs abort the whole build

- **Status:** wontfix · **Severity:** low · **Date:** 2026-07-21
- **Location:** `scripts/build-geojson.mjs:34,158,165`
- **Problem:** A malformed `nd-buildings.json` entry throws a plain Error and
  kills the build with a stack trace, with no aggregation of other bad
  entries.
- **Resolution:** Accepted — it's a dev-only script over a small hand-curated
  file; fail-fast with the offending entry in the stack trace is adequate, and
  `validate-data.mjs` + CI gate the merged output.

## TEST — Testing

### TEST-001 — Add a node:test suite for build-geojson.mjs's geometry and merge logic

- **Status:** open · **Severity:** med · **Date:** 2026-07-21
- **Location:** `scripts/build-geojson.mjs` (`ringFromGeometry()`,
  `geometryFor()`, POI kind mapping, missing-osm-id error path); no test file
  exists anywhere in the repo
- **Problem:** The only code that turns raw OSM data into rendered polygons
  has zero automated coverage; regressions in ring closing, relation handling,
  or POI kind mapping would ship silently. Fixing COR-001/COR-004 without
  tests would leave them unguarded too.
- **Goal:** Add `scripts/build-geojson.test.mjs` run via `node --test scripts/`
  covering: ring already-closed vs needs-closing; relation with 2+ outer
  members → MultiPolygon; relation with no outer geometry → throws; POI tag →
  kind mapping incl. skip case (extract `kindForTags()` if needed); the
  missing-osm-id throw. Add a `node --test scripts/` step to `ci.yml`.
- **Done when:** `node --test scripts/` passes locally and in CI, and CI fails
  when one of the covered branches is deliberately broken.

### TEST-002 — Self-test that validate-data.mjs actually fails on bad fixtures

- **Status:** open · **Severity:** low · **Date:** 2026-07-21
- **Location:** `scripts/validate-data.mjs` (only ever runs against the real
  data files)
- **Problem:** The gate has been verified to fail on bad data exactly once,
  manually (PR #5); a regression that silently disables one of its checks
  (bounds, ref uniqueness, required fields) would go unnoticed because it
  would still exit 0 on good data.
- **Goal:** Add bad fixtures (out-of-bounds coordinate; duplicate/missing
  ref) under `scripts/fixtures/bad/` plus a self-test that runs
  validate-data.mjs as a subprocess against them, asserting non-zero exit and
  the expected error substring; include a good-fixture case asserting exit 0.
  Wire into the same `node --test scripts/` CI step as TEST-001.
- **Done when:** Deliberately weakening a validate-data check makes the
  self-test (and CI) fail.

### TEST-003 — Decide on automated browser testing (rejected: keep manual headless checks)

- **Status:** wontfix · **Severity:** low · **Date:** 2026-07-21
- **Location:** `js/{app,panel,locate,search}.js` (IIFEs coupled to
  window/document/Leaflet; untestable under plain node:test)
- **Problem:** The four browser modules have no automated tests, and making
  them testable would require either a DOM shim or a Playwright-style dev
  dependency — both conflicting with the repo's zero-npm-dependency,
  no-bundler design.
- **Resolution:** Accepted trade-off — browser behavior is verified manually
  with headless Chromium (desktop + mobile viewports) before merges, per the
  established workflow; no npm test dependency will be introduced while the
  no-deps principle stands. Revisit only if the browser code grows
  substantially or the no-deps principle is dropped.

## DATA — Data

### DATA-001 — Verify the 11 low-confidence building locations on the ground

- **Status:** open · **Severity:** high · **Date:** 2026-07-21
- **Location:** `data/nd-buildings.json` (entries with `"confidence": "low"`
  after the Nov-2025 map update: ND8, ND9, ND11, ND13, ND16, ND34, ND38,
  ND39, ND49, ND50)
- **Problem:** These ND references could not be confidently matched to an OSM
  footprint during curation; six render as approximate point markers and four
  (ND11, ND13, ND49, ND50) use best-guess polygons. Users may be directed
  to the wrong building. ND48's footprint is medium-confidence but its
  official grid square (A7) disagrees with the OSM Customs House position —
  check it too.
- **Goal:** Walk the campus (or cross-reference the current official map) and
  for each entry either assign the correct `osm` way id from
  `data/footprints-raw.json` or correct the `point`, then raise `confidence`.
  Rebuild with `node scripts/build-geojson.mjs`.
- **Done when:** No entry in nd-buildings.json carries `"confidence": "low"`;
  `node scripts/validate-data.mjs` passes; spot-checked on the deployed map.

### DATA-002 — Re-verify all building data against the current official campus map

- **Status:** fixed · **Severity:** high · **Date:** 2026-07-21
- **Location:** `data/nd-buildings.json` (all entries);
  `reference/fremantle-campus-map-2025-11.pdf`
- **Problem:** Building names/contents were transcribed from the Sept 2015
  edition of the official PDF (the newest copy fetchable — the university site
  Cloudflare-blocks bots), so the dataset lagged a decade of campus changes.
- **Resolution:** User uploaded the current November 2025 official map
  (ND6572); every entry rewritten against it in PR #6 — renames (ND17 Michael
  J M Wright Library, ND7 Peter Prendiville Study Centre, ND42 Fremantle
  Hotel, ND22 Former Fremantle Courthouse), contents moves (Moot Court
  ND22→ND13), removals (ND5, ND30, ND45 no longer university buildings),
  additions (ND49, ND50; ND48 re-matched to the Customs House footprint).
  Residual location uncertainty tracked in DATA-001.

### DATA-003 — Document a refresh cadence for the OSM snapshots

- **Status:** open · **Severity:** low · **Date:** 2026-07-21
- **Location:** `README.md` / `CLAUDE.md` (absent); `scripts/fetch-footprints.mjs`
- **Problem:** No policy anywhere states when to re-run `fetch-footprints.mjs`
  against Overpass; OSM footprints in the bbox can move or be re-tagged
  independently of this repo, and the snapshots will silently age.
- **Goal:** Add a one-line policy to the README data-pipeline section (e.g.
  re-fetch every 6 months or before each semester; after each refresh, diff
  the raw snapshots and review changed/removed way/relation ids referenced by
  `osm` fields before regenerating).
- **Done when:** The cadence and post-refresh review steps are stated in the
  README.

## UX — UX / Accessibility

### UX-001 — Give the search box combobox ARIA semantics and arrow-key navigation

- **Status:** fixed · **Severity:** high · **Date:** 2026-07-22
- **Location:** `index.html:14-15` (`#search-input`, `#search-results`);
  `js/search.js:71-166` (`renderResults`, keydown handler)
- **Problem:** The input has no accessible name and no combobox role; the
  results list has no listbox/option roles or aria-expanded/-activedescendant
  wiring; keydown handles only Escape/Enter and Enter always selects
  `currentResults[0]`. Screen-reader users get an unlabeled box with invisible
  results; keyboard users can only ever reach the top match of up to 8.
- **Resolution:** Added `aria-label`/`role="combobox"`/`aria-expanded`/
  `aria-controls`/`aria-autocomplete` to the input, `role="listbox"` to the
  results container, `role="option"`/id/`aria-selected` to each rendered
  result, and ArrowUp/ArrowDown handling that wraps, updates
  `aria-activedescendant` and a `.active` highlight class, with Enter
  selecting the active (or first) option (this PR).

### UX-002 — Make the detail panel and info modal real dialogs with focus management

- **Status:** open · **Severity:** med · **Date:** 2026-07-21
- **Location:** `index.html:18,27`; `js/panel.js:45-61`
  (`openPanel`/`closePanel`); `js/search.js:108` (`inputEl.blur()`);
  `js/app.js:335-341` (`closeInfoModal`)
- **Problem:** Neither container has `role="dialog"`/`aria-modal`/
  `aria-labelledby` (`#panel-title` exists but is unreferenced); opening never
  moves focus in (search selection even blurs the input, dropping focus to
  `<body>`), and closing never restores focus to the opener.
- **Goal:** Add dialog roles and `aria-labelledby`; give the panel/modal (or
  their close buttons) `tabindex="-1"` and focus them on open; remember
  `document.activeElement` before opening and restore it on close.
- **Done when:** Opening either surface announces it and moves focus in;
  Escape/close returns focus to the triggering element.

### UX-003 — Provide (or explicitly document) a keyboard path to building footprints

- **Status:** open · **Severity:** low · **Date:** 2026-07-21
- **Location:** `js/app.js:242-262` (click-only handlers on Leaflet `Path`
  layers, which are never focusable — verified against vendor/leaflet.js)
- **Problem:** Building shapes and circle markers can't be tabbed to, so the
  map itself has no keyboard interaction path; search is the only keyboard
  entry point to a building's panel.
- **Goal:** After UX-001 lands, either accept search as the designated
  keyboard path (document it in the info modal / README) or add focusable
  proxies for footprints. Decide deliberately rather than by omission.
- **Done when:** Either a documented decision (flip to wontfix with rationale)
  or tabbable building access exists.

### UX-004 — Announce toast messages to screen readers

- **Status:** open · **Severity:** med · **Date:** 2026-07-21
- **Location:** `index.html:25` (`#toast`); `js/locate.js:33-41` (`showToast`)
- **Problem:** The toast has no `role="status"`/`aria-live`, so geolocation
  feedback ("You're outside the campus area", permission errors) is never
  announced — a screen-reader user tapping locate gets silence.
- **Goal:** Add `role="status" aria-live="polite" aria-atomic="true"` to the
  toast element; `textContent` updates then announce automatically.
- **Done when:** With a screen reader active, triggering any toast announces
  its text.

### UX-005 — Respect prefers-reduced-motion

- **Status:** open · **Severity:** med · **Date:** 2026-07-21
- **Location:** `css/app.css:385` (`.gps-dot-pulse` infinite 2s scale-to-3.2×
  animation); `css/app.css:285` (`#detail-panel` transform transition); no
  `prefers-reduced-motion` block exists anywhere
- **Problem:** The persistently pulsing GPS marker runs unconditionally while
  tracking is active — no accommodation for vestibular-sensitive users
  (WCAG 2.3.3).
- **Goal:** Add one `@media (prefers-reduced-motion: reduce)` block disabling
  the gps-pulse animation and the panel slide transition.
- **Done when:** With OS motion-reduction enabled, the GPS dot renders without
  pulsing and the panel appears without sliding.

### UX-006 — Fix ref-pill contrast over courtyard fills (ND2, ND15)

- **Status:** open · **Severity:** low · **Date:** 2026-07-21
- **Location:** `js/app.js:72-89` (courtyard `fillColor: '#69b3e3'`);
  `css/app.css:80-94` (`.building-label`, white text, no background)
- **Problem:** White label text over the courtyard fill computes to 2.29:1
  (WCAG AA needs 4.5:1 for 11px text); the navy text-shadow halo helps but
  isn't a guaranteed-contrast mechanism. Only ND2/ND15 affected.
- **Goal:** Darken the courtyard fill, use navy text on courtyard labels, or
  give the pill a solid background chip so contrast is fill-independent.
- **Done when:** Computed contrast for courtyard labels ≥ 4.5:1; verified in a
  headless-browser screenshot.

### UX-007 — Enlarge undersized touch targets to ≥44px

- **Status:** open · **Severity:** low · **Date:** 2026-07-21
- **Location:** `css/app.css`: `#locate-btn` 40×40 (334-335), `#panel-close`
  30×30 (225-226), `.ndmap-info-control a` 30×30 (423-426),
  `#info-modal-close` 28×28 (471-472)
- **Problem:** All four interactive controls are under the ~44px guideline
  (WCAG 2.5.5 / HIG) — meaningful for one-handed outdoor phone use.
- **Goal:** Grow each control's hit area to ≥44×44 (transparent padding or
  pseudo-element is fine; visual glyph can stay small).
- **Done when:** Each control's effective hit area measures ≥44×44 in
  devtools; layout unchanged visually.

### UX-008 — Keep the attribution control visible and inside the safe area

- **Status:** open · **Severity:** low · **Date:** 2026-07-21
- **Location:** `js/app.js:49` (`setPosition('bottomleft')`); `css/app.css`
  (no `.leaflet-control-attribution` styling; desktop `#detail-panel`
  z-index 1300 overlays the bottom-left corner when open)
- **Problem:** The OSM/CARTO attribution — a licence requirement — has no
  safe-area-inset padding (unlike every other bottom-anchored element) and is
  fully covered by the desktop detail panel while it's open.
- **Goal:** Add safe-area padding for `.leaflet-control-attribution` and move
  it (e.g. bottomright) or raise it so an open desktop panel can't obscure it.
- **Done when:** Attribution is visible with the panel open at desktop widths
  and clears the home-indicator inset on phones.

### UX-009 — Assess ref-pill clutter at low zoom on a phone viewport

- **Status:** open · **Severity:** low · **Date:** 2026-07-21
- **Location:** `js/app.js:250-256` (permanent tooltips bound
  unconditionally); `minZoom: 16`, default `zoom: 17` (`js/app.js:20-24`)
- **Problem:** All 40 ref pills render simultaneously at every zoom level
  (the old zoom-gating was removed with name labels); whether they collide
  unreadably at minZoom 16 on a phone hasn't been visually verified.
- **Goal:** Screenshot the map at zoom 16/17 in a mobile-sized headless
  Chromium viewport; if pills collide in the dense blocks, zoom-gate or thin
  them below zoom 17, otherwise flip this entry to wontfix with the
  screenshot as evidence.
- **Done when:** A documented decision backed by screenshots, and (if needed)
  zoom-gating shipped.

## BLD — Build / Deployment

### BLD-001 — Commit the CI and Pages workflows once the gh token has workflow scope

- **Status:** fixed · **Severity:** med · **Date:** 2026-07-21
- **Location:** `.github/workflows/ci.yml`, `.github/workflows/pages.yml`
- **Problem:** The gh OAuth token lacked the `workflow` scope, so the CI
  workflow (data validation on PRs) and the Actions-based Pages deploy could
  not be pushed; merges to main shipped with no automated gate.
- **Resolution:** Token refreshed with `workflow` scope; both workflows
  committed via PR #4, CI verified green on that PR and verified to fail on a
  deliberately broken data fixture, Pages switched from legacy branch build to
  `build_type=workflow`.

### BLD-002 — Require the CI validate check to pass before merging to main

- **Status:** open · **Severity:** low · **Date:** 2026-07-21
- **Location:** GitHub repo settings (`gh api repos/renkt99/unofficialNDmap/branches/main/protection` → 404 "Branch not protected")
- **Problem:** `ci.yml`'s `validate` job runs and fails correctly on bad data
  (verified via PR #5), but no branch-protection rule makes it required, so
  GitHub would permit merging a PR with a failing or pending check. Today the
  only gate is the operator's watch-and-merge discipline.
- **Goal:** Add a branch-protection rule on `main` requiring the `validate`
  status check (repo is public, so this is available on the free plan), e.g.
  via `gh api -X PUT repos/renkt99/unofficialNDmap/branches/main/protection`.
- **Done when:** `gh api repos/renkt99/unofficialNDmap/branches/main/protection`
  returns a rule listing `validate` as a required status check, and a test PR
  with a failing check shows merge blocked in the GitHub UI.

### BLD-003 — Stop publishing raw snapshots and reference PDFs to the public site

- **Status:** open · **Severity:** med · **Date:** 2026-07-21
- **Location:** `.github/workflows/pages.yml` (`upload-pages-artifact` `path: .`)
- **Problem:** The Pages artifact is the whole repo, so
  `data/footprints-raw.json` (392K), `data/pois-raw.json` (44K), and both
  `reference/*.pdf` official campus maps (university-copyrighted material) are
  republished verbatim at the public site URL even though the app only fetches
  `data/*.geojson`. The PDFs are the main concern — redistributing them was
  never a deliberate decision.
- **Goal:** In `pages.yml`, stage a filtered build dir (copy `index.html`,
  `.nojekyll`, `css/`, `js/`, `vendor/`, and `data/*.geojson` only) and point
  `upload-pages-artifact`'s `path:` at it; verify the deployed site still loads
  and that `<site>/reference/fremantle-campus-map-2025-11.pdf` returns 404.
- **Done when:** Deploy run green, map loads at the published URL, and the raw
  JSON + PDF URLs 404.

### BLD-004 — Add a LICENSE file for the project's own code

- **Status:** open · **Severity:** low · **Date:** 2026-07-21
- **Location:** repo root (no `LICENSE*` file exists; README covers only data:
  OSM/ODbL, CARTO, Leaflet BSD-2, leaflet-rotate GPL-3.0)
- **Problem:** The site's own HTML/CSS/JS has no stated license, so reuse
  rights are legally undefined. Note the vendored leaflet-rotate is GPL-3.0,
  which constrains the choice for the combined work.
- **Goal:** Pick a license compatible with the GPL-3.0 vendored dependency
  (GPL-3.0 itself is the safe choice for the site as distributed), add
  `LICENSE` at the repo root, and reference it from the README.
- **Done when:** `LICENSE` exists at the root and README's licensing section
  mentions the project-code license alongside the data/library licenses.

### BLD-005 — Document the required Node version for the data pipeline

- **Status:** open · **Severity:** low · **Date:** 2026-07-21
- **Location:** `README.md` (data pipeline section); `ci.yml` pins
  `node-version: 22`
- **Problem:** `scripts/*.mjs` are ES modules using `node:` specifiers, but the
  README never states a minimum Node version, so a contributor on an old Node
  gets confusing failures instead of a stated requirement.
- **Goal:** Add one line to the README's data-pipeline section: requires
  Node 22+ (matching CI; 18+ works but CI is the reference).
- **Done when:** README states the Node version next to the script
  instructions.

### BLD-006 — Document the Leaflet vendoring/upgrade procedure

- **Status:** open · **Severity:** low · **Date:** 2026-07-21
- **Location:** `vendor/` (Leaflet 1.9.4 + leaflet-rotate, hand-vendored; no
  lockfile, no SRI attributes in `index.html`)
- **Problem:** There is no written procedure for upgrading the vendored
  libraries, and no automated check that a vendor swap didn't break rendering —
  a future upgrade done casually could silently break the map.
- **Goal:** Add a short "Vendoring / upgrading" note to the README or CLAUDE.md:
  download the target dist bundle, diff against committed `vendor/` files
  before overwriting, keep `leaflet.css` and `vendor/images/` siblings, and
  re-test map rendering (desktop + mobile viewports) before merging.
- **Done when:** The procedure is documented and mentions the css/images
  sibling constraint from `audits/build-packaging.md`.
