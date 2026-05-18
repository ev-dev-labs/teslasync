# Contributing to TeslaSync

Thanks for taking the time to contribute. TeslaSync is a self-hosted Tesla
fleet intelligence platform — it talks to real cars over the Tesla Fleet API
and Fleet Telemetry stream, stores months of high-resolution signal history,
and ships commands back to vehicles. Bugs in this codebase can drain
batteries, leak GPS traces, or wedge a charging session at 02:00. We take
correctness seriously and ask that you do too.

This document covers:

- [Code of Conduct](#code-of-conduct)
- [How to ask for help](#how-to-ask-for-help)
- [Reporting bugs](#reporting-bugs)
- [Suggesting features](#suggesting-features)
- [Security issues](#security-issues)
- [Development setup](#development-setup)
- [Branching, commits, and pull requests](#branching-commits-and-pull-requests)
- [Coding standards](#coding-standards)
- [Tests and verification](#tests-and-verification)
- [Documentation](#documentation)
- [Architectural decisions and ADRs](#architectural-decisions-and-adrs)
- [Releasing](#releasing)
- [Licensing of contributions](#licensing-of-contributions)

---

## Code of Conduct

By participating in this project — issues, pull requests, discussions,
chat — you agree to abide by the [Code of Conduct](./CODE_OF_CONDUCT.md).
Report unacceptable behaviour to **conduct@ev-dev-labs.com**.

## How to ask for help

In order of preference:

1. **Read [`docs/`](./docs)** — the VitePress site covers configuration,
   deployment, the Helix AI layer, observability, and runbooks for the
   common operational situations.
2. **Search existing issues** — chances are someone has hit the same
   thing.
3. **Open a [Discussion](https://github.com/ev-dev-labs/teslasync/discussions)**
   for usage questions, deployment help, or design ideas. Reserve
   issues for confirmed bugs and concrete feature work.

Please do not email maintainers directly for usage help — public
discussions help every operator and let the project scale.

## Reporting bugs

Open a GitHub issue using the **Bug report** template. Useful bug reports
include:

- The TeslaSync version (git SHA or release tag — `docker exec teslasync-api /app/teslasync -version`)
- The deployment target (Docker Compose, k3s, k8s + Helm, bare binary)
- Steps to reproduce, ideally with a sanitised log excerpt
- Expected vs actual behaviour
- Whether the issue persists after restarting the API container (which
  clears the L1 `signal.Store` cache)

Redact VINs, Tesla OAuth tokens, locations, and email addresses before
posting. The project never asks for credentials in an issue or PR
comment.

## Suggesting features

Open a GitHub issue with the **Feature request** template. Frame the
request as a *problem you have*, not a solution. Maintainers will work
with you to find the right shape — often the best fix is one we hadn't
considered.

Features that touch the telemetry pipeline, signal storage, or the
write path are subject to [ADR review](#architectural-decisions-and-adrs).
Expect a design conversation before implementation starts.

## Security issues

**Do not open a public issue for security vulnerabilities.** See
[SECURITY.md](./SECURITY.md) for the coordinated-disclosure process and
the threat model. Email **security@ev-dev-labs.com** with steps to
reproduce; we acknowledge reports within 48 hours.

---

## Development setup

### Prerequisites

- **Go 1.25** (see `go.mod`; the toolchain directive will auto-download
  the right version)
- **Node.js 20** + npm 10
- **Docker** + **docker compose** (for the local DB + MQTT + Redis stack)
- **golangci-lint** v1.61+
- **helm** 3.14+ (only if you touch the chart)

Optional but recommended:

- **k3s** (single-node) or **kind** if you want to test the Helm chart
  end-to-end before pushing
- **yq** for inspecting rendered manifests
- **gh** CLI for opening PRs from the terminal

### Clone and bootstrap

```bash
git clone https://github.com/ev-dev-labs/teslasync.git
cd teslasync
cp .env.example .env             # adjust ports / passwords if needed
docker compose up -d postgres redis mosquitto
go run ./cmd/migrate up          # apply migrations
go run ./cmd/teslasync            # API on :8080
```

Frontend dev server:

```bash
cd web
npm ci
npm run dev                       # SPA on :5173, proxies /api to :8080
```

### Common one-liners

```bash
# Go
go test ./... -race
golangci-lint run
go vet ./...

# Frontend
cd web
npx tsc --noEmit                  # type-check, must be clean
npm run lint
npm test

# Helm
helm lint ./helm/teslasync
helm template test ./helm/teslasync > /tmp/rendered.yaml
```

### Test data

For replay-driven development, use the CSV fixtures under
`testdata/replay/`. The `cmd/replay-vehicle` binary streams them into a
local MQTT broker as if a real car were driving. Always restart the API
container and `redis-cli FLUSHDB` before replaying — stale L1 + L2 state
will corrupt boundary values in the new run.

---

## Branching, commits, and pull requests

### Branch naming

```
feat/<short-description>      # new functionality
fix/<short-description>       # bug fix
refactor/<short-description>  # no behaviour change
docs/<short-description>      # docs-only
chore/<short-description>     # tooling, deps, CI
```

Long-running work that spans many PRs uses a phase prefix, e.g.
`refactor/signals-rewrite` (Phase-48).

### Commit messages

We follow **Conventional Commits**:

```
type(scope): short summary

Body explaining the why, not the what. Reference issues or ADRs.
Document non-obvious tradeoffs and rejected alternatives.
```

| Type       | Use for                                              |
| ---------- | ---------------------------------------------------- |
| `feat`     | New user-facing capability                           |
| `fix`      | Bug fix                                              |
| `refactor` | Code change with no behaviour change                 |
| `perf`     | Performance improvement                              |
| `docs`     | Documentation only                                   |
| `test`     | Adding or fixing tests                               |
| `chore`    | Dependencies, CI, tooling                            |
| `ci`       | CI workflow / pipeline changes                       |
| `style`    | Formatting, whitespace                               |
| `revert`   | Reverts a previous commit (include the SHA)          |

Scopes commonly used: `web`, `api`, `db`, `mqtt`, `tesla`, `helm`,
`ci`, `docs`, or a specific feature directory (`web/charging`,
`tesla/codec`).

The commit body is mandatory for anything non-trivial. Reviewers need
to know why a choice was made, not just what changed — that information
is lost forever once the PR is merged.

### Pull requests

1. **Open early, mark as draft** if you want feedback on the approach
   before finishing.
2. **One concern per PR.** A 30-file PR mixing a refactor with a feature
   is almost impossible to review safely. Stack PRs instead.
3. **Fill out the template.** It exists to save reviewer time, not as
   a hoop.
4. **Link the issue.** `Closes #123` auto-closes on merge.
5. **All CI checks must pass** — security, tests, lint, type-check,
   helm lint. There are no "warning" gates anymore; everything either
   passes or fails the PR.
6. **Self-review first.** Walk your own diff before requesting review.
7. **Squash on merge** unless the PR is a series of meaningful commits
   that tell a story. Each commit on `main` should build, test, and
   deploy cleanly.

### Reviews

Reviewers will look for:

- Does it match the PA-approved ADRs? (See `.github/ARCHITECTURE.md`.)
- Are tests included for the new behaviour and for the edge cases?
- Does it handle the empty / loading / error states (frontend) or the
  context cancellation / DB-down / partial-failure paths (backend)?
- Does it leak secrets or PII to logs?
- Does it work on a stock k3s install with no extra CNI / ingress
  controller? Self-hosted operators are first-class consumers; if a
  feature requires Calico / MetalLB / Istio to function, that's a
  reviewer concern.

Reviewers strive to respond within two working days. If a review
stalls, ping the PR — silence is not approval.

---

## Coding standards

### Go

- **Go 1.25**, CGO disabled, `gofmt -s`, `golangci-lint run`.
- Error handling: `return fmt.Errorf("fetch vehicle %d: %w", id, err)`.
- Logging: `zerolog` only. Structured fields, never `fmt.Sprintf`.
- No `panic()` in non-startup code paths. Startup-only panics are
  acceptable in `main` if they surface a clear configuration error.
- Database access goes through the repository pattern in
  `internal/database/`. Parameterised queries only — no string
  interpolation, ever.
- Telemetry ingest goes through `normalize.Pipeline.ProcessAtomics`.
  There is no second entry point; a reflective coverage test enforces
  this.
- Tests under `internal/.../<pkg>_test.go`. Race detector required:
  `go test -race ./...`.
- Read [`.github/instructions/go-backend.instructions.md`](./.github/instructions/go-backend.instructions.md)
  before adding a handler, repo, or model.

### Frontend

- **TypeScript strict mode**. No `any` without an inline justification
  comment and a follow-up issue link.
- Pages live under `web/src/features/<domain>/pages/`. They orchestrate;
  they do not fetch.
- Data fetching is in `web/src/api/hooks/`. One TanStack Query hook per
  endpoint. URLs are relative — the `request()` client auto-prefixes
  `/api/v1`.
- Use the shared component library: `@/components/ui`, `@/components/charts`,
  `@/components/maps`, etc. Direct imports from `recharts`, `react-leaflet`,
  or `framer-motion` in feature code are rejected at review.
- Every user-facing string goes through `t('namespace.key', 'Fallback')`.
- Loading, empty, and error states are mandatory on every page that
  fetches data. Hidden sections behind `{data && ...}` are an
  anti-pattern.
- Read [`.github/instructions/react-frontend.instructions.md`](./.github/instructions/react-frontend.instructions.md)
  before adding a page or shared component.

### Units (Phase-48 SI canonical)

All new Go struct fields, JSON, and DB columns use **SI units**:
`distance_m`, `duration_s`, `speed_mps`, `energy_wh`, `power_w`,
`pressure_kpa`. The legacy `_mi`, `_min`, `_mph`, `_kwh`, `_kw`, `_psi`
suffixes are being deleted; do not add new callers.

Frontend displays the user's preferred unit at the render boundary via
the `useUnits()` hook from `@/hooks/useUnits`. Never convert in the
page or API layer.

### Configuration

When you add or rename an env var, update **three** places in the
same commit:

1. `internal/config/config.go` (Go binding)
2. `docker-compose.yml` (local dev)
3. `helm/teslasync/values.yaml` + the corresponding ConfigMap or
   Secret template under `helm/teslasync/templates/`

Verify with `helm template test ./helm/teslasync | grep YOUR_NEW_VAR`.

---

## Tests and verification

We have one bar: **the test you would run as the maintainer before
merging your own change**. That usually means more than the minimum
viable test.

### Required before opening a PR

- `go test ./... -race` passes
- `golangci-lint run` is clean
- `go vet ./...` is clean
- `cd web && npx tsc --noEmit` is clean
- `cd web && npm run lint` is clean
- `cd web && npm test` passes
- For Helm changes: `helm lint ./helm/teslasync` is clean and
  `helm template test ./helm/teslasync` produces a valid manifest

The full CI suite also runs `govulncheck`, Trivy (filesystem, config,
and Helm), CodeQL, gitleaks, and `npm audit`. All of these are
blocking — if a CVE shows up in your branch, it has to be triaged or
fixed before merge. The triage paths live in `.govulnignore.yaml`,
`.trivyignore`, `.gitleaksignore`, and `.audit-ci.json`; document any
allowlist entry in the commit message.

### Test data

Use the existing `testdata/` fixtures where possible. For new fixtures,
prefer real-world-shaped data over synthetic minimums — silent
production bugs almost always come from a value the synthetic tests
never imagined.

---

## Documentation

Documentation lives in three places, in order of operator impact:

1. **`docs/`** — the VitePress site, deployed publicly. Update this
   when you add a feature, change configuration, or fix a behaviour
   that operators have learned to work around.
2. **README.md** — high-level pitch, install one-liner, deeper links.
   Update only for top-level changes (new major feature, new license,
   new minimum requirement).
3. **`.github/` instructions** — agent + reviewer guidance. Update
   when a convention changes or a new prohibited pattern is identified.

A pull request that changes behaviour without updating the
corresponding docs is incomplete.

---

## Architectural decisions and ADRs

`.github/ARCHITECTURE.md` contains the Principal Architect (PA)-approved
ADRs. Any change to:

- The telemetry pipeline (`internal/tesla/*`, `internal/mqtt/*`,
  `internal/normalize/*`)
- The signal storage contract (`signal.Store`, `signal_log`,
  `RedisSignalCache`)
- Cross-cutting backend boundaries (auth, multi-tenancy, write path)
- The Helm chart's deployment topology

is subject to ADR review. The process:

1. Open a discussion or draft PR with a short ADR document
   (`.github/ARCHITECTURE.md` template at the top of the file).
2. Get explicit sign-off from a maintainer with `pa-review/approved`
   label before merging the implementation.
3. The merged ADR is the source of truth — future code that disagrees
   with it gets rejected at review.

This sounds heavy. In practice 95% of contributions don't touch any
of these areas and proceed at normal velocity. The ADR process exists
for the ones that do.

---

## Releasing

Maintainers tag releases on `main`. The release workflow:

- Builds multi-arch container images for `linux/amd64` and `linux/arm64`
- Signs them with Cosign (keyless OIDC; signatures verifiable via
  `cosign verify`)
- Generates an SBOM and attaches it to the release
- Cuts a GitHub release with auto-generated notes from the conventional
  commit log
- Publishes the Helm chart to the chart repo

If you contributed a notable change, you'll be credited in the release
notes by your GitHub username. If you'd prefer a different attribution
or no attribution, note it on the PR.

---

## Licensing of contributions

TeslaSync is **MIT-licensed** (see [LICENSE](./LICENSE)). By
contributing, you agree that your contribution will be licensed under
the same terms. You also confirm that you have the right to submit the
work — either you wrote it, or you have explicit permission from the
copyright holder.

We do not require a Contributor License Agreement. The MIT license
covers what we need.

---

## Thank you

Self-hosted infrastructure software is built by people who care about
self-hosted infrastructure software. Every issue, every PR, every
typo-fix in the docs is appreciated. If a maintainer didn't say it
soon enough — thank you for being here.
