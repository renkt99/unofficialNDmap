# unofficialNDmap

Static Leaflet map of the Notre Dame Fremantle campus. No build step, no npm
dependencies — plain HTML/CSS/JS served as-is (GitHub Pages branch build of
`main`, site at https://renkt99.github.io/unofficialNDmap/, served under the
`/unofficialNDmap/` subpath: all asset/data references must stay **relative**).

- App: `index.html`, `css/app.css`, `js/{app,panel,locate,search}.js` — IIFEs
  sharing the `window.NDMap` namespace; `js/app.js` must load first.
- Data: `data/nd-buildings.json` is the hand-curated source of truth; never
  edit `data/buildings.geojson` / `data/pois.geojson` / `data/context-buildings.geojson` directly — regenerate
  with `node scripts/build-geojson.mjs` and check with
  `node scripts/validate-data.mjs` (run this before every merge; there is no
  CI gate yet — see BLD-001 in `audits/FINDINGS.md`).
- The campus bounds live in `scripts/bounds.mjs` (`BOUNDS`), imported by both
  `scripts/validate-data.mjs` and the POI filter in `scripts/build-geojson.mjs`,
  plus the `CAMPUS_BOUNDS` literal in `js/app.js` (which must be kept in sync
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
