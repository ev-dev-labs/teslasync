package metrics

import (
	"sync"
	"testing"

	"github.com/prometheus/client_golang/prometheus"
	dto "github.com/prometheus/client_model/go"
)

// The conflict registry is the anti-inflation mechanism: an HTTP read that
// re-observes the SAME disagreement must be a no-op for every metric. These
// tests pin that, plus the bounded label vocabulary.

func TestRecordVehicleStateConflictIsIdempotentPerVehicle(t *testing.T) {
	ResetVehicleStateConflictsForTests()
	t.Cleanup(ResetVehicleStateConflictsForTests)

	if changed := RecordVehicleStateConflict(1, "charging", "parked"); !changed {
		t.Fatal("first observation of a conflict must report a change")
	}
	// Five more polls of the same vehicle in the same disagreement — this is
	// exactly what a 30s dashboard refresh does.
	for i := 0; i < 5; i++ {
		if changed := RecordVehicleStateConflict(1, "charging", "parked"); changed {
			t.Fatalf("repeat observation %d reported a change; reads must not inflate the signal", i)
		}
	}

	got := VehicleStateConflictSnapshot()
	if got["charging->parked"] != 1 {
		t.Fatalf("conflict count = %d, want 1 vehicle regardless of read volume (%v)",
			got["charging->parked"], got)
	}
}

func TestRecordVehicleStateConflictCountsDistinctVehicles(t *testing.T) {
	ResetVehicleStateConflictsForTests()
	t.Cleanup(ResetVehicleStateConflictsForTests)

	RecordVehicleStateConflict(1, "charging", "parked")
	RecordVehicleStateConflict(2, "charging", "parked")
	RecordVehicleStateConflict(3, "driving", "online")

	got := VehicleStateConflictSnapshot()
	if got["charging->parked"] != 2 {
		t.Fatalf("charging->parked = %d, want 2", got["charging->parked"])
	}
	if got["driving->online"] != 1 {
		t.Fatalf("driving->online = %d, want 1", got["driving->online"])
	}
}

func TestConflictGaugeMatchesRegistryAfterConcurrentUpdates(t *testing.T) {
	ResetVehicleStateConflictsForTests()
	t.Cleanup(ResetVehicleStateConflictsForTests)

	const vehicles = 100
	var wg sync.WaitGroup
	wg.Add(vehicles)
	for vehicleID := int64(1); vehicleID <= vehicles; vehicleID++ {
		go func(id int64) {
			defer wg.Done()
			RecordVehicleStateConflict(id, "charging", "parked")
		}(vehicleID)
	}
	wg.Wait()

	gauge := VehicleStateConflictCurrent.WithLabelValues("charging", "parked")
	metric := &dto.Metric{}
	if err := gauge.Write(metric); err != nil {
		t.Fatalf("read conflict gauge: %v", err)
	}
	if got := metric.GetGauge().GetValue(); got != vehicles {
		t.Fatalf("published gauge = %v, want %d to match the registry", got, vehicles)
	}
}

func TestRecordVehicleStateConflictMovesVehicleBetweenBuckets(t *testing.T) {
	ResetVehicleStateConflictsForTests()
	t.Cleanup(ResetVehicleStateConflictsForTests)

	RecordVehicleStateConflict(1, "charging", "parked")
	if changed := RecordVehicleStateConflict(1, "driving", "parked"); !changed {
		t.Fatal("a DIFFERENT disagreement for the same vehicle must report a change")
	}

	got := VehicleStateConflictSnapshot()
	if got["charging->parked"] != 0 {
		t.Fatalf("old bucket = %d, want 0 after the vehicle moved (%v)", got["charging->parked"], got)
	}
	if got["driving->parked"] != 1 {
		t.Fatalf("new bucket = %d, want 1 (%v)", got["driving->parked"], got)
	}

	oldGauge := &dto.Metric{}
	if err := VehicleStateConflictCurrent.WithLabelValues("charging", "parked").Write(oldGauge); err != nil {
		t.Fatalf("read old conflict gauge: %v", err)
	}
	if got := oldGauge.GetGauge().GetValue(); got != 0 {
		t.Fatalf("old published gauge = %v, want 0 after the vehicle moved", got)
	}

	newGauge := &dto.Metric{}
	if err := VehicleStateConflictCurrent.WithLabelValues("driving", "parked").Write(newGauge); err != nil {
		t.Fatalf("read new conflict gauge: %v", err)
	}
	if got := newGauge.GetGauge().GetValue(); got != 1 {
		t.Fatalf("new published gauge = %v, want 1 after the vehicle moved", got)
	}
}

func TestClearVehicleStateConflictOnlyReportsRealTransitions(t *testing.T) {
	ResetVehicleStateConflictsForTests()
	t.Cleanup(ResetVehicleStateConflictsForTests)

	if changed := ClearVehicleStateConflict(1); changed {
		t.Fatal("clearing a vehicle that was never in conflict must not report a transition")
	}
	RecordVehicleStateConflict(1, "charging", "parked")
	if changed := ClearVehicleStateConflict(1); !changed {
		t.Fatal("clearing a conflicted vehicle must report the transition once")
	}
	if changed := ClearVehicleStateConflict(1); changed {
		t.Fatal("a converged fleet must not emit a resolution transition on every poll")
	}
	if got := VehicleStateConflictSnapshot()["charging->parked"]; got != 0 {
		t.Fatalf("count after clear = %d, want 0", got)
	}
}

func TestClearVehicleStateConflictObservesEpisodeDuration(t *testing.T) {
	ResetVehicleStateConflictsForTests()
	t.Cleanup(ResetVehicleStateConflictsForTests)

	observer := VehicleStateConflictDuration.WithLabelValues("charging", "parked")
	histogram, ok := observer.(prometheus.Metric)
	if !ok {
		t.Fatalf("conflict duration observer %T does not expose prometheus.Metric", observer)
	}
	before := &dto.Metric{}
	if err := histogram.Write(before); err != nil {
		t.Fatalf("read conflict duration before clear: %v", err)
	}

	RecordVehicleStateConflict(42, "charging", "parked")
	ClearVehicleStateConflict(42)

	after := &dto.Metric{}
	if err := histogram.Write(after); err != nil {
		t.Fatalf("read conflict duration after clear: %v", err)
	}
	if got, want := after.GetHistogram().GetSampleCount(), before.GetHistogram().GetSampleCount()+1; got != want {
		t.Fatalf("duration sample count = %d, want %d", got, want)
	}
}

func TestConflictStateLabelFoldsUnknownValues(t *testing.T) {
	// Cardinality guard: a future FSM state name (or an empty string) must
	// collapse into the closed vocabulary rather than mint a new series.
	for _, known := range []string{"charging", "driving", "parked", "asleep", "online", "offline", "updating"} {
		if got := conflictStateLabel(known); got != known {
			t.Fatalf("conflictStateLabel(%q) = %q, want passthrough", known, got)
		}
	}
	for _, unknown := range []string{"", "suspended", "VIN5YJ3E1EA7KF000001", "🚗"} {
		if got := conflictStateLabel(unknown); got != "other" {
			t.Fatalf("conflictStateLabel(%q) = %q, want %q", unknown, got, "other")
		}
	}
}
