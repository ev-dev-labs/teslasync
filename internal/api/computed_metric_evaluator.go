// Package api: deprecated aliases for the computed-metric evaluator.
//
// All real logic lives in internal/notification/computed (extracted in
// phase-47/05). The aliases here keep existing internal/api callers
// (alert_handler.go, alert_handler_rules.go) compiling for one release.
//
// Deprecated: import "github.com/ev-dev-labs/teslasync/internal/notification/computed"
// directly. These aliases will be removed in phase-48.
package api

import (
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/notification/computed"
)

// Deprecated: use computed.Evaluator.
type ComputedMetricEvaluator = computed.Evaluator

// Deprecated: use computed.Result.
type ComputedMetricResult = computed.Result

// NewComputedMetricEvaluator builds an evaluator backed by the global
// ComputedMetrics registry.
//
// Deprecated: use computed.New.
func NewComputedMetricEvaluator(db *database.DB) *ComputedMetricEvaluator {
	return computed.New(db)
}
