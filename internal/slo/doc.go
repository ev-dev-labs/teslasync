// Package slo provides the runtime SLO tracker for TeslaSync.
//
// Layer: platform
//
// The codegen toolkit at cmd/slogen renders Prometheus recording rules,
// multi-window multi-burn-rate alerts,
// and Grafana dashboards from slo/catalog.yaml at build time. This
// package consumes the same catalogue at runtime so the SPA can show
// a live SLO board inside TeslaSync — same source of truth, same SLI
// expressions, no drift between operators looking at Grafana and
// admins looking at the admin/observability/slo page.
//
// Three primitives:
//
//   - Catalog: a strict-YAML loader that mirrors cmd/slogen's parser
//     (no third-party YAML dep). Exposes the same Catalog / SLO / SLI
//     shape.
//   - Tracker: queries the configured Prometheus HTTP API for current
//     burn ratios per SLO across short + long windows for both fast
//     and slow burn tiers. Falls back to direct SLI evaluation when
//     the recording rules are unavailable.
//   - Evaluator: turns Prometheus samples into a Status — burn tier
//     (none/slow/fast), error budget remaining, expected exhaustion
//     date.
//
// Failures are isolated per SLO so a slow Prometheus query doesn't
// block the whole admin board.
package slo
