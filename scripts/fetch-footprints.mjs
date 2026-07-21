#!/usr/bin/env node
// Fetch raw building footprints for the Fremantle West End bbox from Overpass
// and save them as data/footprints-raw.json (an OSM-JSON snapshot, committed
// so builds are reproducible without hitting Overpass).
//
// Uses curl (some environments block Node's direct TLS path but allow curl).
//
// Usage: node scripts/fetch-footprints.mjs

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BBOX = '-32.0615,115.7405,-32.0515,115.7515'; // south,west,north,east
const QUERY = `[out:json][timeout:60];
(
  way["building"](${BBOX});
  relation["building"](${BBOX});
);
out geom;`;
const POI_QUERY = `[out:json][timeout:60];
(
  nwr["amenity"="parking"]["access"!="private"](${BBOX});
  node["highway"="bus_stop"](${BBOX});
  nwr["amenity"="bicycle_parking"](${BBOX});
);
out tags center;`;

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

function overpass(query) {
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const endpoint of ENDPOINTS) {
      try {
        const out = execFileSync('curl', [
          '-sS', '--fail', '--max-time', '90',
          '-A', 'unofficialNDmap/1.0 (+https://github.com/unofficialNDmap)',
          endpoint,
          '--data-urlencode', `data=${query}`,
        ], { maxBuffer: 64 * 1024 * 1024 });
        return JSON.parse(out.toString());
      } catch (err) {
        console.error(`${endpoint} failed (attempt ${attempt + 1}): ${err.message.split('\n')[0]}`);
      }
    }
  }
  console.error('All Overpass endpoints failed.');
  process.exit(1);
}

const buildings = overpass(QUERY);
console.log(`Fetched ${buildings.elements.length} building elements`);
writeFileSync(fileURLToPath(new URL('../data/footprints-raw.json', import.meta.url)), JSON.stringify(buildings));
console.log('Wrote data/footprints-raw.json');

const pois = overpass(POI_QUERY);
console.log(`Fetched ${pois.elements.length} POI elements`);
writeFileSync(fileURLToPath(new URL('../data/pois-raw.json', import.meta.url)), JSON.stringify(pois));
console.log('Wrote data/pois-raw.json');
