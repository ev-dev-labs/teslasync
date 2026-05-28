// Phase-50 / 0063 — ML2 Range-prediction model.
//
// range_predictor_test.go covers:
//
//  1. train_range_model.Validate rejects non-positive vehicle_id,
//     days outside [1,30], and missing vehicle_id.
//  2. query_range_prediction.Validate rejects non-positive
//     vehicle_id and missing vehicle_id.
//  3. train_range_model.Execute returns the LearnedBucket envelope
//     from the trainer, with per-bucket source label and
//     learned/fallback counts that match the trainer's output.
//  4. query_range_prediction.Execute returns the
//     CurrentEffectiveBuckets (every entry SourceLinearFallback)
//     grounded by vehicle_id.
//  5. Both tools report Mutates()=false — the dispatcher must never
//     pause for confirmation on these read-only tools.
//  6. RegisterRangePredictorTools installs both tools by canonical
//     name on a fresh Registry.
package predict

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	mlrange "github.com/ev-dev-labs/teslasync/internal/ml/range"
)

// fakeRangeStatsSource is a deterministic in-memory DriveStatsSource
// for tool tests. Mirrors the fake in internal/ml/range's tests.
type fakeRangeStatsSource struct {
	samples []mlrange.DriveSample
}

func (f *fakeRangeStatsSource) SamplesForVehicle(_ context.Context, _ int64, _ time.Time) ([]mlrange.DriveSample, error) {
	out := make([]mlrange.DriveSample, len(f.samples))
	copy(out, f.samples)
	return out, nil
}

func TestTrainRangeModel_Validate_RejectsZeroVehicleID(t *testing.T) {
	t.Parallel()
	tool := &trainRangeModel{trainer: mlrange.NewTrainer(&fakeRangeStatsSource{})}
	_, err := tool.Validate(json.RawMessage(`{"vehicle_id":0,"days":7}`))
	if err == nil {
		t.Fatalf("err = nil, want non-nil for vehicle_id=0")
	}
}

func TestTrainRangeModel_Validate_RejectsNegativeVehicleID(t *testing.T) {
	t.Parallel()
	tool := &trainRangeModel{trainer: mlrange.NewTrainer(&fakeRangeStatsSource{})}
	_, err := tool.Validate(json.RawMessage(`{"vehicle_id":-3,"days":7}`))
	if err == nil {
		t.Fatalf("err = nil, want non-nil for vehicle_id=-3")
	}
}

func TestTrainRangeModel_Validate_RejectsMissingVehicleID(t *testing.T) {
	t.Parallel()
	tool := &trainRangeModel{trainer: mlrange.NewTrainer(&fakeRangeStatsSource{})}
	_, err := tool.Validate(json.RawMessage(`{"days":7}`))
	if err == nil {
		t.Fatalf("err = nil, want non-nil for missing vehicle_id")
	}
}

func TestTrainRangeModel_Validate_RejectsDaysOverMax(t *testing.T) {
	t.Parallel()
	tool := &trainRangeModel{trainer: mlrange.NewTrainer(&fakeRangeStatsSource{})}
	_, err := tool.Validate(json.RawMessage(`{"vehicle_id":1,"days":31}`))
	if err == nil {
		t.Fatalf("err = nil, want non-nil for days=31")
	}
}

func TestTrainRangeModel_Validate_AcceptsZeroDays(t *testing.T) {
	t.Parallel()
	tool := &trainRangeModel{trainer: mlrange.NewTrainer(&fakeRangeStatsSource{})}
	if _, err := tool.Validate(json.RawMessage(`{"vehicle_id":1}`)); err != nil {
		t.Fatalf("err = %v, want nil for omitted days", err)
	}
}

func TestTrainRangeModel_Execute_ReturnsEnvelopeWithCounts(t *testing.T) {
	t.Parallel()
	// 6 mild/suburban drives ⇒ learned (>= DefaultMinSamplesPerBucket=5);
	// every other bucket falls back.
	src := &fakeRangeStatsSource{}
	for _, v := range []float64{160, 165, 170, 175, 180, 170} {
		src.samples = append(src.samples, mlrange.DriveSample{
			WhPerKm: v, AvgSpeedKmh: 70, AmbientTemp: 20,
		})
	}
	tr := mlrange.NewTrainer(src)
	tool := &trainRangeModel{trainer: tr}
	in, err := tool.Validate(json.RawMessage(`{"vehicle_id":42,"days":7}`))
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	envelope, ok := out.(map[string]any)
	if !ok {
		t.Fatalf("Execute returned %T, want map[string]any", out)
	}
	if got := envelope["vehicle_id"]; got != int64(42) {
		t.Errorf("vehicle_id = %v, want 42", got)
	}
	if got := envelope["lookback_days"]; got != 7 {
		t.Errorf("lookback_days = %v, want 7", got)
	}
	buckets, ok := envelope["buckets"].([]map[string]any)
	if !ok {
		t.Fatalf("buckets is %T, want []map[string]any", envelope["buckets"])
	}
	if len(buckets) == 0 {
		t.Fatalf("buckets is empty, want >= 1")
	}
	// learned_count must equal exactly 1 (only mild/suburban had >= 5 samples).
	if got := envelope["learned_count"]; got != 1 {
		t.Errorf("learned_count = %v, want 1", got)
	}
	// fallback_count must equal len(buckets) - 1.
	if got := envelope["fallback_count"]; got != len(buckets)-1 {
		t.Errorf("fallback_count = %v, want %d", got, len(buckets)-1)
	}
	// The mild/suburban entry must carry source=learned and have
	// p5/p95/mean/stddev populated.
	var ms map[string]any
	for _, b := range buckets {
		if b["temp_bucket"] == "mild" && b["speed_bucket"] == "suburban" {
			ms = b
			break
		}
	}
	if ms == nil {
		t.Fatalf("mild/suburban not in buckets")
	}
	if ms["source"] != mlrange.SourceLearned {
		t.Errorf("mild/suburban source = %v, want %q", ms["source"], mlrange.SourceLearned)
	}
	if _, ok := ms["mean"]; !ok {
		t.Errorf("mild/suburban learned entry missing mean")
	}
	if _, ok := ms["stddev"]; !ok {
		t.Errorf("mild/suburban learned entry missing stddev")
	}
}

func TestTrainRangeModel_Execute_NilTrainerReturnsError(t *testing.T) {
	t.Parallel()
	tool := &trainRangeModel{trainer: nil}
	in, err := (&trainRangeModel{trainer: mlrange.NewTrainer(&fakeRangeStatsSource{})}).Validate(
		json.RawMessage(`{"vehicle_id":1,"days":7}`))
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	_, err = tool.Execute(context.Background(), in)
	if err == nil || !strings.Contains(err.Error(), "no Trainer wired") {
		t.Fatalf("err = %v, want \"no Trainer wired\"", err)
	}
}

func TestTrainRangeModel_Mutates_IsFalse(t *testing.T) {
	t.Parallel()
	tool := &trainRangeModel{trainer: mlrange.NewTrainer(&fakeRangeStatsSource{})}
	if tool.Mutates() {
		t.Fatalf("Mutates() = true, want false")
	}
}

func TestQueryRangePrediction_Validate_RejectsZeroVehicleID(t *testing.T) {
	t.Parallel()
	tool := &queryRangePrediction{}
	if _, err := tool.Validate(json.RawMessage(`{"vehicle_id":0}`)); err == nil {
		t.Fatalf("err = nil, want non-nil for vehicle_id=0")
	}
}

func TestQueryRangePrediction_Validate_RejectsMissingVehicleID(t *testing.T) {
	t.Parallel()
	tool := &queryRangePrediction{}
	if _, err := tool.Validate(json.RawMessage(`{}`)); err == nil {
		t.Fatalf("err = nil, want non-nil for missing vehicle_id")
	}
}

func TestQueryRangePrediction_Execute_ReturnsAllFallback(t *testing.T) {
	t.Parallel()
	tool := &queryRangePrediction{}
	in, err := tool.Validate(json.RawMessage(`{"vehicle_id":7}`))
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	envelope, ok := out.(map[string]any)
	if !ok {
		t.Fatalf("Execute returned %T, want map[string]any", out)
	}
	if got := envelope["vehicle_id"]; got != int64(7) {
		t.Errorf("vehicle_id = %v, want 7", got)
	}
	// query_range_prediction does not emit a lookback_days field.
	if _, present := envelope["lookback_days"]; present {
		t.Errorf("lookback_days unexpectedly present in query envelope")
	}
	// learned_count must be 0 (no learned envelopes are persisted today).
	if got := envelope["learned_count"]; got != 0 {
		t.Errorf("learned_count = %v, want 0", got)
	}
	buckets, ok := envelope["buckets"].([]map[string]any)
	if !ok {
		t.Fatalf("buckets is %T, want []map[string]any", envelope["buckets"])
	}
	if len(buckets) == 0 {
		t.Fatalf("buckets is empty")
	}
	for _, b := range buckets {
		if b["source"] != mlrange.SourceLinearFallback {
			t.Errorf("bucket %v/%v source = %v, want %q", b["temp_bucket"], b["speed_bucket"], b["source"], mlrange.SourceLinearFallback)
		}
	}
}

func TestQueryRangePrediction_Mutates_IsFalse(t *testing.T) {
	t.Parallel()
	tool := &queryRangePrediction{}
	if tool.Mutates() {
		t.Fatalf("Mutates() = true, want false")
	}
}

func TestRegisterRangePredictorTools_RegistersBoth(t *testing.T) {
	t.Parallel()
	r := tools.NewRegistry()
	RegisterRangePredictorTools(r, RangePredictorSources{
		Trainer: mlrange.NewTrainer(&fakeRangeStatsSource{}),
	})
	for _, name := range []string{
		"train_range_model",
		"query_range_prediction",
	} {
		if _, ok := r.Get(name); !ok {
			t.Errorf("tool %q not registered", name)
		}
	}
}
