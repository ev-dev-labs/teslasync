# Phase R — Cluster Map (skeleton)

> **Status:** SKELETON, populated incrementally in R1 (backend) and
> R7 (frontend). Each section lists the source files in the flat
> folder, proposes a subpackage structure, and is filled in when the
> corresponding R-sub-phase reaches its "audit" step.
>
> **Convention:** see ADR-011 §2-§7. Backend uses Option A short
> idiomatic names; frontend uses category dirs.

## Backend (Go) — populated in R1

### `internal/models/` (36 files) — owner: R5

- **Target subpackages:** TBD per R1 audit.
- **Candidate clusters from filename prefixes:** _(populate in R1)_
- **Composition file:** `internal/models/doc.go` (no registry needed
  — pure types).
- **Risk notes:** Models are imported by everything; high blast
  radius for import-path updates. Mitigated by smallest-cluster-first
  ordering.

### `internal/jobs/` (25 files) — owner: R6

- **Target subpackages:** TBD per R1 audit.
- **Candidate clusters:** _(populate in R1)_
- **Composition file:** `internal/jobs/registry.go` (job registry).
- **Risk notes:** Self-contained; low blast radius.

### `internal/ai/tools/` (109 files) — owner: R6 (per ADR-015 amendment)

- **Target subpackages:** TBD per R1 audit; candidates include
  `nl/`, `alert/`, `charge/`, `drive/`, `auto/`, `voice/`,
  `route/`, `safety/`.
- **Composition file:** `internal/ai/tools/registry.go` (tool
  registry).
- **Risk notes:** Per ADR-015 amendment, pure file-move only. AI
  guard middleware preserved. `make ai-vet` MUST pass after each
  cluster commit.

### `internal/database/` (143 files) — owner: R4

- **Target subpackages:** TBD per R1 audit; candidates include
  `vehicle/`, `charging/`, `drive/`, `signal/`, `automation/`,
  `notification/`, `alert/`, `audit/`, `export/`, `achievement/`,
  `dashboard/`, `gdpr/`, `sharing/`, `telemetry/`, `tesla/`,
  `energy/`.
- **Composition file:** `internal/database/registry.go` (new) — or
  reuse existing `internal/database/database.go` as the wiring
  surface.
- **Shared subpackage:** `internal/database/shared/` for
  `cache.go`, `helpers.go`, `migrate.go`, `query_budget_tracer.go`,
  `mongodb.go`, `from_map.go`.
- **Risk notes:** Touches many `internal/api/*` callers. Per
  rubber-duck #3, accept the double-touch budget rather than
  building a temporary compat layer.

### `internal/handler/v1/` (12 files now, growing) — owner: R3

- **Target subpackages:** Matching the R2 destination subpackages
  exactly (handler/v1/charging/ for api/charging/, etc).
- **Composition file:** `internal/handler/v1/router.go` (new).
- **Risk notes:** Very small now (12 files) but defines the
  destination shape that R2 must adopt. Do R3 before R2.

### `internal/api/` (434 files) — owner: R2 (split into R2a–R2e)

- **Target subpackages (provisional):** `vehicle/`, `charging/`,
  `drive/`, `trip/`, `energy/`, `analytics/`, `telemetry/`,
  `automation/`, `alert/`, `notification/`, `admin/`, `settings/`,
  `auth/`, `sharing/`, `export/`, `signal/`, `system/`,
  `dashboard/`, `motor/`, `climate/`, `security/`, `media/`,
  `tire/`, `location/`, `ai/`, `sse/`.
- **Composition file:** `internal/api/router.go` (existing; refactored
  to call `Mount(r, deps)` on each subpkg).
- **Shared subpackages (extracted in R2.0 PREP):**
  - `internal/api/httpx/` — `writeJSON`, `writeError`, request
    decoders, response writers.
  - `internal/api/apiparams/` — pagination, sorting, filter parsing,
    validation primitives.
  - `internal/api/apitest/` — `setupTestRouter`, `doRequest`,
    `assertStatus`, fixture loaders.
  - `internal/api/middleware/` (if not already) — auth, ratelimit,
    AI guard, query budget, request ID, tracing.
- **R2 wave plan:**
  - **R2a** — shared/middleware/SSE/system handlers.
  - **R2b** — read-only resources (analytics, signals, etc).
  - **R2c** — vehicle/charging/drive/telemetry core.
  - **R2d** — AI/admin/cross-cutting + **AI guard preservation gate**
    per ADR-015 amendment.
  - **R2e** — cleanup + ADR-009 re-application + parent-package
    mechanical enforcement (`internal/api/*.go` may only be
    `doc.go|router.go|composition.go`).

## Frontend (TS/React) — populated in R7

### `web/src/lib/` (104 files) — owner: R11

- **Target subdirs:** TBD per R7 audit; candidates include `format/`,
  `geo/`, `dom/`, `calc/`, `data/`, `broadcast/`, `automation/`,
  `ui/`, `csv/`, `time/`, `string/`, `validation/`.
- **Public-entrypoint pattern:** allow direct imports from
  `@/lib/format/date`, `@/lib/geo/distance`, etc. NO barrel
  required (per rubber-duck #14; barrels strict only for
  `components/*`).
- **Risk notes:** Leaf dep for hooks AND widgets. Moved EARLIEST
  in the frontend sequence to avoid double-touching downstream.

### `web/src/hooks/` (64 files) — owner: R10

- **Target subdirs:** TBD per R7 audit; candidates include `ui/`,
  `data/`, `browser/`, `lifecycle/`, `formatting/`, `behavior/`.
- **Public-entrypoint pattern:** direct imports from
  `@/hooks/ui/useBreadcrumbs` etc. (same as `lib`).
- **Risk notes:** Depends on `lib/` (move after R11).

### `web/src/api/hooks/` (67 files) — owner: R8

- **Target subdirs:** Mirror the backend bounded contexts from R4
  (each `useXxx.ts` lives in the subdir matching its
  `internal/database/<x>/`).
- **Public-entrypoint pattern:** direct imports from
  `@/api/hooks/charging/useCharging`.
- **Risk notes:** Depends on `lib/` (R11) AND on knowing the
  backend's `internal/database/` subpkg names (R4). Move after both.

### `web/src/features/dashboard/widgets/` (121 files) — owner: R9

- **Target subdirs:** TBD per R7 audit; candidates include
  `battery/`, `charging/`, `climate/`, `drive/`, `energy/`,
  `automation/`, `ai/`, `security/`, `vehicles/`, `alerts/`,
  `system/`, `misc/`.
- **Existing `widgets/registry/` subdirectory** stays as-is.
- **Public-entrypoint pattern:** widgets re-exported from
  `features/dashboard/widgets/index.ts` barrel.
- **Risk notes:** Imports from lib/hooks/api/hooks heavily. Move
  after R11/R10/R8.

### `web/src/components/ai/` (61 files) — owner: R12 (per ADR-015 amendment)

- **Target subdirs:** TBD per R7 audit; per-AI-feature subdirs.
- **Public-entrypoint pattern:** strict barrel
  `components/ai/index.ts` (per rubber-duck #14 — barrels strict
  for components).
- **Risk notes:** ADR-015-amendment scope. AI guard wrapping
  preserved.

### `web/src/components/feedback/` (62 files) — owner: R12

- **Target subdirs:** TBD per R7 audit; candidates `loading/`,
  `error/`, `empty/`, `alerts/`, `prompts/`.
- **Public-entrypoint pattern:** strict barrel
  `components/feedback/index.ts`.

### `web/src/components/data-display/` (46 files) — owner: R12

- **Target subdirs:** TBD per R7 audit; candidates `metrics/`,
  `cards/`, `tables/`, `lists/`, `timeline/`, `badges/`.
- **Public-entrypoint pattern:** strict barrel
  `components/data-display/index.ts`.

## Acceptance criteria for this document

This skeleton is fleshed out as R1/R7 progress. By end of R7 every
"_TBD per R1/R7 audit_" placeholder above MUST be replaced with a
concrete file-to-subpackage mapping, with each subpackage's file
count noted.

Per ADR-011 §1, no subpackage SHOULD exceed 50 files. If the audit
shows a candidate cluster > 50 files, sub-split it.
