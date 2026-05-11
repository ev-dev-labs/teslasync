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

## Prohibited

- Direct `jaegerexporter` SDK calls in new code (use OTel collector).
- Hand-edited Prometheus rule files (use code generator).
- Single-window error-rate alerts (use MW-MBR).
- Spans without `defer span.End()`.
- Metrics with unbounded label cardinality (e.g., `vehicle_id` as label without sampling).
- `fmt.Errorf` in handlers without recording the error on the span.

## References

- `.github/ARCHITECTURE.md` ADR-008
