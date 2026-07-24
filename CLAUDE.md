# unofficialNDmap

Static Leaflet map of the Notre Dame Fremantle campus. No build step, no npm
dependencies — plain HTML/CSS/JS served as-is (deployed by
`.github/workflows/pages.yml` on push to `main`, which stages only the app
files — never the raw snapshots or `reference/` PDFs; site at
https://renkt99.github.io/unofficialNDmap/, served under the
`/unofficialNDmap/` subpath: all asset/data references must stay **relative**).

- App: `index.html`, `css/app.css`, `js/{app,panel,locate,search}.js` — IIFEs
  sharing the `window.NDMap` namespace; `js/app.js` must load first. Browser
  files are deliberately ES5 `var`-only (shipped unbundled, no build step) —
  do not modernize them; `scripts/*.mjs` are modern Node ESM.
- Data: `data/nd-buildings.json` is the hand-curated source of truth; never
  edit `data/buildings.geojson` / `data/context-buildings.geojson` directly — regenerate
  with `node scripts/build-geojson.mjs` and check with
  `node scripts/validate-data.mjs`. CI (`.github/workflows/ci.yml`) gates
  every PR: it fails on stale committed geojson, runs the validator, and runs
  `node --test "scripts/**/*.test.mjs"`; branch protection on `main` requires
  the `validate` check. `entrances` (where present) are curated `[lon,lat]`
  points, snapped to the footprint edge and given an inward bearing at build
  time by `build-geojson.mjs`.
- The campus bounds live in `scripts/bounds.mjs` (`BOUNDS`), imported by both
  `scripts/validate-data.mjs` and `scripts/build-geojson.mjs` (context-buildings
  bounds filter), plus the `CAMPUS_BOUNDS` literal in `js/app.js` (which must be kept in sync
  by hand — that file has no bundler and can't import `bounds.mjs`) — change
  `bounds.mjs` and `js/app.js` together, never one without the other.
  `scripts/fetch-footprints.mjs` intentionally queries a wider bbox for its
  raw OSM snapshots and should NOT be tightened to match.

## Audit workflow

`audits/` holds per-category inspection checklists plus the
`audits/FINDINGS.md` ledger (`open / fixed / wontfix`, resolve in place, never
delete). Ledger-first rule: check it before reporting any finding. Per-PR
`/code-review` + `/security-review` triaged against the ledger is the primary
review mechanism; `/audit-sweep <category>` does whole-repo sweeps one
category at a time, per release.
