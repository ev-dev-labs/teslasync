# Post-Phase-A1 baseline (chore/repo-reorganization)

Captured on branch `chore/repo-reorganization` after Phase A1 completion
on 2026-05-27. Compares directly against the immutable Phase-A0 floor at
`tools/archmetrics/baseline/`.

The A0 baseline (committed `5e1499aa`) is the **pre-reorganization floor**
and MUST NOT be modified. This `baseline-after-a1/` directory captures the
**post-Phase-A1 state** so reviewers can verify every issue documented in
A0's tech-debt list was actually fixed before Phase A2 begins.

## Files

| File | Source | Pass/Fail | A0 result | Delta |
|---|---|---|---|---|
| `pkg-sizes.txt` | `internal/*` + `cmd/*` Go file counts | informational | informational | unchanged (no file moves in A1) |
| `web-sizes.txt` | `web/src/*` TS file counts | informational | informational | unchanged (no file moves in A1) |
| `go-build.txt` | `go build ./...` | PASS (exit 0) | PASS (exit 0) | parity |
| `golangci-lint.txt` | `golangci-lint run ./...` | **PASS (0 issues)** | FAIL (3 issues) | **-3 issues** |
| `go-test.txt` | `go test ./... -short -count=1` | **PASS (170 pkg ok)** | FAIL (1 pkg: `internal/arch`) | **-1 fail** |
| `web-tsc.txt` | `npx tsc --noEmit` | PASS (exit 0) | PASS (exit 0) | parity |
| `web-eslint.txt` | `npx eslint . --format stylish` | **PASS (0 errors)** | FAIL (16 errors) | **-16 errors** |
| `web-lint.txt` | `cd web; npm run lint` (24-audit chain) | **PASS (all green)** | not captured (chain stopped at ESLint) | new floor |
| `archmetrics.json` | `go run ./tools/archmetrics` snapshot | informational | (sibling `baseline.json`) | refreshed |

## A0 tech-debt items: status

Every numbered item from `tools/archmetrics/baseline/README.md` § "Real
pre-existing issues to address" — resolved in Phase A1.

| # | A0 finding | Status | Commit |
|---|---|---|---|
| 1 | `internal/database/slow_queries_repo.go:89` — unused `orderByColumnSnapshot` | FIXED | `7e8db384` (A1.3) |
| 2 | `internal/app/adminobssvc/service.go:35` — unused `pool` field | FIXED | `7e8db384` (A1.3) |
| 3 | `internal/ocpp/dispatcher.go:86` — `cp := *(&s)` SA4001 no-op | FIXED (`cp := s`) | `7e8db384` (A1.3) |
| 4 | 12 packages missing `doc.go` with `// Layer:` | FIXED (all 12 added) | `1e3b2d63` (A1.4) |
| 5 | `web` ESLint 16 errors | FIXED (0 errors) | `76973fd6` (A1.5) |
| — | (A1 expansion) 31 pre-existing light-mode-parity violations | FIXED | `71b4d782` (A1.6) |
| — | (A1 expansion) 5 chained-lint audits red (16 sites) | FIXED | `001f578d` (A1.7) |
| — | (A1 expansion) `audit:rtl` budget bust (409 > 395) | FIXED + ratcheted to 393 | `fe8cf146` (A1.8) |
| — | (A1 expansion) 2 staticcheck issues in `cmd/audit-signal-types` (exposed by A1.1 relocating the script under golangci-lint coverage) | FIXED | `f5a60105` (A1.9) |

## What this means for Phase A2

The `npm run lint` chain (24 audits joined by `&&`) now runs end-to-end
green. Phase A2 (Makefile additions, `eslint-plugin-boundaries` install,
`depguard` install) can build on a fully-green pre-existing floor — every
later failure is genuinely caused by A2+ work, not pre-existing debt
masking new issues.

## Replay

```powershell
cd D:\repos\teslasync
$build = go build ./... 2>&1 | Out-String
if ([string]::IsNullOrEmpty($build)) { $build = "(no output — clean)`n" }
$build | Out-File tools\archmetrics\baseline-after-a1\go-build.txt -Encoding utf8

$lint = golangci-lint run ./... 2>&1 | Out-String
if ([string]::IsNullOrEmpty($lint)) { $lint = "(no output — clean)`n" }
$lint | Out-File tools\archmetrics\baseline-after-a1\golangci-lint.txt -Encoding utf8

go test ./... -short -count=1 2>&1 | Tee-Object tools\archmetrics\baseline-after-a1\go-test.txt

cd web
$tsc = npx tsc --noEmit 2>&1 | Out-String
if ([string]::IsNullOrEmpty($tsc)) { $tsc = "(no output — clean)`n" }
$tsc | Out-File ..\tools\archmetrics\baseline-after-a1\web-tsc.txt -Encoding utf8

$eslint = npx eslint . --format stylish 2>&1 | Out-String
if ([string]::IsNullOrEmpty($eslint)) { $eslint = "(no output — clean)`n" }
$eslint | Out-File ..\tools\archmetrics\baseline-after-a1\web-eslint.txt -Encoding utf8

npm run lint 2>&1 | Tee-Object ..\tools\archmetrics\baseline-after-a1\web-lint.txt
```

Note: PowerShell's `2>&1 | Tee-Object` does NOT create the output file
when the underlying command produces zero stdout/stderr (clean run), so
clean-state captures use the `Out-String` + `IsNullOrEmpty` guard pattern
shown above. Genuinely noisy outputs (test runs, chained lint) can use
`Tee-Object` directly.
