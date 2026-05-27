# baseline-after-a2/

Capture of every CI gate + repo metric AFTER Phase A2 (tooling additions)
of `chore/repo-reorganization` is complete. Mirrors the file shape of
`baseline-after-a1/` so deltas can be diffed mechanically across phases.

**Captured at**: A2.7 (this commit). Branch HEAD includes:

- A2.1  `e0819921`  `.editorconfig`
- A2.2  `58d42a23`  `docs/CONTRIBUTING.md` (first-PR runbook + Prettier
                    decision)
- A2.3  `252cf9c8`  Tiered `make verify` / `verify-full` / `verify-smoke`
                    targets + `.gitattributes` EOL hardening
- A2.3b `b13fba7b`  `go mod tidy` promoted 3 deps from indirect→direct
- A2.4a `4b97069d`  Repo-wide `gofmt -s` + `goimports` drift fix (351
                    files, format-only)
- A2.4  `1c34e60e`  `gofmt` + `goimports` + `tsc-frontend` pre-commit
                    hooks + `.git-blame-ignore-revs`
- A2.5  `5cd3e27b`  `depguard` enabled in `.golangci.yml` (rules empty;
                    A3 populates)
- A2.6  `fd5cb18c`  `eslint-plugin-boundaries` installed + registered
                    in flat config (rules empty; B1 populates)

## What's NOT in this baseline

A2 was an **enforcement scaffolding** phase, not a code change phase.
Therefore, relative to `baseline-after-a1/`:

- Go production code is **byte-identical in semantics** — `gofmt -s`
  and `goimports` rewrites (351 files) are mechanical formatting
  only. `go test ./... -short` is still 170/170. `archmetrics.json`
  is byte-identical (167627 bytes both phases).
- Frontend production code is **byte-identical** — only `web/
  eslint.config.js`, `web/package.json`, `web/package-lock.json`,
  and `.golangci.yml` changed since A1.
- ESLint surface changed by ONE plugin registration but with no
  enforcement (boundaries rule is `default: 'allow'` no-op).

## Status summary (all gates green)

| Gate                        | Exit | Notes                                |
|-----------------------------|------|--------------------------------------|
| `go build ./...`            | 0    | unchanged from A1                    |
| `go vet ./...`              | 0    | unchanged from A1                    |
| `go test ./... -short`      | 0    | 170 ok / 0 FAIL (matches A1)         |
| `golangci-lint run ./...`   | 0    | NEW: depguard linter now active      |
| `gofmt -l -s .`             | 0    | NEW: was 350+ files in A1            |
| `goimports -l .`            | 0    | NEW: was 1 file in A1                |
| `npm run lint` (24 audits)  | 0    | unchanged from A1                    |
| `npx eslint --max-warnings 0` | 0  | NEW: boundaries plugin loads cleanly |
| `npx tsc --noEmit`          | 0    | unchanged from A1                    |
| `npm run build`             | 0    | unchanged from A1 (size below)       |

## Frontend bundle size

- 29752.3 KB total | 6096.6 KB JS | 208.6 KB CSS | 837 files

Matches A1 to within rounding (no A2 commit touches `src/` source code).

## Files in this baseline

| File                  | Purpose                                          |
|-----------------------|--------------------------------------------------|
| `archmetrics.json`    | DAG-floor capture from `tools/archmetrics`       |
| `go-build.txt`        | `go build ./...` output                          |
| `go-vet.txt`          | `go vet ./...` output                            |
| `go-test.txt`         | `go test ./... -short -count=1` output           |
| `golangci-lint.txt`   | `golangci-lint run ./...` output (with depguard) |
| `pkg-sizes.txt`       | file counts per `cmd/*`, `internal/*`, `tools/*`, `web/src/*` |
| `web-tsc.txt`         | `npx tsc --noEmit` output                        |
| `web-eslint.txt`      | `npx eslint --max-warnings 0 'src/**/*.{ts,tsx}'` output |
| `web-lint.txt`        | full 24-audit chain output                       |
| `web-build.txt`       | `npm run build` tail (Vite size table)           |
| `web-sizes.txt`       | post-build `dist/` size summary                  |
| `README.md`           | this file                                        |

## Delta from `baseline-after-a1/`

| Surface                          | A1 → A2 delta                          |
|----------------------------------|----------------------------------------|
| `.editorconfig` exists           | no → **yes** (A2.1)                    |
| `docs/CONTRIBUTING.md` exists    | no → **yes** (A2.2)                    |
| `make verify` / `verify-full` / `verify-smoke` targets | none → **3 tiers, ~95 new Makefile lines** (A2.3) |
| `.gitattributes` text eol rules  | minimal → **full coverage** (A2.3)     |
| `go.mod` direct deps             | 3 misclassified `// indirect` → **promoted** (A2.3b) |
| `gofmt -s -l .` count            | 350+ → **0** (A2.4a)                   |
| `goimports -l .` count           | 1 → **0** (A2.4a)                      |
| pre-commit hooks                 | golangci-lint + go-build-mod + go-mod-tidy + eslint + vitest + gitleaks → **+ gofmt + goimports + tsc-frontend** (A2.4) |
| `.git-blame-ignore-revs`         | none → **1 entry (A2.4a SHA)** (A2.4)  |
| `.golangci.yml` enabled linters  | 6 → **7 (+depguard, no-op)** (A2.5)    |
| `web/eslint.config.js` plugins   | jsx-a11y + teslasync → **+ boundaries (no-op)** (A2.6) |
| `archmetrics.json` size          | 167627 bytes → **167627 bytes** (unchanged — no architecture changes in A2) |
| go test result                   | 170 ok / 0 FAIL → **170 ok / 0 FAIL** (no regressions) |
| frontend bundle size             | within 1% of A1                        |

## Delta from `baseline/` (A0 — pre-reorg)

| Metric                | A0       | A2       | Delta             |
|-----------------------|----------|----------|-------------------|
| commits on branch     | 0        | 18       | +18               |
| `gofmt -s -l .`       | 350+     | 0        | **fixed in A2.4a** |
| `goimports -l .`      | 1        | 0        | **fixed in A2.4a** |
| pre-commit hooks      | 9        | 12       | +3 (gofmt, goimports, tsc) |
| golangci-lint enabled | 6        | 7        | +1 (depguard, no-op) |
| Makefile targets      | 19       | 29       | +10 (verify chain + leaves) |
| `.editorconfig`       | absent   | present  | added             |
| `.gitattributes`      | minimal  | hardened | EOL fully scoped  |
| `.git-blame-ignore-revs` | absent | 1 entry | added             |
| `docs/CONTRIBUTING.md`| absent   | present  | added             |
| go test result        | 170 ok   | 170 ok   | zero regressions  |
| frontend bundle size  | baseline | within 1% | zero regression  |

## Next phase

**A3 — Architecture enforcement RATCHET**. Will:

1. Extend `tools/archmetrics` `forbiddenEdges` with the Clean
   Architecture DAG.
2. Mirror the DAG in `.golangci.yml` `depguard` rules (the empty
   `deny: []` block populated in A2.5).
3. Add per-package allowlists for legacy packages
   (`internal/api`, `internal/ai`) with their current violation
   count locked in.
4. Activate the ratchet: net-new violations fail CI; allowlisted
   packages can only shrink.
5. Verify with deliberate-violation tests.

Reference: `docs/architecture/repo-reorganization-plan.md` §A3.
