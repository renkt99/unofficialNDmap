#!/usr/bin/env node
// Merge the curated ND building list (data/nd-buildings.json) with OSM
// footprints (data/footprints-raw.json) into data/buildings.geojson, and
// convert data/pois-raw.json into data/pois.geojson.
//
// Usage: node scripts/build-geojson.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BOUNDS } from './bounds.mjs';

const dataDir = (f) => fileURLToPath(new URL(`../data/${f}`, import.meta.url));

const curated = JSON.parse(readFileSync(dataDir('nd-buildings.json'), 'utf8'));
const raw = JSON.parse(readFileSync(dataDir('footprints-raw.json'), 'utf8'));

const byId = new Map(raw.elements.map((e) => [`${e.type}/${e.id}`, e]));

function ringFromGeometry(geometry) {
  const ring = geometry.map((p) => [p.lon, p.lat]);
  const [fx, fy] = ring[0];
  const [lx, ly] = ring[ring.length - 1];
  if (fx !== lx || fy !== ly) ring.push([fx, fy]);
  return ring;
}

function geometryFor(el) {
  if (el.type === 'way') {
    return { type: 'Polygon', coordinates: [ringFromGeometry(el.geometry)] };
  }
  // Multipolygon relation: treat each outer member as a polygon shell.
  // (Sufficient for the buildings used here; inner holes are ignored.)
  const outers = (el.members || []).filter((m) => m.role === 'outer' && m.geometry);
  if (!outers.length) throw new Error(`relation/${el.id} has no outer members with geometry`);
  const polys = outers.map((m) => [ringFromGeometry(m.geometry)]);
  return polys.length === 1
    ? { type: 'Polygon', coordinates: polys[0] }
    : { type: 'MultiPolygon', coordinates: polys };
}

const features = [];
for (const b of curated.buildings) {
  const props = {
    ref: b.ref,
    name: b.name,
    address: b.address ?? null,
    contents: b.contents ?? [],
    confidence: b.confidence,
    kind: b.kind ?? 'building',
  };
  if (b.note) props.note = b.note;

  let geometry;
  if (b.osm) {
    const el = byId.get(b.osm);
    if (!el) throw new Error(`${b.ref}: OSM element ${b.osm} not found in footprints-raw.json`);
    geometry = geometryFor(el);
    props.osm = b.osm;
  } else if (b.point) {
    geometry = { type: 'Point', coordinates: [b.point[1], b.point[0]] };
  } else {
    throw new Error(`${b.ref}: needs either "osm" or "point"`);
  }
  features.push({ type: 'Feature', properties: props, geometry });
}

const fc = {
  type: 'FeatureCollection',
  _attribution: 'Building footprints © OpenStreetMap contributors (ODbL). Building references from the University of Notre Dame Australia Fremantle Campus Map.',
  features,
};
writeFileSync(dataDir('buildings.geojson'), JSON.stringify(fc));
console.log(`Wrote data/buildings.geojson (${features.length} features)`);

// --- Context buildings (non-campus) ---
// All other footprints inside the campus bounds, drawn as muted beige blocks
// beneath the ND buildings (the raster basemap's own buildings are too bright
// against the cream tint). Geometry only — they are non-interactive.
const usedOsm = new Set(curated.buildings.map((b) => b.osm).filter(Boolean));
const contextFeatures = [];
for (const el of raw.elements) {
  const id = `${el.type}/${el.id}`;
  if (usedOsm.has(id)) continue;
  let geometry;
  try {
    geometry = geometryFor(el);
  } catch {
    continue; // e.g. relation without resolvable outer geometry
  }
  // Keep any footprint that reaches into the campus bounds (edge-crossers included).
  const flat = [];
  const walk = (c) => (typeof c[0] === 'number' ? flat.push(c) : c.forEach(walk));
  walk(geometry.coordinates);
  const inside = flat.some(
    ([lon, lat]) => lat >= BOUNDS.south && lat <= BOUNDS.north && lon >= BOUNDS.west && lon <= BOUNDS.east,
  );
  if (!inside) continue;
  contextFeatures.push({ type: 'Feature', properties: {}, geometry });
}
writeFileSync(
  dataDir('context-buildings.geojson'),
  JSON.stringify({ type: 'FeatureCollection', _attribution: '© OpenStreetMap contributors (ODbL)', features: contextFeatures }),
);
console.log(`Wrote data/context-buildings.geojson (${contextFeatures.length} features)`);

// --- POIs ---
const poisRaw = JSON.parse(readFileSync(dataDir('pois-raw.json'), 'utf8'));
const poiFeatures = [];
for (const el of poisRaw.elements) {
  const t = el.tags || {};
  let kind = null;
  if (t.amenity === 'parking') kind = 'parking';
  else if (t.highway === 'bus_stop') kind = 'bus_stop';
  if (!kind) continue;
  // Note: the PDF legend shows CAT bus stops, but the Fremantle CAT service
  // was discontinued in 2023 — regular (Transperth) stops are shown instead.
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null) continue;
  // Query bbox clips ways loosely; keep only POIs whose centre is inside the
  // campus bounds the map is locked to (must match validate-data.mjs).
  if (lat < BOUNDS.south || lat > BOUNDS.north || lon < BOUNDS.west || lon > BOUNDS.east) continue;
  poiFeatures.push({
    type: 'Feature',
    properties: { kind, name: t.name ?? null, osm: `${el.type}/${el.id}` },
    geometry: { type: 'Point', coordinates: [lon, lat] },
  });
}
writeFileSync(
  dataDir('pois.geojson'),
  JSON.stringify({ type: 'FeatureCollection', _attribution: '© OpenStreetMap contributors (ODbL)', features: poiFeatures }),
);
console.log(`Wrote data/pois.geojson (${poiFeatures.length} features)`);
