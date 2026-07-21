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

// --- Label anchor: pole of inaccessibility ("polylabel") ---
// The interior point farthest from the outline — anchors the NDxx label at
// the footprint's visual centre (a plain centroid drifts to the edge, or
// outside entirely, on L-shaped footprints). Runs in locally-scaled degrees
// (lon × cos(lat)) so x/y distances are comparable.

function segDistSq(x, y, [ax, ay], [bx, by]) {
  let dx = bx - ax;
  let dy = by - ay;
  let px = ax;
  let py = ay;
  if (dx !== 0 || dy !== 0) {
    const t = ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      px = bx;
      py = by;
    } else if (t > 0) {
      px += dx * t;
      py += dy * t;
    }
  }
  dx = x - px;
  dy = y - py;
  return dx * dx + dy * dy;
}

// Signed distance from (x, y) to the polygon outline: positive inside.
function polygonDist(x, y, rings) {
  let inside = false;
  let minSq = Infinity;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) {
        inside = !inside;
      }
      minSq = Math.min(minSq, segDistSq(x, y, a, b));
    }
  }
  return (inside ? 1 : -1) * Math.sqrt(minSq);
}

function poleOfInaccessibility(rings, precision) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of rings[0]) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const cellSize = Math.min(maxX - minX, maxY - minY);
  if (cellSize === 0) return [minX, minY];

  const cell = (x, y, h) => ({ x, y, h, d: polygonDist(x, y, rings), max: 0 });
  const withMax = (c) => ((c.max = c.d + c.h * Math.SQRT2), c);

  const queue = [];
  for (let x = minX; x < maxX; x += cellSize) {
    for (let y = minY; y < maxY; y += cellSize) {
      queue.push(withMax(cell(x + cellSize / 2, y + cellSize / 2, cellSize / 2)));
    }
  }
  let best = cell((minX + maxX) / 2, (minY + maxY) / 2, 0);
  while (queue.length) {
    queue.sort((a, b) => a.max - b.max);
    const c = queue.pop();
    if (c.d > best.d) best = c;
    if (c.max - best.d <= precision) continue;
    const h = c.h / 2;
    queue.push(
      withMax(cell(c.x - h, c.y - h, h)),
      withMax(cell(c.x + h, c.y - h, h)),
      withMax(cell(c.x - h, c.y + h, h)),
      withMax(cell(c.x + h, c.y + h, h)),
    );
  }
  return [best.x, best.y];
}

function ringArea(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return Math.abs(sum / 2);
}

// [lon, lat] label anchor for a Polygon/MultiPolygon geometry. For
// multipolygons the label goes on the largest part.
function labelPointFor(geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const rings = polys.reduce((a, b) => (ringArea(b[0]) > ringArea(a[0]) ? b : a));
  const k = Math.cos((rings[0][0][1] * Math.PI) / 180);
  const scaled = rings.map((ring) => ring.map(([lon, lat]) => [lon * k, lat]));
  const [x, y] = poleOfInaccessibility(scaled, 5e-6); // ≈ 0.5 m
  return [Number((x / k).toFixed(7)), Number(y.toFixed(7))];
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
    props.labelPoint = labelPointFor(geometry);
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
