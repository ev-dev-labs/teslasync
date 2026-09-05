# Contributing to TeslaSync

Documentation fixes, reproducible bug reports, tests, and focused code changes
are welcome. For installation rather than development, use
[Getting Started](/guide/getting-started).

## Choose your first contribution

1. Check [existing issues](https://github.com/ev-dev-labs/teslasync/issues) and discuss
   substantial changes before investing in an implementation.
2. Fork or branch, reproduce the problem, and keep the change focused.
3. Read the repository's `.github/instructions/` rules for the files you touch.
4. Run the relevant existing checks below; record actual results and limitations.
5. Open a PR describing what changed, why, how to test it, and any migration impact.

For documentation-only work:

```bash
cd docs
npm ci
npm run docs:dev
# After editing, stop the preview and verify:
npm run docs:build
```

Check links in the rendered site under `/teslasync/`, including screenshots,
anchors, and sidebar entries. The site currently ignores dead links during
build, so build success is not a link audit. No Go or frontend build is needed
for prose-only changes.

Never include credentials, private keys, VINs, or precise locations in reports.
Follow the [security policy](https://github.com/ev-dev-labs/teslasync/blob/main/SECURITY.md)
for vulnerabilities instead of opening a public issue.

This is the **first PR runbook**: clone → run → ship your first change.
For the deeper "how to add a vertical-slice feature" walkthrough, see
[`contributing/adding-features.md`](contributing/adding-features.md).
For the repo layout map, see
[`contributing/code-structure.md`](contributing/code-structure.md).

This file (`docs/CONTRIBUTING.md`) is canonical for the engineering
runbook and tooling decisions. The `docs/contributing/*` pages on the
public VitePress site are user-facing extended versions of the same
material.

---

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| Go | 1.25.x | Backend toolchain |
| Node.js | 20 LTS or 22 LTS | Frontend toolchain |
| Docker Desktop / Engine | 24+ | TimescaleDB, Redis, Mosquitto, integration smoke |
| `golangci-lint` | v1.64+ | Backend lint gate |
| `pre-commit` | latest | Local hook runner (pip install) |
| `make` | GNU Make 4+ | Verification chain. On Windows use WSL or a separately installed GNU Make with a POSIX shell. Git for Windows does not include Make by default; nmake is not compatible. |
| `gh` CLI | optional | Issue and pull-request management |

Verify after install:

```powershell
go version              # go1.25.x
node -v                 # v20.x or v22.x
docker --version
golangci-lint --version
pre-commit --version
make --version          # GNU Make 4.x (or run via Docker — see below)
```

### Windows development

Use a WSL development environment with the listed toolchains for Make targets,
or run the underlying commands directly. A container with only `make` installed
cannot run Go, Node.js, and lint gates. Go race tests also require a supported
C toolchain. See [Local Development](/guide/local-development) for service setup.

## First run — clone to green build

```powershell
git clone https://github.com/ev-dev-labs/teslasync.git
cd teslasync

# Backend
go mod download
go build ./...
go test ./... -short -count=1

# Frontend
cd web
npm ci
npx tsc --noEmit
npm run lint          # 24-audit chain — see "Quality gates" below
npm run build
cd ..

# Pre-commit hooks (one-time per clone)
pip install pre-commit
pre-commit install
pre-commit install --hook-type pre-push

# Full local verification (matches CI behaviour)
make verify           # FAST: lint + vet + short tests + web typecheck + web lint
make verify-full      # BATCH: + race + arch-check + ai-vet + generate-check
make verify-smoke     # TRACK: + docker compose up + signal-log replay (slow)
```

`make verify` is the gate you should run before every commit. `make
verify-full` is what CI runs on every push. `make verify-smoke` is what
the maintainer runs before a release tag.

## Quality gates — what each tier checks

| Tier | Targets it runs | Cost | When to run |
|---|---|---|---|
| `make verify` | `lint` + `vet` + `web-typecheck` + `web-lint` (24-audit chain) + `go test -short -count=1` | ~30–60s | Before every commit |
| `make verify-full` | `verify` + `go test -race` + `arch-check` + `ai-vet` + `generate-check` + `gen-tesla-check` + `web-test-fast` | ~3–5 min | Before every push |
| `make verify-smoke` | `verify-full` + `docker-up` + 45s health wait + `replay-fixture` + `docker-down` | ~10 min | Before tagging a release. Requires Docker Desktop running. |

Each tier is a **strict superset** of the previous one — passing
`verify-smoke` implies passing `verify-full` which implies passing
`verify`. If you can't recall which one to run, run `verify-full`.

Run `make help` to see every available target.

## Formatting tooling — what we use and what we don't

| Surface | Tool | Rationale |
|---|---|---|
| **Editor defaults** (all files) | `.editorconfig` | Encodes charset / EOL / indent for Go (tabs), Makefile (tabs), TS/YAML/JSON/SQL/Shell (2 spaces), Python (4 spaces), Markdown (preserve trailing ws). Read by editors before file open, so mixed-CRLF and mixed-indent commits never enter the graph. |
| **Line endings** | `.gitattributes` (`*.go text eol=lf`, etc.) | Defence-in-depth on top of `.editorconfig`: even if a Windows tool writes CRLF to disk, Git normalises on commit. Required because `gofmt` reads from disk, sees CRLF, and falsely reports ~921 files as "needing formatting" — an artifact, not real debt. See A2.3 commit for details. |
| **Go** | `gofmt` + `goimports` + `golangci-lint` | `gofmt` runs via pre-commit and is the authority for Go formatting. `goimports` orders imports. `golangci-lint` runs `govet` + `staticcheck` + `unused` + `gosimple` + `ineffassign` + `typecheck`. |
| **TypeScript / JS** | ESLint (`--max-warnings 0`) + the 24-audit chain | ESLint enforces structural correctness AND stylistic rules (quote style, indentation). The 24 custom audits enforce architecture invariants (a11y, RTL, light-mode parity, no inline styles, no raw HTML, FSD layer respect via shared-component imports, etc). |
| **Python / Shell / YAML / JSON / SQL / CSS / Markdown** | `.editorconfig` only | We don't ship enough of these for a dedicated formatter to earn its keep. |
| **Prettier** | **NOT USED. Deliberately.** | See below. |

### Why we don't use Prettier

This is a deliberate decision (Phase A2.2 of the repo reorganization,
2026-05-27). The team considered adopting Prettier and rejected it for
the following reasons:

1. **Adopting Prettier would force a one-time mega-diff across
   1,800+ TypeScript files.** That diff makes `git blame` significantly
   harder for months and obscures the legitimate authorship history we
   rely on for ADR-trace work.
2. **ESLint already covers JS/TS structural style.** Prettier adds
   only opinionated whitespace rules on top — and those rules
   regularly conflict with the existing ESLint stylistic config,
   producing tool-fight churn (Prettier reformats → ESLint flags →
   `eslint-plugin-prettier` workaround → both projects argue about
   trailing commas in JSX). The fix is to run ESLint without Prettier
   in the loop.
3. **Editor `.editorconfig` is sufficient for the cases where
   non-TS/JS code needs format consistency** (charset / EOL / indent
   width). Per-language formatters for Python / YAML / shell would be
   noise: we have very little of each, and the volume is so low that
   reviewers catch any drift in code review without tool support.
4. **Go does not benefit from Prettier at all** (`gofmt` is the
   authority and is non-negotiable in the Go ecosystem).
5. **The existing 24-audit ESLint chain is the load-bearing quality
   gate for the frontend.** Adding Prettier would risk masking
   audit failures behind Prettier-reformatting passes (e.g., Prettier
   reformats a multi-line JSX prop and the `audit:datatable-tableid`
   regex stops matching). We want every quality gate to fail loudly
   when it should.

**If you disagree with this decision**, open an issue with concrete
data: the proposed configuration, a representative diff against
`main`, and a mitigation for points 1, 2, and 5 above. ADR-style
revisit, not a unilateral PR.

## Where to add code

Short pointers; the full version is in
[`contributing/code-structure.md`](contributing/code-structure.md) and
[`contributing/adding-features.md`](contributing/adding-features.md).

| You're adding... | It goes in... |
|---|---|
| A new HTTP endpoint | `internal/handler/v1/<name>_handler.go` + `internal/app/<entity>svc/` for the use case. Wired in `internal/api/router.go`. (NOT in `internal/api/` — that directory is frozen per ADR-009.) |
| A new domain entity | `internal/domain/<entity>/types.go` |
| A new port | `internal/port/<domain>/` if shared; inline in the svc otherwise |
| A new repository method | `internal/database/<entity>_repo.go` |
| A new request/response DTO | `internal/handler/dto/<name>.go` with `FromDomain` / `ToDomain` |
| A new frontend page | `web/src/features/<domain>/pages/<Name>Page.tsx` (lazy-loaded; see `App.tsx` route table) |
| A new shared UI component | `web/src/components/<category>/<Name>.tsx` + add to category barrel |
| A new API hook | `web/src/api/hooks/use<Domain>.ts` (TanStack Query) |
| A new database migration | `migrations/NNNN_description.{up,down}.sql` (filename ordering matters; check the highest existing NNNN first) |
| A new feature flag | `internal/flags` + audit row will be auto-written to `feature_flag_changes` |
| A new ADR | `.github/ARCHITECTURE.md` (until Phase A4 splits it into `docs/architecture/adr/NNNN-*.md`) |
| A new Tesla signal field | Re-vendor the proto → `go generate ./internal/tesla/protomodel/...` → add a routing.yaml entry → done. See `.github/instructions/tesla-pipeline.instructions.md`. |

## Commit conventions

Conventional Commits format:

```
type(scope): description

feat(web):     Add battery degradation chart
fix(api):      Handle nil pointer in drive handler
refactor(web): Extract shared StatCard component
perf(db):      Add index for vehicle_id on positions
docs:          Update API route documentation
test(api):     Add unit tests for charging handler
chore:         Update Go dependencies
```

Types: `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `chore`,
`ci`, `style`.
Scope: `web`, `api`, `db`, `mqtt`, `helm`, `ci`, or a specific feature
name.

For Copilot-assisted commits, retain the applicable attribution trailer:

```
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

## Branch conventions

```
feature/add-battery-cells-page
fix/drive-detail-missing-panels
refactor/extract-shared-chart-container
chore/repo-reorganization               # the active reorg branch
```

## Pre-commit hook flow

When you `git commit`, the pre-commit hooks run automatically. What
runs:

| Stage | Hook | Why |
|---|---|---|
| `pre-commit` | `trailing-whitespace`, `end-of-file-fixer`, `check-yaml`, `check-json`, `check-merge-conflict`, `detect-private-key`, `check-added-large-files` (>1MB) | Hygiene |
| `pre-commit` | `golangci-lint` (--timeout=5m) | Backend lint |
| `pre-commit` | `go-build-mod`, `go-mod-tidy` | Backend build sanity |
| `pre-commit` | ESLint (`--max-warnings 0`) on `web/src/**/*.{ts,tsx}` | Frontend lint |
| `pre-commit` | `gitleaks` | Secret detection |
| `pre-push` | Vitest on `web/src/**/*.{ts,tsx}` | Frontend tests |

If you ever need to bypass (you almost never should): `git commit
--no-verify`.

## Common mistakes to avoid

(Lifted from
[`contributing/adding-features.md`](contributing/adding-features.md) §
"What NOT to do"; restated here for visibility.)

- Don't add a "quick endpoint" that bypasses the repository.
- Don't write inline `style={ {...} }` in components. Tailwind utility
  classes for almost everything; `components/ui` for the rest.
- Don't fetch in `useEffect`. TanStack Query exists. Use it.
- Don't hardcode units. `useUnits()` is one import away. SI is on the
  wire; conversion happens at the display boundary only.
- Don't ship a Helix AI feature that's on by default. CI will block
  you, but more importantly the platform's privacy contract depends on
  it. See ADR-015.
- Don't edit `web/src/ai/features.ts` by hand. Run `make generate`.
- Don't add a route without updating the docs.
- Don't add new Go struct fields with `Mi` / `Min` / `Mph` / `Kwh` /
  `Kw` / `Psi` suffixes. SI canonical (`M`, `S`, `Mps`, `Wh`, `W`,
  `Kpa`) only. See Phase-48 mandate in `.github/copilot-instructions.md`.

## Getting help

- Architecture decisions: `.github/ARCHITECTURE.md` (mirrored in
  `docs/architecture/` after Phase A4)
- Repo reorganization plan (this multi-month effort):
  `docs/architecture/repo-reorganization-plan.md`
- Engineering invariants for AI agents:
  `.github/copilot-instructions.md`
- Domain-specific invariants:
  - Tesla pipeline: `.github/instructions/tesla-pipeline.instructions.md`
  - Telemetry pipeline: `.github/instructions/telemetry-pipeline.instructions.md`
  - React frontend: `.github/instructions/react-frontend.instructions.md`
  - Observability: `.github/instructions/observability.instructions.md`
  - Helm + Docker: `.github/instructions/helm-docker.instructions.md`
  - Go backend: `.github/instructions/go-backend.instructions.md`
  - Frontend SI cutover: `.github/instructions/frontend-si-cutover.instructions.md`
  - Data modelling: `.github/instructions/data-modeling.instructions.md`
  - Unit conversion: `.github/instructions/unit-conversion.instructions.md`
  - Prompt engineering: `.github/instructions/prompt-engineering.instructions.md`
