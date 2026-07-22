// Self-test for validate-data.mjs (TEST-002): proves the validator actually
// fails on bad data, not just that it passes on good data. Each bad fixture
// under scripts/fixtures/bad/ breaks exactly one check; running the
// validator as a subprocess against it must exit non-zero with a matching
// error substring. Weakening/removing a check in validate-data.mjs makes the
// corresponding case here fail.
//
// Run via: node --test "scripts/**/*.test.mjs"

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { BOUNDS } from './bounds.mjs';
import { extractCampusBounds, parseAppJsCampusBounds } from './parse-app-bounds.mjs';

const execFileAsync = promisify(execFile);

const scriptPath = fileURLToPath(new URL('./validate-data.mjs', import.meta.url));
const fixture = (p) => fileURLToPath(new URL(`./fixtures/${p}`, import.meta.url));

async function run(dataDir) {
  try {
    const { stdout } = await execFileAsync('node', [scriptPath, dataDir].filter(Boolean));
    return { code: 0, output: stdout };
  } catch (err) {
    // execFile rejects on non-zero exit; err.stderr/err.stdout carry the output.
    return { code: err.code, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

const badCases = [
  ['out-of-bounds', /outside campus bounds/],
  ['duplicate-ref', /appears 2 times in buildings\.geojson \(expected 1\)/],
  ['missing-field', /missing name/],
  ['bad-poi-kind', /bad kind "cafe"/],
  ['unclosed-ring', /not closed \(first coord != last coord\)/],
];

for (const [dir, pattern] of badCases) {
  test(`bad fixture "${dir}": validator exits non-zero with a matching error`, async () => {
    const { code, output } = await run(fixture(`bad/${dir}`));
    assert.notEqual(code, 0);
    assert.match(output, pattern);
  });
}

test('good fixture: validator exits 0', async () => {
  const { code, output } = await run(fixture('good'));
  assert.equal(code, 0);
  assert.match(output, /Validation OK/);
});

test('no dataDir argument: validates the real data/ directory and exits 0', async () => {
  const { code, output } = await run(undefined);
  assert.equal(code, 0);
  assert.match(output, /Validation OK/);
});

// CQ-003: unit-style coverage for the CAMPUS_BOUNDS drift check. Uses direct
// import rather than the subprocess-runner above because parse-app-bounds.mjs
// (unlike validate-data.mjs) has no import-time side effects — see its
// header comment.
test('parseAppJsCampusBounds: real js/app.js CAMPUS_BOUNDS matches scripts/bounds.mjs BOUNDS', () => {
  assert.deepEqual(parseAppJsCampusBounds(), BOUNDS);
});

test('extractCampusBounds: parses a whitespace-tolerant CAMPUS_BOUNDS literal', () => {
  const source = `
    var CAMPUS_BOUNDS = L.latLngBounds(
      [ -32.0585 ,115.7408],
      [-32.0522,   115.7465 ]
    );
  `;
  assert.deepEqual(extractCampusBounds(source), {
    south: -32.0585,
    west: 115.7408,
    north: -32.0522,
    east: 115.7465,
  });
});

test('extractCampusBounds: throws (fails loudly) when the literal is missing', () => {
  assert.throws(() => extractCampusBounds('var x = 1;'), /Could not find a CAMPUS_BOUNDS/);
});
