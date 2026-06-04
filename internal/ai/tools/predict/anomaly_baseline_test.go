// learned_anomaly_baseline_test.go covers:
//
//  1. train_anomaly_baseline.Validate rejects non-positive
//     vehicle_id, days outside [1,30], and missing vehicle_id.
//  2. query_anomaly_baseline.Validate rejects non-positive
//     vehicle_id and missing vehicle_id.
//  3. train_anomaly_baseline.Execute returns the LearnedBaseline
//     envelope from the trainer, with per-signal source label and
//     learned/fallback counts that match the trainer's output.
//  4. query_anomaly_baseline.Execute returns the
//     CurrentEffectiveEnvelope (every entry SourceSafeRangesFallback)
//     grounded by vehicle_id.
//  5. Both tools report Mutates()=false — the dispatcher must
//     never pause for confirmation on these read-only tools.
//  6. RegisterLearnedAnomalyBaselineTools installs both tools by
//     canonical name on a fresh Registry.
package predict

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/ml/anomaly"
)

// fakeLearnedAnomalySource is a deterministic in-memory SignalSampleSource
// for tool tests. Mirrors the fake in internal/ml/anomaly's tests.
type fakeLearnedAnomalySource struct {
	samples map[string][]float64
}

func (f *fakeLearnedAnomalySource) SamplesForVehicle(_ context.Context, _ int64, _ int, signals []string) (map[string][]float64, error) {
	out := make(map[string][]float64, len(signals))
	for _, s := range signals {
		out[s] = f.samples[s]
	}
	return out, nil
}

func TestTrainAnomalyBaseline_Validate_RejectsZeroVehicleID(t *testing.T) {
	t.Parallel()
	tool := &trainAnomalyBaseline{trainer: anomaly.NewTrainer(&fakeLearnedAnomalySource{})}
	_, err := tool.Validate(json.RawMessage(`{"vehicle_id":0,"days":7}`))
	if err == nil {
		t.Fatalf("err = nil, want non-nil for vehicle_id=0")
	}
}

func TestTrainAnomalyBaseline_Validate_RejectsNegativeVehicleID(t *testing.T) {
	t.Parallel()
	tool := &trainAnomalyBaseline{trainer: anomaly.NewTrainer(&fakeLearnedAnomalySource{})}
	_, err := tool.Validate(json.RawMessage(`{"vehicle_id":-3,"days":7}`))
	if err == nil {
		t.Fatalf("err = nil, want non-nil for vehicle_id=-3")
	}
}

func TestTrainAnomalyBaseline_Validate_RejectsMissingVehicleID(t *testing.T) {
	t.Parallel()
	tool := &trainAnomalyBaseline{trainer: anomaly.NewTrainer(&fakeLearnedAnomalySource{})}
	_, err := tool.Validate(json.RawMessage(`{"days":7}`))
	if err == nil {
		t.Fatalf("err = nil, want non-nil for missing vehicle_id")
	}
}

func TestTrainAnomalyBaseline_Validate_RejectsDaysOverMax(t *testing.T) {
	t.Parallel()
	tool := &trainAnomalyBaseline{trainer: anomaly.NewTrainer(&fakeLearnedAnomalySource{})}
	_, err := tool.Validate(json.RawMessage(`{"vehicle_id":1,"days":31}`))
	if err == nil {
		t.Fatalf("err = nil, want non-nil for days=31")
	}
}

func TestTrainAnomalyBaseline_Validate_AcceptsZeroDays(t *testing.T) {
	t.Parallel()
	tool := &trainAnomalyBaseline{trainer: anomaly.NewTrainer(&fakeLearnedAnomalySource{})}
	if _, err := tool.Validate(json.RawMessage(`{"vehicle_id":1}`)); err != nil {
		t.Fatalf("err = %v, want nil for omitted days", err)
	}
}

func TestTrainAnomalyBaseline_Execute_ReturnsEnvelopeWithCounts(t *testing.T) {
	t.Parallel()
	// 30 BatteryLevel samples ⇒ learned; everything else falls back.
	obs := make([]float64, 0, 30)
	for i := 0; i < 30; i++ {
		obs = append(obs, 50+float64(i%10))
	}
	tr := anomaly.NewTrainer(&fakeLearnedAnomalySource{samples: map[string][]float64{
		"BatteryLevel": obs,
	}})
	tool := &trainAnomalyBaseline{trainer: tr}
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
	signals, ok := envelope["signals"].([]map[string]any)
	if !ok {
		t.Fatalf("signals is %T, want []map[string]any", envelope["signals"])
	}
	if len(signals) == 0 {
		t.Fatalf("signals is empty, want >= 1")
	}
	// learned_count must equal exactly 1 (only BatteryLevel had >= 30 samples)
	if got := envelope["learned_count"]; got != 1 {
		t.Errorf("learned_count = %v, want 1", got)
	}
	// fallback_count must equal len(signals) - 1
	if got := envelope["fallback_count"]; got != len(signals)-1 {
		t.Errorf("fallback_count = %v, want %d", got, len(signals)-1)
	}
	// The BatteryLevel entry must carry source=learned and have
	// p5/p95/mean/stddev populated.
	var bat map[string]any
	for _, s := range signals {
		if s["signal"] == "BatteryLevel" {
			bat = s
			break
		}
	}
	if bat == nil {
		t.Fatalf("BatteryLevel not in signals")
	}
	if bat["source"] != anomaly.SourceLearned {
		t.Errorf("BatteryLevel source = %v, want %q", bat["source"], anomaly.SourceLearned)
	}
	if _, ok := bat["mean"]; !ok {
		t.Errorf("BatteryLevel learned entry missing mean")
	}
	if _, ok := bat["stddev"]; !ok {
		t.Errorf("BatteryLevel learned entry missing stddev")
	}
}

func TestTrainAnomalyBaseline_Execute_NilTrainerReturnsError(t *testing.T) {
	t.Parallel()
	tool := &trainAnomalyBaseline{trainer: nil}
	in, err := (&trainAnomalyBaseline{trainer: anomaly.NewTrainer(&fakeLearnedAnomalySource{})}).Validate(
		json.RawMessage(`{"vehicle_id":1,"days":7}`))
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	_, err = tool.Execute(context.Background(), in)
	if err == nil || !strings.Contains(err.Error(), "no Trainer wired") {
		t.Fatalf("err = %v, want \"no Trainer wired\"", err)
	}
}

func TestTrainAnomalyBaseline_Mutates_IsFalse(t *testing.T) {
	t.Parallel()
	tool := &trainAnomalyBaseline{trainer: anomaly.NewTrainer(&fakeLearnedAnomalySource{})}
	if tool.Mutates() {
		t.Fatalf("Mutates() = true, want false")
	}
}

func TestQueryAnomalyBaseline_Validate_RejectsZeroVehicleID(t *testing.T) {
	t.Parallel()
	tool := &queryAnomalyBaseline{}
	if _, err := tool.Validate(json.RawMessage(`{"vehicle_id":0}`)); err == nil {
		t.Fatalf("err = nil, want non-nil for vehicle_id=0")
	}
}

func TestQueryAnomalyBaseline_Validate_RejectsMissingVehicleID(t *testing.T) {
	t.Parallel()
	tool := &queryAnomalyBaseline{}
	if _, err := tool.Validate(json.RawMessage(`{}`)); err == nil {
		t.Fatalf("err = nil, want non-nil for missing vehicle_id")
	}
}

func TestQueryAnomalyBaseline_Execute_ReturnsAllFallback(t *testing.T) {
	t.Parallel()
	tool := &queryAnomalyBaseline{}
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
	// query_anomaly_baseline does not emit a lookback_days field.
	if _, present := envelope["lookback_days"]; present {
		t.Errorf("lookback_days unexpectedly present in query envelope")
	}
	// learned_count must be 0 (no learned envelopes are persisted today).
	if got := envelope["learned_count"]; got != 0 {
		t.Errorf("learned_count = %v, want 0", got)
	}
	signals, ok := envelope["signals"].([]map[string]any)
	if !ok {
		t.Fatalf("signals is %T, want []map[string]any", envelope["signals"])
	}
	if len(signals) == 0 {
		t.Fatalf("signals is empty")
	}
	for _, s := range signals {
		if s["source"] != anomaly.SourceSafeRangesFallback {
			t.Errorf("signal %v source = %v, want %q", s["signal"], s["source"], anomaly.SourceSafeRangesFallback)
		}
	}
}

func TestQueryAnomalyBaseline_Mutates_IsFalse(t *testing.T) {
	t.Parallel()
	tool := &queryAnomalyBaseline{}
	if tool.Mutates() {
		t.Fatalf("Mutates() = true, want false")
	}
}

func TestRegisterLearnedAnomalyBaselineTools_RegistersBoth(t *testing.T) {
	t.Parallel()
	r := tools.NewRegistry()
	RegisterLearnedAnomalyBaselineTools(r, LearnedAnomalyBaselineSources{
		Trainer: anomaly.NewTrainer(&fakeLearnedAnomalySource{}),
	})
	for _, name := range []string{
		"train_anomaly_baseline",
		"query_anomaly_baseline",
	} {
		if _, ok := r.Get(name); !ok {
			t.Errorf("tool %q not registered", name)
		}
	}
}
