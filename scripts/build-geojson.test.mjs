// Unit tests for the pure geometry/merge logic in build-geojson.mjs.
// Run via: node --test scripts/
//
// Importing this module has no side effects (build-geojson.mjs gates its
// file-reading/writing `main()` behind a direct-execution check), so these
// tests exercise the exported functions against small inline fixtures
// instead of the real data/ files.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ringFromGeometry, ringFromLatLngs, geometryFor, findOsmElement, snapEntranceToFootprint } from './build-geojson.mjs';

test('ringFromGeometry: already-closed ring is unchanged', () => {
  const geometry = [
    { lat: 0, lon: 0 },
    { lat: 0, lon: 1 },
    { lat: 1, lon: 1 },
    { lat: 0, lon: 0 },
  ];
  const ring = ringFromGeometry(geometry);
  assert.equal(ring.length, 4);
  assert.deepEqual(ring, [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 0],
  ]);
});

test('ringFromGeometry: unclosed ring gets closed by appending the first coord', () => {
  const geometry = [
    { lat: 0, lon: 0 },
    { lat: 0, lon: 1 },
    { lat: 1, lon: 1 },
  ];
  const ring = ringFromGeometry(geometry);
  assert.equal(ring.length, 4);
  assert.deepEqual(ring[ring.length - 1], ring[0]);
  assert.deepEqual(ring, [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 0],
  ]);
});

test('ringFromLatLngs: swaps curated [lat,lng] vertices to [lon,lat] and closes the ring', () => {
  const ring = ringFromLatLngs([
    [-32.1, 115.7],
    [-32.1, 115.8],
    [-32.2, 115.8],
  ]);
  assert.equal(ring.length, 4);
  assert.deepEqual(ring[ring.length - 1], ring[0]);
  assert.deepEqual(ring, [
    [115.7, -32.1],
    [115.8, -32.1],
    [115.8, -32.2],
    [115.7, -32.1],
  ]);
});

test('ringFromLatLngs: an already-closed curated ring is unchanged', () => {
  const ring = ringFromLatLngs([
    [-32.1, 115.7],
    [-32.1, 115.8],
    [-32.2, 115.8],
    [-32.1, 115.7],
  ]);
  assert.equal(ring.length, 4);
});

test('geometryFor: a way element produces a Polygon', () => {
  const way = {
    type: 'way',
    id: 1,
    geometry: [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 1 },
      { lat: 1, lon: 1 },
      { lat: 0, lon: 0 },
    ],
  };
  const geometry = geometryFor(way);
  assert.equal(geometry.type, 'Polygon');
  assert.equal(geometry.coordinates.length, 1);
});

test('geometryFor: a relation with one outer member produces a Polygon', () => {
  const relation = {
    type: 'relation',
    id: 2,
    members: [
      {
        type: 'way',
        role: 'outer',
        geometry: [
          { lat: 0, lon: 0 },
          { lat: 0, lon: 1 },
          { lat: 1, lon: 1 },
          { lat: 0, lon: 0 },
        ],
      },
    ],
  };
  const geometry = geometryFor(relation);
  assert.equal(geometry.type, 'Polygon');
  assert.equal(geometry.coordinates.length, 1);
});

test('geometryFor: a relation with 2+ outer members produces a MultiPolygon', () => {
  const relation = {
    type: 'relation',
    id: 3,
    members: [
      {
        type: 'way',
        role: 'outer',
        geometry: [
          { lat: 0, lon: 0 },
          { lat: 0, lon: 1 },
          { lat: 1, lon: 1 },
          { lat: 0, lon: 0 },
        ],
      },
      {
        type: 'way',
        role: 'outer',
        geometry: [
          { lat: 10, lon: 10 },
          { lat: 10, lon: 11 },
          { lat: 11, lon: 11 },
          { lat: 10, lon: 10 },
        ],
      },
      {
        // an inner ring here is assigned as a hole of whichever outer
        // contains it (COR-001); it is never counted as an outer itself
        type: 'way',
        role: 'inner',
        geometry: [
          { lat: 0.2, lon: 0.2 },
          { lat: 0.2, lon: 0.4 },
          { lat: 0.4, lon: 0.4 },
          { lat: 0.2, lon: 0.2 },
        ],
      },
    ],
  };
  const geometry = geometryFor(relation);
  assert.equal(geometry.type, 'MultiPolygon');
  assert.equal(geometry.coordinates.length, 2);
});

test('geometryFor: a relation with one outer and one inner produces a Polygon with a closed hole ring', () => {
  const relation = {
    type: 'relation',
    id: 5,
    members: [
      {
        type: 'way',
        role: 'outer',
        geometry: [
          { lat: 0, lon: 0 },
          { lat: 0, lon: 10 },
          { lat: 10, lon: 10 },
          { lat: 10, lon: 0 },
          { lat: 0, lon: 0 },
        ],
      },
      {
        type: 'way',
        role: 'inner',
        geometry: [
          { lat: 2, lon: 2 },
          { lat: 2, lon: 4 },
          { lat: 4, lon: 4 },
          { lat: 4, lon: 2 },
        ], // deliberately unclosed
      },
    ],
  };
  const geometry = geometryFor(relation);
  assert.equal(geometry.type, 'Polygon');
  assert.equal(geometry.coordinates.length, 2);
  const hole = geometry.coordinates[1];
  assert.deepEqual(hole[0], hole[hole.length - 1]);
  assert.deepEqual(hole, [
    [2, 2],
    [4, 2],
    [4, 4],
    [2, 4],
    [2, 2],
  ]);
});

test('geometryFor: a relation with 2 outers and 1 inner puts the hole in the containing outer only', () => {
  const relation = {
    type: 'relation',
    id: 6,
    members: [
      {
        type: 'way',
        role: 'outer',
        geometry: [
          { lat: 0, lon: 0 },
          { lat: 0, lon: 1 },
          { lat: 1, lon: 1 },
          { lat: 1, lon: 0 },
          { lat: 0, lon: 0 },
        ],
      },
      {
        type: 'way',
        role: 'outer',
        geometry: [
          { lat: 10, lon: 10 },
          { lat: 10, lon: 11 },
          { lat: 11, lon: 11 },
          { lat: 11, lon: 10 },
          { lat: 10, lon: 10 },
        ],
      },
      {
        // squarely inside the second outer's bbox (10-11, 10-11), nowhere
        // near the first outer (0-1, 0-1) — unambiguous containment
        type: 'way',
        role: 'inner',
        geometry: [
          { lat: 10.2, lon: 10.2 },
          { lat: 10.2, lon: 10.4 },
          { lat: 10.4, lon: 10.4 },
          { lat: 10.4, lon: 10.2 },
          { lat: 10.2, lon: 10.2 },
        ],
      },
    ],
  };
  const geometry = geometryFor(relation);
  assert.equal(geometry.type, 'MultiPolygon');
  assert.equal(geometry.coordinates.length, 2);
  assert.equal(geometry.coordinates[0].length, 1); // first outer: no hole
  assert.equal(geometry.coordinates[1].length, 2); // second outer: got the hole
});

test('geometryFor: a relation with a geometry-less outer member throws, even if another outer has geometry', () => {
  const relation = {
    type: 'relation',
    id: 7,
    members: [
      {
        type: 'way',
        role: 'outer',
        geometry: [
          { lat: 0, lon: 0 },
          { lat: 0, lon: 1 },
          { lat: 1, lon: 1 },
          { lat: 0, lon: 0 },
        ],
      },
      { type: 'way', role: 'outer' }, // no geometry
    ],
  };
  assert.throws(() => geometryFor(relation), /relation\/7: 1 of 2 outer members are missing geometry/);
});

test('geometryFor: a relation with zero outer members with geometry throws', () => {
  const relation = {
    type: 'relation',
    id: 4,
    members: [
      { type: 'way', role: 'inner', geometry: [{ lat: 0, lon: 0 }] },
      { type: 'way', role: 'outer' }, // no geometry
    ],
  };
  assert.throws(() => geometryFor(relation), /relation\/4 has no outer members with geometry/);
});

test('findOsmElement: returns the matching element', () => {
  const byId = new Map([['way/1', { type: 'way', id: 1 }]]);
  const el = findOsmElement(byId, 'way/1', 'ND1');
  assert.deepEqual(el, { type: 'way', id: 1 });
});

test('findOsmElement: throws with the ref and osm id when not found in the snapshot', () => {
  const byId = new Map();
  assert.throws(
    () => findOsmElement(byId, 'way/999', 'ND1'),
    /ND1: OSM element way\/999 not found in footprints-raw\.json/,
  );
});

// ~100m square around (115.744, -32.0555): south edge at lat -32.0565 (more
// negative/southernmost), north edge at -32.0545, west edge at lon 115.743,
// east edge at lon 115.745.
const squareGeometry = {
  type: 'Polygon',
  coordinates: [[
    [115.743, -32.0545],
    [115.745, -32.0545],
    [115.745, -32.0565],
    [115.743, -32.0565],
    [115.743, -32.0545],
  ]],
};

test('snapEntranceToFootprint: a point outside the south edge snaps onto it, bearing north (inward)', () => {
  const result = snapEntranceToFootprint([115.744, -32.0566], squareGeometry);
  assert.ok(Math.abs(result.point[1] - -32.0565) < 1e-6);
  assert.ok(Math.abs(result.point[0] - 115.744) < 1e-6);
  assert.equal(result.bearing, 0);
});

test('snapEntranceToFootprint: a point outside the east edge snaps onto it, bearing west (inward)', () => {
  const result = snapEntranceToFootprint([115.7451, -32.0555], squareGeometry);
  assert.ok(Math.abs(result.point[0] - 115.745) < 1e-6);
  assert.ok(Math.abs(result.point[1] - -32.0555) < 1e-6);
  assert.equal(result.bearing, 270);
});

test('snapEntranceToFootprint: MultiPolygon snaps to the correct member polygon', () => {
  const multiGeometry = {
    type: 'MultiPolygon',
    coordinates: [
      squareGeometry.coordinates,
      [[
        [115.753, -32.0545],
        [115.755, -32.0545],
        [115.755, -32.0565],
        [115.753, -32.0565],
        [115.753, -32.0545],
      ]],
    ],
  };
  const result = snapEntranceToFootprint([115.7549, -32.0555], multiGeometry);
  assert.ok(Math.abs(result.point[0] - 115.755) < 1e-6);
  assert.equal(result.bearing, 270);
});

test('snapEntranceToFootprint: the snapped point lies between the edge endpoints', () => {
  const result = snapEntranceToFootprint([115.744, -32.0566], squareGeometry);
  assert.ok(result.point[0] >= 115.743 && result.point[0] <= 115.745);
});
