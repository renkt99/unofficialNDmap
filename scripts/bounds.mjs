// Shared campus bounds, derived from the official PDF map's scope
// (Cliff St -> Pakenham St, rail curve -> Esplanade Park).
// Used by scripts/validate-data.mjs and scripts/build-geojson.mjs.
//
// js/app.js CAMPUS_BOUNDS must be kept in sync with this MANUALLY — browser
// code here has no bundler, so it can't import an .mjs module directly.
//
// scripts/fetch-footprints.mjs deliberately queries a WIDER bbox than this
// for its raw OSM snapshots (so buildings/POIs just outside the tight map
// bounds are still available in the raw data if ever needed) — do not tighten
// that script's bbox to match this file.
export const BOUNDS = { south: -32.0585, west: 115.7408, north: -32.0522, east: 115.7465 };
