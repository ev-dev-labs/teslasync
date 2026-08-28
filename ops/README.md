# `ops/` — release & operations control plane

Machine-readable manifests for TeslaSync's release and operations
maturity programme (OPS-01 … OPS-13). Everything here is *executable
policy*: each file is validated against the actual state of the
repository by a deterministic, offline gate.

```bash
go run ./cmd/ops-gate            # run every gate
go run ./cmd/ops-gate -list      # what exists
go run ./cmd/ops-gate -check migrations
```

CI runs the same command in `.github/workflows/ops-gate.yml`. No
database, no cluster, no credentials, no network.

## What lives here

| File | Epic | Gate | Enforces |
|---|---|---|---|
| `epics.yaml` | OPS-12 | `epics` | Every accepted epic has an owner, acceptance criteria with real evidence paths, and a status that cannot overstate what has been verified. |
| `smoke/checks.yaml` | OPS-01 | `smoke` | The post-deploy smoke manifest is complete, credential-free, and covers availability, frontend, observability, and recovery. |
| `rollback/policy.yaml` | OPS-02 | `rollback` | Measurable rollback thresholds for API/frontend error rate, latency, LCP/INP, and migration failure, plus an executable remediation plan. |
| `restore/drill.yaml` | OPS-03 | `restore` | The backup restore drill is scheduled, self-contained by default, and honest about what has actually been measured. |
| `migrations/manifest.yaml` | OPS-04 | `migrations` | Every new migration records forward compatibility, rollback notes, expected duration, and a lock risk no weaker than static analysis detects. |
| `rollout/stages.yaml` | OPS-05 | `rollout` | Staged/canary rollout controls match the Helm chart; high-risk flags are registered with a blast radius and an enabling stage. |
| `config/parity.yaml` | OPS-06 | `config-parity` | Config exists in Go, Compose, and Helm together; credentials never render into a ConfigMap. |
| `release/supply-chain.yaml` | OPS-08 | `supply-chain` | Release actions/images are immutable; signature, SBOM, and provenance attestations are mandatory. |
| `capacity/profiles.yaml` | OPS-10 | `capacity` | Capacity profiles are safe, repeatable, cannot target production, and cannot claim a run that did not happen. |
| `runbooks/dependencies.yaml` | OPS-11 | `runbooks` | Every external dependency has a degraded-mode runbook with six complete operator sections. |
| `workflows/policy.yaml` | — | `workflows` | No workflow interpolates an untrusted input into a secret-bearing shell script, and no conditional dependent job relies on an implicit `success()`. |
| `scorecard/dimensions.yaml` | OPS-13 | `scorecard` | The readiness scorecard definition is well-formed and every gate reference resolves. |

Two assertions need rendered manifests rather than static files, so they
run as a separate mode:

```bash
helm template test helm/teslasync | go run ./cmd/ops-gate -verify-helm-render -
```

It proves stable and canary Deployment selectors are disjoint (Kubernetes
selectors are *superset* matches, so a canary pod is otherwise adopted by
the stable Deployment, its HPA, and its PDB), that the Service still
fronts both tiers, that no Service publishes the pod-fatal drain port,
and that `terminationGracePeriodSeconds` can hold the shutdown budget.

## Design rules

**No secrets.** Credentials are referenced by environment variable
*name* only. The smoke gate rejects anything that looks like an inline
credential, and `.gitleaks.toml` covers the rest.

**Nothing claims what it has not verified.** This is the rule the gates
exist to enforce, and it shows up in several shapes:

- An epic with an acceptance criterion that needs a deployed environment
  cannot be marked `implemented` — only
  `implemented-pending-infrastructure`.
- A capacity profile with `last_executed` set to a date must carry a
  `run_reference` someone can open. `never` means never.
- The restore drill's `measurement_status` must be
  `pending-first-drill` until a real drill has been timed; RTO/RPO
  targets can never be presented as measured capability.
- Scorecard criteria that need infrastructure or human judgement are
  reported as `unverifiable` and **excluded from the score** rather than
  quietly counted as met.

**Ratchets, not big-bang cleanups.** `config/parity.yaml` and
`migrations/manifest.yaml` both carry a baseline so pre-existing debt
does not block unrelated work — but new drift fails immediately, and a
baseline entry that stops drifting must be deleted, so the list can only
shrink.

**Defaults never change behaviour.** The rollout controls added for
OPS-05 render exactly the pre-existing Kubernetes manifests until an
operator opts in.

## Adding a new gate

1. Implement `func CheckX(fs.FS) []Finding` in `internal/ops/`.
2. Register it in `internal/ops/gate.go` `Checks()`.
3. Add its manifest here, and a table row above.
4. Add a unit test with both an accepting and a rejecting case — a gate
   that has never been seen to fail is not a gate.
5. If it belongs on the readiness scorecard, reference it by name from
   `scorecard/dimensions.yaml`; the scorecard gate verifies the name
   resolves.

## Related

- `docs/operations/production-readiness-scorecard.md` — generated, do not edit.
- `docs/operations/release-verification.md` — how to verify a published image.
- `docs/operations/cost-controls.md` — where spend and disk growth are bounded.
- `docs/runbooks/degraded-mode-*.md` — one per external dependency.
- `docs/runbooks/backup-restore-drill.md` — the restore drill procedure.
