# Code Quality Audit Checklist

Ledger prefix: **CQ**

This repo's main quality risk is implicit cross-file contracts: `js/{app,panel,locate,search}.js`
are four separate IIFEs that share state and functions only through `window.NDMap`, with
correctness depending on `<script>` order in `index.html` and on defensive `if (NDMap.x)`
checks rather than any enforced interface. A close second is copy-pasted constants (campus
bounds, style colors, magic numbers) that have to be kept in sync by hand across JS, CSS, and
the Node scripts, with no single source of truth and no gate that would catch drift.

## NDMap namespace contract

- [ ] `index.html` (lines 36-39) loads `app.js`, `panel.js`, `locate.js`, `search.js` in a fixed
      order with no comment in the HTML itself explaining why order matters; the only place the
      dependency is documented is the header comment in `js/app.js` ("Exposes window.NDMap,
      used by panel.js / locate.js / search.js"). Add the same note next to the `<script>` tags.
- [ ] `js/app.js` calls `NDMap.openPanel`/`NDMap.closePanel` behind `if (NDMap.openPanel)` guards
      (lines 154, 237) because `panel.js` hasn't necessarily run yet when `app.js`'s async
      `fetch().then()` callbacks fire — but `js/panel.js` (lines 8-9) reads `NDMap.escapeHtml`
      and calls `NDMap.highlightBuilding`/`NDMap.clearHighlight` with no such guard, assuming
      `app.js` already ran synchronously first. The contract ("app.js's sync exports are safe to
      assume, app.js's async-populated exports are not") is implicit and undocumented.
- [ ] `js/search.js` (line 8-9) and `js/panel.js` (line 8-9) both do `var NDMap = window.NDMap;`
      and `var escapeHtml = NDMap.escapeHtml;` at load time with no check that `NDMap` or
      `NDMap.escapeHtml` exist — a script-order change or a script failing to load would throw
      `Cannot read properties of undefined` with no diagnostic pointing at the real cause.
- [ ] No JSDoc or type annotations anywhere on the `NDMap.*` functions (`escapeHtml`,
      `highlightBuilding`, `clearHighlight`, `openPanel`, `closePanel`) that make up the
      cross-file contract — each consumer has to read the producer's source to know the
      expected argument shape (e.g. `openPanel(feature, layer)` where `layer` is optional per
      `js/search.js` line 112 passing a possibly-undefined `layer`).

## Duplicated constants

- [ ] Campus bounds (`-32.0615, 115.7405, -32.0515, 115.7515`) are hand-copied in four places:
      `js/app.js` lines 8-11 (`CAMPUS_BOUNDS`), `scripts/validate-data.mjs` line 16 (`BOUNDS`,
      comment says "Must stay in sync with CAMPUS_BOUNDS in js/app.js"), `scripts/build-geojson.mjs`
      line 91 (inline literals, comment says "must match validate-data.mjs"), and
      `scripts/fetch-footprints.mjs` line 14 (`BBOX` string). Nothing enforces the sync the
      comments ask for; a single shared JSON/constants file the four would import/read from
      would remove three of the four copies.
- [ ] Building fill/stroke colors are triplicated with no shared source: `#0d1f3d`/`#1a3a6b`
      appear as CSS custom properties `--navy`/`--navy-mid` in `css/app.css` lines 4-5, and as
      raw hex literals in both `baseStyle()` and `highlightStyle()` in `js/app.js` (lines 66-70
      and 86-90) — the two JS functions repeat the same color pair and differ only in
      `weight`/`opacity`/`fillOpacity`, so a color change requires editing three places.
- [ ] Zoom level `18` is a bare magic number used for two unrelated purposes with no shared
      name: the zoom-detail CSS class threshold in `updateZoomClass()` (`js/app.js` line 143)
      and the search "zoom to building" target in `selectResult()` (`js/search.js` line 106).
      If the "detail" zoom threshold ever changes, both call sites must be found and edited by
      hand.
- [ ] `maxZoom: 19` is repeated three times with no named constant: `js/app.js` line 17 (map
      option), line 26-27 (tile layer `maxZoom`/`maxNativeZoom`), and `js/search.js` line 108
      (`fitBounds` option) — same value, three unrelated literals.

## Un-named magic numbers

- [ ] `120` (ms search debounce, `js/search.js` line 125), `4000` (ms default toast duration,
      `js/locate.js` line 41), `5000`/`15000` (geolocation `maximumAge`/`timeout`,
      `js/locate.js` lines 146-147), and `45%` (mobile panel height, `css/app.css` line 287) are
      all inline literals with no named constant and no comment explaining the chosen value —
      none are self-evidently correct without inspection.

## Error handling

- [ ] `js/app.js`'s `buildingsPromise` fetch failure (`console.error`, resolves to `null`) —
      buildings are the core feature, but a failed load produces zero user-visible feedback
      beyond the console, unlike `js/locate.js`'s `showToast()` mechanism which exists but
      isn't reused here.
- [ ] `scripts/build-geojson.mjs` throws bare `Error` objects with no error codes/categories
      (e.g. lines 33, 55, 61) that crash the whole script with a stack trace; combined with no
      `try/catch` at the call site, a single malformed `nd-buildings.json` entry aborts the
      entire build with no partial-progress indication of how many buildings succeeded first.

## Tooling gaps (no deterministic gate exists yet)

- [ ] No `package.json`, `.eslintrc*`, or `.prettierrc*` anywhere in the repo — `var`-only style
      is followed by convention in all four `js/*.js` IIFEs (30/10/15/23 `var` declarations,
      zero `let`/`const`) but nothing enforces it; a contributor could mix in `let`/`const` or
      arrow functions with no linter to flag the inconsistency with the rest of the file.
      Since this is a no-deps repo, even a `npx eslint --no-install` recommended-config run in
      CI (alongside the existing untracked `.github/workflows/ci.yml`, which currently only runs
      `node scripts/validate-data.mjs`) would catch unused vars, undeclared globals, and
      accidental `==`.
- [ ] `.github/workflows/ci.yml` and `.github/workflows/pages.yml` exist on disk but are
      git-untracked (`git status` shows `?? .github/`) — CI is not actually active on this repo
      yet; this item should be re-checked once they're committed.
- [ ] `scripts/*.mjs` (ESM, `const`/arrow functions/optional chaining) and `js/*.js` (ES5-style
      IIFEs, `var`, no arrow functions) follow two unrelated style conventions with nothing
      documenting why (browser-compat target for `js/*.js` vs. Node-only for `scripts/*.mjs`) —
      worth a one-line note in README or a top-of-file comment so contributors don't "modernize"
      the browser files and accidentally reintroduce a compat requirement no one asked for.

## Style/CSS hygiene

- [ ] `js/app.js`'s `baseStyle()`/`highlightStyle()`/`pointStyle()`/`pointHighlightStyle()`
      (lines 54-104) form a 4-function cluster where `pointStyle`/`pointHighlightStyle` just
      call the non-point variant and bolt on a `radius` — readable, but the courtyard/building
      branch (`if (feature.properties.kind === 'courtyard')`) is duplicated verbatim between
      `baseStyle` and `highlightStyle` instead of being expressed as a diff over a shared base
      object.
- [ ] `css/app.css` has two separately-declared `#detail-panel` rule blocks (lines 216-224 and
      281-292) rather than one consolidated rule — not wrong (mobile-first override pattern) but
      undocumented as deliberate; a comment marking the split would save the next editor from
      merging them and breaking the cascade.
