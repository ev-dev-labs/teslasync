// Package telemetry bootstraps the OpenTelemetry tracer/metric providers.
//
// Layer: platform
//
// Per ADR-007: this package KEEPS its current charter (OpenTelemetry
// plumbing) but will be RENAMED to internal/platform/observability in
// phase-48 to avoid name collision with internal/telemetry (phase-42
// territory). See docs/architecture/platform-consolidation-todo.md.
package telemetry
