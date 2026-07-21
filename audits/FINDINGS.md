# Audit Findings Ledger

Single source of truth for everything the category audits in this folder have
turned up. Before reporting a finding, **check this ledger first** — if it is
already here as `fixed` or `wontfix`, do not re-surface it. Repeat audit runs
should diff their results against this file and only append genuinely new
findings.

## How to record a finding

One entry per finding, appended under the matching category `##` section, using
this exact template. The template doubles as a self-contained work item — see
"Working a finding" below — so fill it in as if the reader has no other context.

```
### <CAT>-NNN — <imperative one-line title>

- **Status:** open · **Severity:** crit|high|med|low · **Date:** YYYY-MM-DD
- **Location:** `path/to/file.js:line` or `func()`
- **Problem:** The defect/risk and its impact, in one or two sentences.
- **Goal:** The fix as an imperative, self-contained task — exact enough that
  an agent given only this entry knows what to change and where.
- **Done when:** Observable acceptance criteria: behavior, tests, checks.
```

Field rules:

- **ID** — `<CAT>-NNN`, category prefix + zero-padded sequence, never reused.
  Prefixes in this project: `SEC` Security, `COR` Correctness, `CQ` Code
  Quality, `TEST` Testing, `DATA` Data, `UX` UX/Accessibility, `BLD`
  Build/Deployment. Scan the section for the highest existing number.
- **Title** — imperative and specific, not a restatement of the problem.
- **Status** — `open` (confirmed, not yet fixed), `fixed`, or `wontfix`
  (deliberately accepted).
- **Severity** — `crit` / `high` / `med` / `low`. Security and data-loss
  findings default to `high` or above.
- **Date** — `YYYY-MM-DD` the entry was last changed (ISO 8601).
- **Goal / Done when** — present on `open` entries. Keep the goal grounded in
  the suggested fix; keep "Done when" observable (a passing test, a check
  output, a behavior), not "code looks better".

When a finding is resolved, edit its entry **in place** — never delete entries;
the history of what was accepted and why is the point. Update Status + Date and
replace the **Goal** and **Done when** lines with a single line:

- fixed → `- **Resolution:** <what was done + commit SHA or PR#>`
- wontfix → `- **Resolution:** <why it is accepted>`

Keep entries tight: Problem in one or two sentences, deep detail in the commit
message or a linked issue. An empty category section holds a single `_none
yet._` line until its first finding.

## Working a finding (`/goal`)

Every `open` entry is written to be handed off as-is by its ID:

    /goal fix DATA-001 from audits/FINDINGS.md

## SEC — Security

_none yet._

## COR — Correctness

### COR-001 — Render the P&O Hotel (ND5) courtyard hole instead of dropping it

- **Status:** open · **Severity:** low · **Date:** 2026-07-21
- **Location:** `scripts/build-geojson.mjs` `geometryFor()` (relation branch)
- **Problem:** Multipolygon relations keep only `outer` members; OSM relation
  17256639 (ND5, P&O Hotel) has one `inner` ring, so the building renders as a
  solid polygon with its courtyard filled in. Cosmetic, but silently wrong for
  any future relation with holes.
- **Goal:** In `geometryFor()`, append `inner` member rings as additional rings
  of the containing polygon (GeoJSON Polygon ring 2+ = holes), or at minimum
  `console.warn` when inner members are dropped. Regenerate buildings.geojson.
- **Done when:** ND5 renders with its courtyard cut out on the deployed map and
  a unit test covers a relation with an inner ring.

## CQ — Code Quality

_none yet._

## TEST — Testing

_none yet._

## DATA — Data

### DATA-001 — Verify the 11 low-confidence building locations on the ground

- **Status:** open · **Severity:** high · **Date:** 2026-07-21
- **Location:** `data/nd-buildings.json` (entries with `"confidence": "low"`
  after the Nov-2025 map update: ND8, ND9, ND11, ND13, ND16, ND34, ND38,
  ND39, ND49, ND50)
- **Problem:** These ND references could not be confidently matched to an OSM
  footprint during curation; six render as approximate point markers and four
  (ND11, ND13, ND49, ND50) use best-guess polygons. Users may be directed
  to the wrong building. ND48's footprint is medium-confidence but its
  official grid square (A7) disagrees with the OSM Customs House position —
  check it too.
- **Goal:** Walk the campus (or cross-reference the current official map) and
  for each entry either assign the correct `osm` way id from
  `data/footprints-raw.json` or correct the `point`, then raise `confidence`.
  Rebuild with `node scripts/build-geojson.mjs`.
- **Done when:** No entry in nd-buildings.json carries `"confidence": "low"`;
  `node scripts/validate-data.mjs` passes; spot-checked on the deployed map.

### DATA-002 — Re-verify all building data against the current official campus map

- **Status:** fixed · **Severity:** high · **Date:** 2026-07-21
- **Location:** `data/nd-buildings.json` (all entries);
  `reference/fremantle-campus-map-2025-11.pdf`
- **Problem:** Building names/contents were transcribed from the Sept 2015
  edition of the official PDF (the newest copy fetchable — the university site
  Cloudflare-blocks bots), so the dataset lagged a decade of campus changes.
- **Resolution:** User uploaded the current November 2025 official map
  (ND6572); every entry rewritten against it in PR #6 — renames (ND17 Michael
  J M Wright Library, ND7 Peter Prendiville Study Centre, ND42 Fremantle
  Hotel, ND22 Former Fremantle Courthouse), contents moves (Moot Court
  ND22→ND13), removals (ND5, ND30, ND45 no longer university buildings),
  additions (ND49, ND50; ND48 re-matched to the Customs House footprint).
  Residual location uncertainty tracked in DATA-001.

## UX — UX / Accessibility

_none yet._

## BLD — Build / Deployment

### BLD-001 — Commit the CI and Pages workflows once the gh token has workflow scope

- **Status:** fixed · **Severity:** med · **Date:** 2026-07-21
- **Location:** `.github/workflows/ci.yml`, `.github/workflows/pages.yml`
- **Problem:** The gh OAuth token lacked the `workflow` scope, so the CI
  workflow (data validation on PRs) and the Actions-based Pages deploy could
  not be pushed; merges to main shipped with no automated gate.
- **Resolution:** Token refreshed with `workflow` scope; both workflows
  committed via PR #4, CI verified green on that PR and verified to fail on a
  deliberately broken data fixture, Pages switched from legacy branch build to
  `build_type=workflow`.
