// Pure helper (CQ-003): parses the hand-maintained CAMPUS_BOUNDS literal out
// of js/app.js so validate-data.mjs can catch drift against BOUNDS in
// scripts/bounds.mjs. Deliberately split into its own side-effect-free
// module rather than living inline in validate-data.mjs: validate-data.mjs
// runs its checks at import time (see its header comment), so importing it
// directly from a test would re-run the whole CLI validation as a side
// effect. This module has none, so it's directly unit-testable.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Resolved from THIS file's own location (import.meta.url), never from a
// dataDir argument — js/app.js is a fixed source file, not part of the
// data/ fixture set, so fixture-dir validation runs still check the real
// js/app.js against it. That's intentional: CAMPUS_BOUNDS drift is a
// code-level bug, not something a data fixture should be able to hide.
const DEFAULT_APP_JS_PATH = fileURLToPath(new URL('../js/app.js', import.meta.url));

// Matches the hand-maintained literal in js/app.js:
//   var CAMPUS_BOUNDS = L.latLngBounds(
//     [-32.0585, 115.7408],
//     [-32.0522, 115.7465]
//   );
// i.e. L.latLngBounds([south, west], [north, east]), tolerant of whitespace.
const CAMPUS_BOUNDS_RE =
  /CAMPUS_BOUNDS\s*=\s*L\.latLngBounds\(\s*\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]\s*,\s*\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]\s*\)/;

/**
 * Extracts { south, west, north, east } from js/app.js source text.
 * Throws (fails loudly) if the CAMPUS_BOUNDS literal can't be found, rather
 * than silently skipping the drift check.
 */
export function extractCampusBounds(source) {
  const match = CAMPUS_BOUNDS_RE.exec(source);
  if (!match) {
    throw new Error(
      'Could not find a CAMPUS_BOUNDS = L.latLngBounds([...], [...]) literal in js/app.js — ' +
        'has its shape changed? Update the regex in scripts/parse-app-bounds.mjs.',
    );
  }
  const [, south, west, north, east] = match;
  return { south: Number(south), west: Number(west), north: Number(north), east: Number(east) };
}

/** Reads js/app.js (or `path`, for tests) and extracts its CAMPUS_BOUNDS. */
export function parseAppJsCampusBounds(path = DEFAULT_APP_JS_PATH) {
  return extractCampusBounds(readFileSync(path, 'utf8'));
}
