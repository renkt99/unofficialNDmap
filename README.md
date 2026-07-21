# unofficialNDmap

Unofficial interactive map of the University of Notre Dame Australia, Fremantle campus (Fremantle West End, Perth WA).

## Disclaimer

This is an unofficial project, not affiliated with or endorsed by the University of Notre Dame Australia. Building locations are partly unverified — all features are flagged with a confidence level in `data/nd-buildings.json`.

## Features

- **Live GPS "blue dot"** — shows your current location on the map
- **All ND building numbers and names** with their contents, sourced from the official campus map PDF
- **Search functionality** — find by building number, name, or room/facility
- **Building detail panel** — tap a building to see full details
- **Parking and bus stop markers** — other campus amenities (the free Fremantle CAT bus shown on the official PDF was discontinued in 2023, so regular Transperth stops are shown instead)
- **Map locked to the campus area** — navigation constrained to Fremantle West End

## Running Locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000 in your browser.

**Note:** Geolocation works on localhost or HTTPS only.

## Data Pipeline

The data workflow consists of three scripts:

1. **`node scripts/fetch-footprints.mjs`** — Fetches OSM building footprints and POIs via Overpass into `data/*-raw.json` snapshots
2. **`node scripts/build-geojson.mjs`** — Merges the hand-curated `data/nd-buildings.json` with the footprints into `data/buildings.geojson`, `data/pois.geojson`, and `data/context-buildings.geojson` (non-campus buildings drawn as muted context)
3. **`node scripts/validate-data.mjs`** — Sanity checks the generated data (also run in CI)

**Curated source of truth:** `data/nd-buildings.json`

## Data Sources & Licensing

- **Building footprints and POIs** © OpenStreetMap contributors, ODbL (https://www.openstreetmap.org/copyright)
- **Basemap tiles** by CARTO (Positron), © OpenStreetMap contributors © CARTO
- **Building references and contents** transcribed from the official Fremantle Campus Map PDF (November 2025 edition, archived in `reference/` alongside the superseded Sept 2015 edition)
- **Address cross-references** from freotopia.org
- **Leaflet 1.9.4** (BSD-2) vendored in `vendor/`

## Deployment

The map is automatically deployed to GitHub Pages via GitHub Actions on every push to the main branch.
