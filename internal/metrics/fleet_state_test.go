package metrics

import (
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	dto "github.com/prometheus/client_model/go"
)

func metricValue(t *testing.T, metric prometheus.Metric) float64 {
	t.Helper()
	sample := &dto.Metric{}
	if err := metric.Write(sample); err != nil {
		t.Fatalf("write metric: %v", err)
	}
	if sample.Gauge != nil {
		return sample.GetGauge().GetValue()
	}
	return sample.GetCounter().GetValue()
}

func TestObserveFleetStateBatchPublishesCoverageAgeAndEvidence(t *testing.T) {
	ResetFleetStateMetricsForTests()
	t.Cleanup(ResetFleetStateMetricsForTests)

	now := time.Date(2026, 8, 27, 12, 0, 0, 0, time.UTC)
	ObserveFleetStateBatch(now, []FleetStateMetricObservation{
		{VehicleID: 1, Verified: true, ObservedAt: now.Add(-10 * time.Second)},
		{VehicleID: 2, Reason: "stale", ObservedAt: now.Add(-2 * time.Minute)},
		{VehicleID: 3, Reason: "failed"},
		{VehicleID: 4, Reason: "unverified", ObservedAt: now.Add(-30 * time.Second)},
	})

	if got := metricValue(t, FleetTelemetryCoverageRatio); got != 0.25 {
		t.Fatalf("coverage ratio = %v, want 0.25", got)
	}
	if got := metricValue(t, FleetTelemetryOldestObservationAge); got != 120 {
		t.Fatalf("oldest observation age = %v, want 120", got)
	}
	if got := metricValue(t, FleetStateEvidenceCurrent.WithLabelValues("stale")); got != 1 {
		t.Fatalf("stale evidence count = %v, want 1", got)
	}
}

func TestObserveFleetStateBatchCountsFallbackTransitionsOnly(t *testing.T) {
	ResetFleetStateMetricsForTests()
	t.Cleanup(ResetFleetStateMetricsForTests)

	now := time.Now()
	stale := []FleetStateMetricObservation{{VehicleID: 7, Reason: "stale"}}
	ObserveFleetStateBatch(now, stale)
	ObserveFleetStateBatch(now, stale)

	if got := metricValue(t, FleetStateFallbackTotal.WithLabelValues("stale")); got != 1 {
		t.Fatalf("stale fallback transitions = %v, want 1", got)
	}

	ObserveFleetStateBatch(now, []FleetStateMetricObservation{{VehicleID: 7, Reason: "failed"}})
	if got := metricValue(t, FleetStateFallbackTotal.WithLabelValues("failed")); got != 1 {
		t.Fatalf("failed fallback transitions = %v, want 1", got)
	}
}

func TestObserveFleetStateBatchMergesDisjointPages(t *testing.T) {
	ResetFleetStateMetricsForTests()
	t.Cleanup(ResetFleetStateMetricsForTests)

	now := time.Date(2026, 8, 27, 12, 0, 0, 0, time.UTC)
	firstPage := []FleetStateMetricObservation{
		{VehicleID: 1, Verified: true, ObservedAt: now.Add(-10 * time.Second)},
		{VehicleID: 2, Reason: "stale", ObservedAt: now.Add(-2 * time.Minute)},
	}
	secondPage := []FleetStateMetricObservation{
		{VehicleID: 3, Reason: "failed"},
	}

	ObserveFleetStateBatch(now, firstPage)
	ObserveFleetStateBatch(now, secondPage)
	ObserveFleetStateBatch(now, firstPage)
	ObserveFleetStateBatch(now, secondPage)

	if got := metricValue(t, FleetTelemetryCoverageRatio); got != 1.0/3.0 {
		t.Fatalf("coverage ratio = %v, want 1/3 across both pages", got)
	}
	if got := metricValue(t, FleetTelemetryOldestObservationAge); got != 120 {
		t.Fatalf("oldest observation age = %v, want 120 across both pages", got)
	}
	if got := metricValue(t, FleetStateEvidenceCurrent.WithLabelValues("verified")); got != 1 {
		t.Fatalf("verified evidence count = %v, want 1 across both pages", got)
	}
	if got := metricValue(t, FleetStateEvidenceCurrent.WithLabelValues("stale")); got != 1 {
		t.Fatalf("stale evidence count = %v, want 1 across both pages", got)
	}
	if got := metricValue(t, FleetStateEvidenceCurrent.WithLabelValues("failed")); got != 1 {
		t.Fatalf("failed evidence count = %v, want 1 across both pages", got)
	}
	if got := metricValue(t, FleetStateFallbackTotal.WithLabelValues("stale")); got != 1 {
		t.Fatalf("stale fallback transitions = %v, want 1 across repeated pages", got)
	}
	if got := metricValue(t, FleetStateFallbackTotal.WithLabelValues("failed")); got != 1 {
		t.Fatalf("failed fallback transitions = %v, want 1 across repeated pages", got)
	}
}

func TestObserveFleetStateBatchEvictsVehiclesThatStopAppearing(t *testing.T) {
	ResetFleetStateMetricsForTests()
	t.Cleanup(ResetFleetStateMetricsForTests)

	now := time.Date(2026, 8, 27, 12, 0, 0, 0, time.UTC)
	ObserveFleetStateBatch(now, []FleetStateMetricObservation{
		{VehicleID: 1, Reason: "stale", ObservedAt: now.Add(-2 * time.Minute)},
		{VehicleID: 2, Verified: true, ObservedAt: now.Add(-10 * time.Second)},
	})

	refreshedAt := now.Add(fleetStateMetricRecordTTL + time.Second)
	ObserveFleetStateBatch(refreshedAt, []FleetStateMetricObservation{
		{VehicleID: 2, Verified: true, ObservedAt: refreshedAt},
	})

	if got := metricValue(t, FleetTelemetryCoverageRatio); got != 1 {
		t.Fatalf("coverage ratio = %v, want 1 after departed vehicle eviction", got)
	}
	if got := metricValue(t, FleetTelemetryOldestObservationAge); got != 0 {
		t.Fatalf("oldest observation age = %v, want 0 after departed vehicle eviction", got)
	}
	if got := metricValue(t, FleetStateEvidenceCurrent.WithLabelValues("stale")); got != 0 {
		t.Fatalf("stale evidence count = %v, want 0 after departed vehicle eviction", got)
	}
	if got := metricValue(t, FleetStateEvidenceCurrent.WithLabelValues("verified")); got != 1 {
		t.Fatalf("verified evidence count = %v, want 1 after departed vehicle eviction", got)
	}
}

func TestObserveFleetStateBatchIgnoresOlderOverlappingResponse(t *testing.T) {
	ResetFleetStateMetricsForTests()
	t.Cleanup(ResetFleetStateMetricsForTests)

	now := time.Date(2026, 8, 27, 12, 0, 0, 0, time.UTC)
	ObserveFleetStateBatch(now, []FleetStateMetricObservation{{
		VehicleID:  1,
		Verified:   true,
		ObservedAt: now,
	}})
	ObserveFleetStateBatch(now.Add(-time.Second), []FleetStateMetricObservation{{
		VehicleID: 1,
		Reason:    "failed",
	}})

	if got := metricValue(t, FleetTelemetryCoverageRatio); got != 1 {
		t.Fatalf("coverage ratio = %v, want 1 after older response", got)
	}
	if got := metricValue(t, FleetStateEvidenceCurrent.WithLabelValues("verified")); got != 1 {
		t.Fatalf("verified evidence count = %v, want 1 after older response", got)
	}
	if got := metricValue(t, FleetStateFallbackTotal.WithLabelValues("failed")); got != 0 {
		t.Fatalf("failed fallback transitions = %v, want 0 from ignored older response", got)
	}
}

func TestObserveFleetStateBatchBoundsUnknownReason(t *testing.T) {
	ResetFleetStateMetricsForTests()
	t.Cleanup(ResetFleetStateMetricsForTests)

	ObserveFleetStateBatch(time.Now(), []FleetStateMetricObservation{{
		VehicleID: 9,
		Reason:    "future-unbounded-reason",
	}})

	if got := metricValue(t, FleetStateEvidenceCurrent.WithLabelValues("other")); got != 1 {
		t.Fatalf("other evidence count = %v, want 1", got)
	}
}

func TestObserveFleetStateBatchPreservesCanonicalUnknownReason(t *testing.T) {
	ResetFleetStateMetricsForTests()
	t.Cleanup(ResetFleetStateMetricsForTests)

	ObserveFleetStateBatch(time.Now(), []FleetStateMetricObservation{{
		VehicleID: 10,
		Reason:    "unknown",
	}})

	if got := metricValue(t, FleetStateEvidenceCurrent.WithLabelValues("unknown")); got != 1 {
		t.Fatalf("unknown evidence count = %v, want 1", got)
	}
}
