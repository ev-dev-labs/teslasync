# Phase-47 / Prompt 99 — Execution gate (acceptance contract)

> Read this in full before executing any prompt 01–10 in
> `.github/prompts/db-refactor/phase-47/`. The numbered prompts are
> self-contained, but this file is the **single source of truth** for
> cross-prompt dependencies, anti-patterns, sequencing relative to
> phase-42, and the phase-completion checklist.
>
> Phase-47 is **backend architecture hygiene** — it has zero frontend
> changes, zero env-var changes, zero helm/docker changes, zero
> migrations. Every prompt is either pure-additive instrumentation
> (01–03) or constrained refactors with no behavioural change (04–05)
> or ADRs + arch_test rules (06–10).
>
> **Phase-47 implements the 7-finding remediation plan from the
> Principal Architect critique:** main.go bloat, api/handler split,
> models/domain duplication, platform junk drawer, worker→api inversion,
> no arch enforcement, partial doc.go adoption.

---

## §1 — Ground rules

1. **Forward-only.** Execute prompts in numerical order unless §5 says
   otherwise.
2. **One prompt per branch.** Branch name:
   `phase-47-prompt-NN-<short-name>`.
3. **No cross-prompt edits.** A prompt's allowed-files list is
   exhaustive. If you need to touch a file outside the list, the prompt
   is wrong — STOP and update the prompt before touching the file.
4. **No code execution in prompt authoring.** This phase was authored
   without running any code. The Gate scripts are for executors.
5. **Verify metrics before claiming success.** `tools/archmetrics`
   exists for exactly this — paste its before/after numbers.
6. **Honesty Covenant is mandatory.** Every prompt embeds the covenant
   verbatim. Do not weaken individual rules to make a gate pass.

---

## §2 — Pre-flight (run once before phase-47 begins)

```powershell
cd D:\repos\teslasync
git fetch origin
git checkout main
git pull --ff-only

# Sanity
go version          # expect go 1.25
node --version      # not used by phase-47, but baseline check

# CRITICAL: phase-42 (Tesla telemetry rewrite) and phase-48 (SI canonical
# mega-PR) have BOTH landed. All prompts 01–10 may execute sequentially
# without coordination gates.
#
# CAUTION: the historical phase-42/9999 grep below will return commits
# from a long-since-merged tag and is kept only as a sanity check.
git --no-pager log --oneline --grep="phase-42/9999" | Select-Object -First 1
# Confirm phase-48 SI canonical mega-PR is on the current branch (must
# be present, otherwise prompts 06 + 07 ADR text references would predate
# the SI cutover and risk codifying legacy field names):
git --no-pager log --oneline --grep="Phase-48 SI Canonical Mega-PR" | Select-Object -First 1
# If the phase-48 grep returns nothing, STOP. Re-read prompts 06 + 07
# Evidence sections — the hexagonal subsystem (handler/v1 + app/*svc +
# domain/* + adapter/postgres) was renamed end-to-end by phase-48 and
# all ADR text that says "DistanceMiles", "EnergyUsedKWh", "MaxSpeedMph"
# etc. must be reviewed against the post-SI struct definitions before
# the ADR is committed. See:
#   .github/prompts/db-refactor/phase-48-si-canonical/0000-methodology.prompt.md

# Confirm no phase-47 branches yet
git --no-pager branch -a | Select-String "phase-47"
```

If phase-42 has merged, the full phase-47 sequence is unblocked.

> **2026-05-08 update — drift evidence:** phase-47 was authored 2026-05-04
> but no prompts have yet executed. In the 4 days since authoring, the
> architecture has DRIFTED in the wrong direction (internal/api: 223 → 289
> files, +30%; cmd/teslasync/main.go: 726 → 1022 lines, +41%; the worker
> → internal/api inversion is unfixed). Phase-42 + phase-48 both landed
> in this window without arch_test guards in place to push back. This
> drift is **the strongest possible argument FOR executing phase-47** —
> prompts 02 (arch_test foundation), 04 (slim main.go), 05 (worker
> decoupling), and 09–10 (port/adapter rules + handler thinness) would
> have caught every line of the drift.

---

## §3 — DO NOT (anti-patterns specific to phase-47)

```
❌ Do NOT migrate any internal/api/*.go file to internal/handler/v1/.
   Per ADR-005 (prompt 06), this is phase-48+ work. Phase-47 only
   declares the rule.

❌ Do NOT delete any deprecated alias in internal/api/ created by
   prompt 05. Removal is phase-48 work.

❌ Do NOT widen AdvisorySources to silence a violation. The whole point
   of a rule is to surface the violation; if you can't fix it, add an
   AllowedException with a real Until: target.

❌ Do NOT add a new file under internal/api/ for any reason after
   prompt 06 lands. arch_test will FAIL the build.

❌ Do NOT add a new directory under internal/platform/ without an
   ADR-007 amendment AND an AllowedPlatformSubpackages update in the
   same commit.

❌ Do NOT touch anything under internal/telemetry/, internal/tesla/,
   internal/signal/. These are phase-42 territory; phase-47 prompts
   that overlap (e.g. prompt 03 doc.go coverage) treat them as append-only.

❌ Do NOT add new env vars in any phase-47 prompt. None are needed.

❌ Do NOT modify Helm/docker-compose/Dockerfile beyond the single
   ldflags path change in prompt 04.

❌ Do NOT skip the regression negative tests in prompts 02, 03, 06,
   07, 08, 09, 10. They are how we verify the enforcement works.
```

---

## §4 — Migrations

**Phase-47 introduces ZERO database migrations.**

If a prompt appears to need a migration, it has been mis-authored —
STOP and revisit the design.

---

## §5 — Dependency map

```
01-baseline-metrics         (root; pure additive)
02-arch-test-foundation     ← 01 (TestBaselineHonoured uses baseline.json)
03-package-doc-conventions  ← 01, 02 (extends arch_test.go)
04-app-server-extraction    ← 01, 02, 03; HARD-after phase-42 9999-final-gate
05-worker-api-decoupling    ← 01, 02, 03; soft-after 04
06-handler-canonical-adr    ← 01, 02, 03; HARD-after phase-42 9999-final-gate
07-models-vs-domain-adr     ← 01, 02, 03
08-platform-charter-adr     ← 01, 02, 03
09-port-adapter-rules       ← 01, 02, 03, 07
10-handler-thinness-rule    ← 02, 03, 06, 09
99-execution-gate           ← every prompt 01–10 must be merged
```

**Allowable parallel execution:**
- 01 → 02 → 03 (strictly sequential)
- 04 and 05 may execute in parallel after 03 IF executors coordinate
  (5 needs 04's apilog dep, but 04 doesn't need 05).
- 07, 08 may execute in parallel after 03.
- 06 may execute in parallel with 07/08 once phase-42 has landed.
- 09 must wait for 07.
- 10 must wait for 06 and 09.

**HARD sequencing relative to phase-42:**
- Phase-47 prompts 01, 02, 03, 07, 08, 09 may run in PARALLEL with
  phase-42 (none touch internal/telemetry/tesla/signal).
- Phase-47 prompts 04, 05, 06, 10 must run AFTER phase-42 9999-final-gate
  has merged. Reasons:
  - 04 reorganises cmd/teslasync/main.go which phase-42 also edits.
  - 05 extracts internal/api/computed_metric_evaluator.go and
    api_call_log_middleware.go; phase-42 may also touch these.
  - 06 freezes internal/api; phase-42 may add files there.
  - 10 enforces handler thinness; only relevant after migration is settled.

---

## §6 — Acceptance checklist (per prompt)

Every prompt's Gate writes a log to
`.github/prompts/db-refactor/logs/phase-47-NN-<slug>.log` ending in:

```
EXIT=<int>
STATUS=DONE|BLOCKED
```

The phase is COMPLETE when ALL 10 logs report `EXIT=0` + `STATUS=DONE`.

**Expected log file names** (`$expectedLogs` array — copy verbatim into
the final-gate script):

```powershell
$expectedLogs = @(
  "phase-47-01-baseline-metrics.log",
  "phase-47-02-arch-test-foundation.log",
  "phase-47-03-package-doc-conventions.log",
  "phase-47-04-app-server-extraction.log",
  "phase-47-05-worker-api-decoupling.log",
  "phase-47-06-handler-canonical-adr.log",
  "phase-47-07-models-vs-domain-adr.log",
  "phase-47-08-platform-charter-adr.log",
  "phase-47-09-port-adapter-rules.log",
  "phase-47-10-handler-thinness-rule.log"
)
```

---

## §7 — Risk classification

| Prompt | Risk | Notes |
|--------|------|-------|
| 01 baseline-metrics | LOW | Pure additive; new tool only |
| 02 arch-test-foundation | LOW | New test package; expected to be RED for the 2 worker→api violations until prompt 05 |
| 03 package-doc-conventions | LOW | Only doc.go files added |
| 04 app-server-extraction | **MEDIUM** | Touches startup path of main binary. Smoke-start required. |
| 05 worker-api-decoupling | **MEDIUM** | Code relocates; deprecated aliases preserve callers |
| 06 handler-canonical-adr | LOW | Doc + arch_test rule |
| 07 models-vs-domain-adr | LOW-MEDIUM | Charter test may surface real violations needing fixes |
| 08 platform-charter-adr | LOW | Doc + arch_test rule |
| 09 port-adapter-rules | **MEDIUM** | Exemption list curation; new fail-level rules |
| 10 handler-thinness-rule | LOW | Rule applies only to handler/v1; existing files comply |

---

## §8 — Honesty covenant (phase-level)

The Honesty Covenant is embedded VERBATIM in every prompt. The
phase-level summary:

```
1. No red-as-green     — never claim success when a verification step fails.
2. No scope narrowing  — implement every section in "Files touched".
3. No skip-and-assume  — paste actual command output.
4. No field resurrection — N/A for arch phase.
5. No stubs            — every test, every helper, every ADR section is real content.
6. No delegation       — execute the prompt yourself.
7. No predecessor bypass — see §5 dep-map.
8. No commit on red    — Gate must be GREEN before commit/push.
9. No silent drift     — adding/removing rules requires updating ALL of: rules.go, exemptions.md, baseline.json/.md.
10. Log MUST contain EXIT + STATUS lines.
```

---

## §9 — Env vars (none added)

Phase-47 introduces **zero** new environment variables. The 4-location
sync rule (config.go ↔ docker-compose.yml ↔ helm configmap ↔ helm values)
does not apply.

If a prompt's design appears to need an env var, the prompt has been
mis-authored — STOP and revisit.

---

## §10 — Helm/docker assertions (none required)

Phase-47 introduces no Helm or docker-compose changes EXCEPT for the
single ldflags path update in prompt 04 (`Dockerfile`):

```diff
- -X main.Version=$(VERSION)
+ -X github.com/ev-dev-labs/teslasync/internal/buildinfo.Version=$(VERSION)
```

Verification:

```powershell
# Confirm Dockerfile uses the new ldflags path after prompt 04 lands
Select-String -Path Dockerfile -Pattern 'internal/buildinfo\.Version'
# Expect at least 1 match.

# Confirm helm template still renders cleanly (no env var changes mean
# this is sanity only)
helm template test helm/teslasync 2>&1 | Select-String -Pattern "ERROR|Error"
# Expect no output.
```

---

## §11 — Final gate (run after every prompt 01–10 has merged)

```powershell
cd D:\repos\teslasync
$gate = ".github\prompts\db-refactor\logs\phase-47-99-final-gate.log"
"=== PHASE-47 FINAL GATE — $(Get-Date -Format o) ===" | Tee-Object -FilePath $gate

$expectedLogs = @(
  "phase-47-01-baseline-metrics.log",
  "phase-47-02-arch-test-foundation.log",
  "phase-47-03-package-doc-conventions.log",
  "phase-47-04-app-server-extraction.log",
  "phase-47-05-worker-api-decoupling.log",
  "phase-47-06-handler-canonical-adr.log",
  "phase-47-07-models-vs-domain-adr.log",
  "phase-47-08-platform-charter-adr.log",
  "phase-47-09-port-adapter-rules.log",
  "phase-47-10-handler-thinness-rule.log"
)

"=== STEP 1: ALL_LOGS_PRESENT ===" | Tee-Object -FilePath $gate -Append
$logsDir = ".github\prompts\db-refactor\logs"
$missing = @()
foreach ($n in $expectedLogs) {
  if (-not (Test-Path (Join-Path $logsDir $n))) { $missing += $n }
}
if ($missing.Count -gt 0) {
  "FAIL: missing logs: $($missing -join ', ')" | Tee-Object -FilePath $gate -Append
  "EXIT=1" | Tee-Object -FilePath $gate -Append
  "STATUS=BLOCKED" | Tee-Object -FilePath $gate -Append
  exit 1
}

"=== STEP 2: ALL_LOGS_DONE ===" | Tee-Object -FilePath $gate -Append
$blocked = @()
foreach ($n in $expectedLogs) {
  $tail = Get-Content (Join-Path $logsDir $n) -Tail 4
  $hasDone = $tail | Where-Object { $_ -match "^STATUS=DONE\s*$" }
  if (-not $hasDone) { $blocked += $n }
}
if ($blocked.Count -gt 0) {
  "FAIL: logs not DONE: $($blocked -join ', ')" | Tee-Object -FilePath $gate -Append
  "EXIT=1" | Tee-Object -FilePath $gate -Append
  "STATUS=BLOCKED" | Tee-Object -FilePath $gate -Append
  exit 1
}

"=== STEP 3: ARCH_TEST_GREEN ===" | Tee-Object -FilePath $gate -Append
go test ./internal/arch/... 2>&1 | Tee-Object -FilePath $gate -Append
$exit = $LASTEXITCODE
if ($exit -ne 0) {
  "FAIL: arch_test red after all phase-47 prompts" | Tee-Object -FilePath $gate -Append
  "EXIT=$exit" | Tee-Object -FilePath $gate -Append
  "STATUS=BLOCKED" | Tee-Object -FilePath $gate -Append
  exit $exit
}

"=== STEP 4: BASELINE_REGRESSION_CHECK ===" | Tee-Object -FilePath $gate -Append
go run ./tools/archmetrics -compare tools/archmetrics/baseline.json 2>&1 | Tee-Object -FilePath $gate -Append
$exit = $LASTEXITCODE
if ($exit -ne 0) {
  "FAIL: arch metrics regression" | Tee-Object -FilePath $gate -Append
  "EXIT=$exit" | Tee-Object -FilePath $gate -Append
  "STATUS=BLOCKED" | Tee-Object -FilePath $gate -Append
  exit $exit
}

"=== STEP 5: MAIN_GO_LOC ===" | Tee-Object -FilePath $gate -Append
$loc = (Get-Content cmd/teslasync/main.go | Measure-Object -Line).Lines
"cmd/teslasync/main.go LOC = $loc (target ≤ 80)" | Tee-Object -FilePath $gate -Append
if ($loc -gt 80) {
  "FAIL: main.go > 80 LOC after phase-47" | Tee-Object -FilePath $gate -Append
  "EXIT=1" | Tee-Object -FilePath $gate -Append
  "STATUS=BLOCKED" | Tee-Object -FilePath $gate -Append
  exit 1
}

"=== STEP 6: NO_WORKER_API_IMPORT ===" | Tee-Object -FilePath $gate -Append
foreach ($w in "notification-worker","automation-worker") {
  $hits = Select-String -Path "cmd/$w/main.go" -Pattern '"github.com/ev-dev-labs/teslasync/internal/api"'
  "cmd/$w internal/api imports: $($hits.Count)" | Tee-Object -FilePath $gate -Append
  if ($hits.Count -gt 0) {
    "FAIL: $w still imports internal/api" | Tee-Object -FilePath $gate -Append
    "EXIT=1" | Tee-Object -FilePath $gate -Append
    "STATUS=BLOCKED" | Tee-Object -FilePath $gate -Append
    exit 1
  }
}

"=== STEP 7: ADRS_PRESENT ===" | Tee-Object -FilePath $gate -Append
foreach ($adr in "ADR-005","ADR-006","ADR-007") {
  $hit = Select-String -Path .github/ARCHITECTURE.md -Pattern "## $adr" -SimpleMatch
  if ($hit.Count -lt 1) {
    "FAIL: $adr missing from ARCHITECTURE.md" | Tee-Object -FilePath $gate -Append
    "EXIT=1" | Tee-Object -FilePath $gate -Append
    "STATUS=BLOCKED" | Tee-Object -FilePath $gate -Append
    exit 1
  }
}

"=== STEP 8: DOC_GO_COVERAGE ===" | Tee-Object -FilePath $gate -Append
$bl = Get-Content tools/archmetrics/baseline.json | ConvertFrom-Json
"doc_go_coverage = $($bl.doc_go_coverage)" | Tee-Object -FilePath $gate -Append
if ($bl.doc_go_coverage -lt 0.99) {
  "FAIL: doc.go coverage < 0.99 after prompt 03" | Tee-Object -FilePath $gate -Append
  "EXIT=1" | Tee-Object -FilePath $gate -Append
  "STATUS=BLOCKED" | Tee-Object -FilePath $gate -Append
  exit 1
}

"=== STEP 9: HELM_TEMPLATE_OK ===" | Tee-Object -FilePath $gate -Append
$helm = helm template test helm/teslasync 2>&1
$helmErr = $helm | Select-String -Pattern "^Error:|^ERROR:"
if ($helmErr.Count -gt 0) {
  "FAIL: helm template emitted errors" | Tee-Object -FilePath $gate -Append
  $helmErr | Tee-Object -FilePath $gate -Append
  "EXIT=1" | Tee-Object -FilePath $gate -Append
  "STATUS=BLOCKED" | Tee-Object -FilePath $gate -Append
  exit 1
}

"=== STEP 10: BUILD_AND_VET ===" | Tee-Object -FilePath $gate -Append
go build ./... 2>&1 | Tee-Object -FilePath $gate -Append
if ($LASTEXITCODE -ne 0) { "EXIT=$LASTEXITCODE" | Tee-Object -FilePath $gate -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $gate -Append; exit $LASTEXITCODE }
go vet ./... 2>&1 | Tee-Object -FilePath $gate -Append
if ($LASTEXITCODE -ne 0) { "EXIT=$LASTEXITCODE" | Tee-Object -FilePath $gate -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $gate -Append; exit $LASTEXITCODE }

"EXIT=0" | Tee-Object -FilePath $gate -Append
"STATUS=DONE" | Tee-Object -FilePath $gate -Append
```

---

## §12 — Phase summary commit

After the final gate is green, optionally land a phase-summary commit
(no code changes — only bumps a top-level CHANGELOG if one exists):

```
chore(arch): close phase-47 backend architecture hygiene

Phase-47 closed all 7 PA-critique findings:

  1. cmd/teslasync/main.go: 726 → ≤ 80 LOC (prompt 04)
  2. ADR-005 freezes internal/api; new HTTP code lands in handler/v1 (06)
  3. ADR-006 charters models (DTOs) vs domain (pure entities) (07)
  4. ADR-007 charters internal/platform/ + gates new subpackages (08)
  5. cmd/notification-worker, cmd/automation-worker decoupled from
     internal/api via internal/apilog + internal/notification/computed (05)
  6. internal/arch/arch_test.go enforces import-graph rules at build time
     (02, 09, 10)
  7. doc.go coverage 40% → 100% with // Layer: declarations (03)

tools/archmetrics/baseline.json captured before/after metrics; CI now
fails on arch regression (`make arch-check`).

Out of scope (deferred to phase-48+):
  - Migration of 200+ files from internal/api to internal/handler/v1
  - Consolidation of internal/platform/{cache,config,database} dups
  - Rename of internal/platform/telemetry → observability
  - Multi-module split (separate go.mod per binary)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

---

## §13 — Honest stance

Phase-47 does NOT solve every architectural concern in TeslaSync. It:

- Records the 3 highest-leverage decisions (ADR-005/006/007).
- Installs the enforcement (`internal/arch/arch_test.go`) so future
  drift is visible at PR time.
- Closes 2 concrete violations (cmd/teslasync/main.go bloat,
  worker→api inversion).

The actual large-scale migration (200+ files from `internal/api` to
`internal/handler/v1`) is **deferred to phase-48+** and will be its own
multi-prompt phase. Anyone claiming "phase-47 finished the hexagonal
migration" is wrong — it set the GUARDRAILS for that migration.
