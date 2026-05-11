# Phase-44: HTTP RED metrics — label vocabulary & conventions

> **Status:** active (Phase-44 prompt 0020).
> **Owner:** Observability working group.
> **Related runbooks:**
> - [`phase-44-context-propagation-audit.md`](./phase-44-context-propagation-audit.md)
> - [`phase-44-tracing-conventions.md`](./phase-44-tracing-conventions.md) *(authored in earlier phase-44 prompts)*

This runbook documents the **R**ate / **E**rrors / **D**uration metric
contract that every HTTP handler in `internal/api/` exposes via
`MetricsMiddleware` (declared in
[`internal/api/middleware.go`](../../internal/api/middleware.go)).

## TL;DR

Every inbound HTTP request emits **exactly three** metric observations:

| Metric                                                          | Type      | Labels                                | Notes                                               |
|-----------------------------------------------------------------|-----------|----------------------------------------|------------------------------------------------------|
| `teslasync_red_http_requests_total`                             | counter   | `method`, `route`, `status_class`     | Always incremented (1 per request)                   |
| `teslasync_red_http_request_errors_total`                       | counter   | `method`, `route`, `status_class`     | Incremented **only** when `status_class == "5xx"`    |
| `teslasync_red_http_request_duration_seconds`                   | histogram | `method`, `route`                      | Sample observed once per request, in seconds         |

The histogram buckets are:
`{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10}` seconds.

Names use the `red_` prefix so they coexist with the legacy
`teslasync_http_requests_total` / `teslasync_http_request_duration_seconds`
counters in [`internal/metrics/metrics.go`](../../internal/metrics/metrics.go).
The legacy counters use `{method, path, status}` labels and remain emitted
by `PrometheusMiddleware` for backwards-compatible Grafana queries during
the migration window. They will be deprecated once dashboards & alerts have
been ported to the RED metric set.

## Label vocabulary

### `method`

The HTTP verb of the request, in uppercase as it arrives from `r.Method`.
Cardinality is bounded by the IANA-registered method set
(`GET`/`POST`/`PUT`/`PATCH`/`DELETE`/`HEAD`/`OPTIONS`/...).

### `route`

The **canonical chi route pattern** of the matched handler — for example
`/api/v1/drives/{driveID}` — *not* the request URL. This is critical to
avoid label-cardinality explosions from path parameters.

`MetricsMiddleware` resolves the route via
`chi.RouteContext(r.Context()).RoutePattern()`. When chi has no match
(e.g. 404 on a path that didn't reach any registered handler), the
middleware falls back to the existing `normalizePath()` helper in
[`internal/api/metrics.go`](../../internal/api/metrics.go) which performs
prefix-based collapsing (`/api/v1/drives/123` → `/api/v1/drives/:id`,
etc.). Unrouted paths that don't match any normalisation rule pass through
verbatim — these should be rare and worth investigating.

### `status_class`

Five fixed values derived from the response status code by
`statusClass()` in `internal/api/middleware.go`:

| Status code range | `status_class` |
|-------------------|----------------|
| `100`..`199`      | `1xx`          |
| `200`..`299`      | `2xx`          |
| `300`..`399`      | `3xx`          |
| `400`..`499`      | `4xx`          |
| `500`..`599`      | `5xx`          |
| any other value   | `5xx`          |

Out-of-range codes (negative, `0`, ≥`600`) collapse to `5xx` so the
cardinality of this label is hard-bounded at five. **Do not** introduce
the raw status code as a label; high-cardinality status labels were
identified as a top-three Prometheus operator pain point in the
phase-44 observability ADR.

## Errors-counter semantics

`teslasync_red_http_request_errors_total` is incremented **only** for
`5xx` responses (server errors). 4xx responses are NOT considered
service errors — they are client-driven and should be tracked separately
(e.g., via specific 4xx auth-failure counters in the auth subsystem) if
attention is warranted.

This convention makes the per-route error rate query trivial:

```promql
sum by (route) (
  rate(teslasync_red_http_request_errors_total[5m])
)
/
sum by (route) (
  rate(teslasync_red_http_requests_total[5m])
)
```

## Recording & alerting recipes

### RED dashboard tiles

```promql
# Rate (req/s) per route
sum by (route) (rate(teslasync_red_http_requests_total[1m]))

# Error rate (5xx %, per route)
100 *
  sum by (route) (rate(teslasync_red_http_request_errors_total[5m]))
/
  sum by (route) (rate(teslasync_red_http_requests_total[5m]))

# Latency p95 per route (seconds)
histogram_quantile(0.95,
  sum by (le, route) (rate(teslasync_red_http_request_duration_seconds_bucket[5m]))
)
```

### Burn-rate alert template (consumed by phase-44 prompt 0032)

```yaml
- alert: APIError5xxBurn_Fast
  expr: |
    sum by (route) (rate(teslasync_red_http_request_errors_total[5m]))
      /
    sum by (route) (rate(teslasync_red_http_requests_total[5m]))
      > (1 - 0.999) * 14.4
  for: 2m
  labels:
    severity: page
  annotations:
    summary: "5xx burn-rate too high on {{ $labels.route }}"
```

## Implementation notes

### Where the middleware is wired

In [`internal/api/router.go`](../../internal/api/router.go), the chain is:

```go
r.Use(chimw.RequestID)
r.Use(chimw.RealIP)
r.Use(TracingMiddleware)
r.Use(LoggerMiddleware)
r.Use(RecoveryMiddleware)
r.Use(ErrorTrackingMiddleware(errorTracker))
r.Use(PrometheusMiddleware) // legacy {method,path,status} — kept for back-compat dashboards
r.Use(MetricsMiddleware)    // RED metrics with status_class
```

`MetricsMiddleware` MUST come **after** chi's RequestID and AFTER any
middleware that materialises a routing context. Coming after
`RecoveryMiddleware` is also important: if a handler panics, the
recovery middleware converts the panic to `500`, *then* the deferred
record in `MetricsMiddleware` fires and counts the request as a 5xx
server error — the test
`TestMetricsMiddleware_RecordsAfterPanic` (in
[`internal/api/middleware_metrics_test.go`](../../internal/api/middleware_metrics_test.go))
pins this behaviour.

### Instrumentation via `chimw.NewWrapResponseWriter`

`MetricsMiddleware` wraps the writer with
`chimw.NewWrapResponseWriter` so it can read the final `Status()` after
the handler returns. This is the same wrapper used by `LoggerMiddleware`
to keep the two consistent — if you ever need to extend either, refactor
once and reuse.

### Observation timing

Duration is measured from the moment `MetricsMiddleware` fires through
to the moment the deferred record runs — this includes time spent in
all *downstream* middleware as well as the handler. It does **not**
include time spent in *upstream* middleware (RequestID, RealIP, Tracing,
Logger, Recovery, ErrorTracking, PrometheusMiddleware), which is
typically sub-millisecond.

## Audit & coverage

`MetricsMiddleware` is wired exactly once at the global router level
(`internal/api/router.go`), so coverage is 100% of inbound `/api/v1/*`
traffic by construction. There is no per-handler instrumentation work
to do; adding a new route automatically gains all three RED metrics.

If a future change moves a handler outside the global middleware chain
(e.g., a separate sub-router that bypasses the main `r.Use(...)` chain),
the handler MUST re-attach `MetricsMiddleware` explicitly. Phase-44
prompt 0080 (route-coverage audit) verifies this invariant.

## Testing the contract

Tests in
[`internal/api/middleware_metrics_test.go`](../../internal/api/middleware_metrics_test.go)
pin every contract listed above:

| Test | Pins                                                                                    |
|------|------------------------------------------------------------------------------------------|
| `TestStatusClass`                                  | The `1xx`/`2xx`/`3xx`/`4xx`/`5xx` mapping (incl. out-of-range fallback)             |
| `TestRouteLabel_UsesChiPattern`                    | chi `RoutePattern()` is used when available                                          |
| `TestRouteLabel_UnroutedFallsBackToNormalizedPath` | Fallback to `normalizePath()` when chi has no match                                  |
| `TestMetricsMiddleware_HappyPath`                  | 2xx → +1 requests, +0 errors, +1 duration sample                                     |
| `TestMetricsMiddleware_ErrorPath`                  | 5xx → +1 requests, +1 errors, +1 duration sample                                     |
| `TestMetricsMiddleware_ClientErrorIsNotErrorBucket`| 4xx → +1 requests, +0 errors                                                          |
| `TestMetricsMiddleware_RecordsAfterPanic`          | Panicking handler → +1 requests, +1 errors (recovered to 500)                         |

## Future work tracked in subsequent phase-44 prompts

- **0021** — exemplars (link traces from histogram buckets) ✅ landed
- **0022** — business SLIs (drive-completed, charge-completed)
- **0030** — SLO catalog yaml referencing these RED metrics
- **0031** — Prometheus recording rules over these counters
- **0032** — burn-rate alerts (see template above)
- **0033** — Grafana dashboards consuming these metrics
- **0080** — route-coverage audit (verifies every route is instrumented)

## Trace-ID exemplars on the latency histogram

Since prompt 0021, the latency histogram observation is routed through
`observeDurationWithExemplar()` (in
[`internal/api/middleware.go`](../../internal/api/middleware.go)) which calls
`prometheus.ExemplarObserver.ObserveWithExemplar()` whenever the active OTel
span context is **valid AND sampled**. The exemplar carries two label pairs:

| Exemplar label | Source                                                     |
|----------------|------------------------------------------------------------|
| `trace_id`     | `trace.SpanContextFromContext(ctx).TraceID().String()`     |
| `span_id`     | `trace.SpanContextFromContext(ctx).SpanID().String()`      |

When no span is in flight, or the span is explicitly NOT sampled
(`TraceFlags=0`), the observation falls back to a plain `Observe()` and no
exemplar is recorded. Tests
`TestObserveDurationWithExemplar_AttachesTraceID`,
`TestObserveDurationWithExemplar_NoExemplarWithoutSampledSpan`, and
`TestObserveDurationWithExemplar_NotSampledSpanIsSkipped` pin all three
branches.

### Prometheus configuration required

Exemplars are only **stored and queryable** when Prometheus is started with
the `--enable-feature=exemplar-storage` flag. Without the flag, the
histogram still emits exemplars on /metrics scrapes, but Prometheus drops
them on ingestion, so the Grafana "Show exemplars" toggle has nothing to
render.

In [`deploy/`](../../deploy/) Helm/Compose definitions, add to the
Prometheus container args:

```yaml
args:
  - --config.file=/etc/prometheus/prometheus.yml
  - --storage.tsdb.path=/prometheus
  - --enable-feature=exemplar-storage   # required for trace-ID exemplars
```

In a docker-compose dev stack:

```yaml
prometheus:
  image: prom/prometheus:v2.47.0
  command:
    - --config.file=/etc/prometheus/prometheus.yml
    - --enable-feature=exemplar-storage
```

### Querying exemplars

Once the flag is on, exemplars are queryable via:

```
GET /api/v1/query_exemplars?query=teslasync_red_http_request_duration_seconds_bucket&start=...&end=...
```

In Grafana, enable the "Show exemplars" toggle on any panel using the
histogram, and configure a "Trace to logs / Trace to metrics" datasource
link from `trace_id` → Tempo so a click on a bucket exemplar opens the
trace.

### Follow-on work

The exemplar feature gate is enabled per-Prometheus-server. Phase-44
prompt 0050 (Helm OTel collector) and 0051 (Helm Tempo) will land the
chart-side configuration so all three observability backends agree on
the contract. Until then, dev stacks must enable the flag manually.
