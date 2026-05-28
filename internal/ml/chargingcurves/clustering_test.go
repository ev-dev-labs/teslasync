// Phase-50 / 0064 — ML3 Charging-curve fingerprint clustering statistical model.
//
// clustering_test.go pins the deterministic statistical trainer's
// contract:
//
//   - per-cluster fallback when fewer than MinSessions sessions exist;
//   - per-cluster learned mean/stddev/p5/p95 when at least MinSessions
//     sessions exist;
//   - days clamping to [1, MaxLookbackDays];
//   - vehicleID <= 0 returns an empty slice;
//   - nil SessionSource returns ErrNoSource;
//   - source-error propagation;
//   - deterministic output order (alphabetic ClusterIDs);
//   - defensive filtering of invalid samples (NaN, +/-Inf, nil);
//   - power-tier classification matches the canonical thresholds.
//
// These tests run in milliseconds and are pinned by both unit and
// golden tests downstream.

package mlchargingcurves

import (
	"context"
	"errors"
	"math"
	"testing"
	"time"

	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"
)

// fakeSource is the deterministic in-memory SessionSource used by
// every test in this file. Pinning the window the trainer passes
// also lets us assert the time math is correct.
type fakeSource struct {
	sessions      []*chargingmodel.ChargingSession
	err           error
	lastVehicleID int64
	lastStart     time.Time
	lastEnd       time.Time
	lastLimit     int
	calls         int
}

func (f *fakeSource) SessionsForVehicle(_ context.Context, vehicleID int64, limit int, start, end time.Time) ([]*chargingmodel.ChargingSession, error) {
	f.lastVehicleID = vehicleID
	f.lastLimit = limit
	f.lastStart = start
	f.lastEnd = end
	f.calls++
	if f.err != nil {
		return nil, f.err
	}
	return f.sessions, nil
}

// fixedNow returns a deterministic time.Now() so window math is
// reproducible in tests.
func fixedNow() time.Time {
	return time.Date(2026, 5, 15, 12, 0, 0, 0, time.UTC)
}

// newTestTrainer constructs a trainer wired with the supplied fake
// source, MinSessions=3 (the package default), LookbackDays=90 (the
// package default), and a fixed clock so window math is
// deterministic.
func newTestTrainer(src *fakeSource) *Trainer {
	t := NewTrainer(src)
	t.nowFn = fixedNow
	return t
}

// floatPtr returns a pointer to v. Useful for setting nullable
// model fields concisely in tests.
func floatPtr(v float64) *float64 { return &v }

// strPtr returns a pointer to s.
func strPtr(s string) *string { return &s }

// makeSession builds a *chargingmodel.ChargingSession with peak/avg/energy
// + an ended_at 1 hour after started_at so DurationMinutes() returns
// a non-nil value. id is the row primary key (used by the example
// IDs assertions).
func makeSession(id int64, peakW, avgW, energyWh float64, chargerType string) *chargingmodel.ChargingSession {
	startedAt := time.Date(2026, 5, 1, 22, 0, 0, 0, time.UTC)
	endedAt := startedAt.Add(time.Hour)
	return &chargingmodel.ChargingSession{
		ID:                 id,
		VehicleID:          42,
		StartedAt:          startedAt,
		EndedAt:            &endedAt,
		PeakPowerW:         floatPtr(peakW),
		AvgPowerW:          floatPtr(avgW),
		TotalEnergyAddedWh: floatPtr(energyWh),
		ChargerType:        strPtr(chargerType),
		DeltaSocPct:        floatPtr(40),
	}
}

// TestClassifyChargingPowerTier_KnownBuckets pins the canonical
// L1/L2/DC tier classification.
func TestClassifyChargingPowerTier_KnownBuckets(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		peak *float64
		want string
	}{
		{"nil", nil, "unknown"},
		{"zero", floatPtr(0), "unknown"},
		{"negative", floatPtr(-100), "unknown"},
		{"l1 at threshold", floatPtr(1920), "l1_overnight"},
		{"l1 below threshold", floatPtr(1500), "l1_overnight"},
		{"l2 just above l1", floatPtr(1921), "l2_workplace"},
		{"l2 mid range", floatPtr(7000), "l2_workplace"},
		{"l2 at threshold", floatPtr(19200), "l2_workplace"},
		{"dc just above l2", floatPtr(19201), "dc_fast"},
		{"dc mid range", floatPtr(50000), "dc_fast"},
		{"dc supercharger v3", floatPtr(250000), "dc_fast"},
	}
	for _, tc := range cases {
		got := ClassifyChargingPowerTier(tc.peak)
		if got != tc.want {
			t.Errorf("ClassifyChargingPowerTier(%v) = %q, want %q", tc.peak, got, tc.want)
		}
	}
}

// TestTrainer_NoSourceReturnsErr proves the wiring guard.
func TestTrainer_NoSourceReturnsErr(t *testing.T) {
	t.Parallel()
	tr := &Trainer{}
	_, err := tr.Train(context.Background(), 1, 0)
	if !errors.Is(err, ErrNoSource) {
		t.Fatalf("err = %v, want ErrNoSource", err)
	}
}

// TestTrainer_NonPositiveVehicleIDReturnsEmpty pins the validator
// chokepoint contract: a non-positive vehicle_id is the AI handler's
// problem, not the trainer's. The trainer returns nil/nil so the
// AI handler can decide whether to 4xx or 5xx.
func TestTrainer_NonPositiveVehicleIDReturnsEmpty(t *testing.T) {
	t.Parallel()
	src := &fakeSource{sessions: []*chargingmodel.ChargingSession{}}
	tr := newTestTrainer(src)
	out, err := tr.Train(context.Background(), 0, 0)
	if err != nil {
		t.Fatalf("err = %v, want nil", err)
	}
	if len(out) != 0 {
		t.Fatalf("len(out) = %d, want 0", len(out))
	}
	if src.calls != 0 {
		t.Fatalf("source.calls = %d, want 0 (early return on vehicleID<=0)", src.calls)
	}
}

// TestTrainer_NoSessionsReturnsEmpty pins the empty-window
// behaviour: zero clusters reported (the trainer skips empty
// buckets). This is the "I have no charging history" UX.
func TestTrainer_NoSessionsReturnsEmpty(t *testing.T) {
	t.Parallel()
	src := &fakeSource{sessions: []*chargingmodel.ChargingSession{}}
	tr := newTestTrainer(src)
	out, err := tr.Train(context.Background(), 1, 0)
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if len(out) != 0 {
		t.Fatalf("len(out) = %d, want 0 (no sessions ⇒ no clusters)", len(out))
	}
}

// TestTrainer_FallbackBelowMinSessions pins the rule-label-fallback
// behaviour: a cluster with fewer than MinSessions sessions emits
// SourceRuleLabelFallback with no statistics but honest SessionCount.
func TestTrainer_FallbackBelowMinSessions(t *testing.T) {
	t.Parallel()
	// Two L2 sessions — below the MinSessions=3 floor.
	src := &fakeSource{sessions: []*chargingmodel.ChargingSession{
		makeSession(1, 7000, 6000, 30000, "wall_connector"),
		makeSession(2, 7100, 6100, 31000, "wall_connector"),
	}}
	tr := newTestTrainer(src)
	out, err := tr.Train(context.Background(), 42, 0)
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if len(out) != 1 {
		t.Fatalf("len(out) = %d, want 1 (l2_workplace cluster)", len(out))
	}
	c := out[0]
	if c.ClusterID != "l2_workplace" {
		t.Errorf("ClusterID = %q, want l2_workplace", c.ClusterID)
	}
	if c.Source != SourceRuleLabelFallback {
		t.Errorf("Source = %q, want %q (only 2 sessions < MinSessions=3)", c.Source, SourceRuleLabelFallback)
	}
	if c.SessionCount != 2 {
		t.Errorf("SessionCount = %d, want 2", c.SessionCount)
	}
	if c.PeakPowerWMean != 0 || c.PeakPowerWStddev != 0 {
		t.Errorf("learned stats present in fallback: peakMean=%v stddev=%v", c.PeakPowerWMean, c.PeakPowerWStddev)
	}
	if c.DominantChargerType != "wall_connector" {
		t.Errorf("DominantChargerType = %q, want wall_connector", c.DominantChargerType)
	}
	if len(c.ExampleSessionIDs) != 2 || c.ExampleSessionIDs[0] != 1 || c.ExampleSessionIDs[1] != 2 {
		t.Errorf("ExampleSessionIDs = %v, want [1 2]", c.ExampleSessionIDs)
	}
}

// TestTrainer_LearnedAtOrAboveMinSessions pins the learned-cluster
// behaviour: a cluster with MinSessions or more sessions emits
// SourceLearned with full statistics.
func TestTrainer_LearnedAtOrAboveMinSessions(t *testing.T) {
	t.Parallel()
	// Five L2 sessions — well above MinSessions=3.
	src := &fakeSource{sessions: []*chargingmodel.ChargingSession{
		makeSession(1, 7000, 6000, 30000, "wall_connector"),
		makeSession(2, 7200, 6200, 31000, "wall_connector"),
		makeSession(3, 6800, 5800, 29000, "wall_connector"),
		makeSession(4, 7100, 6100, 30500, "wall_connector"),
		makeSession(5, 6900, 5900, 29500, "wall_connector"),
	}}
	tr := newTestTrainer(src)
	out, err := tr.Train(context.Background(), 42, 0)
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if len(out) != 1 {
		t.Fatalf("len(out) = %d, want 1 (l2_workplace cluster)", len(out))
	}
	c := out[0]
	if c.Source != SourceLearned {
		t.Fatalf("Source = %q, want %q (5 sessions ≥ MinSessions=3)", c.Source, SourceLearned)
	}
	if c.SessionCount != 5 {
		t.Errorf("SessionCount = %d, want 5", c.SessionCount)
	}
	// Peak mean = (7000+7200+6800+7100+6900)/5 = 7000.
	if math.Abs(c.PeakPowerWMean-7000) > 1e-9 {
		t.Errorf("PeakPowerWMean = %v, want 7000", c.PeakPowerWMean)
	}
	if c.PeakPowerWStddev <= 0 {
		t.Errorf("PeakPowerWStddev = %v, want > 0", c.PeakPowerWStddev)
	}
	if c.PeakPowerWP5 < 6800 || c.PeakPowerWP5 > 7000 {
		t.Errorf("PeakPowerWP5 = %v, want in [6800, 7000]", c.PeakPowerWP5)
	}
	if c.PeakPowerWP95 > 7200 || c.PeakPowerWP95 < 7000 {
		t.Errorf("PeakPowerWP95 = %v, want in [7000, 7200]", c.PeakPowerWP95)
	}
	// avg/peak ≈ 6000/7000 = 0.857
	if c.RampShapeMean < 0.8 || c.RampShapeMean > 0.9 {
		t.Errorf("RampShapeMean = %v, want in [0.8, 0.9]", c.RampShapeMean)
	}
}

// TestTrainer_MultipleClustersDeterministicOrder proves the output
// is in canonical [ClusterIDs] order regardless of input ordering.
func TestTrainer_MultipleClustersDeterministicOrder(t *testing.T) {
	t.Parallel()
	// Mix L1 + L2 + DC, each above MinSessions=3.
	sessions := []*chargingmodel.ChargingSession{
		// DC fast first to defeat any "first-seen wins" ordering bug.
		makeSession(10, 50000, 40000, 30000, "supercharger"),
		makeSession(11, 51000, 41000, 31000, "supercharger"),
		makeSession(12, 49000, 39000, 29000, "supercharger"),
		// Then L1.
		makeSession(20, 1500, 1300, 5000, "outlet"),
		makeSession(21, 1600, 1400, 5500, "outlet"),
		makeSession(22, 1400, 1200, 4500, "outlet"),
		// Then L2.
		makeSession(30, 7000, 6000, 30000, "wall_connector"),
		makeSession(31, 7200, 6200, 31000, "wall_connector"),
		makeSession(32, 6800, 5800, 29000, "wall_connector"),
	}
	src := &fakeSource{sessions: sessions}
	tr := newTestTrainer(src)
	out, err := tr.Train(context.Background(), 42, 0)
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if len(out) != 3 {
		t.Fatalf("len(out) = %d, want 3 clusters", len(out))
	}
	wantOrder := []string{"dc_fast", "l1_overnight", "l2_workplace"}
	for i, want := range wantOrder {
		if out[i].ClusterID != want {
			t.Errorf("out[%d].ClusterID = %q, want %q (canonical alphabetic order)", i, out[i].ClusterID, want)
		}
	}
}

// TestTrainer_PropagatesSourceError pins error propagation.
func TestTrainer_PropagatesSourceError(t *testing.T) {
	t.Parallel()
	src := &fakeSource{err: errors.New("db down")}
	tr := newTestTrainer(src)
	_, err := tr.Train(context.Background(), 42, 0)
	if err == nil {
		t.Fatal("err = nil, want propagated source error")
	}
}

// TestTrainer_DaysClampedToMax pins the upper-bound clamp.
func TestTrainer_DaysClampedToMax(t *testing.T) {
	t.Parallel()
	src := &fakeSource{sessions: []*chargingmodel.ChargingSession{}}
	tr := newTestTrainer(src)
	_, err := tr.Train(context.Background(), 42, MaxLookbackDays+1000)
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	// Window is [end - MaxLookbackDays, end] regardless of input.
	wantStart := fixedNow().UTC().AddDate(0, 0, -MaxLookbackDays)
	if !src.lastStart.Equal(wantStart) {
		t.Errorf("lastStart = %v, want %v (clamped at MaxLookbackDays=%d)", src.lastStart, wantStart, MaxLookbackDays)
	}
}

// TestTrainer_DefaultsLookbackWhenZero pins the default-lookback
// behaviour.
func TestTrainer_DefaultsLookbackWhenZero(t *testing.T) {
	t.Parallel()
	src := &fakeSource{sessions: []*chargingmodel.ChargingSession{}}
	tr := newTestTrainer(src)
	_, err := tr.Train(context.Background(), 42, 0)
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	wantStart := fixedNow().UTC().AddDate(0, 0, -DefaultLookbackDays)
	if !src.lastStart.Equal(wantStart) {
		t.Errorf("lastStart = %v, want %v (DefaultLookbackDays=%d)", src.lastStart, wantStart, DefaultLookbackDays)
	}
}

// TestTrainer_DefensiveFiltersBadValues pins the defensive
// filtering: NaN / +/-Inf / negative peaks must not corrupt the
// learned envelope.
func TestTrainer_DefensiveFiltersBadValues(t *testing.T) {
	t.Parallel()
	// Three valid L2 sessions plus three bad ones at L2 level.
	bad1 := makeSession(100, 7000, math.NaN(), 30000, "wall_connector")
	bad2 := makeSession(101, 7000, math.Inf(1), 30000, "wall_connector")
	bad3 := makeSession(102, 7000, -100, 30000, "wall_connector") // negative avg
	good1 := makeSession(1, 7000, 6000, 30000, "wall_connector")
	good2 := makeSession(2, 7200, 6200, 31000, "wall_connector")
	good3 := makeSession(3, 6800, 5800, 29000, "wall_connector")
	src := &fakeSource{sessions: []*chargingmodel.ChargingSession{bad1, bad2, bad3, good1, good2, good3}}
	tr := newTestTrainer(src)
	out, err := tr.Train(context.Background(), 42, 0)
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if len(out) != 1 {
		t.Fatalf("len(out) = %d, want 1", len(out))
	}
	c := out[0]
	// SessionCount counts ALL sessions in the bucket (including
	// the bad ones — they were classified as L2 by their valid
	// peak); the bad avg values are filtered from the avg
	// statistics but the SessionCount remains honest.
	if c.SessionCount != 6 {
		t.Errorf("SessionCount = %d, want 6 (all 6 sessions L2-classified)", c.SessionCount)
	}
	// AvgPowerWMean must be finite; the NaN/Inf/negative samples
	// must not leak into the mean.
	if math.IsNaN(c.AvgPowerWMean) || math.IsInf(c.AvgPowerWMean, 0) {
		t.Errorf("AvgPowerWMean = %v, want finite", c.AvgPowerWMean)
	}
}

// TestCurrentEffectiveClusters returns one entry per ClusterIDs
// (currently no learned persistence; every entry is rule-label
// fallback with SessionCount=0).
func TestCurrentEffectiveClusters(t *testing.T) {
	t.Parallel()
	out := CurrentEffectiveClusters()
	if len(out) != len(ClusterIDs) {
		t.Fatalf("len(out) = %d, want %d", len(out), len(ClusterIDs))
	}
	for i, id := range ClusterIDs {
		if out[i].ClusterID != id {
			t.Errorf("out[%d].ClusterID = %q, want %q", i, out[i].ClusterID, id)
		}
		if out[i].Source != SourceRuleLabelFallback {
			t.Errorf("out[%d].Source = %q, want %q (no learned persistence today)", i, out[i].Source, SourceRuleLabelFallback)
		}
		if out[i].SessionCount != 0 {
			t.Errorf("out[%d].SessionCount = %d, want 0", i, out[i].SessionCount)
		}
	}
}
