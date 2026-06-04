---
adr: 011
title: Bounded-Context Subpackages for Flat-Folder Hot-Spots
status: PROPOSED
date: 2026-05-28
deciders:
  - User mandate ("we need to cover whole app", maximalist scope selection 2026-05-28)
  - Copilot CLI agent (Claude Opus 4.7 xhigh)
supplements:
  - ADR-006 (Models vs Domain Charter)
  - ADR-007 (internal/platform/ Charter)
  - ADR-009 (HTTP Handler Canonical Home)
amends:
  - ADR-009 (lifted for Phase R, then re-applied to NEW subpackages after R2e)
related:
  - ADR-015 (AI-Off Contract; amendment in 015-amendment-ai-scope.md narrows its scope for Phase R)
---

# ADR-011: Bounded-Context Subpackages for Flat-Folder Hot-Spots

## Context

Six backend folders and seven frontend folders exceed 30 source files in a
single flat package/namespace:

**Backend (Go):**
| Folder | Files |
|---|---|
| `internal/api/` | 434 |
| `internal/database/` | 143 |
| `internal/ai/tools/` | 109 |
| `internal/models/` | 36 |
| `internal/tesla/router/writers/` | 28 (borderline) |
| `internal/jobs/` | 25 |

**Frontend (TS):**
| Folder | Files |
|---|---|
| `web/src/features/dashboard/widgets/` | 121 |
| `web/src/lib/` | 104 |
| `web/src/api/hooks/` | 67 |
| `web/src/hooks/` | 64 |
| `web/src/components/feedback/` | 62 |
| `web/src/components/ai/` | 61 |
| `web/src/components/data-display/` | 46 |

These flat namespaces make navigation harder, hide ownership, and prevent
fine-grained architecture rules. They also make code review on changes
that touch multiple resources noisy (e.g. a charging-feature PR shows up
adjacent to vehicle handlers because both live in `package api`).

Many modern Go codebases use short idiomatic package names at the
bounded-context level (Kubernetes `apps/v1`, etcd `embed`, Hashicorp
Vault `audit`/`auth`/`api`). The same short name appearing across
multiple layers (api/charging, database/charging, models/charging) is
collision-prone and is the main ergonomic trade-off; we accept this
trade-off explicitly and codify a deterministic alias convention to
manage it.

## Decision

### 1. Trigger

Every backend folder containing ≥ 30 `.go` files (excluding `_test.go`)
in a single package MUST be split into bounded-context subpackages.

Every frontend folder containing ≥ 30 `.ts`/`.tsx` files MUST be split
into bounded-context subdirectories.

### 2. Naming convention — Option A (idiomatic short)

Subpackages use short idiomatic Go names matching the bounded context:

```go
// internal/api/charging/handler.go
package charging

// internal/database/charging/repo.go
package charging

// internal/handler/v1/charging/handler.go
package charging
```

### 3. Alias convention (mandatory at multi-layer-import callsites)

Where the same short name is imported from multiple layers at one
callsite (e.g. composition root, tests, cross-layer wiring), use
deterministic suffixes:

| Layer | Alias suffix | Example |
|---|---|---|
| `internal/api/<x>` | `<x>api` | `chargingapi "github.com/.../internal/api/charging"` |
| `internal/handler/v1/<x>` | `<x>handler` | `charginghandler "github.com/.../internal/handler/v1/charging"` |
| `internal/database/<x>` | `<x>db` | `chargingdb "github.com/.../internal/database/charging"` |
| `internal/models/<x>` | `<x>model` | `chargingmodel "github.com/.../internal/models/charging"` |
| `internal/domain/<x>` | `<x>domain` | `chargingdomain "github.com/.../internal/domain/charging"` |
| `internal/app/<x>svc` | `<x>svc` (grandfathered Option B) | `chargingsvc "github.com/.../internal/app/chargingsvc"` |
| `internal/jobs/<x>` | `<x>jobs` | `chargingjobs "github.com/.../internal/jobs/charging"` |
| `internal/ai/tools/<x>` | `<x>aitools` | `chargingaitools "github.com/.../internal/ai/tools/charging"` |

Where only ONE such package is imported at a callsite (e.g. a handler
file in `internal/api/charging/` imports `internal/database/charging`
only), **no alias is required** — dominant single-import keeps clean Go
style. Aliases are mandatory only at composition/test/cross-layer wiring
callsites.

### 4. Parent-directory mechanical rule

Parent dirs (`internal/api/`, `internal/database/`, etc.) contain ONLY:

- `doc.go` (with `// Layer:` declaration)
- composition file(s) — `router.go`, `registry.go`, `wiring.go`, etc.
- shared-helper subpackages — e.g. `internal/api/httpx/`,
  `internal/api/apiparams/`, `internal/api/apitest/`
- the resource subpackages themselves

No `*_handler.go` / `*_repo.go` / business helpers may live at the
parent level. Enforced mechanically by archmetrics:

```
parent-package globs (internal/api/*.go excluding subdirs)
  MUST match only doc.go | router.go | <composition>.go | <middleware>.go
```

### 5. Resource-package public API

Each resource subpackage exposes a narrow constructor + `Mount` API:

```go
package charging

type Deps struct {
    Repo   chargingdb.Repository
    Svc    chargingsvc.Service
    Logger zerolog.Logger
}

type Handler struct{ deps Deps }

func NewHandler(deps Deps) *Handler { return &Handler{deps: deps} }

func (h *Handler) Mount(r chi.Router) {
    r.Route("/charging", func(r chi.Router) {
        r.Get("/", h.list)
        r.Get("/{sessionID}", h.get)
        // ...
    })
}
```

The parent `router.go` calls `Mount` rather than reaching into handler
internals. Same pattern for database `Registry`.

### 6. Grandfathering

Existing `internal/app/*svc/` packages use Option B (suffix-in-name) and
are GRANDFATHERED. We do not rename `chargingsvc`, `tripsvc`, etc.

Greenfield packages going forward use Option A.

### 7. Composition root carve-outs

The composition root for each parent (`internal/api/router.go`,
`internal/database/registry.go`) is the ONLY file allowed to import all
of its sibling subpackages. This is encoded as an explicit `ExceptFrom`
carve-out in `tools/archmetrics/main.go`:

```go
{From: "internal/api/<x>", To: "internal/api/<y>",
 ExceptFrom: []string{"internal/api"}},  // router.go is the carve-out
```

### 8. ADR-009 interaction

ADR-009 freezes `internal/api/` against NEW files. This freeze is LIFTED
for the duration of Phase R (the restructure phase), then RE-APPLIED to
the NEW parent (`internal/api/`) AND to each new subpkg after R2e
completes. The restructure converts the freeze from a coarse
"package-level" guard to a finer "per-subpackage" guard.

## Consequences

### Positive

- Smaller packages = better godoc, faster IDE indexing, clearer
  ownership, easier review.
- Archmetrics DAG can express per-subpackage rules (currently impossible
  with flat `package api`).
- Frontend ESLint boundaries can enforce intra-folder structure.
- Test parallelization improves (per-package test caching is finer).
- Composition responsibility is explicit at the parent root.

### Negative

- Mass `git mv` commits make `git blame` noisy. Mitigated via
  `.git-blame-ignore-revs`.
- Some subpackage names will collide with stdlib (`api`, `admin`). Use
  aliases per §3.
- Composition/cross-layer wiring callsites need consistent aliases.
  Mitigated by the convention table above.
- Phase R adds 4–8 weeks to the reorg timeline (user accepted).

### Trade-off accepted explicitly

The same short name across api/database/models/domain layers is more
collision-prone than the Kubernetes-style precedent often cited.
TeslaSync repeats the bounded-context name in up to 6 layers (api,
handler/v1, database, models, domain, app/*svc, jobs, ai/tools). We
accept this: idiomatic package declarations at the DEFINITION site +
deterministic aliases at the BOUNDARY/composition callsites.

## Alternatives considered

### Option B — Suffix in package name

```go
package apicharging  // not package charging
package chargingdb   // not package charging
```

Rejected because:

- Verbose; non-idiomatic for Go.
- Existing `internal/app/*svc/` already uses this (grandfathered) and
  the suffix is awkward inside the package itself (`func (s
  *chargingsvcService) ...`).
- Forces redundant typing at definition site for an issue that only
  matters at composition site.

### Option C — Kubernetes-style with mandatory aliases everywhere

Rejected because:

- Mandatory aliases on every import is noisy at definition-site
  consumers (e.g. a charging handler file that imports only
  `internal/database/charging` does not need an alias).
- Adds review friction for the 80% case to solve the 20% case.

### Status quo — Keep flat packages

Rejected per user mandate and the Context section's enumeration of
real costs.

## Rollback

If Phase R is judged a regression:

- Each cluster commit is a discrete `git mv` + package-decl edit. A
  cluster can be reverted with `git revert <sha>`.
- The pre-R baseline at `tools/archmetrics/baseline-after-a3/` (and
  the v3 cluster-map docs) captures the original shape.
- No production behavior changes; this is purely package-layout.

## References

- Repo reorganization plan: `docs/architecture/repo-reorganization-plan.md`
  (and the live working copy at the session plan.md)
- Cluster maps: `docs/architecture/migration/cluster-map.md`
- ADR-015 amendment: `docs/architecture/adr/015-amendment-ai-scope.md`
- Phase R coordination note:
  `docs/architecture/migration/phase-r-coordination-note.md`
