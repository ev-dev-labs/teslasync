# Production readiness scorecard

<!-- GENERATED FILE — DO NOT EDIT BY HAND.
     Source of truth: ops/scorecard/dimensions.yaml
     Regenerate with: go run ./cmd/readiness-scorecard -write -->

Generated: 2026-08-29T13:38:03Z

Commit: `c1b59bbaaa78f7fe9b4470b3bd5bb60f36b0d62d`

## How to read this

Every status below is **derived**, never asserted:

| Status | Meaning |
|---|---|
| `met` | Every evidence path exists and the associated static gate passes. |
| `gap` | Evidence is missing or the gate fails. |
| `unverifiable` | The criterion needs a deployed environment, real credentials, or a human judgement. CI cannot prove it either way, so it is **excluded from the score** and listed explicitly rather than counted as met. |

Score is `met / (met + gap)`. Overall: **100%** (37 met, 0 gap, 4 unverifiable).

## Summary

| Dimension | Score | Met | Gap | Unverifiable |
|---|---:|---:|---:|---:|
| Availability | 100% | 5 | 0 | 0 |
| Latency & performance | 100% | 5 | 0 | 1 |
| Security & supply chain | 100% | 10 | 0 | 0 |
| Accessibility | 100% | 2 | 0 | 2 |
| Recovery & resilience | 100% | 9 | 0 | 1 |
| Cost & resource control | 100% | 6 | 0 | 0 |

## Availability

> Can we tell when the platform is down, and does a bad deploy get caught before users do?

| Criterion | Status | Verification | Notes |
|---|---|---|---|
| Every user-facing endpoint has a declarative SLO.<br/><sub>`avail-slo-catalog`</sub> | `met` | `go run ./cmd/slo-coverage-audit` | — |
| SLOs are alerted on with multi-window multi-burn-rate rules, not single-window thresholds.<br/><sub>`avail-burn-alerts`</sub> | `met` | `helm template test helm/teslasync` | — |
| An authenticated smoke gate runs against the deployment after every release.<br/><sub>`avail-post-deploy-smoke`</sub> | `met` | `go run ./cmd/ops-gate -check smoke` | gate "smoke" passes |
| Liveness, readiness, and preStop drain endpoints exist and behave correctly under shutdown.<br/><sub>`avail-probe-contract`</sub> | `met` | `go test ./internal/ops/...` | — |
| Rollout is staged with canary controls and an explicit pause switch.<br/><sub>`avail-staged-rollout`</sub> | `met` | `go run ./cmd/ops-gate -check rollout` | gate "rollout" passes |

## Latency & performance

> Do we have measured budgets for backend and frontend, and do regressions block a release?

| Criterion | Status | Verification | Notes |
|---|---|---|---|
| API latency SLOs exist with explicit percentile budgets.<br/><sub>`lat-api-budgets`</sub> | `met` | `go run ./cmd/slo-coverage-audit` | — |
| Core Web Vitals (LCP/INP/CLS/FCP/TTFB) are collected from real users and have SLOs.<br/><sub>`lat-web-vitals`</sub> | `met` | `go run ./cmd/slo-coverage-audit` | — |
| Frontend performance regressions are caught in CI before merge.<br/><sub>`lat-regression-gate`</sub> | `met` | `gh workflow view perf.yml` | — |
| Latency and Web Vitals thresholds are wired into the automated rollback policy.<br/><sub>`lat-rollback-thresholds`</sub> | `met` | `go run ./cmd/ops-gate -check rollback` | gate "rollback" passes |
| Repeatable capacity profiles exist for the load shapes that break this system.<br/><sub>`lat-capacity-profiles`</sub> | `met` | `go run ./cmd/ops-gate -check capacity` | gate "capacity" passes |
| Each capacity profile has been executed against a representative environment and its results recorded.<br/><sub>`lat-capacity-executed`</sub> | `unverifiable` | `gh workflow run capacity-test.yml -f profile=<id> -f confirm=RUN` | needs a deployed environment or real credentials; CI cannot prove this either way |

## Security & supply chain

> Can a consumer prove what is in a release, and can an attacker move a tag under us?

| Criterion | Status | Verification | Notes |
|---|---|---|---|
| SAST, container scanning, secret scanning, and Go vulnerability scanning run in CI.<br/><sub>`sec-scanning`</sub> | `met` | `gh workflow view security.yml` | — |
| Security workflow actions and scanner images are SHA/digest pinned.<br/><sub>`sec-immutable-actions`</sub> | `met` | `go run ./scripts/check-security-workflow-pins.go` | — |
| Release workflow actions and images are SHA/digest pinned too.<br/><sub>`sec-release-immutability`</sub> | `met` | `go run ./cmd/ops-gate -check supply-chain` | gate "supply-chain" passes |
| Every published image ships a signature, an SBOM attestation, and SLSA build provenance.<br/><sub>`sec-sbom-signing-provenance`</sub> | `met` | `go run ./cmd/ops-gate -check supply-chain` | gate "supply-chain" passes |
| Each release publishes its vulnerability status, and a fixable CRITICAL blocks every public release side effect rather than only the notes.<br/><sub>`sec-vuln-status`</sub> | `met` | `go run ./cmd/ops-gate -check workflows` | gate "workflows" passes |
| No credential values live in the repository; ops manifests reference env var names only.<br/><sub>`sec-no-repo-secrets`</sub> | `met` | `go run ./cmd/ops-gate -check smoke` | gate "smoke" passes |
| No workflow interpolates an untrusted input into a shell script that holds secrets.<br/><sub>`sec-workflow-injection`</sub> | `met` | `go run ./cmd/ops-gate -check workflows` | gate "workflows" passes |
| The pod-fatal preStop drain endpoint is not reachable through any Service or Ingress.<br/><sub>`sec-drain-plane-isolated`</sub> | `met` | `helm template test helm/teslasync \| go run ./cmd/ops-gate -verify-helm-render -` | gate "rollout" passes |
| The Helm chart ships no static database or Grafana password and rejects known weak overrides.<br/><sub>`sec-generated-chart-credentials`</sub> | `met` | `go run ./cmd/ops-gate -check helm-secrets` | gate "helm-secrets" passes |
| Workloads can consume one Secret materialized from Vault or a cloud secret manager without credentials in Helm values.<br/><sub>`sec-external-secret-sources`</sub> | `met` | `go run ./cmd/ops-gate -check helm-secrets` | gate "helm-secrets" passes |

## Accessibility

> Is the UI usable with a keyboard and a screen reader, and is that enforced?

| Criterion | Status | Verification | Notes |
|---|---|---|---|
| Documented accessibility guidelines exist for contributors.<br/><sub>`a11y-guidelines`</sub> | `unverifiable` | `manual review` | the artifact exists, but the assessment is a human judgement; CI cannot score it |
| Automated axe + keyboard checks run in CI on every PR touching the frontend.<br/><sub>`a11y-automated-gate`</sub> | `met` | `gh workflow view frontend-quality.yml` | — |
| Data visualisations carry accessible descriptions rather than being image-only.<br/><sub>`a11y-chart-annotations`</sub> | `met` | `node web/scripts/audit-chart-a11y.mjs` | — |
| A recorded accessibility audit exists with tracked findings.<br/><sub>`a11y-audit-record`</sub> | `unverifiable` | `manual review` | the artifact exists, but the assessment is a human judgement; CI cannot score it |

## Recovery & resilience

> When something breaks, do we know what to do, and have we proved the backups work?

| Criterion | Status | Verification | Notes |
|---|---|---|---|
| Every external dependency has a degraded-mode runbook.<br/><sub>`rec-degraded-runbooks`</sub> | `met` | `go run ./cmd/ops-gate -check runbooks` | gate "runbooks" passes |
| Every new migration is reviewed for forward compatibility, rollback, duration, and lock risk.<br/><sub>`rec-migration-review`</sub> | `met` | `go run ./cmd/ops-gate -check migrations` | gate "migrations" passes |
| A measurable rollback policy exists with an ordered, executable remediation plan.<br/><sub>`rec-rollback-policy`</sub> | `met` | `go run ./cmd/ops-gate -check rollback` | gate "rollback" passes |
| Backup artifacts are verified automatically, not assumed.<br/><sub>`rec-backup-verification`</sub> | `met` | `go test ./cmd/backup-verify/...` | — |
| Every SQL fixture the drill depends on matches the live schema and is executed in CI, not merely checked for existence.<br/><sub>`rec-fixtures-executable`</sub> | `met` | `go run ./cmd/ops-gate -check fixtures` | gate "fixtures" passes |
| A scheduled restore drill is defined and wired to a workflow.<br/><sub>`rec-restore-drill-defined`</sub> | `met` | `go run ./cmd/ops-gate -check restore` | gate "restore" passes |
| Recovery has finite RTO/RPO targets, evidence semantics, and explicitly assigned incident roles.<br/><sub>`rec-objectives-and-ownership`</sub> | `met` | `go run ./cmd/ops-gate -check restore` | gate "restore" passes |
| A production-artifact restore drill has succeeded and its RTO is recorded.<br/><sub>`rec-restore-drill-executed`</sub> | `unverifiable` | `gh workflow run backup-restore-drill.yml -f mode=production-artifact` | needs a deployed environment or real credentials; CI cannot prove this either way |
| Shutdown drains in-flight work instead of dropping it, the grace period can hold the whole budget, and both are covered by tests.<br/><sub>`rec-graceful-shutdown`</sub> | `met` | `go test ./internal/ops/... ./internal/app/...` | — |
| Config cannot drift between Go, Compose, and Helm.<br/><sub>`rec-config-parity`</sub> | `met` | `go run ./cmd/ops-gate -check config-parity` | gate "config-parity" passes |

## Cost & resource control

> Can this deployment run away with someone's money or disk?

| Criterion | Status | Verification | Notes |
|---|---|---|---|
| Every workload declares CPU/memory requests and limits.<br/><sub>`cost-resource-limits`</sub> | `met` | `helm template test helm/teslasync` | — |
| Autoscaling has explicit min/max bounds rather than unbounded growth.<br/><sub>`cost-autoscaling-bounds`</sub> | `met` | `helm template test helm/teslasync` | — |
| The default signal_log retention is finite and wired to an executable cleanup schedule.<br/><sub>`cost-data-retention`</sub> | `met` | `go run ./cmd/ops-gate -check retention` | gate "retention" passes |
| Fleet API calls reserve against a shared daily spend ceiling while preserving command capacity.<br/><sub>`cost-fleet-api-budget`</sub> | `met` | `go run ./cmd/ops-gate -check fleet-api-budget` | gate "fleet-api-budget" passes |
| AI provider spend is rate-limited and budgeted per-account.<br/><sub>`cost-ai-spend-limits`</sub> | `met` | `go test ./internal/ai/limit/...` | — |
| Capacity tests have hard duration ceilings and cannot be pointed at production.<br/><sub>`cost-capacity-ceilings`</sub> | `met` | `go run ./cmd/ops-gate -check capacity` | gate "capacity" passes |

## Open gaps

None.

## Not machine-verifiable

These are **not** claimed as done by CI. Each needs a real environment, a real drill, or a human assessment:

- **lat-capacity-executed** (Latency & performance) — Each capacity profile has been executed against a representative environment and its results recorded. — run: `gh workflow run capacity-test.yml -f profile=<id> -f confirm=RUN`
- **a11y-guidelines** (Accessibility) — Documented accessibility guidelines exist for contributors. — run: `manual review`
- **a11y-audit-record** (Accessibility) — A recorded accessibility audit exists with tracked findings. — run: `manual review`
- **rec-restore-drill-executed** (Recovery & resilience) — A production-artifact restore drill has succeeded and its RTO is recorded. — run: `gh workflow run backup-restore-drill.yml -f mode=production-artifact`
