# Security audit checklist (SEC)

The biggest realistic risk in this repo is DOM injection: building/POI data —
much of it ultimately sourced from OSM, which anyone can edit — flows into
`innerHTML` in `js/panel.js` / `js/search.js` and into Leaflet tooltip/`divIcon`
`html` fields in `js/app.js`, with `NDMap.escapeHtml()` as the single point of
defense. The second risk is the runtime dependency on CARTO's tile CDN on every
page load, combined with GitHub Pages offering no CSP or other security headers
to backstop either of these. Findings from this checklist are logged in
`audits/FINDINGS.md` under the `SEC` prefix.

## DOM injection (XSS via data → innerHTML / Leaflet HTML fields)

- [ ] `js/panel.js` `renderFeature()` (lines 16-43) — verify every property
      interpolated into the panel HTML (`p.ref`, `p.name`, `p.address`, each
      `p.contents[i]`, `p.note`) passes through `NDMap.escapeHtml`, including
      any property added to the curated schema in `data/nd-buildings.json` /
      `scripts/build-geojson.mjs` in the future (e.g. a hypothetical `hours` or
      `phone` field).
- [ ] `js/search.js` `renderResults()` (lines 71-90) — verify `r.text` and the
      `secondary` string (built from `r.ref` + `r.name` at line 79, *before*
      escaping) are only ever inserted via `escapeHtml(...)` at the point of
      concatenation into `html` (lines 82-83); confirm no future refactor
      builds `secondary` from an already-escaped fragment plus a raw one
      (double-escaping / mixed-escaping bugs).
- [ ] `js/app.js` `escapeHtml()` (lines 44-49) — confirm the replacement map
      covers `& < > " '` (it does) so the same function is safe for both text
      *and* attribute contexts; verify no call site interpolates a property
      into an unquoted HTML attribute (none currently do — all current uses
      are text-node content inside `<span>`/`<p>`/`<li>`/`<h2>`), and flag any
      future attribute-context usage for review even though quote-escaping is
      already present.
- [ ] `js/app.js` `buildingLabelHtml()` (lines 132-139), bound as a permanent
      tooltip via `layer.bindTooltip(buildingLabelHtml(feature), {...})` (line
      229) — confirm `feature.properties.ref` and `.name` both pass through
      `escapeHtml` before concatenation into the `label-ref`/`label-name`
      spans.
- [ ] `js/app.js` `bindPoiTooltip()` (lines 185-190) — confirm
      `feature.properties.name` from `data/pois.geojson` passes through
      `escapeHtml` before `layer.bindTooltip(...)`; this is the field most
      directly populated from a raw OSM `name` tag (see Data pipeline section).
- [ ] `js/app.js` `poiIcon()` `divIcon` `html` (lines 159-177) — the glyph/CSS
      class come from a fixed internal `if/else` on the `kind` string passed by
      the caller, not from OSM tag data directly, so no escaping is needed
      today; verify this stays true if `kind` is ever derived by
      directly forwarding an OSM tag value instead of the current
      `poiFilter`/switch logic in `js/app.js` and `scripts/build-geojson.mjs`.
- [ ] `js/app.js` `InfoControl.onAdd()` sets `link.innerHTML = 'ⓘ'` (line 295)
      — confirm this stays a static string; flag if it's ever changed to
      interpolate any variable text.
- [ ] `index.html` info-modal disclaimer paragraph (line 30) — confirm it
      remains static markup shipped in `index.html` and is never replaced with
      `fetch()`-driven or otherwise data-derived content without adding
      escaping.

## Data pipeline / OSM trust boundary (data poisoning via upstream edits)

- [ ] `scripts/fetch-footprints.mjs` `overpass()` (lines 35-53) — confirm the
      Overpass `QUERY`/`POI_QUERY` template string is passed to
      `execFileSync('curl', [...])` as the single argv element
      `` `data=${query}` `` behind `--data-urlencode` (line 43), i.e. `curl` is
      invoked directly (no shell), so there is no shell-interpolation/injection
      vector even though `BBOX` and the query bodies are template-literal
      constructed.
- [ ] Trust boundary at `scripts/build-geojson.mjs` line 94 — `t.name` (a raw,
      unsanitized OSM `name` tag value from `data/pois-raw.json`) is written
      straight into `pois.geojson`'s `properties.name` with no transformation;
      confirm the *only* mitigation for a malicious/vandalized OSM edit (e.g.
      an `onerror=` payload in a POI's `name` tag) is `escapeHtml` at render
      time in `js/app.js` `bindPoiTooltip()`, and that this path is never
      bypassed.
- [ ] `scripts/fetch-footprints.mjs` `ENDPOINTS` (lines 29-33) — three
      third-party Overpass mirrors (`overpass-api.de`, `overpass.kumi.systems`,
      `overpass.private.coffee`); confirm the fetched `data/*-raw.json`
      snapshots and the derived `data/buildings.geojson` / `data/pois.geojson`
      are committed to git (not fetched at request time), so a compromised or
      malicious mirror response requires a human-reviewed commit before it can
      reach production, rather than propagating directly to site visitors.
- [ ] `data/nd-buildings.json` (hand-curated) — confirm no script *writes* to
      this file automatically; `scripts/build-geojson.mjs` only reads it
      (`readFileSync` at line 13), so the Overpass pipeline cannot silently
      alter the curated building list, only the OSM-sourced footprint
      geometry/POI data merged alongside it.
- [ ] `scripts/build-geojson.mjs` and `scripts/validate-data.mjs` — both
      resolve all paths through `dataDir()` (`new URL('../data/${f}', ...)`,
      no CLI-argument or environment-derived path component), so confirm
      neither script can be made to read/write outside `data/` even in a
      compromised-input scenario.

## Third-party / supply chain

- [ ] `vendor/leaflet.js` — confirm the header comment (`Leaflet 1.9.4,
      (c) 2010-2023 ...`) matches the actual vendored version in use; since
      there is no `package.json`/lockfile in this repo, Dependabot/npm-audit
      style scanning does not cover this file — confirm there is a manual
      process (e.g. checked at each `/audit-sweep`) for watching Leaflet CVEs
      and re-vendoring `vendor/leaflet.js` + `vendor/leaflet.css`.
- [ ] `index.html` line 35 (`<script src="vendor/leaflet.js">`) — confirm
      Leaflet continues to be served same-origin from `vendor/` rather than
      loaded from an external CDN `<script src>` without Subresource Integrity,
      which would reintroduce a supply-chain compromise vector this vendoring
      currently avoids.
- [ ] `js/app.js` line 23, CARTO Positron tile CDN
      (`https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png`) — a
      third-party dependency loaded on every page view via Leaflet's
      `L.tileLayer`, which renders tiles as `<img>` elements (not
      `innerHTML`), so a compromised/malicious CARTO response is limited to
      serving bad *images*, not executing script; confirm `L.tileLayer` usage
      is never changed to an HTML-based tile renderer that would upgrade this
      to a script-injection vector.
- [ ] CARTO tile requests have no Subresource-Integrity equivalent (tiles are
      per-coordinate images, not a single static asset) — confirm this is an
      accepted, documented limitation rather than an oversight, and confirm
      the map degrades to a blank/grey basemap (data layers still render) if
      `cartocdn.com` is unreachable, rather than failing the whole page load.

## Secrets / repo hygiene

- [ ] Confirm no API keys, tokens, or credentials exist anywhere in
      `scripts/fetch-footprints.mjs` or other committed files — the Overpass
      API used there requires no authentication, so none should ever be added;
      re-check with a secret-pattern grep at each `/audit-sweep security` since
      there is no automated secret-scanning gate in `.github/workflows/ci.yml`.

## Deployment / headers (GitHub Pages)

- [ ] `.github/workflows/ci.yml` runs only `node scripts/validate-data.mjs`
      (data-shape validation, not a security gate) on `pull_request` and
      `push` to `main`; per the current repo state both `ci.yml` and
      `pages.yml` are **untracked in git** (not yet committed), so no CI gate
      is actually active yet — confirm these get committed so `validate-data`
      runs automatically; until then, treat every item in this checklist as a
      manual, not automated, check.
- [ ] `.github/workflows/pages.yml` `permissions:` block (lines: `contents:
      read`, `pages: write`, `id-token: write`) — confirm it stays scoped to
      exactly these three and never gains `contents: write` or other broad
      scopes it doesn't need for `actions/deploy-pages@v4`.
- [ ] GitHub Pages serves this site with no ability to set custom response
      headers — confirm this is understood as a hard platform limitation: no
      CSP, no `X-Frame-Options`, no `Permissions-Policy` can be configured, so
      `escapeHtml()` coverage (see DOM injection section) is the *only* line
      of defense against injected content, with no header-based backstop
      possible while hosted on Pages.

## Privacy (geolocation)

- [ ] `js/locate.js` `onPosition()` (lines 99-116) — confirm GPS coordinates
      are only ever used locally to call `drawOrUpdateDot()` / `map.panTo()`
      and are never sent via `fetch`/`XHR`/`sendBeacon`/an analytics script;
      confirm no such telemetry code exists anywhere in `js/` that could
      capture `pos.coords`.
- [ ] `index.html` info-modal disclaimer (line 30) — confirm its claims are
      accurate as written (affiliation + OSM/ODbL data licensing + "locations
      marked approximate are unverified"); note it currently makes **no
      statement at all about geolocation handling**, so there's nothing to
      verify for accuracy today — flag this absence explicitly as a gap if a
      privacy statement is ever expected before/when the locate feature is
      used.
- [ ] `js/locate.js` `drawOrUpdateDot()` (lines 68-84) — confirm
      latitude/longitude/accuracy values are only ever passed to Leaflet API
      calls (`L.marker`, `L.circle`, `setLatLng`, `setRadius`) as numeric
      arguments, never string-interpolated into `innerHTML` or any `divIcon`
      `html` field, so there is no injection path from GPS data itself (only
      the static `gpsIcon` HTML at lines 24-29, which contains no
      variable data).
