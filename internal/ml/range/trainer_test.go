// Range-prediction trainer tests.
//
// trainer_test.go pins the deterministic statistical trainer's
// contract:
//
//   - per-bucket fallback when fewer than MinSamples drives exist;
//   - per-bucket learned mean/stddev/p5/p95 when at least MinSamples
//     drives exist;
//   - days clamping to [1, MaxDays];
//   - vehicleID <= 0 returns an empty slice;
//   - nil DriveStatsSource returns ErrNoSource;
//   - source-error propagation;
//   - deterministic output order (temp_bucket, speed_bucket
//     alphabetic on each axis);
//   - defensive filtering of invalid Wh/km samples (NaN, +/-Inf,
//     non-positive).
//
// These tests run in milliseconds and are pinned by both unit and
// golden tests downstream.

package mlrange

import (
	"context"
	"errors"
	"math"
	"testing"
	"time"
)

// fakeSource is the deterministic in-memory DriveStatsSource used
// by every test in this file. Pinning the cutoff time the trainer
// passes also lets us assert the time math is correct.
type fakeSource struct {
	samples       []DriveSample
	err           error
	lastVehicleID int64
	lastCutoff    time.Time
	calls         int
}

func (f *fakeSource) SamplesForVehicle(_ context.Context, vehicleID int64, cutoff time.Time) ([]DriveSample, error) {
	f.lastVehicleID = vehicleID
	f.lastCutoff = cutoff
	f.calls++
	if f.err != nil {
		return nil, f.err
	}
	return f.samples, nil
}

// fixedNow returns a deterministic time.Now() so cutoff math is
// reproducible in tests.
func fixedNow() time.Time {
	return time.Date(2026, 5, 15, 12, 0, 0, 0, time.UTC)
}

// newTestTrainer constructs a trainer wired with the supplied fake
// source, MinSamples=5 (the package default), Days=14 (the package
// default), and a fixed clock so cutoff math is deterministic.
func newTestTrainer(src *fakeSource) *Trainer {
	t := NewTrainer(src)
	t.nowFn = fixedNow
	return t
}

// TestTrainer_AllFallbackWhenNoSamples pins the empty-window
// behaviour: every (temp, speed) bucket falls back to the
// HeuristicWhPerKm value with sample_count = 0.
func TestTrainer_AllFallbackWhenNoSamples(t *testing.T) {
	t.Parallel()
	src := &fakeSource{samples: []DriveSample{}}
	tr := newTestTrainer(src)
	out, err := tr.Train(context.Background(), 1, 0)
	if err != nil {
		t.Fatalf("Train err = %v", err)
	}
	want := len(TempBuckets) * len(SpeedBuckets)
	if len(out) != want {
		t.Fatalf("len(out) = %d, want %d", len(out), want)
	}
	for _, b := range out {
		if b.Source != SourceLinearFallback {
			t.Errorf("bucket %s/%s Source = %q, want linear_fallback", b.TempBucket, b.SpeedBucket, b.Source)
		}
		if b.SampleCount != 0 {
			t.Errorf("bucket %s/%s SampleCount = %d, want 0", b.TempBucket, b.SpeedBucket, b.SampleCount)
		}
		// Heuristic returns a positive Wh/km value for every
		// canonical bucket pair — the fallback must surface it.
		if b.WhPerKm <= 0 {
			t.Errorf("bucket %s/%s WhPerKm = %v, want > 0", b.TempBucket, b.SpeedBucket, b.WhPerKm)
		}
	}
}

// TestTrainer_LearnedWhenEnoughSamples pins the happy path: 6
// drives in the mild/suburban bucket (≥ DefaultMinSamplesPerBucket)
// produces a learned envelope; the other 11 buckets fall back.
func TestTrainer_LearnedWhenEnoughSamples(t *testing.T) {
	t.Parallel()
	// 6 mild/suburban drives at ~170 Wh/km mean.
	mildSuburbanValues := []float64{160, 165, 170, 175, 180, 170}
	src := &fakeSource{}
	for _, v := range mildSuburbanValues {
		src.samples = append(src.samples, DriveSample{
			WhPerKm:     v,
			AvgSpeedKmh: 70, // suburban (50..90)
			AmbientTemp: 20, // mild (10..25)
		})
	}
	tr := newTestTrainer(src)
	out, err := tr.Train(context.Background(), 1, 0)
	if err != nil {
		t.Fatalf("Train err = %v", err)
	}

	var learnedCount, fallbackCount int
	var mildSuburban *LearnedBucket
	for i := range out {
		switch out[i].Source {
		case SourceLearned:
			learnedCount++
		case SourceLinearFallback:
			fallbackCount++
		}
		if out[i].TempBucket == "mild" && out[i].SpeedBucket == "suburban" {
			mildSuburban = &out[i]
		}
	}
	if learnedCount != 1 {
		t.Errorf("learnedCount = %d, want 1", learnedCount)
	}
	if fallbackCount != len(TempBuckets)*len(SpeedBuckets)-1 {
		t.Errorf("fallbackCount = %d, want %d", fallbackCount, len(TempBuckets)*len(SpeedBuckets)-1)
	}
	if mildSuburban == nil {
		t.Fatal("mild/suburban bucket missing from output")
	}
	if mildSuburban.SampleCount != 6 {
		t.Errorf("mild/suburban SampleCount = %d, want 6", mildSuburban.SampleCount)
	}
	wantMean := 170.0 // (160+165+170+175+180+170) / 6
	if math.Abs(mildSuburban.WhPerKm-wantMean) > 1e-9 {
		t.Errorf("mild/suburban WhPerKm = %v, want %v", mildSuburban.WhPerKm, wantMean)
	}
	if mildSuburban.Stddev <= 0 {
		t.Errorf("mild/suburban Stddev = %v, want > 0", mildSuburban.Stddev)
	}
	if mildSuburban.P5 <= 0 || mildSuburban.P5 > mildSuburban.WhPerKm {
		t.Errorf("mild/suburban P5 = %v, want in (0, mean=%v]", mildSuburban.P5, mildSuburban.WhPerKm)
	}
	if mildSuburban.P95 < mildSuburban.WhPerKm {
		t.Errorf("mild/suburban P95 = %v, want >= mean=%v", mildSuburban.P95, mildSuburban.WhPerKm)
	}
}

// TestTrainer_DaysClampedToMaxDays pins the [1, MaxDays] clamp:
// days=999 must be reduced to MaxDays=30 before the cutoff is
// computed. We assert the cutoff sent to the source is
// `fixedNow() - 30*24h`.
func TestTrainer_DaysClampedToMaxDays(t *testing.T) {
	t.Parallel()
	src := &fakeSource{}
	tr := newTestTrainer(src)
	_, err := tr.Train(context.Background(), 1, 999)
	if err != nil {
		t.Fatalf("Train err = %v", err)
	}
	wantCutoff := fixedNow().Add(-time.Duration(MaxDays) * 24 * time.Hour)
	if !src.lastCutoff.Equal(wantCutoff) {
		t.Errorf("cutoff = %v, want %v (clamped from days=999)", src.lastCutoff, wantCutoff)
	}
}

// TestTrainer_DaysZeroUsesDefaultDays pins the days=0 default path.
// The cutoff must be `fixedNow() - DefaultDays*24h`.
func TestTrainer_DaysZeroUsesDefaultDays(t *testing.T) {
	t.Parallel()
	src := &fakeSource{}
	tr := newTestTrainer(src)
	_, err := tr.Train(context.Background(), 1, 0)
	if err != nil {
		t.Fatalf("Train err = %v", err)
	}
	wantCutoff := fixedNow().Add(-time.Duration(DefaultDays) * 24 * time.Hour)
	if !src.lastCutoff.Equal(wantCutoff) {
		t.Errorf("cutoff = %v, want %v (default days=%d)", src.lastCutoff, wantCutoff, DefaultDays)
	}
}

// TestTrainer_VehicleIDZeroReturnsNil asserts that vehicle_id=0
// produces a nil slice — the AI handler's validator is the single
// chokepoint for "vehicle_id is required". The trainer's defensive
// branch ensures a misconfigured caller doesn't waste a SQL round
// trip.
func TestTrainer_VehicleIDZeroReturnsNil(t *testing.T) {
	t.Parallel()
	src := &fakeSource{}
	tr := newTestTrainer(src)
	out, err := tr.Train(context.Background(), 0, 0)
	if err != nil {
		t.Fatalf("Train err = %v", err)
	}
	if out != nil {
		t.Fatalf("Train(vehicleID=0) = %v, want nil", out)
	}
	if src.calls != 0 {
		t.Errorf("source.calls = %d, want 0 (vehicle_id=0 must short-circuit)", src.calls)
	}
}

// TestTrainer_NilSourceReturnsErrNoSource pins the wiring-bug
// surface: a Trainer constructed with nil Source surfaces
// ErrNoSource on the first Train call.
func TestTrainer_NilSourceReturnsErrNoSource(t *testing.T) {
	t.Parallel()
	tr := &Trainer{}
	_, err := tr.Train(context.Background(), 1, 0)
	if !errors.Is(err, ErrNoSource) {
		t.Fatalf("Train err = %v, want ErrNoSource", err)
	}
}

// TestTrainer_PropagatesSourceError pins the error-propagation
// contract: a SamplesForVehicle error is wrapped and returned so
// the AI handler can surface it on the SSE stream.
func TestTrainer_PropagatesSourceError(t *testing.T) {
	t.Parallel()
	srcErr := errors.New("pgx: connection refused")
	src := &fakeSource{err: srcErr}
	tr := newTestTrainer(src)
	_, err := tr.Train(context.Background(), 1, 0)
	if err == nil {
		t.Fatal("Train err = nil, want non-nil")
	}
	if !errors.Is(err, srcErr) {
		t.Errorf("Train err = %v, want wrap of %v", err, srcErr)
	}
}

// TestTrainer_OutputOrderDeterministic pins the alphabetic outer-
// product order: out[0] is (cold, city), out[1] is (cold, highway),
// out[2] is (cold, suburban), out[3] is (freezing, city), …
func TestTrainer_OutputOrderDeterministic(t *testing.T) {
	t.Parallel()
	src := &fakeSource{}
	tr := newTestTrainer(src)
	out, err := tr.Train(context.Background(), 1, 0)
	if err != nil {
		t.Fatalf("Train err = %v", err)
	}
	wantOrder := []struct{ tb, sb string }{
		{"cold", "city"}, {"cold", "highway"}, {"cold", "suburban"},
		{"freezing", "city"}, {"freezing", "highway"}, {"freezing", "suburban"},
		{"hot", "city"}, {"hot", "highway"}, {"hot", "suburban"},
		{"mild", "city"}, {"mild", "highway"}, {"mild", "suburban"},
	}
	if len(out) != len(wantOrder) {
		t.Fatalf("len(out) = %d, want %d", len(out), len(wantOrder))
	}
	for i, want := range wantOrder {
		if out[i].TempBucket != want.tb || out[i].SpeedBucket != want.sb {
			t.Errorf("out[%d] = (%s,%s), want (%s,%s)", i, out[i].TempBucket, out[i].SpeedBucket, want.tb, want.sb)
		}
	}
}

// TestTrainer_FiltersInvalidWhPerKm pins the defensive branch that
// drops samples with non-positive / NaN / +/-Inf Wh/km. Six valid
// samples + two invalid samples in the mild/suburban bucket must
// produce a learned envelope from the six valid values; the two
// invalid samples must not appear in mean / stddev.
func TestTrainer_FiltersInvalidWhPerKm(t *testing.T) {
	t.Parallel()
	src := &fakeSource{}
	for _, v := range []float64{160, 165, 170, 175, 180, 170} {
		src.samples = append(src.samples, DriveSample{WhPerKm: v, AvgSpeedKmh: 70, AmbientTemp: 20})
	}
	src.samples = append(src.samples,
		DriveSample{WhPerKm: math.NaN(), AvgSpeedKmh: 70, AmbientTemp: 20},
		DriveSample{WhPerKm: math.Inf(1), AvgSpeedKmh: 70, AmbientTemp: 20},
		DriveSample{WhPerKm: -50, AvgSpeedKmh: 70, AmbientTemp: 20},
	)
	tr := newTestTrainer(src)
	out, err := tr.Train(context.Background(), 1, 0)
	if err != nil {
		t.Fatalf("Train err = %v", err)
	}
	var found bool
	for _, b := range out {
		if b.TempBucket == "mild" && b.SpeedBucket == "suburban" {
			found = true
			if b.SampleCount != 6 {
				t.Errorf("mild/suburban SampleCount = %d, want 6 (3 invalid samples filtered)", b.SampleCount)
			}
			if math.Abs(b.WhPerKm-170.0) > 1e-9 {
				t.Errorf("mild/suburban WhPerKm = %v, want 170 (invalid samples filtered)", b.WhPerKm)
			}
		}
	}
	if !found {
		t.Fatal("mild/suburban bucket missing")
	}
}

// TestCurrentEffectiveBuckets_AllLinearFallback pins the
// query-side contract: the slice does not persist learned models,
// so CurrentEffectiveBuckets returns the linear-fallback envelope
// for every bucket with sample_count = 0.
func TestCurrentEffectiveBuckets_AllLinearFallback(t *testing.T) {
	t.Parallel()
	out := CurrentEffectiveBuckets()
	want := len(TempBuckets) * len(SpeedBuckets)
	if len(out) != want {
		t.Fatalf("len(out) = %d, want %d", len(out), want)
	}
	for _, b := range out {
		if b.Source != SourceLinearFallback {
			t.Errorf("bucket %s/%s Source = %q, want linear_fallback", b.TempBucket, b.SpeedBucket, b.Source)
		}
		if b.SampleCount != 0 {
			t.Errorf("bucket %s/%s SampleCount = %d, want 0", b.TempBucket, b.SpeedBucket, b.SampleCount)
		}
		if b.WhPerKm <= 0 {
			t.Errorf("bucket %s/%s WhPerKm = %v, want > 0", b.TempBucket, b.SpeedBucket, b.WhPerKm)
		}
	}
}

// TestHeuristicWhPerKm_PinnedValues pins representative bucket
// outputs against the canonical Go formula in
// internal/api/range_projection_handler_compute.go's defaultEfficiency.
// The parity test in internal/api also asserts the same equivalence
// from the api side; this test pins the ml side independently so a
// drift surfaces from BOTH packages.
func TestHeuristicWhPerKm_PinnedValues(t *testing.T) {
	t.Parallel()
	cases := []struct {
		tempBucket, speedBucket string
		want                    float64
	}{
		// mild/city: base=155, no temp multiplier → 155
		{"mild", "city", 155},
		// mild/suburban: base=170 → 170
		{"mild", "suburban", 170},
		// mild/highway: base=195 → 195
		{"mild", "highway", 195},
		// cold/city: base=155 * 1.15 = 178.25
		{"cold", "city", 178.25},
		// freezing/highway: base=195 * 1.35 = 263.25
		{"freezing", "highway", 263.25},
		// hot/highway: representative tempC=30 (NOT > 35) so no
		// hot multiplier → 195. This explicitly pins that the
		// "hot" bucket name does NOT trigger the legacy >35°C
		// multiplier — the bucket's representative midpoint sits
		// below the threshold.
		{"hot", "highway", 195},
	}
	for _, tc := range cases {
		got, ok := HeuristicWhPerKm(tc.tempBucket, tc.speedBucket)
		if !ok {
			t.Errorf("HeuristicWhPerKm(%q,%q) ok=false, want true", tc.tempBucket, tc.speedBucket)
			continue
		}
		if math.Abs(got-tc.want) > 1e-9 {
			t.Errorf("HeuristicWhPerKm(%q,%q) = %v, want %v", tc.tempBucket, tc.speedBucket, got, tc.want)
		}
	}
}

// TestHeuristicWhPerKm_UnknownBucketReturnsNotOk pins the
// defence-in-depth branch: an unknown bucket pair returns (0, false)
// rather than silently returning the 155 base.
func TestHeuristicWhPerKm_UnknownBucketReturnsNotOk(t *testing.T) {
	t.Parallel()
	if v, ok := HeuristicWhPerKm("UNKNOWN", "city"); ok || v != 0 {
		t.Errorf("HeuristicWhPerKm(UNKNOWN, city) = (%v, %v), want (0, false)", v, ok)
	}
	if v, ok := HeuristicWhPerKm("mild", "UNKNOWN"); ok || v != 0 {
		t.Errorf("HeuristicWhPerKm(mild, UNKNOWN) = (%v, %v), want (0, false)", v, ok)
	}
}

// TestTempBucketFor_PinnedThresholds pins the exact threshold
// behaviour at the bucket boundaries. Mirrors the internal/api
// `tempBucketFor` boundaries; the parity test in internal/api
// pins the same equivalence from the api side.
func TestTempBucketFor_PinnedThresholds(t *testing.T) {
	t.Parallel()
	cases := []struct {
		temp float64
		want string
	}{
		{-50, "freezing"},
		{-0.001, "freezing"},
		{0, "cold"},
		{9.999, "cold"},
		{10, "mild"},
		{24.999, "mild"},
		{25, "hot"},
		{50, "hot"},
	}
	for _, tc := range cases {
		if got := TempBucketFor(tc.temp); got != tc.want {
			t.Errorf("TempBucketFor(%v) = %q, want %q", tc.temp, got, tc.want)
		}
	}
}

// TestSpeedBucketFor_PinnedThresholds pins the km/h threshold
// behaviour at the bucket boundaries.
func TestSpeedBucketFor_PinnedThresholds(t *testing.T) {
	t.Parallel()
	cases := []struct {
		speed float64
		want  string
	}{
		{0, "city"},
		{49.999, "city"},
		{50, "suburban"},
		{89.999, "suburban"},
		{90, "highway"},
		{200, "highway"},
	}
	for _, tc := range cases {
		if got := SpeedBucketFor(tc.speed); got != tc.want {
			t.Errorf("SpeedBucketFor(%v) = %q, want %q", tc.speed, got, tc.want)
		}
	}
}
