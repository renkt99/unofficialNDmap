# unofficialNDmap

Unofficial interactive map of the University of Notre Dame Australia, Fremantle campus (Fremantle West End, Perth WA).

## Disclaimer

This is an unofficial project, not affiliated with or endorsed by the University of Notre Dame Australia. Building locations are partly unverified — all features are flagged with a confidence level in `data/nd-buildings.json`.

## Features

- **Live GPS "blue dot"** — shows your current location on the map
- **All ND building numbers and names** with their contents, sourced from the official campus map PDF
- **Entrance arrows** — building entrances transcribed from the official campus map PDF
- **Search functionality** — find by building number, name, or room/facility
- **Building detail panel** — tap a building to see full details
- **Map locked to the campus area** — navigation constrained to Fremantle West End
- **Keyboard access via search** — building footprints on the map are pointer-only by design (Leaflet vector shapes aren't focusable); the search box is the designated keyboard path: it is a full ARIA combobox, and every building and facility is reachable by typing and arrowing through the results

## Running Locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000 in your browser.

**Note:** Geolocation works on localhost or HTTPS only.

## Code Conventions

**Browser files (`js/*.js`) and Node scripts have different syntax levels:**
- `js/*.js` — ES5 `var`-only IIFEs with conservative syntax, shipped unbundled to browsers with no build step. Do not modernize these files to let/const/arrow functions; they must stay ES5-compatible for all browsers.
- `scripts/*.mjs` — Modern Node.js ESM modules with current syntax. Contributors must not mix styles between the two; if adding browser code, follow the ES5 pattern.

## Data Pipeline

The data workflow consists of three scripts (requires **Node 22+**; CI is the reference):

1. **`node scripts/fetch-footprints.mjs`** — Fetches OSM building footprints via Overpass into `data/footprints-raw.json`
2. **`node scripts/build-geojson.mjs`** — Merges the hand-curated `data/nd-buildings.json` with the footprints into `data/buildings.geojson` and `data/context-buildings.geojson` (non-campus buildings drawn as muted context)
3. **`node scripts/validate-data.mjs`** — Sanity checks the generated data (also run in CI)

**Curated source of truth:** `data/nd-buildings.json`

**OSM snapshot refresh policy:** Re-run `node scripts/fetch-footprints.mjs` about every 6 months or before each semester to capture changes in the OpenStreetMap dataset. After each refresh, diff the raw snapshot (`data/footprints-raw.json`) and review any changed or removed way/relation ids that are referenced by `osm` fields in `data/nd-buildings.json` before regenerating with `build-geojson.mjs`.

## Data Sources & Licensing

- **Building footprints** © OpenStreetMap contributors, ODbL (https://www.openstreetmap.org/copyright)
- **Basemap tiles** by CARTO (Positron), © OpenStreetMap contributors © CARTO
- **Building references, contents, and entrance locations** transcribed from the official Fremantle Campus Map PDF (November 2025 edition, archived in `reference/` alongside the superseded Sept 2015 edition)
- **Address cross-references** from freotopia.org
- **Leaflet 1.9.4** (BSD-2) and **leaflet-rotate 0.2.8** (GPL-3.0) vendored in `vendor/`
- **This project's own code** (HTML/CSS/JS) is licensed under the **GPL-3.0** — see [LICENSE](LICENSE). (GPL-3.0 was chosen because the vendored leaflet-rotate is GPL-3.0, which governs the combined work as distributed.)

## Vendoring & Upgrading Leaflet

To upgrade Leaflet or leaflet-rotate: download the target distribution bundle, diff the extracted `vendor/` files against the committed version to understand what changed, then overwrite the existing files. **Keep `leaflet.css` and the `vendor/images/` directory as siblings** — `leaflet.css` contains relative references to `./images/` for icons and sprites. After any vendor swap, re-test map rendering on both desktop and mobile viewports before merging to ensure no visual regressions.

## Deployment

The map is automatically deployed to GitHub Pages via GitHub Actions on every push to the main branch.
