// Unit tests for the pure geometry/merge logic in build-geojson.mjs.
// Run via: node --test scripts/
//
// Importing this module has no side effects (build-geojson.mjs gates its
// file-reading/writing `main()` behind a direct-execution check), so these
// tests exercise the exported functions against small inline fixtures
// instead of the real data/ files.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ringFromGeometry, geometryFor, findOsmElement, kindForTags } from './build-geojson.mjs';

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
        // inner members are ignored entirely (COR-001), not counted as outers
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

test('kindForTags: amenity=parking maps to "parking"', () => {
  assert.equal(kindForTags({ amenity: 'parking' }), 'parking');
});

test('kindForTags: highway=bus_stop maps to "bus_stop"', () => {
  assert.equal(kindForTags({ highway: 'bus_stop' }), 'bus_stop');
});

test('kindForTags: unrelated tags are skipped (null/undefined)', () => {
  assert.ok(!kindForTags({ amenity: 'cafe' }));
  assert.ok(!kindForTags({}));
});
