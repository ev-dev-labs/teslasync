# Cost & resource controls

Where TeslaSync's spend and disk growth are bounded, and what happens
when a bound is removed. Referenced by the `cost` dimension of the
production readiness scorecard (`ops/scorecard/dimensions.yaml`).

Self-hosting shifts cost from a subscription to compute, storage, and —
for the AI features — per-token API spend. Compute and request spend ship
with active ceilings. Destructive telemetry retention requires an explicit
operator acknowledgement after backup verification.

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

| Control | Environment variable | Shipped default | Purpose |
|---|---|---:|---|
| Signal history window | `SIGNAL_HISTORY_RETENTION_DAYS` | 365 days | Selects the raw-history window for `signal_log` and transport evidence |
| Signal history acknowledgement | `SIGNAL_HISTORY_RETENTION_ACKNOWLEDGED` | `false` | Activates destructive chunk removal only after backup verification |
| Position retention | `POSITION_RETENTION_DAYS` | Disabled | Trims the legacy positions table, which receives no canonical telemetry writes |
| General data retention | `DATA_RETENTION_DAYS` | Disabled | Compatibility setting for the removed vehicle-state history; it does not bound active telemetry |
| MongoDB TTL | `MONGODB_TTL_DAYS` | 30 days | Bounds the optional document store |

Go, Docker Compose, and Helm all ship the same 365-day history window and
the same safe `false` acknowledgement default. This prevents an upgrade from
silently deleting telemetry from an existing installation. After an operator
sets `SIGNAL_HISTORY_RETENTION_ACKNOWLEDGED=true`, TeslaSync drops complete
TimescaleDB chunks on a daily schedule for both `signal_log` and
`signal_transport_evidence`. Initial convergence advances through no more
than eight seven-day chunk windows per run.

`ops/retention/policy.yaml` is the machine-readable contract; the retention
ops gate checks both defaults on every configuration surface, the bounded
chunk cleanup, the acknowledgement guard, and the recurring scheduler:

```bash
go run ./cmd/ops-gate -check retention
```

Before enabling cleanup:

1. Create a database backup inside the declared RPO window and complete its
   restore validation.
2. Confirm the selected history window preserves the evidence needed by
   operations, exports, and analytics.
3. Set `SIGNAL_HISTORY_RETENTION_ACKNOWLEDGED=true` and observe
   `chunks_dropped` and `backlog_remaining` in the cleanup logs.

Setting `SIGNAL_HISTORY_RETENTION_DAYS=0` disables cleanup even when it was
previously acknowledged. Leaving acknowledgement `false` preserves all
history and emits a startup warning so the unbounded storage posture is
visible rather than silently destructive.

Two things to know before changing them:

1. **Continuous aggregates keep their own copies.** `cagg_fleet_stats`
   and `cagg_battery_daily` survive raw-row trimming, so shortening raw
   retention loses point-in-time reconstruction but not long-range
   trends.
2. **Retention is destructive.** Trimmed telemetry cannot be
   backfilled — Tesla does not re-deliver history. Shorten a retention
   window only after confirming what depends on it.

## Tesla Fleet API spend

Fleet API polling, wake-ups, commands, and selected partner endpoints are
metered by Tesla. TeslaSync reserves an estimated price before each call
against one atomic UTC-day PostgreSQL row shared by the API server,
automation worker, resubscribe tool, and replicas.

The shipped `$0.30/day` ceiling protects `$0.05` for commands so background
polling cannot consume the entire allowance. The System Budgets page exposes
both rows. The guard fails closed when its database evidence is unavailable.
See `docs/operations/fleet-api-budget.md` for estimates, configuration, and
response procedure.

```bash
go run ./cmd/ops-gate -check fleet-api-budget
```

## AI provider spend

AI inference is the other direct per-request monetary cost and can run away
quickly when a remote provider is enabled.

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

The final cloud invoices live outside the repository, but the controls and
their shipped defaults are machine-gated:

```bash
go run ./cmd/ops-gate -check retention    # signal_log default and enforcement
go run ./cmd/ops-gate -check fleet-api-budget # Fleet API spend + command reserve
go run ./cmd/ops-gate -check capacity     # load-generation ceilings
helm template test helm/teslasync         # resource limits + HPA bounds render
go test ./internal/ai/limit/...           # spend quotas behave
```

The readiness scorecard reports these as the `cost` dimension:

```bash
go run ./cmd/readiness-scorecard
```
