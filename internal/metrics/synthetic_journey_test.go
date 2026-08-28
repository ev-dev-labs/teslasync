package metrics

import (
	"testing"

	"github.com/prometheus/client_golang/prometheus/testutil"
)

func TestObserveSyntheticJourneyStep(t *testing.T) {
	t.Parallel()

	ObserveSyntheticJourneyStep(operatorChainJourneyLabel, "fleet_state", true, false, 120)
	if got := testutil.ToFloat64(syntheticJourneyStepResults.WithLabelValues(operatorChainJourneyLabel, "fleet_state", "ok")); got != 1 {
		t.Errorf("ok counter = %v, want 1", got)
	}

	ObserveSyntheticJourneyStep(operatorChainJourneyLabel, "vehicle_inspect", true, true, 0)
	if got := testutil.ToFloat64(syntheticJourneyStepResults.WithLabelValues(operatorChainJourneyLabel, "vehicle_inspect", "skipped")); got != 1 {
		t.Errorf("skipped counter = %v, want 1", got)
	}

	ObserveSyntheticJourneyStep(operatorChainJourneyLabel, "battery_health", false, false, 5000)
	if got := testutil.ToFloat64(syntheticJourneyStepResults.WithLabelValues(operatorChainJourneyLabel, "battery_health", "failed")); got != 1 {
		t.Errorf("failed counter = %v, want 1", got)
	}
}

func TestObserveSyntheticJourneyStepBoundsUnknownLabels(t *testing.T) {
	t.Parallel()

	before := testutil.ToFloat64(
		syntheticJourneyStepResults.WithLabelValues(unknownJourneyLabel, unknownJourneyLabel, "ok"),
	)
	ObserveSyntheticJourneyStep("vehicle_42", "dynamic_42", true, false, 1)
	ObserveSyntheticJourneyStep("vehicle_99", "dynamic_99", true, false, 1)
	if got := testutil.ToFloat64(
		syntheticJourneyStepResults.WithLabelValues(unknownJourneyLabel, unknownJourneyLabel, "ok"),
	); got != before+2 {
		t.Errorf("bounded unknown counter = %v, want %v", got, before+2)
	}
}
