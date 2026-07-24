#!/usr/bin/env node
// Merge the curated ND building list (data/nd-buildings.json) with OSM
// footprints (data/footprints-raw.json) into data/buildings.geojson.
//
// Usage: node scripts/build-geojson.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BOUNDS } from './bounds.mjs';

const dataDir = (f) => fileURLToPath(new URL(`../data/${f}`, import.meta.url));

export function ringFromGeometry(geometry) {
  const ring = geometry.map((p) => [p.lon, p.lat]);
  const [fx, fy] = ring[0];
  const [lx, ly] = ring[ring.length - 1];
  if (fx !== lx || fy !== ly) ring.push([fx, fy]);
  return ring;
}

// Closed GeoJSON ring from a curated `polygon` vertex list. Curated vertices
// are [lat, lng] (matching the `point` field convention); GeoJSON positions
// are [lon, lat].
export function ringFromLatLngs(latLngs) {
  const ring = latLngs.map(([lat, lon]) => [lon, lat]);
  const [fx, fy] = ring[0];
  const [lx, ly] = ring[ring.length - 1];
  if (fx !== lx || fy !== ly) ring.push([fx, fy]);
  return ring;
}

// Even-odd point-in-ring test for [lon, lat] points against a closed ring of
// [lon, lat] pairs. Used only to decide which outer shell an inner (hole)
// ring belongs to for MultiPolygon relations.
function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// Snaps [lon, lat] to the nearest point on any exterior ring of `geometry`
// (Polygon → coordinates[0]; MultiPolygon → each polygon's [0]) and derives
// the inward-pointing compass bearing (0 = north, clockwise) of that edge.
// Point-segment projection runs in locally scaled degrees (lon × cos(lat))
// so x/y distances are comparable — same scaling as poleOfInaccessibility
// above. The inward side is determined by offsetting a small distance along
// each of the edge's two normal candidates and testing which offset point
// falls inside the ring (pointInRing) — more robust than reasoning about
// ring winding.
//
// Note: if the input point sits exactly on a shared vertex between two
// edges, the nearest edge is ambiguous (both are equidistant) and this
// picks whichever edge is encountered first in ring order — curated
// entrance points should sit mid-edge, not on a footprint corner.
export function snapEntranceToFootprint(lonLat, geometry) {
  const rings = (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates).map((poly) => poly[0]);
  const k = Math.cos((lonLat[1] * Math.PI) / 180);
  const toScaled = ([lon, lat]) => [lon * k, lat];
  const [px, py] = toScaled(lonLat);

  let best = null;
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const a = toScaled(ring[i]);
      const b = toScaled(ring[i + 1]);
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const segLenSq = dx * dx + dy * dy;
      let t = 0;
      if (segLenSq !== 0) {
        t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / segLenSq));
      }
      const sx = a[0] + dx * t;
      const sy = a[1] + dy * t;
      const dSq = (px - sx) * (px - sx) + (py - sy) * (py - sy);
      if (!best || dSq < best.dSq) best = { dSq, sx, sy, dx, dy, ring };
    }
  }

  const point = [Number((best.sx / k).toFixed(7)), Number(best.sy.toFixed(7))];

  // Two perpendicular candidates to the edge direction; offset a small
  // distance (~1m, in scaled degrees) from the snapped point along each and
  // test which one lands inside the polygon via the existing pointInRing.
  const mag = Math.sqrt(best.dx * best.dx + best.dy * best.dy) || 1;
  const nx = -best.dy / mag;
  const ny = best.dx / mag;
  const eps = 1e-5;
  const candidate = [point[0] + (nx * eps) / k, point[1] + ny * eps];
  const inward = pointInRing(candidate, best.ring) ? [nx, ny] : [-nx, -ny];

  const bearing = Math.round(((Math.atan2(inward[0], inward[1]) * 180) / Math.PI + 360) % 360) % 360;

  return { point, bearing };
}

export function geometryFor(el) {
  if (el.type === 'way') {
    return { type: 'Polygon', coordinates: [ringFromGeometry(el.geometry)] };
  }
  // Multipolygon relation: each outer member is a polygon shell; inner
  // members become holes (additional rings) of the outer shell that
  // contains them.
  const members = el.members || [];
  const allOuters = members.filter((m) => m.role === 'outer');
  const outers = allOuters.filter((m) => m.geometry);
  if (!outers.length) throw new Error(`relation/${el.id} has no outer members with geometry`);
  if (outers.length !== allOuters.length) {
    throw new Error(
      `relation/${el.id}: ${allOuters.length - outers.length} of ${allOuters.length} outer members are missing geometry`,
    );
  }

  const allInners = members.filter((m) => m.role === 'inner');
  const inners = allInners.filter((m) => m.geometry);
  if (inners.length !== allInners.length) {
    console.warn(
      `relation/${el.id}: ${allInners.length - inners.length} of ${allInners.length} inner members are missing geometry (hole dropped)`,
    );
  }

  const polys = outers.map((m) => [ringFromGeometry(m.geometry)]);
  for (const inner of inners) {
    const innerRing = ringFromGeometry(inner.geometry);
    const target =
      polys.length === 1 ? polys[0] : (polys.find((poly) => pointInRing(innerRing[0], poly[0])) ?? polys[0]);
    target.push(innerRing);
  }

  return polys.length === 1
    ? { type: 'Polygon', coordinates: polys[0] }
    : { type: 'MultiPolygon', coordinates: polys };
}

// Looks up a curated building's OSM element by id, throwing the same error
// the inline lookup used to throw when the id isn't in the snapshot.
export function findOsmElement(byId, osmId, ref) {
  const el = byId.get(osmId);
  if (!el) throw new Error(`${ref}: OSM element ${osmId} not found in footprints-raw.json`);
  return el;
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

function main() {
  const curated = JSON.parse(readFileSync(dataDir('nd-buildings.json'), 'utf8'));
  const raw = JSON.parse(readFileSync(dataDir('footprints-raw.json'), 'utf8'));

  const byId = new Map(raw.elements.map((e) => [`${e.type}/${e.id}`, e]));

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
    // Official map's dark-navy "Key buildings" tier (styled in js/app.js).
    if (b.key) props.key = true;

    let geometry;
    if (b.polygon) {
      // Hand-drawn footprint, used where one OSM way covers several ND
      // numbers and the official map's interior walls split it (e.g. the
      // ND21/ND38 terrace). `osm` may still name the parent way so it stays
      // excluded from the context layer below.
      geometry = { type: 'Polygon', coordinates: [ringFromLatLngs(b.polygon)] };
      if (b.osm) props.osm = b.osm;
      props.labelPoint = labelPointFor(geometry);
    } else if (b.osm) {
      const el = findOsmElement(byId, b.osm, b.ref);
      geometry = geometryFor(el);
      props.osm = b.osm;
      props.labelPoint = labelPointFor(geometry);
    } else if (b.point) {
      geometry = { type: 'Point', coordinates: [b.point[1], b.point[0]] };
    } else {
      throw new Error(`${b.ref}: needs either "osm", "polygon" or "point"`);
    }

    if (b.entrances) {
      if (geometry.type === 'Point') {
        throw new Error(`${b.ref}: has "entrances" but only a "point" geometry (courtyards/points can't have entrances)`);
      }
      props.entrances = b.entrances.map(([lon, lat]) => {
        const snapped = snapEntranceToFootprint([lon, lat], geometry);
        const dLon = (snapped.point[0] - lon) * Math.cos((lat * Math.PI) / 180) * 111320;
        const dLat = (snapped.point[1] - lat) * 111320;
        const distM = Math.sqrt(dLon * dLon + dLat * dLat);
        if (distM > 30) {
          throw new Error(`${b.ref}: entrance [${lon}, ${lat}] snapped ${distM.toFixed(1)}m from the footprint boundary (expected <30m — check for a typo)`);
        }
        return [snapped.point[0], snapped.point[1], snapped.bearing];
      });
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
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
