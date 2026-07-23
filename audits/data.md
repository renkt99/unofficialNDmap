# Data Audit Checklist (DATA)

The entire product is `data/nd-buildings.json`: 41 hand-curated entries (ND1–ND48)
transcribed from a single PDF snapshot of the campus map dated 10 Sept 2015 — the
current official map may have since renumbered, renamed, or reassigned buildings,
and this repo has no mechanism to detect that drift. 11 of the 41 entries (8
point-fallback, 3 low-confidence polygon matches) carry `confidence: "low"`,
meaning both the location and the ND-number-to-footprint match are unverified.
Findings from sweeps of this checklist go in `audits/FINDINGS.md` with prefix `DATA`.

## Source vintage

- [ ] Obtain the *current* official Fremantle Campus Map PDF from the university's
      website (Cloudflare-blocks bot fetches — requires a human to download it in
      a real browser) and archive it alongside `reference/fremantle-campus-map-2015.pdf`.
- [ ] Diff every `ref` / `name` / `address` / `contents[]` in `data/nd-buildings.json`
      against the current PDF entry-by-entry; log any renumbering, renaming, merged,
      demolished, or newly added buildings as individual findings.
- [ ] Confirm ND48 (Campus Services & IT, 7 Pakenham Street) against the current
      map — it does not appear on the 2015 PDF and was sourced from freotopia.org
      per its `note` field.
- [ ] Confirm ND45 (Campus Services Office, 30 Mouat Street) — its `note` flags a
      conflict with freotopia.org, which places ND45 in the eastern section of
      Owston's Buildings (ND23, 9–23 High Street) instead of the Strelitz Buildings
      footprint currently assigned.

## Footprint / location matching (confidence: low)

- [ ] ND2 (Malloy Courtyard) — point-only fallback `[-32.05635, 115.74345]`; needs
      an on-the-ground check or a courtyard footprint added to OSM.
- [ ] ND8 (Holy Spirit Chapel) — point-only fallback `[-32.0565, 115.7439]`; verify
      against current map and, if possible, match to an OSM footprint.
- [ ] ND9 (Student Services, off Bateman Courtyard) — point-only fallback
      `[-32.05645, 115.74395]`; no OSM footprint matched.
- [ ] ND15 (Bateman Courtyard) — point-only fallback `[-32.0563, 115.7441]`;
      courtyard, same class of gap as ND2.
- [ ] ND16 (General Classroom Building, off Bateman Courtyard) — point-only
      fallback `[-32.0564, 115.7442]`; no OSM footprint matched.
- [ ] ND34 (School of Medicine, Henry Street) — point-only fallback
      `[-32.05605, 115.74435]`; three separate ND refs (ND34/ND38/ND39) are all
      "School of Medicine" on Henry Street with only point fallbacks — cross-check
      against the current map to confirm they are still distinct buildings.
- [ ] ND38 (School of Medicine, 29 Henry Street) — point-only fallback
      `[-32.056, 115.7442]`; see ND34 note above.
- [ ] ND39 (School of Medicine, 45 Henry Street) — point-only fallback
      `[-32.05648, 115.74442]`; see ND34 note above.
- [ ] ND11 (School of Law, Bateman Courtyard/Croke Street) — matched to
      `way/164418329` at low confidence; confirm the polygon is ND11 and not an
      adjacent building before raising confidence.
- [ ] ND13 (Law Library, Croke Street) — matched to `way/164418330` at low
      confidence; confirm against current map / on-the-ground.
- [ ] ND45 — matched to `way/164418328` at low confidence with a known freotopia
      conflict (see Source vintage above); resolve which footprint is correct.

## Generated-file drift

- [ ] Run `node scripts/build-geojson.mjs` from a clean checkout and confirm
      `data/buildings.geojson` comes out byte-identical to
      the committed version — any diff means the committed generated file is
      stale relative to `nd-buildings.json` / `footprints-raw.json`.
- [ ] Consider wiring the drift check above into `.github/workflows/ci.yml`
      (currently only `node scripts/validate-data.mjs` runs there) so a curated-data
      edit without a regenerate can't reach `main`.
- [ ] Run `node scripts/validate-data.mjs` and confirm it passes with zero errors
      (ref uniqueness, campus-bounds containment, required name/contents/confidence
      fields) — this already runs in CI on push/PR but re-verify after any manual
      edit to the raw or generated files.

## Snapshot refresh cadence

- [ ] Define and document a cadence (e.g. every 3–6 months, or before each
      semester) for re-running `node scripts/fetch-footprints.mjs` against Overpass,
      since OSM building footprints in the bbox can move or be re-tagged
      independently of this repo.
- [ ] After each `fetch-footprints.mjs` refresh, diff the new `footprints-raw.json`
      against the previous commit and manually review changed/
      removed `way`/`relation` ids referenced by `osm` fields in
      `data/nd-buildings.json` before regenerating and committing the GeoJSON.

## Licensing / attribution

- [ ] Confirm the ODbL attribution string is present and unbroken in the live map
      UI (`js/app.js` `attribution:` option on the Leaflet tile layer, currently
      `© OpenStreetMap contributors © CARTO`).
- [ ] Confirm the info modal (`index.html` `#info-modal-content`) still states
      "Building data © OpenStreetMap contributors (ODbL)" and the unaffiliated/
      unofficial disclaimer.
- [ ] Confirm `README.md`'s Data Sources & Licensing section still lists OSM
      (ODbL), CARTO basemap tiles, the 2015 PDF transcription source, the
      freotopia.org address cross-reference, and vendored Leaflet (BSD-2), and
      that none have silently gone stale relative to actual usage in the code.
