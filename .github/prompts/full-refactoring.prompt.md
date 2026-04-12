---
description: "FULL REFACTORING — Execute all 9 phases sequentially, no stopping, no waiting for approval"
---

# Full Refactoring — Autonomous Execution

## ⛔ READ THIS COMPLETELY BEFORE STARTING

You are executing a FULL codebase refactoring across 9 phases. The user is unavailable.
**Do NOT stop between phases. Do NOT ask for approval. Execute all 9 phases sequentially.**

**Branch:** `refactor/full-rewrite` (create it from `main` if it doesn't exist)

## Rules for Autonomous Execution

```
1. Execute phases 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 IN ORDER
2. Do NOT skip a phase. Each phase depends on the previous one.
3. Do NOT ask for approval between phases. Just keep going.
4. After EACH phase, run the verification commands in that phase's acceptance
   criteria. If something fails, FIX IT before moving to the next phase.
5. If you hit an error you truly cannot resolve, document it in a
   BLOCKING_ISSUES.md file and continue with the next phase that isn't blocked.
6. Phases 6-7 (frontend) can be done after Phase 5, or interleaved — your choice.
7. Follow .github/copilot-instructions.md for EVERY phase — the anti-patchwork
   and honesty rules apply to EVERY file you create.
```

## 📍 PROGRESS TRACKING — MANDATORY

**You MUST update the progress file after completing EACH phase and after EACH major task
within a phase. This is how the user knows where you stopped if the session ends.**

### At the START of the session

Create (or update if it exists) the file `REFACTORING_PROGRESS.md` in the repo root:

```markdown
# Refactoring Progress Tracker

> Auto-updated by the agent after each phase/task.
> If the session ends unexpectedly, this file shows exactly where to resume.

## Current Status
- **Active Phase:** 0
- **Active Task:** Setting up internal/platform/config/
- **Last Completed Phase:** None
- **Last Git Commit:** (none yet)
- **Timestamp:** 2026-04-12T08:45:00Z

## Phase Checklist

### Phase 0: Foundation
- [ ] internal/platform/config/
- [ ] internal/domain/errors.go
- [ ] internal/domain/fsm/ (engine, types, sub_fsm)
- [ ] internal/platform/database/
- [ ] internal/platform/cache/
- [ ] internal/platform/telemetry/
- [ ] internal/platform/httputil/
- [ ] internal/platform/buildinfo/
- [ ] internal/handler/middleware/
- [ ] ✅ Verification passed
**Status:** NOT STARTED

### Phase 1: Domain Layer
- [ ] internal/domain/vehicle/
- [ ] internal/domain/charging/ (+ SubFSM)
- [ ] internal/domain/trip/
- [ ] internal/domain/export/
- [ ] internal/domain/notification/
- [ ] internal/domain/user/
- [ ] ✅ Verification passed
**Status:** NOT STARTED

### Phase 2: Port Interfaces
- [ ] internal/port/repository/
- [ ] internal/port/external/
- [ ] internal/port/messaging/
- [ ] ✅ Verification passed
**Status:** NOT STARTED

### Phase 3: Adapters
- [ ] internal/adapter/postgres/ (queries + repositories)
- [ ] internal/adapter/redis/
- [ ] internal/adapter/tesla/
- [ ] internal/adapter/geocoding/
- [ ] internal/adapter/mqtt/
- [ ] internal/adapter/storage/
- [ ] migrations updated
- [ ] ✅ Verification passed
**Status:** NOT STARTED

### Phase 4: Application Services
- [ ] internal/app/vehiclesvc/
- [ ] internal/app/chargingsvc/
- [ ] internal/app/tripsvc/
- [ ] internal/app/exportsvc/
- [ ] internal/app/notificationsvc/
- [ ] internal/app/dashboardsvc/
- [ ] ✅ Verification passed
**Status:** NOT STARTED

### Phase 5: HTTP Handlers & Wiring
- [ ] internal/handler/dto/
- [ ] internal/handler/v1/
- [ ] cmd/teslasync/main.go
- [ ] cmd/notification-worker/main.go
- [ ] cmd/export-worker/main.go
- [ ] ✅ Verification passed
**Status:** NOT STARTED

### Phase 6: Frontend Shared Library
- [ ] components/ui/
- [ ] components/layout/
- [ ] components/feedback/
- [ ] components/data-display/
- [ ] components/charts/
- [ ] components/maps/
- [ ] components/forms/
- [ ] components/motion/
- [ ] hooks/
- [ ] api/client.ts
- [ ] lib/utils.ts + lib/fsm.ts
- [ ] ✅ Verification passed
**Status:** NOT STARTED

### Phase 7: Frontend Features
- [ ] types/ + api/hooks/
- [ ] features/dashboard/
- [ ] features/vehicles/
- [ ] features/charging/
- [ ] features/trips/
- [ ] features/settings/
- [ ] features/maps/
- [ ] routes/ + i18n/
- [ ] ✅ Verification passed
**Status:** NOT STARTED

### Phase 8: Cleanup
- [ ] Dead code removed
- [ ] Test coverage targets met
- [ ] Grafana dashboards created
- [ ] Runbooks created
- [ ] Documentation updated
- [ ] Docker images build successfully (all 4)
- [ ] docker compose up — all services healthy
- [ ] Health checks pass (API, workers, web)
- [ ] ✅ Final verification passed
**Status:** NOT STARTED
```

### Update rules

```
AFTER completing each task within a phase:
  1. Check the box: - [ ] → - [x]
  2. Update "Active Task" to the next task
  3. git add REFACTORING_PROGRESS.md && git commit -m "progress: completed {task}"

AFTER completing an entire phase:
  1. Check the "✅ Verification passed" box
  2. Update "Status" for that phase: NOT STARTED → ✅ COMPLETE
  3. Update "Last Completed Phase"
  4. Update "Active Phase" to the next phase
  5. git add -A && git commit -m "refactor: complete phase {N} — {phase name}"
  6. git push

AFTER completing a verification that FAILS:
  1. Update "Active Task" to: "FIXING: {what failed}"
  2. Fix the issue
  3. Re-run verification
  4. Then proceed normally

This means every task gets its own small commit. The user can:
  - Read REFACTORING_PROGRESS.md to see exactly where you are
  - Check git log to see what was done
  - Resume from the exact task that was in progress
```

## Phase Execution Sequence

For each phase, read the corresponding prompt file, execute it fully, verify it, then move on:

### Phase 0: Foundation
Read and execute: `.github/prompts/phase-0-foundation.prompt.md`
- Build: `internal/platform/`, `internal/domain/fsm/`, `internal/domain/errors.go`, `internal/handler/middleware/`
- Verify: `go build ./internal/... && go test ./internal/platform/... ./internal/domain/fsm/... -v`
- ✅ Move to Phase 1

### Phase 1: Domain Layer
Read and execute: `.github/prompts/phase-1-domain.prompt.md`
- Build: `internal/domain/vehicle/`, `internal/domain/charging/`, `internal/domain/trip/`, `internal/domain/export/`, `internal/domain/notification/`, `internal/domain/user/`
- Verify: `go build ./internal/domain/... && go test ./internal/domain/... -v -cover`
- Verify purity: `grep -rn "pgx\|net/http\|zerolog\|redis" internal/domain/` → must return nothing
- ✅ Move to Phase 2

### Phase 2: Port Interfaces
Read and execute: `.github/prompts/phase-2-ports.prompt.md`
- Build: `internal/port/repository/`, `internal/port/external/`, `internal/port/messaging/`
- Verify: `go build ./internal/port/...`
- ✅ Move to Phase 3

### Phase 3: Adapters
Read and execute: `.github/prompts/phase-3-adapters.prompt.md`
- Build: `internal/adapter/postgres/`, `internal/adapter/redis/`, `internal/adapter/tesla/`, `internal/adapter/geocoding/`, `internal/adapter/mqtt/`, `internal/adapter/storage/`
- Verify: `go build ./internal/adapter/... && go test ./internal/adapter/... -v`
- Verify no SQL leakage: `grep -rn "SELECT\|INSERT\|UPDATE\|DELETE" internal/app/ internal/handler/` → nothing
- ✅ Move to Phase 4

### Phase 4: Application Services
Read and execute: `.github/prompts/phase-4-services.prompt.md`
- Build: `internal/app/vehiclesvc/`, `internal/app/chargingsvc/`, `internal/app/tripsvc/`, `internal/app/exportsvc/`, `internal/app/notificationsvc/`, `internal/app/dashboardsvc/`
- Verify: `go build ./internal/app/... && go test ./internal/app/... -v -cover`
- Verify no direct state: `grep -rn "\.State\s*=" internal/app/` → nothing
- ✅ Move to Phase 5

### Phase 5: HTTP Handlers & Wiring
Read and execute: `.github/prompts/phase-5-handlers.prompt.md`
- Build: `internal/handler/dto/`, `internal/handler/v1/`, `cmd/teslasync/`, `cmd/notification-worker/`, `cmd/export-worker/`
- Verify: `go build ./cmd/... && go test ./internal/handler/... -v`
- ✅ Move to Phase 6

### Phase 6: Frontend Shared Library
Read and execute: `.github/prompts/phase-6-frontend-library.prompt.md`
- Build: ALL shared components, hooks, API client, barrel exports
- Verify: `cd web && npx tsc --noEmit && npm run lint && npm run test`
- ✅ Move to Phase 7

### Phase 7: Frontend Features
Read and execute: `.github/prompts/phase-7-frontend-features.prompt.md`
- Build: ALL feature pages using ONLY shared components
- Verify: `cd web && npx tsc --noEmit && npm run lint && npm run test && npm run build`
- Verify no raw imports: `grep -rn "from 'recharts'\|from 'react-leaflet'\|from 'framer-motion'" web/src/features/` → nothing
- ✅ Move to Phase 8

### Phase 8: Cleanup
Read and execute: `.github/prompts/phase-8-cleanup.prompt.md`
- Delete dead code, fill test gaps, add dashboards and runbooks
- Build ALL Docker images — all 4 must succeed
- Run `docker compose up -d` — all services must start and pass health checks
- Run FULL verification suite from phase-8 prompt
- Verify: `curl -sf http://localhost:8080/healthz && curl -sf http://localhost:8080/readyz`
- Cleanup: `docker compose down`

## After ALL Phases — Final Report

When all 8 phases are complete, write a `REFACTORING_REPORT.md` in the repo root:

```markdown
# Refactoring Report

## Phase Results
| Phase | Status | Files Created | Files Modified | Tests |
|-------|--------|---------------|----------------|-------|
| 0 Foundation | ✅/❌/⚠️ | count | count | pass/fail |
| 1 Domain | ... | ... | ... | ... |
| ... | ... | ... | ... | ... |

## Verification Results
[Paste final go build, go test, tsc, lint, and build output]

## Not Completed (if any)
- ❌ [item] — [reason]

## Known Issues
- ⚠️ [issue]

## Blocking Issues (if any)
- 🚫 [issue] — [what's needed to resolve]
```

## Remember

- Read `.github/copilot-instructions.md` — it governs everything you do
- Read `ENGINEERING_GUIDELINES.md` sections referenced in each phase prompt
- NO patchwork. NO shortcuts. NO fake "done" claims.
- Every phase has verification commands — RUN THEM and fix failures before moving on.
- The user will review everything when they return. Be thorough now so nothing gets reverted later.
