// Package api: deprecated aliases for the computed-metric registry.
//
// All real logic lives in internal/notification/computed. The aliases
// here keep existing internal/api callers (alert_handler.go,
// alert_handler_rules.go) compiling for one release.
//
// Deprecated: import "github.com/ev-dev-labs/teslasync/internal/notification/computed"
// directly. These aliases will be removed in a future cleanup.
package api

import (
	"time"

	"github.com/ev-dev-labs/teslasync/internal/notification/computed"
)

// Deprecated: use computed.MetricFn.
type MetricFn = computed.MetricFn

// Deprecated: use computed.MetricDef.
type MetricDef = computed.MetricDef

// Deprecated: use computed.MetricSummary.
type MetricSummary = computed.MetricSummary

// Deprecated: use computed.ComputedMetricOps.
var ComputedMetricOps = computed.ComputedMetricOps

// Deprecated: use computed.ComputedMetricWindows.
var ComputedMetricWindows = computed.ComputedMetricWindows

// Deprecated: use computed.ComputedMetrics.
var ComputedMetrics = computed.ComputedMetrics

// Deprecated: use computed.ErrUnknownMetric.
var ErrUnknownMetric = computed.ErrUnknownMetric

// Deprecated: use computed.ListMetricSummaries.
func ListMetricSummaries() []MetricSummary {
	return computed.ListMetricSummaries()
}

// Deprecated: use computed.IsValidComputedMetricOp.
func IsValidComputedMetricOp(op string) bool {
	return computed.IsValidComputedMetricOp(op)
}

// Deprecated: use computed.IsPercentChangeOp.
func IsPercentChangeOp(op string) bool {
	return computed.IsPercentChangeOp(op)
}

// Deprecated: use computed.CompareMetric.
func CompareMetric(op string, value, threshold float64) (bool, error) {
	return computed.CompareMetric(op, value, threshold)
}

// Deprecated: use computed.ComparePercentChange.
func ComparePercentChange(op string, current, prev, thresholdPct float64) (bool, float64, error) {
	return computed.ComparePercentChange(op, current, prev, thresholdPct)
}

// Deprecated: use computed.WindowBounds.
func WindowBounds(window string, now time.Time) (start, end time.Time, err error) {
	return computed.WindowBounds(window, now)
}

// Deprecated: use computed.PreviousWindowBounds.
func PreviousWindowBounds(window string, now time.Time) (start, end time.Time, err error) {
	return computed.PreviousWindowBounds(window, now)
}
