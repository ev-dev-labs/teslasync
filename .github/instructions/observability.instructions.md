---
applyTo: "internal/**,web/**"
---

# Observability Instructions

These rules implement `.github/ARCHITECTURE.md` ADR-008 for all backend and frontend observability changes.

## Required

1. Every HTTP handler creates a span via `otel.Tracer("api").Start(ctx, ...)`.
2. Every repo method accepts `ctx context.Context` first and propagates it.
3. Every outbound HTTP call uses `otelhttp.NewTransport`.
4. Every MQTT message handler creates a span seeded from message metadata.
5. Every prometheus metric has labels for `method`, `route`, `status_class`.
6. Every user-facing endpoint has an SLO entry in `slo/catalog.yaml`.
7. Every `.Error()` log line carries `trace_id` from the active span.
8. Frontend RUM bootstraps in `web/src/main.tsx` only — never in pages.
9. **Every worker `main.go`** calls `tracing.Init(ctx, cfg, tracing.WithServiceName("teslasync-<worker>"))` immediately after logger setup and defers a 5s-bounded shutdown before `cancel()`. Failure to connect to the collector MUST log a warning and continue (non-fatal); never crash the worker on telemetry setup.
10. **Every MQTT publisher on an internal topic** (notifications, exports, automation reload/webhook — anything `teslasync/*` we own end-to-end) MUST wrap the payload via `mqtt.InjectTraceContext(ctx, body)` so the consumer can resume the trace. Tesla Fleet Telemetry topics are exempt — Tesla owns the publisher and we start a root span on consume.
11. **Every MQTT consumer on an internal topic** MUST call `mqtt.ExtractTraceContext(ctx, msg.Payload())` to recover the parent context and use the unwrapped payload bytes. The helper falls back to passthrough for legacy un-enveloped messages, so it is safe to deploy consumer-first.
12. **Every new SSE caller** uses `EventHub.BroadcastWithContext(ctx, eventType, data)` or `BroadcastSignalChangeWithContext`. The bare `Broadcast` / `BroadcastSignalChange` methods are `// Deprecated:` thin wrappers that emit a root `sse.broadcast` span — acceptable for legacy paths but never for new code.
13. **Every FSM engine constructed in a composition root** (router.go, worker main, app/new.go) MUST receive `engine.SetTracer(tracing.NewFSMTracer("fsm.<scope>"))` where `<scope>` is `vehicle|charging|export|trip|notification`. The domain `internal/domain/fsm` and `internal/app/*svc` packages remain zero-dep on OTel (per ADR-006); the adapter lives in `internal/tracing`.
14. **Every long-lived ticker loop** (worker tick handlers, in-API background workers like `gas_price_worker`, `maintenance_worker`, `unit_drift_validator`, `signal_history_cleanup`, `trip_generator`, `ai_background_jobs`, `health_watchdog`) creates a per-iteration span named `<domain>.<action>_tick` so a stuck or slow tick is visible in Tempo.
15. **Every flow listed in `cmd/trace-coverage-audit/main.go`** MUST stay green. If you add a new background flow, add it to the audit and verify `go run ./cmd/trace-coverage-audit` exits 0 before merging.

## Prohibited

- Direct `jaegerexporter` SDK calls in new code (use OTel collector).
- Hand-edited Prometheus rule files (use code generator).
- Single-window error-rate alerts (use MW-MBR).
- Spans without `defer span.End()`.
- Metrics with unbounded label cardinality (e.g., `vehicle_id` as label without sampling). Span attributes MAY carry `vehicle_id` — span cardinality is bounded by trace sampling, not by Prometheus label cartesian explosion.
- `fmt.Errorf` in handlers without recording the error on the span.
- Calling the deprecated `EventHub.Broadcast` / `BroadcastSignalChange` from new code (use the `*WithContext` variants).
- Publishing to an internal MQTT topic without `mqtt.InjectTraceContext` — breaks end-to-end trace continuity across the broker.
- Importing `go.opentelemetry.io/otel` into `internal/domain/**` or `internal/app/*svc` — keeps the FSM/domain layer testable without an OTel dependency.

## References

- `.github/ARCHITECTURE.md` ADR-008
- `docs/runbooks/phase-44-trace-coverage-audit.md` — list of flows the audit gate enforces
- `internal/tracing/tracing.go` — `Init` + functional options
- `internal/mqtt/propagation.go` — `InjectTraceContext` / `ExtractTraceContext`
- `internal/tracing/fsmtracer.go` — OTel adapter for the domain `fsm.Tracer` port
