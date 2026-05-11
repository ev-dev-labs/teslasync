# Debug from a trace — operator runbook

> Phase 44 / Prompt 0090

This runbook explains how to use the new tracing stack
(Grafana → Tempo → Loki → Prometheus) to debug a slow or failing request.
It assumes you have access to Grafana with the Tempo and Prometheus
datasources provisioned per `phase-44-0052-helm-grafana-tempo-datasource`.

## Overview

```
slow user report  ─►  Grafana SLO dashboard  ─►  exemplar dot
                                                   │
                                                   ▼
                                                Tempo trace
                                          ┌────────┼────────┐
                                          ▼        ▼        ▼
                                        Loki   Prometheus  span tree
                                       (logs)  (metrics)   (timing)
```

The pipeline is built so you should never have to grep raw logs to
diagnose a single slow request. Always start at a metric exemplar.

## Prerequisites

- Grafana 10+ with the **Prometheus** and **Tempo** datasources.
- The OTel collector is forwarding traces with sampling per
  `docs/runbooks/phase-44-trace-sampling.md` (errors + slow always kept).
- Trace IDs are present in your application logs (the Go zerolog setup
  injects `trace_id` automatically when a context with a span is logged
  through it; the JS RUM SDK does the equivalent in the browser).

## Walkthrough

### Step 1 — Find a slow request via an exemplar

Open Grafana → **SLO Overview** dashboard. Pick the offending SLO
(e.g. `api_latency_p99_500ms`). Look for the latency-histogram panel
with green dots overlaid: each dot is an **exemplar** trace ID Tempo
ingested for that latency bucket. Hover a dot above the SLO threshold
line to see its trace ID.

### Step 2 — Click the exemplar

Click the **trace ID** link in the exemplar tooltip ("View trace"
label, courtesy of `exemplarTraceIdDestinations` in the datasource
config). Grafana opens the Tempo split view and renders the span tree.

### Step 3 — Examine the span tree

The root span is the HTTP entry (named e.g. `GET /api/v1/vehicles/{id}/state`).
Its children are the chi middleware spans, then the handler, then the
service-layer spans, then the database / Tesla-API / Redis spans.

Look for:

- **Long bars** — a span whose duration is most of the trace.
- **Red icons** — spans with `status.code = ERROR`.
- **Wide gaps** between sibling spans — context-propagation bug; a span
  was not started where it should have been.

### Step 4 — Jump to logs (Loki)

Each span has a "Logs for this span" button if Loki is provisioned with
the datasource UID `loki`. The button shifts the time range by ±1 min
around the span and queries by `trace_id="<id>"`. If Loki is not
provisioned in your install, copy the trace ID and run a Prometheus
query manually: `count by (trace_id) (otelcol_processor_batch_batch_size_count)`.

### Step 5 — Jump to metrics (Prometheus)

Each span has a "Service map" / "Metrics for this span" button. This
opens Prometheus with a templated query for `service.name`/`http.route`
attributes from the span. Useful for checking whether the slow span is
an outlier (one in a million) or a steady-state regression (every
request to that route is now slow).

### Step 6 — Diagnose

Common patterns:

| Pattern | Likely cause | Fix |
|---|---|---|
| Single long DB span | Slow query plan / missing index | EXPLAIN ANALYZE the query, add index |
| Single long Tesla-API span | Tesla rate limit or upstream hiccup | Check `tesla_*` Grafana panel; if upstream OK, wait |
| Many short DB spans | N+1 problem | Batch the queries in repo layer |
| Long parent + tiny children | Synchronous CPU work outside any span | Add a span around the hot loop |
| Span tree truncated | Sampling dropped children | Bump `decision_wait` in OTel collector tail-sampling |

## Example 1 — `/vehicles/{id}/state` p99 spike to 2 s

1. SLO dashboard shows `api_latency_p99_500ms` budget burning at 12×.
2. Latency panel exemplars show 3 dots near the 2 s mark, all on
   `route=/api/v1/vehicles/{vehicleID}/state`.
3. Clicked exemplar opens Tempo. Trace shows:
   - HTTP entry: 1980 ms.
   - `service.GetVehicleState`: 1970 ms.
   - `signal.Store.GetState`: 1960 ms.
   - `database.Query` (one row): 1955 ms ← anomalous.
4. Clicked "Logs for this span" → Loki shows `query took 1955ms` with
   the SQL: `SELECT * FROM signal_log WHERE vehicle_id = $1 ORDER BY emitted_at DESC LIMIT 1`.
5. EXPLAIN ANALYZE → seq scan; missing index on `(vehicle_id, emitted_at DESC)`.
6. Added migration; latency dropped back below 200 ms p99.

## Example 2 — `/commands/{id}/wake` returns 504

1. Burn-rate alert `WakeCommandFastBurn` fires.
2. Errors-rate panel shows 100% 504 for the last 30 min.
3. Latency panel exemplars all coloured red (ERROR status).
4. Clicked exemplar → Tempo span tree shows:
   - HTTP entry → handler → `tesla.WakeUp` (timed out at 30 s).
   - Tesla-client span has `error: true`, `error.message: context deadline exceeded`.
5. Logs (via Loki link) show repeated `429 Too Many Requests` from
   the Tesla Owner API on the same VIN.
6. Diagnosed as Tesla rate limit; throttled the wake-up loop in
   `internal/service/wake_loop.go`. Errors stopped within a release.

## Example 3 — MQTT pipeline lag

1. Custom dashboard "MQTT pipeline" shows ingest lag at 8 s
   (consumer-vs-producer offset).
2. There's no exemplar on a synchronous request, but the
   `normalize.process` span is published from the pipeline.
3. Filtered Tempo for `service.name=teslasync-mqtt` and sorted by
   duration. Top hit: `normalize.write` at 7 s.
4. Span attributes show `db.statement.preview =
   "INSERT INTO drive_telemetry ..."`, `db.rows_affected=1`, and the
   span has 6 children all called `database.Query`. N+1 detected.
5. Refactored the writer to batch inserts; lag dropped to 200 ms.

## Related runbooks

- `phase-44-trace-sampling.md` — head + tail sampling matrix.
- `phase-44-log-sampling.md` — zerolog sampler chain shape.
- `phase-44-respond-to-burn-alert.md` — what to do when an SLO burn-rate alert fires.
- `phase-44-add-new-slo.md` — workflow for adding a new SLO entry.
