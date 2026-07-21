#!/usr/bin/env node
// Data sanity checks, run in CI. Fails (exit 1) on any violation:
// - buildings.geojson / pois.geojson parse as GeoJSON FeatureCollections
// - every ND ref in nd-buildings.json appears exactly once in buildings.geojson
// - every geometry lies within the campus bounds the map is locked to
// - every building has a name and a non-empty contents list
//
// Usage: node scripts/validate-data.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dataDir = (f) => fileURLToPath(new URL(`../data/${f}`, import.meta.url));

// Must stay in sync with CAMPUS_BOUNDS in js/app.js (map lock bounds).
const BOUNDS = { south: -32.0615, west: 115.7405, north: -32.0515, east: 115.7515 };

const errors = [];

function coordsWithin(geometry) {
  const flat = [];
  const walk = (c) => (typeof c[0] === 'number' ? flat.push(c) : c.forEach(walk));
  walk(geometry.coordinates);
  return flat.every(
    ([lon, lat]) => lat >= BOUNDS.south && lat <= BOUNDS.north && lon >= BOUNDS.west && lon <= BOUNDS.east,
  );
}

const curated = JSON.parse(readFileSync(dataDir('nd-buildings.json'), 'utf8'));
const buildings = JSON.parse(readFileSync(dataDir('buildings.geojson'), 'utf8'));
const pois = JSON.parse(readFileSync(dataDir('pois.geojson'), 'utf8'));

for (const [name, fc] of [['buildings.geojson', buildings], ['pois.geojson', pois]]) {
  if (fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) {
    errors.push(`${name}: not a FeatureCollection`);
    continue;
  }
  fc.features.forEach((f, i) => {
    if (f.type !== 'Feature' || !f.geometry || !f.geometry.coordinates) {
      errors.push(`${name}[${i}]: malformed feature`);
    } else if (!coordsWithin(f.geometry)) {
      errors.push(`${name}[${i}] (${f.properties?.ref ?? f.properties?.kind ?? '?'}): geometry outside campus bounds`);
    }
  });
}

const curatedRefs = curated.buildings.map((b) => b.ref);
const geoRefs = buildings.features.map((f) => f.properties.ref);
for (const ref of curatedRefs) {
  const n = geoRefs.filter((r) => r === ref).length;
  if (n !== 1) errors.push(`${ref}: appears ${n} times in buildings.geojson (expected 1)`);
}
for (const f of buildings.features) {
  const p = f.properties;
  if (!p.name) errors.push(`${p.ref}: missing name`);
  if (!Array.isArray(p.contents) || p.contents.length === 0) errors.push(`${p.ref}: empty contents`);
  if (!['high', 'medium', 'low'].includes(p.confidence)) errors.push(`${p.ref}: bad confidence "${p.confidence}"`);
}

if (errors.length) {
  console.error(`Validation FAILED (${errors.length} errors):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`Validation OK: ${buildings.features.length} buildings, ${pois.features.length} POIs.`);
