# Phase R — Coordination Note

> **Audience:** anyone working on `main` or PRs targeting `main` while
> the `chore/repo-reorganization` branch is in active Phase R execution.
>
> **Author:** Copilot CLI agent + User mandate
>
> **Active period:** 2026-05-28 → end of Phase R (estimate 4–8 weeks
> from R0 commit)

## What is happening

The `chore/repo-reorganization` branch is undergoing a holistic
bounded-context restructure (Phase R) per ADR-011. This means
hundreds to thousands of files will be moved via `git mv` into new
subdirectories matching their bounded context.

Concretely:
- `internal/api/*_handler.go` → `internal/api/<resource>/handler.go`
- `internal/database/*_repo.go` → `internal/database/<aggregate>/repo.go`
- `internal/handler/v1/*.go` → `internal/handler/v1/<resource>/*.go`
- `internal/models/*.go` → `internal/models/<domain>/*.go`
- `internal/jobs/*.go` → `internal/jobs/<category>/*.go`
- `internal/ai/tools/*.go` → `internal/ai/tools/<capability>/*.go`
- `web/src/lib/*.ts` → `web/src/lib/<purpose>/*.ts`
- `web/src/hooks/*.ts` → `web/src/hooks/<purpose>/*.ts`
- `web/src/api/hooks/*.ts` → `web/src/api/hooks/<domain>/*.ts`
- `web/src/features/dashboard/widgets/*.tsx` →
  `web/src/features/dashboard/widgets/<domain>/*.tsx`
- `web/src/components/{ai,feedback,data-display}/*.tsx` →
  `web/src/components/<category>/<subcategory>/*.tsx`

## What you need to do

### If you are working on `main`

Continue normally. The Phase R branch will NOT be merged into `main`
until the entire reorg is complete (planned for the D4 PR). Until
then, your PRs against `main` are unaffected by Phase R structurally.

When Phase R finally merges to `main`, expect ONE large reorg PR with
clear cluster-by-cluster commits. Each cluster commit has been
designed to preserve `git log --follow` traceability.

### If you are working on `chore/repo-reorganization` (or a branch off it)

Rebase frequently. Each Phase R sub-phase commit lands directly on
`chore/repo-reorganization` and pushes to origin. If your branch is
based on a pre-R commit, rebasing against post-R commits will be
painful because so many import paths will have moved.

Recommended workflow:
- Pull `chore/repo-reorganization` daily.
- For long-running work, rebase against the most recent post-cluster
  commit (one with `refactor(R<n>):` prefix).
- Use `git log --follow <file>` to trace history of any moved file.

## How to read `git blame` and `git log` after the reorg

### `git blame`

Phase R move commits are added to `.git-blame-ignore-revs` so
`git blame` skips them when computing the "real" author. On GitHub
the file's blame view honors this automatically. Locally you may
need to opt in:

```bash
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

Once configured, `git blame internal/api/charging/handler.go` will
show the original committer who wrote each line, NOT the bulk-move
commit.

### `git log` and history archaeology

Use `git log --follow <new-path>` to trace history across moves:

```bash
git log --follow internal/api/charging/handler.go
# Shows commits for the file even though it was previously at
# internal/api/charging_handler.go.
```

For deeper investigation (e.g. before the rename detection
threshold), use `git log -M70% --follow` to lower the similarity
threshold.

## Expected paths after Phase R

The cluster map (`docs/architecture/migration/cluster-map.md`) is
the source of truth for the planned subpackage structure. It is
populated incrementally as R1 (backend audit) and R7 (frontend
audit) progress.

Tentative paths (subject to R1/R7 audit refinement):

| Today | After Phase R |
|---|---|
| `internal/api/vehicle_handler.go` | `internal/api/vehicle/handler.go` |
| `internal/api/charging_handler.go` | `internal/api/charging/handler.go` |
| `internal/api/drive_handler.go` | `internal/api/drive/handler.go` |
| `internal/database/vehicle_repo.go` | `internal/database/vehicle/repo.go` |
| `internal/database/charging_repo.go` | `internal/database/charging/repo.go` |
| `internal/database/cache.go` | `internal/database/shared/cache.go` |
| `internal/database/migrate.go` | `internal/database/shared/migrate.go` |
| `internal/ai/tools/charge_*.go` | `internal/ai/tools/charge/*.go` |
| `web/src/lib/dateFormat.ts` | `web/src/lib/format/date.ts` |
| `web/src/lib/distance.ts` | `web/src/lib/calc/distance.ts` |
| `web/src/api/hooks/useCharging.ts` | `web/src/api/hooks/charging/useCharging.ts` |
| `web/src/features/dashboard/widgets/BatteryGaugeWidget.tsx` | `web/src/features/dashboard/widgets/battery/BatteryGaugeWidget.tsx` |

## Phase R cluster boundaries

Each cluster lands as ONE commit. Commit titles follow:
`refactor(R<n>): <description>` (e.g.
`refactor(R5): models/charging cluster split`).

Phase R sub-phases:

```
R0   ADRs + cluster-map skeleton + freeze/coordination + report-mode descriptors
R0.5 Canary move (1-3 files; tiniest possible smoke)
R1   Backend cluster maps (audit)
R7   Frontend cluster maps (audit)
R5   internal/models split
R6   internal/jobs + internal/ai/tools split
R4   internal/database split
R3   internal/handler/v1 split (destination shape)
R2.0 Extract internal/api/{httpx,apiparams,apitest} + snapshot harness
R2a  internal/api shared/middleware/SSE/system
R2b  internal/api read-only resources
R2c  internal/api vehicle/charging/drive/telemetry core
R2d  internal/api AI/admin + AI guard preservation gate
R2e  internal/api cleanup + ADR-009 re-application
R11  web/src/lib split
R10  web/src/hooks split
R8   web/src/api/hooks split
R9   web/src/features/dashboard/widgets split
R12  web/src/components/{ai,feedback,data-display} split
R13  Flip archmetrics + ESLint boundaries from report → error mode
R14  Capture baseline-after-r/
```

## Compatibility surface

There is NO temporary compatibility surface (per ADR-011 + rubber-duck
critique on Phase R plan). Import paths change atomically per cluster
commit. If you have a long-running branch with imports of moved
packages, the rebase will require updating import paths to the new
locations — `goimports -w .` handles 95% of the work, the remainder
is manual.

If a public Go API (exported function/type) is being renamed as part
of a cluster commit, this will be called out in the commit message
explicitly. Phase R minimizes such renames; in most cases the
exported identifiers stay the same and only their package path
changes.

## Frequently asked questions

### Will Phase R change any HTTP route URLs?

NO. Route URLs (`/api/v1/...`) are preserved exactly. Per-cluster
snapshot diff testing (defined in R2.0 prep) confirms behavioral
parity for every endpoint.

### Will Phase R change any database schema?

NO. Database schema is out of scope (see repo-reorganization plan
§9). Phase R is a Go package layout change only.

### Will Phase R change any frontend rendered HTML / CSS?

NO. Frontend file moves are TS/TSX file relocations only. Component
trees, props, styles, and rendered DOM are preserved.

### Will Phase R change any public Go API?

In most cases only the package PATH changes (e.g.
`internal/database.VehicleRepo` → `internal/database/vehicle.Repo`).
Where a type name changes (typically dropping a now-redundant prefix
like `VehicleRepo` → `Repo` when moving into `package vehicle`), the
cluster commit message documents the rename.

### How do I find a file after a move?

```bash
# Search by current filename
git log --all --diff-filter=R --name-status -- '*<old-name>*'

# Or by content match
git grep -l '<some unique string from the file>'
```

### My PR conflicts heavily with the reorg branch — what now?

Phase R will not merge to `main` until D4 (end of full reorg). Your
PR against `main` does not conflict with `chore/repo-reorganization`
until that final merge. At D4 you may need to rebase your PR if it
was merged before D4 by adjusting import paths — but most PRs will
have merged long before D4 and will not be affected.

## Contact / questions

Per project convention, open a GitHub issue tagged
`reorg-phase-r-question` or comment on the latest Phase R commit on
`chore/repo-reorganization`.
