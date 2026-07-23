# Build & Deployment Audit (BLD)

**Main risk:** no CI gate currently runs on merges to `main`. `.github/workflows/ci.yml` and `pages.yml` exist on disk but are untracked (`git status` shows only `.github/` as untracked) because the `gh` OAuth token lacks the `workflow` scope, so neither has ever been pushed — `scripts/validate-data.mjs` is a manual step nobody is forced to run. In the meantime GitHub Pages' legacy branch-build silently republishes the entire repo on every push to `main` with zero validation, making that build the de facto release gate.

Findings ledger prefix: **BLD**

## CI wiring

- [ ] Push `.github/workflows/ci.yml` and `.github/workflows/pages.yml` once `gh auth refresh -s workflow` has been run interactively — right now `git status` lists `.github/` as untracked and neither workflow is live.
- [ ] Once `ci.yml` is live, open a throwaway PR that deliberately violates a check in `scripts/validate-data.mjs` (e.g. a building outside the `BOUNDS` it validates) and confirm the `validate` job actually fails and blocks the PR — don't just trust the YAML compiles.
- [ ] `ci.yml` has no `paths:` filter, so it reruns on every push/PR regardless of whether `data/`, `scripts/`, or unrelated files changed — fine at this repo's size (~1MB), revisit only if the workflow gets slow or noisy.

## Pages deploy

- [ ] Live Pages config is still the legacy branch build (`gh api repos/.../pages` → `"build_type": "legacy"`, source `main` / `/`) — confirm this is an accepted interim state while `pages.yml` (the Actions-based `configure-pages`/`upload-pages-artifact`/`deploy-pages` flow) sits unpushed.
- [ ] Once `pages.yml` is pushed, switch the repo's Pages build type from legacy to "workflow" (Settings → Pages, or via the API) so deploys run through Actions instead of the implicit branch build — until that switch happens, pushing `pages.yml` alone changes nothing live.
- [ ] `https_enforced` is currently `true` (confirmed via `gh api repos/.../pages`) — re-verify this stays `true` after switching build types, since `js/locate.js`'s geolocation API requires a secure context and will silently stop working if enforcement is ever dropped.

## Asset paths (subpath deployment)

- [ ] `index.html`'s `<link>`/`<script>` tags (`vendor/leaflet.css`, `css/app.css`, `vendor/leaflet.js`, `js/app.js`, `js/panel.js`, `js/locate.js`, `js/search.js`) are all relative with no leading slash (verified by grep) — keep it that way, since the site lives at `https://renkt99.github.io/unofficialNDmap/` (a subpath) and a leading `/` would resolve to the Pages root and 404.
- [ ] `js/app.js`'s data fetches — `fetch('data/buildings.geojson')` and `fetch('data/context-buildings.geojson')` — are relative for the same reason; re-grep for `fetch("/`, `href="/`, `src="/` in `index.html`/`css/`/`js/` before merging any change that touches asset or data references.
- [ ] `vendor/leaflet.css`'s own image references (marker icons etc.) resolve relative to `vendor/images/` — safe only as long as `leaflet.css` and `vendor/images/` stay siblings; don't split them apart in a future reorg of `vendor/`.

## Vendored dependencies

- [ ] Leaflet 1.9.4 (`vendor/leaflet.js`, `vendor/leaflet.css`, `vendor/images/*.png` — BSD-2, per README) is manually vendored with no lockfile and no way to pin subresource integrity, since the legacy Pages build serves the files as-is rather than through a `<script integrity=...>` CDN reference. Document the upgrade procedure: re-download the target Leaflet dist bundle, diff it against the committed `vendor/` files before overwriting, and manually re-test map rendering — there's no automated check that a vendor swap didn't break anything.
- [ ] No `package.json` exists anywhere in the repo, so vendoring-by-hand is the only dependency mechanism in place. If a second JS dependency is ever needed, decide then whether to keep manual vendoring (consistent with current practice) or introduce `package.json` + a build step (neither exists today).

## Licensing & repo hygiene

- [ ] Add a `LICENSE` file for the project's own code — the README documents *data* licensing (OSM/ODbL, Leaflet BSD-2) but nothing currently states a license for the site's HTML/CSS/JS.
- [ ] The legacy Pages build publishes the entire repository verbatim, including `data/footprints-raw.json` (396K) Overpass snapshot and `reference/fremantle-campus-map-2015.pdf` (200K) — none of which `index.html`/`js/app.js` fetch at runtime (only `data/*.geojson` is loaded). Total repo size is only ~1MB so this isn't urgent, but decide explicitly: leave them public as-is, or exclude raw/reference files via the `path:`/upload step in `pages.yml` once the Actions-based deploy is live.
- [ ] No `package.json`/`engines` field documents the Node version the data pipeline needs. `scripts/build-geojson.mjs`, `scripts/fetch-footprints.mjs`, and `scripts/validate-data.mjs` are ES modules (`import`, `node:` builtin specifiers) run with bare `node`; `ci.yml` pins `node-version: 22`, but a contributor running `node scripts/build-geojson.mjs` locally has no stated minimum. Add a README note (Node >=18 recommended for stable ESM/`node:` specifier support).
- [ ] `.nojekyll` is committed at the repo root (confirmed tracked, 0 bytes) and must stay there — it's what stops GitHub Pages from running the site through Jekyll, which would otherwise mangle directories like `js/`/`css/` that start with an underscore-adjacent convention Jekyll treats specially. Don't let a future "delete empty files" cleanup remove it.
