// Phase-50 / 0062 — ML1 Learned per-vehicle anomaly baselines.
//
// baseline_test.go covers:
//
//   1. The trainer's wiring contract (nil source ⇒ ErrNoSource;
//      vehicle_id <= 0 ⇒ empty; days clamped to MaxDays).
//   2. Per-signal fallback semantics (sample count below MinSamples
//      ⇒ SourceSafeRangesFallback with the static envelope's
//      bounds; sample count missing entirely ⇒ same fallback).
//   3. Per-signal learned semantics (sample count >= MinSamples
//      ⇒ SourceLearned with p5/p95 bounds clamped to the static
//      envelope; mean/stddev populated; SampleCount honest).
//   4. Determinism: Train() output is alphabetically ordered by
//      signal name across calls — the AI tool's JSON envelope
//      depends on this.
//   5. CurrentEffectiveEnvelope is byte-stable and always emits
//      SourceSafeRangesFallback for every static signal (today's
//      "no learned baselines persisted" contract).
package anomaly

import (
	"context"
	"errors"
	"math"
	"sort"
	"testing"
)

// fakeSource is a deterministic in-memory SignalSampleSource for
// unit testing. samples maps signal name → observation slice. The
// fake records the days argument it was called with so the clamp
// test can assert the trainer normalised it.
type fakeSource struct {
	samples  map[string][]float64
	gotDays  int
	gotCount int
	err      error
}

func (f *fakeSource) SamplesForVehicle(_ context.Context, _ int64, days int, signals []string) (map[string][]float64, error) {
	f.gotCount++
	f.gotDays = days
	if f.err != nil {
		return nil, f.err
	}
	out := make(map[string][]float64, len(signals))
	for _, s := range signals {
		// Honest fake: only return what was set; missing signals
		// are treated by the trainer as zero-sample fallback.
		if v, ok := f.samples[s]; ok {
			out[s] = v
		} else {
			out[s] = nil
		}
	}
	return out, nil
}

func TestTrainer_NilSource_ReturnsErrNoSource(t *testing.T) {
	tr := &Trainer{} // intentionally zero-value
	got, err := tr.Train(context.Background(), 1, 7)
	if !errors.Is(err, ErrNoSource) {
		t.Fatalf("err = %v, want ErrNoSource", err)
	}
	if got != nil {
		t.Fatalf("got = %v, want nil", got)
	}
}

func TestTrainer_VehicleIDZero_ReturnsEmpty(t *testing.T) {
	tr := NewTrainer(&fakeSource{})
	got, err := tr.Train(context.Background(), 0, 7)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("len(got) = %d, want 0 (vehicle_id<=0 short-circuits)", len(got))
	}
}

func TestTrainer_DaysClampedToMaxDays(t *testing.T) {
	src := &fakeSource{samples: map[string][]float64{}}
	tr := NewTrainer(src)
	if _, err := tr.Train(context.Background(), 42, 999); err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if src.gotDays != MaxDays {
		t.Fatalf("gotDays = %d, want %d (clamped)", src.gotDays, MaxDays)
	}
}

func TestTrainer_DaysDefaultWhenZero(t *testing.T) {
	src := &fakeSource{samples: map[string][]float64{}}
	tr := NewTrainer(src)
	if _, err := tr.Train(context.Background(), 42, 0); err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if src.gotDays != DefaultDays {
		t.Fatalf("gotDays = %d, want default %d", src.gotDays, DefaultDays)
	}
}

func TestTrainer_BelowMinSamples_FallsBackToSafeRanges(t *testing.T) {
	// 5 samples for BatteryLevel — below the default 30-sample
	// floor, MUST route through SourceSafeRangesFallback with the
	// static [0, 100] bound.
	src := &fakeSource{samples: map[string][]float64{
		"BatteryLevel": {52, 53, 54, 55, 56},
	}}
	tr := NewTrainer(src)
	got, err := tr.Train(context.Background(), 1, 7)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	bl := pick(t, got, "BatteryLevel")
	if bl.Source != SourceSafeRangesFallback {
		t.Fatalf("Source = %q, want %q", bl.Source, SourceSafeRangesFallback)
	}
	if bl.Lower != 0 || bl.Upper != 100 {
		t.Fatalf("Lower/Upper = %v/%v, want 0/100 (static)", bl.Lower, bl.Upper)
	}
	if bl.SampleCount != 5 {
		t.Fatalf("SampleCount = %d, want 5", bl.SampleCount)
	}
	// Other signals (no entry in fake) MUST also fall back.
	tp := pick(t, got, "TpmsPressureFl")
	if tp.Source != SourceSafeRangesFallback {
		t.Fatalf("TpmsPressureFl Source = %q, want fallback", tp.Source)
	}
	if tp.SampleCount != 0 {
		t.Fatalf("TpmsPressureFl SampleCount = %d, want 0", tp.SampleCount)
	}
}

func TestTrainer_AtLeastMinSamples_EmitsLearned(t *testing.T) {
	// 30 BatteryLevel observations clustered around 60% with one
	// outlier at 5%. p5 should pick up near the bottom of the
	// cluster; p95 near the top. SampleCount should be 30.
	obs := make([]float64, 0, 30)
	for i := 0; i < 29; i++ {
		obs = append(obs, 60+float64(i%5)) // 60..64 repeated
	}
	obs = append(obs, 5) // outlier near the static lower bound
	src := &fakeSource{samples: map[string][]float64{"BatteryLevel": obs}}
	tr := NewTrainer(src)
	got, err := tr.Train(context.Background(), 1, 7)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	bl := pick(t, got, "BatteryLevel")
	if bl.Source != SourceLearned {
		t.Fatalf("Source = %q, want %q", bl.Source, SourceLearned)
	}
	if bl.SampleCount != 30 {
		t.Fatalf("SampleCount = %d, want 30", bl.SampleCount)
	}
	// Lower bound MUST be >= the static lower (0); upper <= static upper (100).
	if bl.Lower < 0 || bl.Upper > 100 {
		t.Fatalf("Lower/Upper = %v/%v, must be inside static [0,100]", bl.Lower, bl.Upper)
	}
	// Mean should be near 62; sanity check.
	if bl.Mean < 50 || bl.Mean > 70 {
		t.Fatalf("Mean = %v, expected near 62", bl.Mean)
	}
	if math.IsNaN(bl.Stddev) || bl.Stddev < 0 {
		t.Fatalf("Stddev = %v, want >= 0 finite", bl.Stddev)
	}
	// p5 / p95 sanity.
	if bl.P5 > bl.P95 {
		t.Fatalf("P5 (%v) > P95 (%v)", bl.P5, bl.P95)
	}
}

func TestTrainer_LearnedBoundsClampedToStatic(t *testing.T) {
	// Plant 30 samples deliberately below the static lower bound to
	// prove the trainer clamps p5 up to the static lower (the
	// physically-reasonable floor).
	obs := make([]float64, 0, 30)
	for i := 0; i < 30; i++ {
		obs = append(obs, -10) // below static [0, 100] for BatteryLevel
	}
	src := &fakeSource{samples: map[string][]float64{"BatteryLevel": obs}}
	tr := NewTrainer(src)
	got, err := tr.Train(context.Background(), 1, 7)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	bl := pick(t, got, "BatteryLevel")
	if bl.Source != SourceLearned {
		t.Fatalf("Source = %q, want %q", bl.Source, SourceLearned)
	}
	if bl.Lower != 0 {
		t.Fatalf("Lower = %v, want clamped-to-static 0", bl.Lower)
	}
}

func TestTrainer_OutputIsAlphabetic(t *testing.T) {
	src := &fakeSource{samples: map[string][]float64{}}
	tr := NewTrainer(src)
	got, err := tr.Train(context.Background(), 1, 7)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	names := make([]string, len(got))
	for i, b := range got {
		names[i] = b.Signal
	}
	sorted := append([]string(nil), names...)
	sort.Strings(sorted)
	for i := range names {
		if names[i] != sorted[i] {
			t.Fatalf("Train() output not alphabetic: got %v want %v", names, sorted)
		}
	}
}

func TestTrainer_SourceErrorPropagates(t *testing.T) {
	src := &fakeSource{err: errors.New("db down")}
	tr := NewTrainer(src)
	if _, err := tr.Train(context.Background(), 1, 7); err == nil {
		t.Fatalf("err = nil, want non-nil propagated")
	}
}

func TestCurrentEffectiveEnvelope_AllFallbackAlphabetic(t *testing.T) {
	got := CurrentEffectiveEnvelope()
	if len(got) == 0 {
		t.Fatalf("len(got) = 0, want >= 1")
	}
	for _, b := range got {
		if b.Source != SourceSafeRangesFallback {
			t.Fatalf("Source = %q, want %q (no learned baselines persisted)", b.Source, SourceSafeRangesFallback)
		}
		if b.SampleCount != 0 {
			t.Fatalf("SampleCount = %d, want 0", b.SampleCount)
		}
	}
	// Alphabetic order.
	for i := 1; i < len(got); i++ {
		if got[i-1].Signal > got[i].Signal {
			t.Fatalf("CurrentEffectiveEnvelope not alphabetic at %d", i)
		}
	}
}

func TestStaticBound_KnownAndUnknown(t *testing.T) {
	if b, ok := StaticBound("BatteryLevel"); !ok || b != [2]float64{0, 100} {
		t.Fatalf("StaticBound(BatteryLevel) = %v,%v, want [0,100],true", b, ok)
	}
	if _, ok := StaticBound("NotASignal"); ok {
		t.Fatalf("StaticBound(NotASignal) ok = true, want false")
	}
}

func TestStaticEnvelope_IsCopy(t *testing.T) {
	e := StaticEnvelope()
	e["BatteryLevel"] = [2]float64{-1, -1}
	if b, _ := StaticBound("BatteryLevel"); b != [2]float64{0, 100} {
		t.Fatalf("StaticBound was mutated through StaticEnvelope copy: %v", b)
	}
}

// pick returns the LearnedBaseline for signal in baselines; fails
// the test if not found.
func pick(t *testing.T, baselines []LearnedBaseline, signal string) LearnedBaseline {
	t.Helper()
	for _, b := range baselines {
		if b.Signal == signal {
			return b
		}
	}
	t.Fatalf("signal %q not in baselines (%d entries)", signal, len(baselines))
	return LearnedBaseline{}
}
