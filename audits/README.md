# Audits

Reusable audit system for unofficialNDmap: one inspection checklist per
category, grounded in this repo's actual files, plus the
[`FINDINGS.md`](FINDINGS.md) ledger tracking every finding
`open / fixed / wontfix`.

| Category | Checklist | Focus |
|---|---|---|
| Security | [security.md](security.md) | innerHTML/tooltip injection, CDN tiles |
| Correctness | [correctness.md](correctness.md) | lat/lng order, triplicated bounds |
| Code quality | [code-quality.md](code-quality.md) | NDMap namespace contracts, duplication |
| Testing | [testing.md](testing.md) | untested build-geojson merge logic |
| Data | [data.md](data.md) | 2015 PDF vintage, low-confidence buildings |
| UX / Accessibility | [ux-accessibility.md](ux-accessibility.md) | label clutter, search dropdown a11y |
| Build / Deployment | [build-packaging.md](build-packaging.md) | no CI gate yet, Pages branch build |

## Running an audit

1. **Read the ledger first** (`FINDINGS.md`) — anything already `fixed` or
   `wontfix` is not a finding.
2. Work the category checklist top-to-bottom against the current code.
3. Record genuinely new findings in the ledger using its template; resolve
   entries in place, never delete.

## The three tiers

1. **Deterministic gates** — `node scripts/validate-data.mjs` (data shape,
   bounds, ref uniqueness). Currently run manually; becomes a CI gate when
   BLD-001 lands.
2. **Per-PR review** — `/code-review` + `/security-review` on every PR,
   triaged against the ledger. This is the primary review mechanism.
3. **Whole-repo sweeps** — `/audit-sweep <category>`, one category per run,
   per-release cadence. The most expensive mechanism; don't run casually.
