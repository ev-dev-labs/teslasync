// Package slo serves the live SLO board at GET /api/v1/admin/observability/slo.
//
// It returns catalog metadata plus live SLI, budget, and fast/slow burn-rate
// evaluations when Prometheus is configured; without PROM_BASE_URL the SPA can
// still render SLO names and targets with a clear misconfiguration banner.
//
// Layer: handler
package slo
