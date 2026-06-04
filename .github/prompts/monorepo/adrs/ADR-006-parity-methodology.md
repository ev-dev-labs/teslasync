# ADR-006 — Parity specification methodology (web is the source of truth; manifest-driven)

**Status:** Accepted · 2026-06 · Supersedes: none

## Context

The mandate: "each UI page, each panel, each pixel, each API — on parity with web."
The web app is ~21 feature areas, ~60 API hooks, ~162 page files, plus a 9-category
shared component library. "Parity" must be **enforceable and checkable**, not aspirational,
or agents will silently drop hard panels.

## Decision

The **web app is the canonical specification**. P1 Phase S0 scans `web/src` and produces
`apps/parity/parity-manifest.json`, with one record per parity **unit**:

- `route` (router path) → `page` (feature page) → `panel/section` (GlassPanel/ChartContainer)
- `component` (shared component used), `chart`, `map`, `metric`, `state` (loading/empty/error)
- `api` (every hook → endpoint + params), `string` (every i18n key the page renders)

Each record carries: id, source file(s), data sources (hooks/endpoints), child panels,
charts, states, and strings. Every UI prompt in P2/P3/P4 **targets exactly one unit**
and its `=== PARITY ===` log section asserts 100% coverage. Per-platform **parity ledgers**
(`apps/parity/<platform>-ledger.json`) track unit status; a platform program is not DONE
until its ledger is 100%.

**Parity is semantic** (ADR-005): same information, hierarchy, data sources, states, and
brand — rendered with native components, not identical pixels.

## Consequences

- ✅ "No stubs / no skeletons" becomes a *data-checkable* invariant (ADR-011).
- ✅ Progress is measurable per platform (X/162 pages, Y panels covered).
- ✅ New web features update the manifest → automatically become parity gaps to close.
- ⚠️ The manifest must stay current; a CI job re-scans `web/src` and flags manifest drift.
- ⚠️ Some web affordances (hover, right-click) map to platform-specific gestures; the
  manifest records the *intent*, the platform prompt records the native realization.

## Alternatives rejected

- **Eyeball parity:** unverifiable; guarantees silent gaps at this scale.
- **Screenshot-diff parity:** breaks ADR-002/005 (native ≠ identical pixels).
