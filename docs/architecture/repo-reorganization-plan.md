# TeslaSync — Repository Reorganization Plan (v3, Phase-48-done world)

**Branch:** `chore/repo-reorganization` (off `main` @ `e1550655`)
**Mandate (user):** "Proper Work. Proper linting. proper state of art design patterns. No shortcuts no anti-patterns. We must not have any tech debt remaining. It's ok even if it takes weeks or months." Design focus: **Clean Architecture**.

**Status:** v1 (20-phase mega-plan) rejected by rubber-duck. v2 (3 strategies + 3 tracks for Phase-48 coordination) obsoleted by user fact "phase-48 is done". v3 is the simplified single-sequence plan for the post-Phase-48 world.

---

## 0. Ground truth (verified 2026-05-27)

```
git log main: e1550655 (Tracing #70) → fd0ff14b → b7235b73 → … → b7507f1b7 (phase-47/02 arch foundation)
```

**What is already done on main (do NOT redo):**

| Done | Evidence |
|---|---|
| Hexagonal scaffolding present | `internal/{domain,port,adapter,app,handler,models,platform}/` all exist; 60+ packages with `doc.go` carrying `// Layer:` declarations (177 files) |
| `internal/handler/v1/` exists, canonical for new handlers | 12 handlers + ADR-009 |
| `internal/app/*svc/` for use cases | 6 svcs: admin/audit, charging, dashboard, export, gdpr-export, notification, trip, vehicle |
| Phase-47 architecture foundation | commits `b7507f1b7` (arch_test foundation), `913f70c3` (doc.go per package), `56de7194` (DI extracted from main.go), `f83f2c2d` (workers decoupled), `9399b53c` (ADR-009), `f976b2b1` (ADR-006), `283271e4` (ADR-007), `4165c8b0` (port/adapter layering at fail-level), `cb3925f2` (handler thinness rule), `009a702c` (close phase-47) — ALL on main |
| `tools/archmetrics` baseline + `make arch-check` | enforces frozenPackages + forbiddenEdges; CI gates on regressions |
| Phase-48 SI canonical on backend | 0 unit-suffixed fields in `internal/models`; only 9 strays repo-wide (mostly legitimate misses or false positives like `PowerMin` = "power minimum") |
| Phase-42 Tesla telemetry pipeline | complete at `b1dd7ea4`; ADR-004 + `internal/tesla/*` + `internal/signal/*` canonical |
| ADR-015 AI-Off Contract + `withAiFeature` enforcement | ESLint rule `teslasync/ai-component-must-be-wrapped` active |
| Tracing observability | commit `e1550655 Tracing (#70)`; OTel + FSM tracer + MQTT propagation |
| `eslint-plugin-jsx-a11y` | wired in `web/eslint.config.js` |

**What remains as the actual tech debt:**

| Remaining | Evidence |
|---|---|
| 434 .go files in frozen `internal/api/` | only 12 migrated to `handler/v1/`; ~96% incomplete |
| Frontend SI cutover incomplete | ~346 legacy unit-suffixed TS identifiers (mix of real legacy + legitimate config like `costPerKwh` per ADR-006 carve-out); top offenders: `costPerKwh` (59), `energyKwh` (21), `solarKw` (14), `batteryKw` (8), `distanceMi` (8) |
| Frontend cross-feature imports not enforced | no `eslint-plugin-boundaries`; FSD layer rule un-mechanized |
| `web/src/entities/` does not exist | shared domain types scattered between `types/` and `features/*/types.ts` |
| 11 stale `.exe` files at repo root (~330MB) | already in `.gitignore`, but committed-clobber from a misconfigured build |
| `coverage.out`, `cover` (file), `coverage/`, `test-results/` at root | test artifacts |
| `MERGE_READY.md`, `REDESIGN-NOTES.md`, `Dockerfile.README.md` at root | working notes that should be archived |
| `SIGNAL_TRACEABILITY_MATRIX.{md,html}` (180KB) at root | belongs under `docs/architecture/` |
| `seed_comprehensive.sql`, `seed_snapshots.sql` at root | belong under `db/seeds/` |
| `publish_test.sh` at root | belongs under `scripts/` |
| ADRs are one mega-file `.github/ARCHITECTURE.md` (88KB) | not one-file-per-ADR; no `docs/architecture/adr/` |
| ADR-009 Exceptions table has 9 entries | each one is a future decision to either migrate or document permanently |
| `internal/tesla_pipeline` `doc.go` carries stale "subject to phase-42 reorganisation" note | Phase-42 is complete; the note is misleading |
| `internal/notification` + `internal/notifier` + `internal/webpush` boundary unclear | Clean Arch shape should be: `notification/` (domain + svc) → port → channel adapters (`webpush`, smtp, fcm) |
| `internal/service` (5 files) | likely legacy pre-Phase-47; either fold into `app/*svc/` or delete |
| `internal/enums` (6 files), `internal/units` (2 files) | possible overlap with `internal/tesla/units`; audit |
| `depguard` rules in `.golangci.yml` do not mirror archmetrics rules | DAG only enforced at archmetrics layer; IDE/editor noise unguarded |
| `errcheck`, `SA1019` suppressed globally in `.golangci.yml` | tech debt by user's "no tech debt" definition |
| Frontend `no-explicit-any` at warn, `exhaustive-deps` at off, `i18next/no-literal-string` at off | quality flags not enforced |
| 289 unmerged commits on `refactor/signals-rewrite` | per `git log`: duplicate of work already squashed into main via PR #65 etc. — treated as historical, branch can be deleted after audit |

---

## 1. Guiding principles

1. **Build on what's done.** Phase-47 already established the canonical architecture. We do not redo arch_test, doc.go-per-package, ADR-006/007/009, or the Phase-48 SI rename. We FINISH what those phases started.
2. **Slice = atomic unit.** A migrated vertical slice is the unit of work: handler → svc → port (if needed) → repo (kept in `internal/database/`) → DTO → tests → router wiring → archmetrics refresh → frontend hook smoke. Every slice ends green.
3. **No business-heavy handler stays in `internal/api/`.** Documented ADR-009 admin/observability exceptions stay if and only if they are explicitly approved in the Exceptions table with rationale. The goal is "thin, documented exception list", not "internal/api deleted".
4. **Clean Architecture mapping (corrected per critique, aligned with current ADRs):**
   - Entities → `internal/domain/<X>/`
   - Use Cases → `internal/app/<X>svc/`
   - Interface Adapters → `internal/handler/v1/` + `internal/handler/dto/` + `internal/adapter/*` + `internal/database/` (kept as repo layer; ADR-006 already permits)
   - Frameworks/Drivers → `cmd/*` + third-party libs
   - **Ports at consumer boundary**, not 1:1 per adapter. Shared interfaces in `internal/port/<domain>/`; locally-scoped ones inline in the svc.
   - `internal/models/` retained per ADR-006 (persistence + transport DTOs).
5. **Frontend FSD = LAYER RULES, not folder renames.** Current `features/components/hooks/lib/api/types/` directory names stay. `eslint-plugin-boundaries` enforces the DAG with current dir → FSD layer mapping. We add `web/src/entities/` only for genuinely shared (≥2 features) domain types.
6. **Enforcement REPORT → RATCHET, never big-bang.** New rules first emit a report; legacy code gets an allowlist with current count; net-new violations fail CI.
7. **Behavioural parity is the hard gate.** Every migrated route gets pre/post JSON snapshot. OpenAPI diff reviewed. Frontend hook smoke-tested. No "looks the same to me."
8. **Out-of-scope is OUT.** AI subsystem reorg, strict-lint cascade, `internal/database` physical rename, telemetry pipeline restructure — explicitly excluded. We deliver the reorg; quality cascades are their own projects.

---

## 2. Phase sequence

```
A — Hygiene & enforcement scaffolding  (1–2 weeks)
   A0 Baseline & critique acceptance
   A1 Root file hygiene
   A2 Tooling additions (depguard, eslint-plugin-boundaries, Makefile targets)
   A3 Architecture enforcement RATCHET (depguard mirrors archmetrics; ratchet legacy)
   A4 Docs MIRROR into docs/architecture/
   A5 Package audits (audit only; small folds; defer big ones)

B — Frontend FSD-lite enforcement      (2–4 weeks)
   B1 Install boundaries; map current dirs → FSD layers (REPORT mode)
   B2 Audit + fix cross-feature imports (per-feature)
   B3 Promote DRY patterns ≥3-replicas to shared
   B4 Add web/src/entities/ for ≥2-feature shared types
   B5 Frontend SI cutover finish (the ~346 identifiers — separate real legacy from config)
   B6 Flip boundaries rule to error

C — Backend internal/api migration     (8–16 weeks; the long pole)
   C0 Pilot: one small admin handler end-to-end; refine the recipe
   C1 Read-only endpoint sweep (low risk, fast wins)
   C2 Vehicles + state
   C3 Drives + trips
   C4 Charging + sessions
   C5 Energy + analytics
   C6 Notifications + alerts + automation (likely folds notification/notifier/webpush)
   C7 Auth + user + settings + sharing + exports
   C8 Admin/observability EXCEPTION sweep (per-file decision: migrate OR document)
   C9 Telemetry/SSE/admin remainder (carefully)
   C10 Finalization (ADR-011 destination ADR; archmetrics refresh)

D — Final verification & handoff       (1 week)
   D0 Full verify-full from clean clone
   D1 Docker-compose smoke + signal-log replay parity
   D2 Documentation finale (clean-architecture.md, fsd.md, CONTRIBUTING.md, C4 diagrams)
   D3 CHANGELOG.md consolidated entry
   D4 PR back to main
```

**Total realistic single-agent effort: 3–5 months.**

A and B can run in parallel (independent surfaces). C is the long pole and depends only on A3 enforcement being in place. D is sequential at the end.

---

## 3. Phase A — Hygiene & enforcement (1–2 weeks)

### A0 — Baseline & critique acceptance
**Concrete work:**
- Commit this v3 plan.
- Capture baselines (Windows-portable):
  - `go build ./...` → exit code.
  - `golangci-lint run ./... > tools/archmetrics/baseline-lint.txt 2>&1` → issue count by linter.
  - `go test ./... -short -count=1` → pass/fail summary (committed to `tools/archmetrics/baseline-test.txt`; race goes nightly).
  - `cd web; npx tsc --noEmit > ../tools/archmetrics/baseline-tsc.txt 2>&1`.
  - `cd web; npm run lint -- --format json > ../tools/archmetrics/baseline-eslint.json 2>&1`.
  - `cd web; npm run build` → record `du web/dist` summary.
  - `go run ./tools/archmetrics > tools/archmetrics/baseline.json` (refresh; commit).
  - File count per `internal/*` and `web/src/*` directory → `tools/archmetrics/baseline-pkg-sizes.txt`.
- Author **ADR-010 — Repo Reorganization Mandate** (under `.github/ARCHITECTURE.md` as a new section): captures user intent verbatim, scope, non-scope, single-track sequence, definition of done. Phase A4 splits this into its own file.

**Done when:** baselines committed; ADR-010 committed; v3 plan committed.

### A1 — Root file hygiene
**Concrete work:**
- DELETE root binaries: `aigen.exe`, `aivet.exe`, `archmetrics.exe`, `automation-worker.exe`, `export-worker.exe`, `notification-worker.exe`, `pub-test-signal.exe`, `resubscribe.exe`, `slogen.exe`, `teslasync.exe`, `trace-coverage-audit.exe`. They are gitignored but locally present; remove.
- DELETE root test artifacts: `coverage.out`, `cover` (file), `coverage/` (dir), `test-results/` (dir contents). Verify none referenced by CI.
- AUDIT `tmp/` dir; either delete or relocate per `Makefile`/`tools` owner.
- MOVE → `docs/archive/`: `MERGE_READY.md`, `REDESIGN-NOTES.md`, `Dockerfile.README.md`.
- MOVE → `docs/architecture/`: `SIGNAL_TRACEABILITY_MATRIX.md`, `SIGNAL_TRACEABILITY_MATRIX.html` (verify VitePress serves `.html` or convert to embedded asset).
- MOVE → `db/seeds/`: `seed_comprehensive.sql`, `seed_snapshots.sql`. Reconcile with existing `db/seed.sql` + `db/seed_003.sql` + `db/seed_large.sql` (rename for clarity if collision).
- MOVE → `scripts/`: `publish_test.sh`.
- Update Makefile / CI / README references to moved paths.
- `.gitignore`: dedupe + harden patterns; add `/coverage`, `/test-results`, `/tmp` if not strict enough.

**Non-goal:** no top-level *directory* allowlist; directories stay.

**Done when:** root contains no stale binaries, no test artifacts, no orphan markdown; `go build ./...`, `make test`, `cd web; npm run build`, `make docker-up` all green.

### A2 — Tooling additions (no consolidation churn)
**Concrete work:**
- Add `.editorconfig` (utf-8, lf, 2-space, trim trailing ws, final newline).
- Document Prettier decision (use or skip — pick one explicitly in `docs/CONTRIBUTING.md`).
- `Makefile` additions:
  - `tidy` → `go mod tidy`.
  - `fmt` → `gofmt -s -w .` + `cd web; npm run lint -- --fix` (or equivalent).
  - `vet` → `go vet ./...`.
  - `web-typecheck` → `cd web; npx tsc --noEmit`.
  - `verify` (FAST gate per-slice) → `lint && vet && test -short && web-lint && web-typecheck`.
  - `verify-full` (BATCH gate) → `verify && test -race && arch-check && make ai-vet && make generate-check`.
  - `verify-smoke` (TRACK gate) → `verify-full && docker-up && replay fixture`.
  - Every target documented with `## comment` for `make help`.
- `.pre-commit-config.yaml`: verify it runs `gofmt`, `goimports`, `golangci-lint`, `npm run lint`, `npx tsc --noEmit`. Add any missing.
- Install `depguard` in `.golangci.yml` (rules added in A3; install the linter now).
- Install `eslint-plugin-boundaries` as devDep in `web/package.json` (rules added in B1).
- **DO NOT** consolidate `.eslintrc.cjs` + `eslint.config.js` (intentional FlatCompat).
- **DO NOT** flip `errcheck`, `no-explicit-any`, `exhaustive-deps`, `SA1019` enforcement. Out of scope.

**Done when:** `make verify` runs locally on a fresh clone; `pre-commit run --all-files` passes.

### A3 — Architecture enforcement RATCHET
**Concrete work:**

**A3.1 — Extend `tools/archmetrics` `forbiddenEdges`:**
```
internal/handler/*  → internal/database         (already partial; cement)
internal/handler/*  → internal/adapter/*
internal/handler/*  → internal/tesla, mqtt, redis, geocoding, …  (infra direct)
internal/app/*      → internal/handler/*         (use cases ≠ transport)
internal/app/*      → internal/api               (legacy isolation)
internal/domain/*   → internal/models            (domain ≠ DTOs)
internal/domain/*   → internal/port              (domain doesn't know its ports)
internal/models     → internal/database, internal/adapter/*, internal/handler/*
internal/port       → internal/adapter/*, internal/database
internal/adapter/*  → internal/handler/*, internal/app/*  (adapters never reach up)
cmd/*               → internal/api               (extend frozen list beyond just workers)
```
- Add per-package allowlist: legacy packages (e.g. `internal/api`, `internal/ai`) get their current violation count committed in `tools/archmetrics/violations-allowlist.json`. Net-new violations in any package fail CI.

**A3.2 — Mirror in `depguard`:**
- Add `depguard` rules in `.golangci.yml` mirroring the DAG. Same ratchet semantics via per-file/per-package excludes.

**A3.3 — Ratchet activation:**
- `make arch-check` is the CI gate; fails when:
  - any allowlisted package's count *grows*, OR
  - any clean package gets a new violation.
- Deliberately introduce a violation in a clean package → CI fails → revert → confirms ratchet works.
- Deliberately introduce a violation in `internal/api` above its allowlist → CI fails → revert → confirms allowlist works.

**Done when:** ratchet enforced; deliberate-violation tests pass (fail when expected); whole repo green under new rules.

### A4 — Docs MIRROR (preserve `.github` canonical for Copilot tooling)
**Concrete work:**
- Split `.github/ARCHITECTURE.md` (88KB) into `docs/architecture/adr/NNNN-title.md` per ADR (one file each, front-matter status/date/supersedes/deciders).
- Generate `docs/architecture/adr/README.md` index.
- `.github/ARCHITECTURE.md` becomes a redirect: "Canonical: `docs/architecture/`. Mirrored here for Copilot tooling." Copilot/agent tools continue to read it (mirror updated via `make docs-sync`).
- MIRROR `.github/instructions/*.md` to `docs/architecture/instructions/`. `.github/instructions/` stays canonical (Copilot custom_instructions uses it).
- Add `docs/architecture/clean-architecture.md` — canonical Go mapping with file pointers.
- Add `docs/architecture/fsd.md` — frontend FSD layer map with current dir → FSD layer mapping.
- Add `docs/CONTRIBUTING.md` — "first PR" runbook (clone → run → first endpoint).
- VitePress sidebar updated for ADRs.
- Add `make docs-sync` target that regenerates `.github/{ARCHITECTURE,instructions/*}.md` from `docs/architecture/`. CI fails on drift.

**Done when:** every ADR is a standalone file; `.github/ARCHITECTURE.md` is a regenerated mirror; `make docs-sync` passes; VitePress sidebar correct.

### A5 — Package audits (audit only; small folds; defer big ones)
**Concrete work:**

For each suspect, produce `docs/architecture/package-audits/<pkg>.md` (file count, public symbols, callers via `gopls references`, last commit date, recommendation):

| Package | Recommendation (probable) | Owner phase |
|---|---|---|
| `internal/tesla_pipeline` | KEEP. Refresh `doc.go` (remove Phase-42 reorg note). | A5 (do now) |
| `internal/service` (5 files) | Likely legacy; fold into `internal/app/*svc/` or delete per file. | A5 if simple; Cn if complex |
| `internal/enums` (6 files) | Verify it's the Tesla generated-enum home; check overlap with `internal/tesla/protomodel`. | A5 |
| `internal/units` (2 files) | Check overlap with `internal/tesla/units`. Likely merge. | A5 |
| `internal/notification` + `internal/notifier` + `internal/webpush` | Clean Arch shape: `notification/` = domain + svc, `notification/channels/{webpush,smtp,fcm}` = adapters implementing `notification.Channel` port. Migration is a substantive vertical slice. | C6 |
| `internal/handler/` top-level (30 files) vs `internal/handler/v1/` | Verify top-level is only `dto/` + `middleware/`. Flag any business handlers for relocation. | A5 |
| `internal/platform/` (37 files) | Verify each subpackage conforms to ADR-007 charter. | A5 |
| `internal/ai/` (394 files) | High-level audit only; no restructure. | A5 (audit), DEFER (restructure) |

Each audit ends with: KEEP / FOLD / SPLIT / DEFER + owner phase.

**Done when:** audits committed; small folds executed (e.g., `internal/units` → `internal/tesla/units` if overlap confirmed); deferred items have a named owner phase.

---

## 4. Phase B — Frontend FSD-lite enforcement (2–4 weeks)

### B1 — Install boundaries plugin; map current dirs → FSD layers (REPORT mode)
**Concrete work:**
- Add `eslint-plugin-boundaries` config (`web/.eslintrc.cjs` or new flat block):
  ```js
  settings: {
    'boundaries/elements': [
      { type: 'app',      pattern: 'src/{App,main,store/*}.{ts,tsx}' },
      { type: 'pages',    pattern: 'src/features/*/pages/**' },
      { type: 'widgets',  pattern: 'src/components/{vehicles,charts}/**' },  // composites
      { type: 'features', pattern: 'src/features/**',  capture: ['feature'] },
      { type: 'entities', pattern: 'src/entities/**',  capture: ['entity'] },
      { type: 'shared',   pattern: 'src/{components/{ui,layout,forms,feedback,motion,data-display,maps},hooks,lib,api,types,i18n}/**' },
      { type: 'generated', pattern: 'src/generated/**' },
    ],
  },
  rules: {
    'boundaries/element-types': ['warn', {  // start at warn
      default: 'disallow',
      rules: [
        { from: 'app',      allow: ['pages','widgets','features','entities','shared','generated'] },
        { from: 'pages',    allow: ['widgets','features','entities','shared','generated'] },
        { from: 'widgets',  allow: ['features','entities','shared','generated'] },
        { from: 'features', allow: ['entities','shared','generated'] },  // NO cross-feature
        { from: 'entities', allow: ['shared','generated'] },
        { from: 'shared',   allow: ['shared','generated'] },
        { from: 'generated', allow: ['generated'] },
      ],
    }],
    'boundaries/no-private': 'error',  // can't reach into another slice's internals
  },
  ```
- Run lint; commit the violation report to `web/cross-feature-imports.md`.

**Done when:** plugin loaded; report committed; CI doesn't fail yet (warn-mode).

### B2 — Audit + fix cross-feature imports
**Concrete work:**
- For each `features/<A>/*` → `features/<B>/*` in the report, choose: **promote to shared/**, **promote to widgets/**, **promote to entities/**, or **legitimate** (rare; add per-feature exception).
- Execute promotion. Update imports. Per touched feature: `npm run lint && npx tsc --noEmit && vitest run`.
- Flip the rule to `error` for each feature when its violations hit zero. Per-feature allowlist for legitimate exceptions.

**Done when:** zero unjustified cross-feature imports.

### B3 — Promote DRY patterns ≥3-replicas to shared
**Concrete work:**
- `grep` for repeated JSX/logic patterns across features.
- Per ≥3-replicas pattern: extract to `components/ui/`, `components/data-display/`, `hooks/`, or `lib/`. Add tests, i18n keys, replace call sites.

**Done when:** repeat-audit finds no ≥3-replicas of equivalent code.

### B4 — Add `web/src/entities/` for shared domain types
**Concrete work:**
- Create `web/src/entities/{vehicle,trip,charging,drive,energy,user,location,signal,notification}/` ONLY for entities appearing in ≥2 features.
- Each entity: `model.ts` (TS types matching `internal/models` JSON tags), `index.ts` (barrel). Optional `lib.ts` for entity-pure helpers.
- Migrate matching types out of `web/src/types/` and `features/*/types.ts`.
- Do NOT mass-move all types.

**Done when:** `entities/` populated with genuinely shared types; tsc clean; lint clean.

### B5 — Frontend SI cutover finish
**Concrete work:**
- Take the 346 legacy unit-suffixed identifiers from baseline.
- Classify each top-occurrence identifier:
  - **CONFIG (allowed per ADR Phase-48 carve-out)**: `costPerKwh`, `avgCostPerKwh`, `perKwh`, `mileageLimitMi` (user setting), etc. → LEAVE.
  - **DISPLAY-LAYER FORMATTING** (e.g., labels containing "kWh" string): LEAVE.
  - **API RESPONSE LEGACY** (e.g., FE reads `data.distanceMi` when backend now returns `distance_m`): FIX. Update FE to read SI field + convert at display via `useUnits()`/`useFormatting()`.
- Produce `web/si-cutover-audit.md` with per-identifier classification + action.
- Execute fixes. Verify each affected page renders correctly.

**Done when:** classification committed; all "FIX" identifiers fixed; remaining are documented as legitimate.

### B6 — Flip boundaries rule to error
**Concrete work:**
- After B2 zero cross-feature imports, flip `boundaries/element-types` from `warn` to `error`.
- Add `make web-lint-strict` Makefile target that runs ESLint with `--max-warnings 0`.
- CI gates on `make web-lint-strict`.

**Done when:** CI fails on any new cross-feature import.

---

## 5. Phase C — Backend `internal/api/` migration (8–16 weeks)

### C0 — Pilot slice (validate the recipe)
**Concrete work:**
- Pick the smallest, lowest-risk handler: 1–3 endpoints, no telemetry hot path, no SSE, no auth complexity. Candidate: a small admin/maintenance handler with no body parsing.
- Execute the full §6 recipe end-to-end.
- Record actual time, surprises, recipe revisions in `docs/architecture/migration-pilot-retrospective.md`.

**Done when:** one handler migrated; recipe refined; `make verify-full` passes.

### C1 — Read-only endpoint sweep
**Concrete work:**
- Identify every `internal/api/*_handler.go` that is GET-only, no DB writes, no external mutations.
- Migrate in batches of ~5 handlers per commit. Each commit ends green per §6 recipe.
- Target ~30–60 handlers migrated in this phase.

### C2 — Vehicles + state
Includes `vehicle_handler.go`, `vehicle_state_handler.go`, related. Vehicles is the core entity; many downstream features depend on it. Migrate carefully with explicit svc boundary.

### C3 — Drives + trips
Tightly coupled (trip = ordered series of drives). One batch. Includes `trips_detail_handler.go` (currently ADR-009 exception — decide: migrate or formalize the exception).

### C4 — Charging + sessions
Includes session telemetry; coordinate with `internal/tesla` package boundaries (no reach-up).

### C5 — Energy + analytics
All `energy_*`, `analytics_*`, signal-aggregation handlers. SI canonical fields throughout.

### C6 — Notifications + alerts + automation (includes notification trio consolidation from A5)
- `internal/notification` + `internal/notifier` + `internal/webpush` Clean Arch reshape:
  - `internal/domain/notification/` — Notification + Channel value objects + invariants.
  - `internal/port/notification/Channel` — port interface.
  - `internal/adapter/notification/{webpush,smtp,fcm}/` — channel adapters.
  - `internal/app/notificationsvc/` — use cases (already exists; extend).
  - `internal/handler/v1/notifications_handler.go` — HTTP handlers.
- Migrate alert handlers + automation handlers as separate sub-slices.

### C7 — Auth + user + settings + sharing + exports
Auth has Authentik ForwardAuth complexity; do NOT break middleware chain. Each handler migrated individually with auth-path regression test.

### C8 — Admin/observability EXCEPTION sweep
For each remaining `internal/api/*_handler.go` (admin/observability cluster — currently ADR-009 exceptions listed in the table at `.github/ARCHITECTURE.md:1264-1275`):
- Decision per file: MIGRATE to `handler/v1` + `app/*svc`, OR keep as ADR-009 exception with explicit rationale.
- Result: ADR-009 Exceptions table has the FINAL, justified list.

### C9 — Telemetry / SSE / remainder (carefully)
Highest-risk handlers. Coordinate with `internal/tesla` and `internal/signal` packages. Per-handler trace-coverage verification.

### C10 — Finalization
- ADR-009 Exceptions table reflects final shape.
- Author **ADR-011 — Clean Architecture: handler/v1 + app/*svc + adapter/* is canonical**. Status: SUPERSEDES (in spirit) ADR-009; keeps ADR-009 as historical record of the freeze.
- Refresh `tools/archmetrics`: remove `internal/api` from `frozenPackages` (no longer growing); add `internal/handler/v1`, `internal/app/*svc` to a canonical-must-not-shrink list.
- Update Copilot custom instructions (`.github/copilot-instructions.md` or equivalent) to reflect post-reorg reality.

**Done when:** `internal/api/` contains only documented exceptions + router/composition; ADR-011 committed; archmetrics post-baseline reflects new world.

---

## 6. The migration recipe (used by every C-phase slice)

For each handler file `internal/api/<name>_handler.go`:

1. **Snapshot the contract.** Hit every endpoint of the handler against the dev DB (or replay fixture). Save JSON responses to `tools/migration-snapshots/<name>-pre.json`.
2. **Identify domain entity.** Find or create `internal/domain/<entity>/types.go`.
3. **Identify ports.** For each external dep (repo, external API, MQ), define a small interface at the svc consumer point. Live in `internal/port/<domain>/` if shared; otherwise local to the svc file.
4. **Wire the adapter.** Existing `internal/database/<entity>_repo.go` stays put; confirm it satisfies the port.
5. **Create the use case.** `internal/app/<entity>svc/service.go` (extend existing svc when possible). Constructor takes ports; methods implement business rules; returns domain types.
6. **Create the handler.** `internal/handler/v1/<name>_handler.go`. Dumb: parse → call svc → write DTO. Uses `internal/handler/helpers.go` patterns.
7. **Define DTOs.** Request/response in `internal/handler/dto/<name>.go` with `FromDomain`/`ToDomain`.
8. **Tests.** Handler test (stub svc), svc test (stub ports), repo test stays where it is.
9. **Wire the router.** Update `internal/api/router.go` to mount the new handler. Keep old route mounting commented for one commit, then delete.
10. **Delete the old handler.** `git rm internal/api/<name>_handler.go internal/api/<name>_handler_test.go`.
11. **Snapshot again.** Save `<name>-post.json`. Diff. ANY diff requires explicit justification or fix.
12. **Frontend hook smoke.** Identify `web/src/api/hooks/use<X>.ts` matching the endpoint. Run its component tests; manual smoke if needed.
13. **OpenAPI diff.** Regenerate the spec; commit + review.
14. **Archmetrics refresh.** `make arch-baseline`. The `internal/api` count MUST decrease by exactly N (= files deleted).
15. **ADR-009 Exceptions table.** If the migrated handler was an exception, remove the row.

---

## 7. Phase D — Final verification & handoff (1 week)

### D0 — Full `make verify-full` from clean clone
- Fresh `git clone`. Install. Run `make verify-full`. All green.

### D1 — Docker-compose smoke + signal-log replay parity
- `make docker-up`. Wait for healthy. Replay a known signal_log fixture. Compare numeric outputs against pre-reorg baseline. Tolerance: zero diff on canonical fields.

### D2 — Documentation finale
- `docs/architecture/clean-architecture.md` — final canonical map.
- `docs/architecture/fsd.md` — final FSD layer map.
- `docs/CONTRIBUTING.md` — "where do I add an endpoint" walkthrough validated by simulating a new contributor.
- `docs/architecture/diagrams/` — C4 diagrams (System Context, Container, Component per bounded context: vehicle, drive, charging, energy, notification, automation, admin).
- `README.md` — top-level rewrite for new layout.

### D3 — CHANGELOG.md consolidated entry
One entry summarizing the reorg, linking to ADR-010 (mandate) + ADR-011 (destination).

### D4 — PR back to main
Phase-by-phase walkthrough in description; reviewer checklist matching DoD.

---

## 8. Definition of Done

**Code-level (mechanical):**
- [ ] Root contains no stale binaries, coverage artifacts, or orphan markdown.
- [ ] All ADRs live under `docs/architecture/adr/`; `.github/ARCHITECTURE.md` is a regenerated mirror.
- [ ] `tools/archmetrics` enforces the Clean Arch DAG with per-package ratchet.
- [ ] `depguard` in `.golangci.yml` mirrors the DAG.
- [ ] `eslint-plugin-boundaries` enforces FSD DAG with current dir mapping at error level.
- [ ] Zero unjustified cross-feature imports in `web/src/features/`.
- [ ] `web/src/entities/` exists and holds genuinely shared types (≥2 features).
- [ ] `internal/handler/v1/` is the canonical handler home for all business handlers.
- [ ] `internal/api/` contains ONLY documented ADR-009 admin exceptions + router/composition.
- [ ] ADR-011 (Clean Arch destination) authored; ADR-009 Exceptions table is final + justified.
- [ ] Frontend SI cutover audit complete; all legitimate identifiers documented.

**Behavioural (the hard gates):**
- [ ] Per-route pre/post snapshot diffs reviewed; any diff justified.
- [ ] OpenAPI spec diffed and reviewed.
- [ ] Frontend bundle size delta ≤ ±5%.
- [ ] `make verify-full` passes from a fresh clone.
- [ ] `make docker-up` from fresh clone → all services healthy → replay fixture → numeric parity.
- [ ] Trace-coverage audit (`cmd/trace-coverage-audit`) still green for all 11 flows.
- [ ] No public route removed without explicit changelog entry.

**Documentation:**
- [ ] `docs/architecture/clean-architecture.md` final.
- [ ] `docs/architecture/fsd.md` final.
- [ ] `docs/CONTRIBUTING.md` includes "where do I add an endpoint" walkthrough.
- [ ] `CHANGELOG.md` has one consolidated reorg entry.

**Explicitly NOT in DoD (per critique):**
- ❌ `internal/api/` does not exist (admin exceptions stay).
- ❌ `internal/database/` does not exist (kept as repo layer per ADR-006).
- ❌ `errcheck`/`gocyclo`/`funlen`/`no-explicit-any` flipped to error (separate quality project).
- ❌ AI subsystem restructured (own project).

---

## 9. Out of scope (explicit)

- AI subsystem reorg (394 files, ADR-015 owned).
- `internal/database` → `internal/adapter/postgres` physical rename.
- Strict-lint cascade (errcheck/gocyclo/no-any flip).
- Telemetry pipeline restructure / `tesla_pipeline` package rename.
- Tesla vendored proto.
- `internal/signal/` layering changes.
- FSM design.
- Database schema changes (except seed file relocation).
- New frameworks (no gRPC, microservices, event sourcing).
- Renaming `web/src/features/` to canonical FSD names.

---

## 10. Risk register

| Risk | L | I | Mitigation |
|---|---|---|---|
| Phase A3 ratchet too tight; blocks legitimate work | M | M | Per-legacy-package allowlist with current count; promote to "clean" only when truly clean. |
| Cross-feature import cleanup uncovers structural defects | M | M | Each defect handled as a Track C candidate slice OR documented architecture decision; not a side quest. |
| Snapshot diffs flake on timestamp/ID fields | M | L | Snapshot helper redacts known volatile fields. |
| `gopls` cannot resolve some references during audits | L | M | Fallback: ripgrep + manual review. |
| Branch lives long enough to drift from main | H | M | Weekly rebase against main. |
| Per-slice verification gates make work slow | M | M | Tiered: per-slice = lint+type+changed-pkg test; per-batch = `verify-full`; per-track = `verify-smoke`. |
| Documentation moves break Copilot tooling | L | L | A4 MIRRORS, does not invert. `.github/` stays canonical for agent tools. |
| `refactor/signals-rewrite` rises from the dead | L | L | Branch is historical (its work is squashed onto main). Verify with `git log --oneline main...refactor/signals-rewrite` before deletion; delete after audit. |
| Notification trio (A5) consolidation has hidden coupling | M | M | C6 batch carries its own pre-flight: trace every notification path before refactoring. |
| Admin/observability exceptions creep | M | L | C8 sweep makes per-file decisions explicit; ADR-009 Exceptions table is the audit log. |
| C9 telemetry/SSE migration breaks live signals | L | H | C9 is LAST. Per-handler trace-coverage verification. Replay fixture against post-state. |

---

## 11. Effort estimate (single agent)

- A0–A5: **1–2 weeks**
- B1–B6: **2–4 weeks**
- C0 (pilot): **2–3 days**
- C1 (read-only sweep, ~40 handlers): **2 weeks**
- C2–C7 (per batch ~30–50 handlers): **1.5–2 weeks each = 9–12 weeks**
- C8 (exception sweep): **3–5 days**
- C9 (telemetry/SSE remainder): **1–2 weeks** (high care)
- C10 (finalization): **3–5 days**
- D0–D4: **1 week**

**Total realistic: 3.5–5.5 months single-agent**, matching user's "weeks or months" tolerance.

A and B parallel-able → saves ~2–4 weeks on the calendar wall-clock.

---

## 12. Status log

| Date | Phase | Status | Notes |
|---|---|---|---|
| 2026-05-27 | plan v1 | drafted | 20-phase mega-plan; rubber-duck found 3 BLOCKERs. |
| 2026-05-27 | plan v2 | drafted | 3-track Phase-48-coordination shape; user obsoleted with "phase-48 is done". |
| 2026-05-27 | plan v3 | drafted | This document. Single-sequence A→B→C→D, Phase-48-done world. Awaiting user approval. |
