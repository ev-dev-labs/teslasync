# Cost & resource controls

Where TeslaSync's spend and disk growth are bounded, and what happens
when a bound is removed. Referenced by the `cost` dimension of the
production readiness scorecard (`ops/scorecard/dimensions.yaml`).

Self-hosting shifts cost from a subscription to compute, storage, and —
for the AI features — per-token API spend. All three are bounded by
default; none of the bounds are load-bearing on human vigilance.

## Compute

| Control | Where | Default |
|---|---|---|
| CPU/memory requests + limits | `helm/teslasync/values.yaml` `resources`, `web.resources`, per-worker `resources` | Set for every workload |
| Compose memory limits | `docker-compose.yml` `deploy.resources` | Set for every service |
| Autoscaling bounds | `helm/teslasync/values.yaml` `autoscaling.minReplicas` / `maxReplicas` | Disabled; explicit min/max when enabled |
| Canary replicas | `rollout.<component>.canary.replicaCount` | `1`, and canary is disabled by default |

Autoscaling is off by default. When it is enabled, `maxReplicas` is the
only thing between a traffic anomaly and an unbounded bill — treat
raising it as a cost decision, not a capacity decision.

## Storage

Fleet telemetry is the dominant cost driver: `signal_log` is a
hypertable receiving every changed field for every vehicle, forever,
unless bounded.

| Control | Environment variable | Purpose |
|---|---|---|
| Signal history retention | `SIGNAL_HISTORY_RETENTION_DAYS` | Trims `signal_log`, the largest table |
| Position retention | `POSITION_RETENTION_DAYS` | Trims GPS history |
| General data retention | `DATA_RETENTION_DAYS` | Trims the remaining time-series |
| MongoDB TTL | `MONGODB_TTL_DAYS` | Bounds the optional document store |

Helm surfaces these under `retention` in `values.yaml`.

Two things to know before changing them:

1. **Continuous aggregates keep their own copies.** `cagg_fleet_stats`
   and `cagg_battery_daily` survive raw-row trimming, so shortening raw
   retention loses point-in-time reconstruction but not long-range
   trends.
2. **Retention is not recoverable.** Trimmed telemetry cannot be
   backfilled — Tesla does not re-deliver history. Shorten a retention
   window only after confirming what depends on it.

## AI provider spend

This is the only per-request *monetary* cost, and it is the one that can
run away fastest.

| Control | Where |
|---|---|
| Per-account token/cost quota | `internal/ai/limit/quota.go` |
| Cost accounting per call | `internal/ai/limit/cost.go`, `internal/ai/provider/cost_decorator.go` |
| Rate limiting | `internal/ai/provider/ratelimit_decorator.go` |
| Staged enablement | `ops/rollout/stages.yaml` — `ai-provider-live-calls` is enabled at the canary stage, not at image promotion |

The quota **fails closed**: when it is exhausted, AI features report
unavailable rather than continuing to spend. See
`docs/runbooks/degraded-mode-ai-provider.md` — raising a quota to
"unblock" a feature is a deliberate spend decision and should be
recorded as one.

Running a local Ollama instance moves this cost from per-token API spend
to compute, which is bounded by the resource limits above.

## Load generation

Capacity tests are the one part of this system that can generate cost on
purpose. `ops/capacity/profiles.yaml` bounds them:

- `safety.max_duration: 30m` — a hard ceiling the gate enforces against
  every profile's declared duration.
- `safety.allowed_environments` — the gate rejects any entry containing
  "prod", so a capacity profile structurally cannot target production.
- `safety.require_confirmation` — `CONFIRM=RUN` must be typed; the k6
  scripts refuse to start without it.
- `.github/workflows/capacity-test.yml` boots and destroys its own
  ephemeral stack, and has no input for aiming at a long-lived
  environment.

## Observability retention

The self-hosted observability stack has its own footprint: Prometheus
TSDB, Tempo trace blocks, and Pyroscope profiles. Trace sampling is
controlled by `OTEL_TRACES_SAMPLER_ARG` (default `1.0` — every trace).
On a busy fleet that is the second-largest storage consumer after
`signal_log`; lowering it is the first lever to pull if trace storage
grows faster than expected.

## Reviewing cost

There is no automated cost gate — this is a self-hosted deployment and
the bill lives outside the repository. What *is* automated:

```bash
go run ./cmd/ops-gate -check capacity     # load-generation ceilings
helm template test helm/teslasync         # resource limits + HPA bounds render
go test ./internal/ai/limit/...           # spend quotas behave
```

The readiness scorecard reports these as the `cost` dimension:

```bash
go run ./cmd/readiness-scorecard
```
