# Pre-reorganization baseline (chore/repo-reorganization)

Captured on branch `chore/repo-reorganization` off `main` @ `e1550655`
on 2026-05-27. These artifacts establish the floor: any later metric in
this branch is compared against these numbers, and net regressions
fail CI.

## Files

| File | Source | Pass/Fail |
|---|---|---|
| `pkg-sizes.txt` | `internal/*` + `cmd/*` Go file counts | informational |
| `web-sizes.txt` | `web/src/*` TS file counts | informational |
| `go-build.txt` | `go build ./...` | PASS (exit 0) |
| `golangci-lint.txt` | `golangci-lint run ./...` | FAIL (3 issues) |
| `go-test.txt` | `go test ./... -short -count=1` | FAIL (1 pkg: `internal/arch`) |
| `web-tsc.txt` | `npx tsc --noEmit` | PASS (exit 0) |
| `web-eslint.txt` | `npm run lint` | FAIL (16 errors) |

`baseline.json` and `baseline.md` (sibling to this dir) are refreshed
`tools/archmetrics` snapshots.

## Real pre-existing issues to address

These are tech debt that was already present on `main` before this
branch started. Per the user mandate ("if you see something broken fix
it, don't leave it"), they are fixed in Phase A1 of the reorg plan
rather than left as a separate problem.

1. **`internal/database/slow_queries_repo.go:89`** — unused function
   `orderByColumnSnapshot`. Either wire up or delete.
2. **`internal/app/adminobssvc/service.go:35`** — unused struct field
   `pool` (type `schemacheck.Querier`). Either wire up or delete.
3. **`internal/ocpp/dispatcher.go:86`** — `cp := *(&s)` is a no-op
   per `staticcheck SA4001`; collapse to `cp := s` (and check whether
   the original was attempting a defensive copy of something that
   needs proper cloning).
4. **`internal/arch.TestEveryInternalPackageHasDocGoWithLayer`** — 12
   packages missing `doc.go` with `// Layer:` declaration:
   - `cmd/backup-verify`, `cmd/chaos-runner`,
     `cmd/fleet-config-validator`, `cmd/ocpp-server`
   - `internal/backupverify`, `internal/chaos`,
     `internal/dataquality`, `internal/integrations/homeassistant`,
     `internal/ocpp`, `internal/slo`, `internal/synthetic`,
     `internal/v2h`
5. **`web` ESLint** — 16 errors (file paths in `web-eslint.txt`).
   Some are auto-fixable (`--fix`); others need real change.

## Replay

To replay:

```powershell
cd D:\repos\teslasync
go build ./... 2>&1 | Tee-Object tools\archmetrics\baseline\go-build.txt
golangci-lint run ./... 2>&1 | Tee-Object tools\archmetrics\baseline\golangci-lint.txt
go test ./... -short -count=1 2>&1 | Tee-Object tools\archmetrics\baseline\go-test.txt
cd web
npx tsc --noEmit 2>&1 | Tee-Object ..\tools\archmetrics\baseline\web-tsc.txt
npm run lint --silent 2>&1 | Tee-Object ..\tools\archmetrics\baseline\web-eslint.txt
```
