package metrics

// Synthetic multi-step journey step metrics.
//
// A JourneyProbe (internal/synthetic) walks a fixed operator chain
// (e.g. "dashboard/fleet state -> vehicle inspect -> battery health ->
// charging history") and reports one observation per step per run.
// Labels are deliberately bounded: `journey` and `step` are both fixed,
// small vocabularies declared in code (see
// internal/synthetic.OperatorChainJourneySteps) — never vehicle IDs,
// VINs, or other unbounded/PII-bearing values.
import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

const (
	operatorChainJourneyLabel = "operator_chain"
	unknownJourneyLabel       = "unknown"
)

var operatorChainStepLabels = map[string]struct{}{
	"fleet_state":      {},
	"vehicle_inspect":  {},
	"battery_health":   {},
	"charging_history": {},
}

var (
	syntheticJourneyStepDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Namespace: "teslasync",
		Subsystem: "synthetic",
		Name:      "journey_step_duration_seconds",
		Help:      "Duration of one step of a synthetic multi-step operator journey.",
		Buckets:   prometheus.DefBuckets,
	}, []string{"journey", "step"})

	syntheticJourneyStepResults = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Subsystem: "synthetic",
		Name:      "journey_step_results_total",
		Help:      "Count of synthetic journey step outcomes by bounded result label.",
	}, []string{"journey", "step", "result"})
)

// ObserveSyntheticJourneyStep records one step's outcome. result must
// be one of "ok", "skipped", or "failed" — callers pass primitive
// fields (not a synthetic.JourneyStepResult) so this package does not
// need to import internal/synthetic.
func ObserveSyntheticJourneyStep(journey, step string, ok, skipped bool, durationMs int64) {
	if journey != operatorChainJourneyLabel {
		journey = unknownJourneyLabel
		step = unknownJourneyLabel
	} else if _, known := operatorChainStepLabels[step]; !known {
		step = unknownJourneyLabel
	}
	result := "failed"
	switch {
	case skipped:
		result = "skipped"
	case ok:
		result = "ok"
	}
	syntheticJourneyStepDuration.WithLabelValues(journey, step).Observe(float64(durationMs) / 1000)
	syntheticJourneyStepResults.WithLabelValues(journey, step, result).Inc()
}
