// Package computed provides the computed-metric evaluator + registry that
// the notification worker uses to fire kind='computed_metric' alert rules.
//
// Unlike the streaming-signal RuleEngine in internal/api, this evaluator
// is invoked on a fixed cadence (every ~5 minutes by the notification
// worker) and aggregates window-bounded values from drives /
// charging_sessions / signal_log via SQL queries.
//
// This package owns the canonical metric registry (charging_cost,
// distance, energy_consumed, etc.). internal/api/computed_metrics.go
// keeps deprecated aliases for one release so existing alert handlers
// keep compiling; new code should import this package directly.
//
// Layer: platform
package computed
