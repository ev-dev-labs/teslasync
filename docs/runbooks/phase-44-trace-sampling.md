# Trace sampling policy (phase-44)

This document records the trace sampling decisions for TeslaSync. It is
the source of truth referenced by:

- `internal/tracing/tracing.go` — head sampling.
- `helm/teslasync/files/otel-collector/config.yaml` — tail sampling.

## Two-stage sampling

| Stage | Where | What it samples |
|---|---|---|
| Head | `internal/tracing/tracing.go` (`ParentBased(TraceIDRatioBased(0.01))`) | 1% of new traces by default; child spans inherit the parent's decision. |
| Tail | OTel collector (`tail_sampling` processor) | Re-evaluates every trace after `decision_wait` (30s); keeps interesting traces regardless of head decision. |

Head sampling uses `ParentBased` so a single sampling decision propagates
through HTTP entry → DB → MQTT → Tesla-client spans. Without parent-based
sampling we would either oversample (each layer rolls dice independently)
or under-sample (interesting traces lose their root span at the first
unsampled layer).

## Sampling matrix

| Policy | Keep? | Why |
|---|---|---|
| Span status = ERROR | 100% | Errors are always interesting. |
| Root-span latency > 1s | 100% | Slow requests tell us where SLO budgets bleed. |
| `http.route = /api/v1/auth/login` | 100% | Security-sensitive, low volume. |
| Anything else | 1% | Baseline; matches the head sampler. |

The collector enforces the policy AFTER the head-sampling stage. The
processor uses a 30s `decision_wait` so the late-arriving error/slow
indicators are observed before the trace is dropped.

## Tuning knobs

- **Head ratio** — `OTEL_TRACES_SAMPLER_ARG=<ratio>` (env). Default 0.01.
- **Tail policies** — edit `helm/teslasync/files/otel-collector/config.yaml`.
- **Buffer size** — `tail_sampling.num_traces` and `expected_new_traces_per_sec`
  must scale with traffic. Current defaults assume ~200 traces/sec.

## Operational impact

- Increasing the head ratio multiplies bandwidth from app pods to the
  collector linearly.
- Tail-sampling buffers traces in collector memory until `decision_wait`
  expires. Memory ≈ `num_traces × avg_spans_per_trace × bytes_per_span`.
  At defaults (50k × 30 × 2KB) ≈ 3 GB. Adjust `memory_limiter` if you
  raise these.
- Errors and slow requests are kept independent of the head ratio, so
  you can lower the head ratio (e.g., to 0.001) in a high-traffic
  environment without losing diagnostic coverage.

## Related runbooks

- `docs/runbooks/phase-44-debug-from-trace.md` (prompt 0090) — using
  exemplars from the SLO dashboards to jump into Tempo.
- `docs/runbooks/phase-44-respond-to-burn-alert.md` (prompt 0091) — how
  burn-rate alerts use the kept traces.
