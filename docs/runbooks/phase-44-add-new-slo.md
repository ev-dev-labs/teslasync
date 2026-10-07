# Add a new SLO — developer runbook

> Phase 44 / Prompt 0092

This runbook walks a TeslaSync developer through the workflow for adding
a new Service Level Objective (SLO). The catalog is the single source of
truth — Prometheus recording rules, burn-rate alerts, and Grafana
dashboards are all generated from `slo/catalog.yaml`.

## When to add an SLO

Add an SLO when:

- A user-facing feature ships and has clear "good vs bad" semantics
  (success ratio, latency, freshness, availability).
- The team agrees on a target the business can reasonably promise
  (e.g. 99.5 % monthly availability).
- You can express the SLI with two PromQL series (`good_events`,
  `valid_events`) that already exist or that the new feature emits.

Do NOT add an SLO for:

- Internal-only tooling.
- Anything you cannot measure with Prometheus today (add the
  measurement first, in a separate PR).
- A feature without an owner.

## Prerequisites

- The metric your SLI will use (`teslasync_red_*`,
  `teslasync_normalize_*`, etc.) is being scraped successfully —
  confirm in Prometheus before authoring.
- You know the proposed objective (% target) and window (e.g. `30d`).
- An owner team for the SLO; the catalog uses snake-case team names
  (`platform`, `frontend`, `data-pipeline`).

## Checklist

### 1. Edit `slo/catalog.yaml`

Append a new entry under `slos:` following the strict YAML subset
documented at the top of the file:

```yaml
  - name: my_new_slo                      # snake_case; unique
    description: "One-line plain English." # double-quoted, single line
    sli:
      good_events: "<promql expr returning rate(...)>"
      valid_events: "<promql expr returning rate(...)>"
    objective: 99.5                        # percentage; 0 < x < 100
    window: 30d                            # m / h / d / w
    owner: platform                        # team name (snake_case)
    fast_burn_severity: ticket             # optional; defaults to page
    tags: [http, red]                      # inline array; lowercase
```

Use `fast_burn_severity: ticket` only for non-urgent planning signals where a
fast burn needs operator attention but must not page on-call, such as an
intentionally enforced spend ceiling.

### 2. Validate

```powershell
go run ./cmd/slogen validate slo/catalog.yaml
```

This runs the strict-YAML parser + schema check. Common failures:

- `name not snake_case` — only `[a-z][a-z0-9_]*`.
- `window not [0-9]+[mhdw]` — `30d`, `12h`, `15m`, `1w`.
- `unbalanced quotes in PromQL` — escape `"` as `\"`.
- `flow-map syntax detected` — only inline arrays for `tags` are allowed.

### 3. Run all codegens

```powershell
go run ./cmd/slogen generate recording  -catalog slo/catalog.yaml -out helm/teslasync/files/prometheus/recording-rules.yaml
go run ./cmd/slogen generate alerts     -catalog slo/catalog.yaml -out helm/teslasync/files/prometheus/alerting-rules.yaml
go run ./cmd/slogen generate dashboards -catalog slo/catalog.yaml -out-dir helm/teslasync/files/grafana/dashboards/
```

Each command writes idempotently — re-runs are byte-stable so the diff
is the smallest possible.

### 4. Eyeball the diffs

```powershell
git diff helm/teslasync/files/prometheus/recording-rules.yaml
git diff helm/teslasync/files/prometheus/alerting-rules.yaml
git diff helm/teslasync/files/grafana/dashboards/
```

You should see exactly one new recording-rule group with 4 rules
(5m / 1h / 6h / 30d windows), one new alert group with 2 alerts
(`<Name>FastBurn`, `<Name>SlowBurn`), and one new dashboard JSON.

### 5. Run tests

```powershell
go build ./...
go test ./cmd/slogen/...
```

The `cmd/slogen` test suite includes a golden-file pass that catches
template drift.

### 6. Helm-lint

```powershell
helm lint helm/teslasync
```

The dashboards configmap globs `files/grafana/dashboards/*.json`, so
the new file is picked up automatically. No template edits needed.

### 7. Verify on a kind cluster (optional but recommended)

```powershell
helm upgrade --install teslasync helm/teslasync \
  --set observability.tempo.enabled=true \
  --set observability.otelCollector.enabled=true
kubectl port-forward svc/teslasync-grafana 3000:3000
```

Open Grafana, navigate to the new dashboard. Confirm:

- SLI ratio panel renders (no "No data").
- Objective line drawn.
- Burn-rate panel populated.
- The two alerts show up in the Alerting page.

### 8. Document the runbook URL

Each burn-rate alert points to `phase-44-respond-to-burn-alert.md` by
default. If your SLO needs a custom triage path, add a short addendum
to that runbook (do NOT fork — keep the on-call playbook centralised).

### 9. Commit

```powershell
git add slo/catalog.yaml \
        helm/teslasync/files/prometheus/recording-rules.yaml \
        helm/teslasync/files/prometheus/alerting-rules.yaml \
        helm/teslasync/files/grafana/dashboards/
git commit -m "feat(slo): add <my_new_slo>

Tracks <one-line description>. Owner: <team>. Objective: <X>%/<window>."
```

The codegen output is committed alongside the catalog so reviewers
can see the resulting alerts/dashboards in the PR diff.

## Worked example — `vehicle_data_freshness`

Suppose Product asks: "We want a guarantee that 99 % of vehicle-state
reads return data fresher than 60 s."

The metric `teslasync_signal_age_seconds_bucket{state="active"}`
already exists from prompt 0022. Good_events = reads where age ≤ 60 s;
valid_events = all reads where state=active.

### Step 1 — append to catalog

```yaml
  - name: vehicle_data_freshness
    description: "99% of active-vehicle state reads must return data fresher than 60s."
    sli:
      good_events: "sum(rate(teslasync_signal_age_seconds_bucket{state=\"active\",le=\"60\"}[5m]))"
      valid_events: "sum(rate(teslasync_signal_age_seconds_count{state=\"active\"}[5m]))"
    objective: 99.0
    window: 30d
    owner: data-pipeline
    tags: [freshness, ratio]
```

### Step 2 — validate

```powershell
go run ./cmd/slogen validate slo/catalog.yaml
# OK (9 SLOs)
```

### Step 3 — generate

```powershell
go run ./cmd/slogen generate recording  -catalog slo/catalog.yaml -out helm/teslasync/files/prometheus/recording-rules.yaml
go run ./cmd/slogen generate alerts     -catalog slo/catalog.yaml -out helm/teslasync/files/prometheus/alerting-rules.yaml
go run ./cmd/slogen generate dashboards -catalog slo/catalog.yaml -out-dir helm/teslasync/files/grafana/dashboards/
```

Diff inspection confirms:

- 4 new recording rules: `slo:vehicle_data_freshness:ratio_rate{5m,1h,6h,30d}`.
- 2 new alerts: `VehicleDataFreshnessFastBurn`, `VehicleDataFreshnessSlowBurn`.
- New file `helm/teslasync/files/grafana/dashboards/slo-vehicle_data_freshness.json`.

### Step 4 — verify

```powershell
go test ./cmd/slogen/...
helm lint helm/teslasync
```

Both green.

### Step 5 — ship

PR with the catalog + generated artefacts + a one-line note in
`CHANGELOG.md`. Reviewer is the SLO owner team.

## Anti-patterns

- **Per-route SLOs for every endpoint.** Use the chart-wide
  `api_availability` for transitive coverage; reserve per-route SLOs
  for endpoints with truly distinct error budgets.
- **Floating objectives.** Once published, an SLO target is a contract
  — changing it requires team review, not a quiet PR.
- **SLIs that mix dimensions.** Don't sum a histogram bucket count
  with a counter — they have different units. Stick to ratios.
- **Hand-edited dashboards.** All dashboards under
  `helm/teslasync/files/grafana/dashboards/slo-*.json` are
  codegen-owned. Hand-edits will be lost on the next regeneration.

## Related runbooks

- `phase-44-respond-to-burn-alert.md` — what to do when an alert fires.
- `phase-44-debug-from-trace.md` — debugging single failed requests.
- `phase-44-trace-sampling.md` — head + tail sampling.
- `phase-44-log-sampling.md` — zerolog sampler chain.
