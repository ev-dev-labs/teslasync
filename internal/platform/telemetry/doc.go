// Package telemetry retains the Prometheus metrics + zerolog bootstrap
// helpers used by internal/handler/middleware. Tracer-init responsibility
// was consolidated into internal/tracing (single canonical OTel bootstrap
// used by cmd/teslasync via internal/app.New and by every worker main via
// tracing.Init with WithServiceName). See .github/ARCHITECTURE.md ADR-008.
//
// Layer: platform
package telemetry
