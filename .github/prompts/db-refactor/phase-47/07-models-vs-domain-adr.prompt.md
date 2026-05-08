# Phase-47 / Prompt 07 — ADR-006: models vs domain charter

## Why

`internal/models/` (33 .go files) and `internal/domain/` (33 .go files,
seven bounded-context subpackages) co-exist with no charter. Today the
practical split is "models = whatever existed before, domain = whatever
the hexagonal migration added," and the boundary is invisible to
contributors. This is the second-most-cited PA finding (after the
api/handler split addressed in ADR-009).

Common symptoms:

- `internal/models.Vehicle` and `internal/domain/vehicle.Vehicle` both
  exist or risk emerging — when?
- Repos under `internal/database/` return `models.X` types; use-cases
  under `internal/app/<name>svc` need pure entities → today they convert
  on every call (or skip the conversion and leak persistence concerns).
- New contributors flip a coin.

This prompt records **ADR-006** with an explicit charter:

- **`internal/models`** = persistence DTOs + API request/response DTOs.
  EVERY exported field of every exported struct MUST carry at least one
  of `db:"..."` or `json:"..."`. May NOT import internal/database,
  internal/adapter/*, internal/api, internal/handler/*, internal/app/*,
  or internal/port/*. MAY import internal/domain/* for ToDomain() /
  FromDomain() conversion methods. Methods limited to simple validators
  + conversion.

- **`internal/domain/<bounded-context>`** = business entities + value
  objects + invariants. May depend ONLY on stdlib + other
  `internal/domain/*` subpackages. Today's domain types DO carry
  `db:`/`json:` tags (legacy from pre-charter migration); the charter
  permits but does not require tags. The HARD enforcement is the
  IMPORT BOUNDARY, not the tag presence. New types should minimize
  tags when feasible, but tag-bearing domain types are not violations.

Conversion happens at the boundary (typically in `internal/app/<name>svc`
or `internal/adapter/postgres/<name>_repo.go`).

This prompt **does not move any existing type** — it records the rule and
adds arch_test enforcement. Specific type migrations are tracked
separately as bug-finds, not phase-47 work.

## Evidence

```powershell
PS> Get-ChildItem internal/models -Filter *.go | Measure-Object
Count: 33
PS> Get-ChildItem internal/domain -Directory | Select-Object -ExpandProperty Name
charging
export
fsm
notification
trip
user
vehicle
PS> Get-ChildItem -Recurse internal/domain -Filter *.go | Measure-Object
Count: 33

PS> Select-String -Path internal/models/*.go -Pattern '`db:|`json:' | Measure-Object
(many — confirms models DOES carry struct tags today)

PS> Select-String -Path internal/domain/**/*.go -Pattern '`db:|`json:'
(few/none — confirms domain DOES NOT carry struct tags today)
```

The charter described above ALIGNS with current practice — this ADR
codifies what most contributors already do, makes it enforceable, and
resolves ambiguity for new types.

## Design

### Step 1 — Append ADR-006 to `.github/ARCHITECTURE.md`

```markdown
## ADR-006: Models vs Domain Charter

```
STATUS: APPROVED (PA, phase-47/07)
DATE: <YYYY-MM-DD set on execution>
SUPERSEDES: implicit "use whichever package you find first"

DECISION:

  internal/models/    = persistence + transport DTOs
                        - Every exported field of every exported struct
                          carries `db:"..."` or `json:"..."` (or both).
                          arch_test enforces.
                        - Pointer fields for nullable columns.
                        - Methods limited to ToDomain() / FromDomain() and
                          simple validators.
                        - Imports: stdlib + time + (allowed exception)
                          internal/domain types referenced via
                          ToDomain/FromDomain.
                        - May NOT import internal/database,
                          internal/adapter/*, internal/api,
                          internal/handler/*, internal/app/*, or
                          internal/port/*. arch_test enforces.

  internal/domain/<X>/= business entities + value objects + invariants
                        - Imports: stdlib + other internal/domain/*
                          subpackages (including the parent internal/domain
                          package) ONLY. arch_test enforces.
                        - May NOT import internal/models, internal/database,
                          internal/adapter/*, internal/api,
                          internal/handler/*, internal/app/*, internal/port/*.
                        - Rich methods enforcing invariants permitted.
                        - MAY carry `db:"..."` / `json:"..."` tags
                          (today's types do; this is grandfathered).
                          Tags are NOT prohibited; the rule is the
                          IMPORT boundary, not tag presence. Future
                          types should minimize tags when feasible.

CONVERSION POLICY:
  - Repos in internal/adapter/postgres or internal/database return
    models.X by default. The matching internal/app/<name>svc method calls
    models.X.ToDomain() before applying business logic.
  - HTTP handlers under internal/handler/v1 accept request DTOs from
    internal/handler/dto and convert via dto → domain.

RATIONALE:
  - Today's practice was undocumented; this ADR codifies what is
    actually safe to enforce: the import boundary. Domain stays
    portable (no DB or HTTP coupling); models stays persistence-aware.
  - Persistence-first refactors (TimescaleDB column changes) touch
    models; business-rule changes touch domain.
  - The "domain MAY have tags" relaxation is honest: most domain
    types under internal/domain/<X>/types.go currently carry json/db
    tags (legacy from pre-charter migration). Mass-stripping them is
    out of scope for this prompt. The arch_test enforces the rule we
    can defend today (imports), not the rule we'd like to defend
    eventually (no tags in domain).

EXCEPTIONS:
  - Legacy types under internal/api/* (FROZEN per ADR-009) often blur
    the line. They are grandfathered until the per-endpoint migration
    moves them. arch_test does NOT enforce the charter on internal/api.
  - The vendored Tesla proto (api/proto/tesla/) carries upstream-named
    identifiers that violate Phase-48 SI canonical naming (e.g. proto
    field 256 `ChargeRateMilePerHour` whose wire content is actually
    meters of range added per hour). The proto identifier MUST stay
    verbatim (it is upstream-owned) and the misnomer is documented via
    SignalMeta.UnitKind + the JSON wire field name + the
    TestRangeAddedMetersPerHour_R2_AuditPin invariant. arch_test MUST
    NOT flag identifiers under internal/tesla/protomodel/ or the
    routing.yaml Field: lines as imperial-name violations.

PHASE-48 SI CANONICAL HARD RULE:
  All numeric fields in internal/models/, internal/domain/<X>/,
  internal/handler/dto/, internal/app/<X>svc/, and internal/adapter/
  postgres/ MUST use SI units: meters (not miles), m/s (not mph),
  Wh (not kWh), Pa (not psi/bar), °C (not °F). Field name suffixes
  must reflect the unit (M for meters, MS for m/s, Wh for watt-hours,
  Pa for pascals, C for celsius). User-setting fields that are
  configuration not measurement (e.g. BaseCostPerKWh, cooldown_min,
  value_min, dwell_minutes) are explicitly allowed to keep human-
  readable units. See:
  .github/prompts/db-refactor/phase-48-si-canonical/0000-methodology.prompt.md

ROLLBACK:
  - If maintaining two parallel hierarchies proves too costly, propose a
    superseding ADR with a clear merge plan. Do not silently merge.
```
```

### Step 2 — Add 3 charter tests to `internal/arch/arch_test.go`

Add these tests with FULL working Go bodies (not stubs):

- `TestDomainPurity` — uses `packages.Load("./internal/domain/...")`;
  for every target import that is `internal/...` AND not
  `internal/domain` AND not `internal/domain/...`, fail. Allowed
  exceptions: stdlib (already filtered out by `!HasPrefix(rel,
  "internal/")`) and `internal/domain` (parent package, used by
  validation.go in subpackages).

- `TestModelsHaveStructTags` — walks `../models/*.go` (excluding
  `_test.go`), parses each file with `go/parser`, finds every exported
  struct via `ast.TypeSpec` whose name is exported. For every field
  with at least one exported name, requires `field.Tag` to be non-nil
  AND its raw value to contain `db:` OR `json:`. Embedded fields (no
  names) and fields with only unexported names are skipped. Failure
  message cites file path + type name + field name.

- `TestModelsImportsRestricted` — uses `packages.Load("./internal/models")`;
  for every direct import, strips the module prefix and fails if it
  matches any of `internal/database`, `internal/adapter/...`,
  `internal/api`, `internal/handler/...`, `internal/app/...`, or
  `internal/port/...`. `internal/domain/*` imports are explicitly
  allowed (for ToDomain helpers).

These tests are real Go — implement to a working state, not stubs.
The forbidden-imports list above is the canonical one.

### Step 3 — Update `internal/models/doc.go`

```go
// Package models defines persistence and transport DTOs for TeslaSync.
//
// Layer: domain
//
// Per ADR-006:
//   - Every struct field carries a `db:"..."` or `json:"..."` tag.
//   - Pointer fields represent nullable columns.
//   - Methods are limited to ToDomain() / FromDomain() and validators.
//   - Pure-business invariants and rich methods belong in
//     internal/domain/<bounded-context>, not here.
//
// Conversion to domain types lives at the use-case boundary:
//   models.Vehicle.ToDomain() → domain/vehicle.Vehicle
package models
```

### Step 4 — Update each `internal/domain/<X>/doc.go`

Append a charter line to each (charging, export, fsm, notification, trip,
user, vehicle):

```go
// Per ADR-006: this package contains pure entities and invariants only.
// No struct tags, no DB or HTTP imports. Conversion to/from persistence
// types happens in internal/app/<name>svc.
```

### Step 5 — Update `internal/arch/rules.go`

Add a third advisory→fail entry for models→database (already partially
covered by the existing layering rule), and add explicit
`DomainAllowedImports` and `ModelsForbiddenImports` sets used by the new
tests.

```go
var DomainAllowedImports = []string{
	"internal/domain", // and any subpackage
}

var ModelsForbiddenImports = []string{
	"internal/database",
	"internal/adapter",
	"internal/api",
	"internal/handler",
	"internal/app",
	"internal/port",
}
```

### Step 6 — Document conversion examples in `docs/architecture/models-vs-domain.md`

Create a short reference (200–300 words) with two worked examples:

```markdown
# models vs domain — quick reference

Per ADR-006:

## Persistence DTO (models)

```go
// internal/models/vehicle.go
type Vehicle struct {
    ID          int64     `json:"id" db:"id"`
    DisplayName string    `json:"display_name" db:"display_name"`
    BatteryKwh  *float64  `json:"battery_kwh,omitempty" db:"battery_kwh"`
}

func (v Vehicle) ToDomain() vehicle.Vehicle {
    return vehicle.Vehicle{ /* ... */ }
}
```

## Domain entity (domain)

```go
// internal/domain/vehicle/vehicle.go
type Vehicle struct {
    id          int64
    displayName string
    batteryKwh  float64 // domain rejects nil — use Option semantics if needed
}

func (v Vehicle) IsBatteryUsable() bool { return v.batteryKwh > 5.0 }
```

## Use-case boundary

```go
// internal/app/vehiclesvc/get.go
func (s *Service) Get(ctx context.Context, id int64) (vehicle.Vehicle, error) {
    row, err := s.repo.Vehicle(ctx, id)
    if err != nil { return vehicle.Vehicle{}, err }
    return row.ToDomain(), nil
}
```
```

## Verification

```
1. ARCHITECTURE.md must contain "## ADR-006:" — grep verifies.
2. internal/models/doc.go must reference ADR-006 — grep verifies.
3. Each internal/domain/<X>/doc.go must reference ADR-006 — grep
   verifies all 7 subpackages.
4. go test -v ./internal/arch/... — TestDomainPurity, TestModelsHaveStructTags,
   TestModelsImportsRestricted MUST PASS.
5. Negative tests:
   a) Add `import _ "github.com/.../internal/database"` to
      internal/domain/vehicle/vehicle.go.
      go test -run TestDomainPurity ./internal/arch/...
      → MUST FAIL citing "domain purity violation".
      Revert.
   b) Add a struct without tags to internal/models/zzz_phase47.go:
      `type Sentinel struct { Name string }`
      go test -run TestModelsHaveStructTags ./internal/arch/...
      → MUST FAIL citing the struct.
      Remove file.
   c) Add `import _ "github.com/.../internal/database"` to
      internal/models/vehicle.go.
      go test -run TestModelsImportsRestricted ./internal/arch/...
      → MUST FAIL citing the forbidden import.
      Revert.
6. Refresh baseline.
```

## Files touched

```
ADDED:
  docs/architecture/models-vs-domain.md

MODIFIED:
  .github/ARCHITECTURE.md                    (+ ADR-006 section)
  internal/models/doc.go                     (+ ADR-006 charter)
  internal/domain/charging/doc.go            (+ ADR-006 reference)
  internal/domain/export/doc.go              (+ ADR-006 reference)
  internal/domain/fsm/doc.go                 (+ ADR-006 reference)
  internal/domain/notification/doc.go        (+ ADR-006 reference)
  internal/domain/trip/doc.go                (+ ADR-006 reference)
  internal/domain/user/doc.go                (+ ADR-006 reference)
  internal/domain/vehicle/doc.go             (+ ADR-006 reference)
  internal/arch/rules.go                     (+ DomainAllowedImports / ModelsForbiddenImports)
  internal/arch/arch_test.go                 (+ 3 test functions)
  tools/archmetrics/baseline.json            (refresh)
  tools/archmetrics/baseline.md              (refresh)

DELETED:
  (none)
```

## Out of scope

- **Moving any existing type from models → domain or vice versa** — the
  ADR establishes the rule; concrete migrations happen ad-hoc as bugs
  surface.
- Splitting `internal/models` further (per-table subdirs, etc.).
- Renaming any existing type.
- Touching `internal/api` (FROZEN; charter not enforced there).
- Anything under `internal/telemetry/`, `internal/tesla/`,
  `internal/signal/` (active phase-42).

---

## Honesty Covenant

```
<!-- BEGIN: HONESTY_COVENANT (verbatim, do not modify) -->
1. No red-as-green     — all 3 new tests pass; all 3 negative tests fail as described.
2. No scope narrowing  — every domain/<X>/doc.go gets the ADR-006 reference (7 subpackages).
3. No skip-and-assume  — paste output of negative tests showing the failure messages.
4. No field resurrection — N/A.
5. No stubs            — TestDomainPurity etc. must contain real assertions, not panic("TODO").
6. No delegation       — execute yourself.
7. No predecessor bypass — depends on prompts 01, 02, 03.
8. No commit on red    — Gate must be GREEN.
9. No silent drift     — if domain/* OR models/* fails the new tests today, FIX the violation as part of this prompt and document it; do not exempt.
10. Log MUST contain EXIT + STATUS lines.
<!-- END: HONESTY_COVENANT -->
```

## Artifact Metadata

| Field | Value |
|-------|-------|
| Phase | 47 |
| Prompt | 07 |
| Slug | models-vs-domain-adr |
| Branch | `phase-47-prompt-07-models-vs-domain-adr` (executed on `refactor/signals-rewrite` per phase-47 same-branch policy) |
| Log | `.github/prompts/db-refactor/logs/phase-47-07-models-vs-domain-adr.log` |
| Risk | LOW (audit confirmed: 0 models structs missing tags, 0 models forbidden imports, 0 domain non-permitted internal imports — all 3 tests pass against today's tree) |
| Backend touched | NO production .go files; only doc + arch_test |
| Frontend touched | NO |
| Migration | NO |
| Env var added | NO |
| Depends on | prompts 01, 02, 03 |

## Logging Requirements

Every gate section uses `Tee-Object -FilePath $log -Append`. Final log
ends with `EXIT=<int>` + `STATUS=<DONE|BLOCKED>`.

## Gate

```powershell
cd D:\repos\teslasync
$log = ".github\prompts\db-refactor\logs\phase-47-07-models-vs-domain-adr.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"=== PHASE-47 / 07 models-vs-domain-adr — $(Get-Date -Format o) ===" | Tee-Object -FilePath $log

"=== STEP 1: ADR_006 ===" | Tee-Object -FilePath $log -Append
$adr = Select-String -Path .github/ARCHITECTURE.md -Pattern "^## ADR-006:"
if ($adr.Count -lt 1) { "FAIL"; "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1 }

"=== STEP 2: DOMAIN_DOC_GO_REFS ===" | Tee-Object -FilePath $log -Append
$domains = "charging","export","fsm","notification","trip","user","vehicle"
$missing = @()
foreach ($d in $domains) {
  $hit = Select-String -Path "internal/domain/$d/doc.go" -Pattern "ADR-006" -ErrorAction SilentlyContinue
  if (-not $hit) { $missing += $d }
}
if ($missing.Count -gt 0) {
  "FAIL: domain subpackages missing ADR-006 reference: $($missing -join ',')" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append
  "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append
  exit 1
}

"=== STEP 3: ARCH_TEST ===" | Tee-Object -FilePath $log -Append
go test -v ./internal/arch/... 2>&1 | Tee-Object -FilePath $log -Append
$exit = $LASTEXITCODE
if ($exit -ne 0) { "EXIT=$exit" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit $exit }

"=== STEP 4: NEGATIVE_DOMAIN_PURITY ===" | Tee-Object -FilePath $log -Append
$f = "internal/domain/vehicle/zzz_phase47.go"
"package vehicle`nimport _ `"github.com/ev-dev-labs/teslasync/internal/database`"" | Out-File -Encoding UTF8 $f
$out = go test -run TestDomainPurity ./internal/arch/... 2>&1
$out | Tee-Object -FilePath $log -Append
$exit = $LASTEXITCODE
Remove-Item $f -Force
if ($exit -eq 0) {
  "FAIL: TestDomainPurity did not detect injected import" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append
  "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append
  exit 1
}

"=== STEP 5: NEGATIVE_MODELS_TAGS ===" | Tee-Object -FilePath $log -Append
$f = "internal/models/zzz_phase47.go"
"package models`ntype Sentinel struct { Name string }" | Out-File -Encoding UTF8 $f
$out = go test -run TestModelsHaveStructTags ./internal/arch/... 2>&1
$out | Tee-Object -FilePath $log -Append
$exit = $LASTEXITCODE
Remove-Item $f -Force
if ($exit -eq 0) {
  "FAIL: TestModelsHaveStructTags did not detect untagged struct" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append
  "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append
  exit 1
}

"=== STEP 6: REFRESH_BASELINE ===" | Tee-Object -FilePath $log -Append
go run ./tools/archmetrics > tools/archmetrics/baseline.json 2>&1
go run ./tools/archmetrics -report > tools/archmetrics/baseline.md 2>&1

"=== STEP 7: GIT_STATUS ===" | Tee-Object -FilePath $log -Append
$status = git status --porcelain
$status | Tee-Object -FilePath $log -Append
$allowed = '^\s*[AM\?]+\s+(\.github/ARCHITECTURE\.md|internal/(models|domain/.+)/doc\.go|internal/arch/(rules|arch_test)\.go|docs/architecture/models-vs-domain\.md|tools/archmetrics/baseline\.(json|md)|\.github/prompts/db-refactor/(logs/phase-47-07.*|phase-47/07-models-vs-domain-adr\.prompt\.md))$'
$violations = $status | Where-Object { $_ -and ($_ -notmatch $allowed) }
if ($violations) {
  "FAIL: unexpected files in git status" | Tee-Object -FilePath $log -Append
  $violations | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append
  "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append
  exit 1
}

"EXIT=0" | Tee-Object -FilePath $log -Append
"STATUS=DONE" | Tee-Object -FilePath $log -Append
```

## Commit

```
docs(arch): ADR-006 — models = DTOs, domain = pure entities (phase-47/07)

Records the charter:
  internal/models/    — persistence + transport DTOs (struct tags allowed/required)
  internal/domain/<X> — pure business entities (no tags, no DB/HTTP imports)

Conversion happens in internal/app/<name>svc at the use-case boundary.
internal/api is grandfathered (FROZEN per ADR-009).

Adds enforcement via 3 new arch_test functions:
  TestDomainPurity            — domain may import only stdlib + internal/domain/*
  TestModelsHaveStructTags    — every exported struct field carries db: or json:
  TestModelsImportsRestricted — models may not import database/adapter/api/handler/app/port

Adds docs/architecture/models-vs-domain.md with worked examples.

This prompt records the rule; does NOT migrate any existing types.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```
