# ADR-001 — Monorepo with a top-level `apps/` directory

**Status:** Accepted · 2026-06 · Supersedes: none

## Context

TeslaSync is one product: a Go backend + React web SPA in a single repo
(`ev-dev-labs/teslasync`). We are adding four native clients (Windows, Android,
macOS, iOS). The clients are thin: they talk to the same `/api/v1/*` + SSE backend
and share a large amount of non-UI logic. We must decide repo topology: one repo
(monorepo) vs. one-repo-per-platform.

The clients evolve in lockstep with the API contract and with each other (a renamed
DTO field, a new endpoint, a units change must land everywhere together). The same
small team owns backend + apps.

## Decision

Use a **single monorepo** — the existing `teslasync` repo — and add a top-level
`apps/` directory:

```
teslasync/
  internal/ cmd/      # Go backend (unchanged)
  web/                # React SPA (parity source of truth)
  api/openapi/        # generated OpenAPI 3.1 spec
  apps/
    shared/   design/ parity/
    windows/  android/ apple/
```

Backend and web are untouched in placement; native work is **additive**. A change to
the API contract + all consumers lands in **one atomic PR**.

## Consequences

- ✅ Atomic cross-cutting changes; no cross-repo version skew; one CI, one issue tracker,
  one history; compiler/codegen catches all consumers of a contract change at once.
- ✅ Easy to split `apps/<platform>` into its own repo *later* if a dedicated team forms
  (the easy direction); merging repos back is the hard direction we avoid.
- ⚠️ Repo grows; CI must use **path filters** so a Swift-only PR doesn't run the Android
  build (addressed in P0 CI matrix).
- ⚠️ Large checkout for contributors who only need one platform; mitigated with sparse
  checkout / partial clone guidance in `apps/README.md`.

## Alternatives rejected

- **Repo-per-platform:** constant publish-then-bump dance for the shared contract;
  version skew; no atomic refactors. Only justified for independently-staffed teams on
  divergent cadences — not our situation.
