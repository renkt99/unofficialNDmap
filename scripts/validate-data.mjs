#!/usr/bin/env node
// Data sanity checks, run in CI. Fails (exit 1) on any violation:
// - buildings.geojson / pois.geojson parse as GeoJSON FeatureCollections
// - every ND ref in nd-buildings.json appears exactly once in buildings.geojson
// - every geometry lies within the campus bounds the map is locked to
// - every building has a name and a non-empty contents list
// - every POI has a known `kind` and a `name` that is either null or non-empty
// - every Polygon/MultiPolygon ring in buildings.geojson and
//   context-buildings.geojson is closed and has at least 4 positions
//
// Usage: node scripts/validate-data.mjs [dataDir]
// dataDir defaults to the real data/ directory; pass a fixture dir (see
// scripts/fixtures/) to validate a self-contained file set instead.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { BOUNDS } from './bounds.mjs';
import { parseAppJsCampusBounds } from './parse-app-bounds.mjs';

const KNOWN_POI_KINDS = ['parking', 'bus_stop'];

const dataDirPath = process.argv[2]
  ? resolve(process.cwd(), process.argv[2])
  : fileURLToPath(new URL('../data', import.meta.url));
const dataDir = (f) => resolve(dataDirPath, f);

// BOUNDS comes from ./bounds.mjs; must stay in sync with CAMPUS_BOUNDS in
// js/app.js (map lock bounds) — see bounds.mjs for details.

const errors = [];

// CQ-003: catch drift between js/app.js's hand-copied CAMPUS_BOUNDS and
// BOUNDS above. Always checks the real js/app.js (see parse-app-bounds.mjs)
// regardless of the dataDir argument — this is a code-level check, not a
// data-fixture one, so fixture-dir validation runs still validate it.
try {
  const appJsBounds = parseAppJsCampusBounds();
  const mismatched = ['south', 'west', 'north', 'east'].filter((k) => appJsBounds[k] !== BOUNDS[k]);
  if (mismatched.length) {
    errors.push(
      `CAMPUS_BOUNDS in js/app.js does not match BOUNDS in scripts/bounds.mjs ` +
        `(mismatched: ${mismatched.join(', ')}) — js/app.js: ${JSON.stringify(appJsBounds)}, ` +
        `bounds.mjs: ${JSON.stringify(BOUNDS)}`,
    );
  }
} catch (err) {
  // Fail loudly rather than silently skipping the check.
  errors.push(`CAMPUS_BOUNDS drift check: ${err.message}`);
}

function coordsWithin(geometry) {
  const flat = [];
  const walk = (c) => (typeof c[0] === 'number' ? flat.push(c) : c.forEach(walk));
  walk(geometry.coordinates);
  return flat.every(
    ([lon, lat]) => lat >= BOUNDS.south && lat <= BOUNDS.north && lon >= BOUNDS.west && lon <= BOUNDS.east,
  );
}

function ringClosureErrors(name, fc) {
  const errs = [];
  if (fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) {
    errs.push(`${name}: not a FeatureCollection`);
    return errs;
  }
  fc.features.forEach((f, i) => {
    const id = f.properties?.ref ?? f.properties?.osm ?? i;
    const geom = f.geometry;
    if (!geom) return; // malformed features are reported elsewhere for files that check it
    const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
    polys.forEach((rings, pi) => {
      rings.forEach((ring, ri) => {
        if (!Array.isArray(ring) || ring.length < 4) {
          errs.push(`${name}[${id}] polygon ${pi} ring ${ri}: fewer than 4 positions`);
          return;
        }
        const [fx, fy] = ring[0];
        const [lx, ly] = ring[ring.length - 1];
        if (fx !== lx || fy !== ly) {
          errs.push(`${name}[${id}] polygon ${pi} ring ${ri}: not closed (first coord != last coord)`);
        }
      });
    });
  });
  return errs;
}

const curated = JSON.parse(readFileSync(dataDir('nd-buildings.json'), 'utf8'));
const buildings = JSON.parse(readFileSync(dataDir('buildings.geojson'), 'utf8'));
const pois = JSON.parse(readFileSync(dataDir('pois.geojson'), 'utf8'));
const contextBuildings = JSON.parse(readFileSync(dataDir('context-buildings.geojson'), 'utf8'));

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
  if (f.geometry.type !== 'Point') {
    const lp = p.labelPoint;
    if (!Array.isArray(lp) || lp.length !== 2) {
      errors.push(`${p.ref}: missing labelPoint`);
    } else if (lp[1] < BOUNDS.south || lp[1] > BOUNDS.north || lp[0] < BOUNDS.west || lp[0] > BOUNDS.east) {
      errors.push(`${p.ref}: labelPoint outside campus bounds`);
    }
  }
  if (!p.name) errors.push(`${p.ref}: missing name`);
  if (!Array.isArray(p.contents) || p.contents.length === 0) errors.push(`${p.ref}: empty contents`);
  if (!['high', 'medium', 'low'].includes(p.confidence)) errors.push(`${p.ref}: bad confidence "${p.confidence}"`);
}

// POI kind must be from the known set produced by kindForTags() in
// build-geojson.mjs; name may legitimately be null (e.g. unnamed parking
// lots) but must never be an empty string.
pois.features.forEach((f, i) => {
  const p = f.properties ?? {};
  const id = p.osm ?? i;
  if (!KNOWN_POI_KINDS.includes(p.kind)) {
    errors.push(`pois.geojson[${id}]: bad kind "${p.kind}"`);
  }
  if (p.name !== null && (typeof p.name !== 'string' || p.name.trim() === '')) {
    errors.push(`pois.geojson[${id}]: name must be null or a non-empty string, got ${JSON.stringify(p.name)}`);
  }
});

errors.push(...ringClosureErrors('buildings.geojson', buildings));
errors.push(...ringClosureErrors('context-buildings.geojson', contextBuildings));

if (errors.length) {
  console.error(`Validation FAILED (${errors.length} errors):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`Validation OK: ${buildings.features.length} buildings, ${pois.features.length} POIs.`);
