// Phase-50 / 0064 — ML3 Charging-curve fingerprint clustering statistical model.
//
// charge_curve_clusters_test.go covers:
//
//  1. train_charge_curve_clusters.Validate rejects non-positive
//     vehicle_id, lookback_days outside [1,365], and missing
//     vehicle_id.
//  2. query_charge_curve_clusters.Validate rejects non-positive
//     vehicle_id and missing vehicle_id.
//  3. train_charge_curve_clusters.Execute returns the
//     LearnedCluster envelope from the trainer, with per-cluster
//     source label and learned/fallback counts that match the
//     trainer's output.
//  4. query_charge_curve_clusters.Execute returns the
//     CurrentEffectiveClusters (every entry SourceRuleLabelFallback)
//     grounded by vehicle_id.
//  5. Both tools report Mutates()=false — the dispatcher must never
//     pause for confirmation on these read-only tools.
//  6. RegisterChargeCurveClustersTools installs both tools by
//     canonical name on a fresh Registry.

package tools

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
	mlchargingcurves "github.com/ev-dev-labs/teslasync/internal/ml/chargingcurves"
)

// fakeChargeSessionSource is a deterministic in-memory
// SessionSource for tool tests. Mirrors the fake in
// internal/ml/chargingcurves's tests.
type fakeChargeSessionSource struct {
	sessions []*models.ChargingSession
}

func (f *fakeChargeSessionSource) SessionsForVehicle(_ context.Context, _ int64, _ int, _, _ time.Time) ([]*models.ChargingSession, error) {
	out := make([]*models.ChargingSession, len(f.sessions))
	copy(out, f.sessions)
	return out, nil
}

// floatPtrCharge returns a pointer to v (helper local to this
// package's tests; tools_test.go may already export a similar
// helper but to keep this self-contained we use a uniquely-named
// one).
func floatPtrCharge(v float64) *float64 { return &v }

// strPtrCharge returns a pointer to s.
func strPtrCharge(s string) *string { return &s }

// makeChargeSession builds a session with peak/avg/energy + an
// ended_at 1 hour after started_at so DurationMinutes() returns
// non-nil.
func makeChargeSession(id int64, peakW, avgW, energyWh float64, chargerType string) *models.ChargingSession {
	startedAt := time.Date(2026, 5, 1, 22, 0, 0, 0, time.UTC)
	endedAt := startedAt.Add(time.Hour)
	return &models.ChargingSession{
		ID:                 id,
		VehicleID:          42,
		StartedAt:          startedAt,
		EndedAt:            &endedAt,
		PeakPowerW:         floatPtrCharge(peakW),
		AvgPowerW:          floatPtrCharge(avgW),
		TotalEnergyAddedWh: floatPtrCharge(energyWh),
		ChargerType:        strPtrCharge(chargerType),
		DeltaSocPct:        floatPtrCharge(40),
	}
}

func TestTrainChargeCurveClusters_Validate_RejectsZeroVehicleID(t *testing.T) {
	t.Parallel()
	tool := &trainChargeCurveClusters{trainer: mlchargingcurves.NewTrainer(&fakeChargeSessionSource{})}
	_, err := tool.Validate(json.RawMessage(`{"vehicle_id":0,"lookback_days":7}`))
	if err == nil {
		t.Fatalf("err = nil, want non-nil for vehicle_id=0")
	}
}

func TestTrainChargeCurveClusters_Validate_RejectsNegativeVehicleID(t *testing.T) {
	t.Parallel()
	tool := &trainChargeCurveClusters{trainer: mlchargingcurves.NewTrainer(&fakeChargeSessionSource{})}
	_, err := tool.Validate(json.RawMessage(`{"vehicle_id":-3,"lookback_days":7}`))
	if err == nil {
		t.Fatalf("err = nil, want non-nil for vehicle_id=-3")
	}
}

func TestTrainChargeCurveClusters_Validate_RejectsMissingVehicleID(t *testing.T) {
	t.Parallel()
	tool := &trainChargeCurveClusters{trainer: mlchargingcurves.NewTrainer(&fakeChargeSessionSource{})}
	_, err := tool.Validate(json.RawMessage(`{"lookback_days":7}`))
	if err == nil {
		t.Fatalf("err = nil, want non-nil for missing vehicle_id")
	}
}

func TestTrainChargeCurveClusters_Validate_RejectsLookbackOverMax(t *testing.T) {
	t.Parallel()
	tool := &trainChargeCurveClusters{trainer: mlchargingcurves.NewTrainer(&fakeChargeSessionSource{})}
	_, err := tool.Validate(json.RawMessage(`{"vehicle_id":1,"lookback_days":366}`))
	if err == nil {
		t.Fatalf("err = nil, want non-nil for lookback_days=366")
	}
}

func TestTrainChargeCurveClusters_Validate_AcceptsZeroLookback(t *testing.T) {
	t.Parallel()
	tool := &trainChargeCurveClusters{trainer: mlchargingcurves.NewTrainer(&fakeChargeSessionSource{})}
	if _, err := tool.Validate(json.RawMessage(`{"vehicle_id":1}`)); err != nil {
		t.Fatalf("err = %v, want nil for omitted lookback_days", err)
	}
}

func TestTrainChargeCurveClusters_Execute_ReturnsEnvelopeWithCounts(t *testing.T) {
	t.Parallel()
	// 4 L2 sessions ⇒ learned (>= DefaultMinSessionsPerCluster=3);
	// 2 L1 sessions ⇒ rule_label_fallback.
	src := &fakeChargeSessionSource{}
	src.sessions = append(src.sessions,
		makeChargeSession(1, 7000, 6000, 30000, "wall_connector"),
		makeChargeSession(2, 7200, 6200, 31000, "wall_connector"),
		makeChargeSession(3, 6800, 5800, 29000, "wall_connector"),
		makeChargeSession(4, 7100, 6100, 30500, "wall_connector"),
		makeChargeSession(20, 1500, 1300, 5000, "outlet"),
		makeChargeSession(21, 1600, 1400, 5500, "outlet"),
	)
	tr := mlchargingcurves.NewTrainer(src)
	tool := &trainChargeCurveClusters{trainer: tr}
	in, err := tool.Validate(json.RawMessage(`{"vehicle_id":42,"lookback_days":90}`))
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
	if got := envelope["lookback_days"]; got != 90 {
		t.Errorf("lookback_days = %v, want 90", got)
	}
	clusters, ok := envelope["clusters"].([]map[string]any)
	if !ok {
		t.Fatalf("clusters is %T, want []map[string]any", envelope["clusters"])
	}
	if len(clusters) != 2 {
		t.Fatalf("clusters length = %d, want 2 (l1_overnight + l2_workplace)", len(clusters))
	}
	if got := envelope["learned_count"]; got != 1 {
		t.Errorf("learned_count = %v, want 1", got)
	}
	if got := envelope["fallback_count"]; got != 1 {
		t.Errorf("fallback_count = %v, want 1", got)
	}
	if got := envelope["min_sessions_for_learned"]; got != mlchargingcurves.DefaultMinSessionsPerCluster {
		t.Errorf("min_sessions_for_learned = %v, want %d", got, mlchargingcurves.DefaultMinSessionsPerCluster)
	}
	// Find the L2 entry; it must carry source=learned and full
	// statistics.
	var l2 map[string]any
	for _, c := range clusters {
		if c["cluster_id"] == "l2_workplace" {
			l2 = c
			break
		}
	}
	if l2 == nil {
		t.Fatalf("l2_workplace not in clusters")
	}
	if l2["source"] != mlchargingcurves.SourceLearned {
		t.Errorf("l2_workplace source = %v, want %q", l2["source"], mlchargingcurves.SourceLearned)
	}
	for _, key := range []string{
		"peak_power_w_mean", "peak_power_w_stddev", "peak_power_w_p5", "peak_power_w_p95",
		"avg_power_w_mean", "total_energy_wh_mean", "duration_min_mean", "ramp_shape_mean",
	} {
		if _, ok := l2[key]; !ok {
			t.Errorf("l2_workplace learned entry missing %q", key)
		}
	}
}

func TestTrainChargeCurveClusters_Execute_NilTrainerReturnsError(t *testing.T) {
	t.Parallel()
	tool := &trainChargeCurveClusters{trainer: nil}
	in, err := (&trainChargeCurveClusters{trainer: mlchargingcurves.NewTrainer(&fakeChargeSessionSource{})}).Validate(
		json.RawMessage(`{"vehicle_id":1,"lookback_days":7}`))
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	_, err = tool.Execute(context.Background(), in)
	if err == nil || !strings.Contains(err.Error(), "no Trainer wired") {
		t.Fatalf("err = %v, want \"no Trainer wired\"", err)
	}
}

func TestTrainChargeCurveClusters_Mutates_IsFalse(t *testing.T) {
	t.Parallel()
	tool := &trainChargeCurveClusters{trainer: mlchargingcurves.NewTrainer(&fakeChargeSessionSource{})}
	if tool.Mutates() {
		t.Fatalf("Mutates() = true, want false")
	}
}

func TestQueryChargeCurveClusters_Validate_RejectsZeroVehicleID(t *testing.T) {
	t.Parallel()
	tool := &queryChargeCurveClusters{}
	if _, err := tool.Validate(json.RawMessage(`{"vehicle_id":0}`)); err == nil {
		t.Fatalf("err = nil, want non-nil for vehicle_id=0")
	}
}

func TestQueryChargeCurveClusters_Validate_RejectsMissingVehicleID(t *testing.T) {
	t.Parallel()
	tool := &queryChargeCurveClusters{}
	if _, err := tool.Validate(json.RawMessage(`{}`)); err == nil {
		t.Fatalf("err = nil, want non-nil for missing vehicle_id")
	}
}

func TestQueryChargeCurveClusters_Execute_ReturnsAllFallback(t *testing.T) {
	t.Parallel()
	tool := &queryChargeCurveClusters{}
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
	// query_charge_curve_clusters does not emit a lookback_days field.
	if _, present := envelope["lookback_days"]; present {
		t.Errorf("lookback_days unexpectedly present in query envelope")
	}
	// learned_count must be 0 (no learned envelopes are persisted today).
	if got := envelope["learned_count"]; got != 0 {
		t.Errorf("learned_count = %v, want 0", got)
	}
	clusters, ok := envelope["clusters"].([]map[string]any)
	if !ok {
		t.Fatalf("clusters is %T, want []map[string]any", envelope["clusters"])
	}
	if len(clusters) == 0 {
		t.Fatalf("clusters is empty")
	}
	for _, c := range clusters {
		if c["source"] != mlchargingcurves.SourceRuleLabelFallback {
			t.Errorf("cluster %v source = %v, want %q", c["cluster_id"], c["source"], mlchargingcurves.SourceRuleLabelFallback)
		}
	}
}

func TestQueryChargeCurveClusters_Mutates_IsFalse(t *testing.T) {
	t.Parallel()
	tool := &queryChargeCurveClusters{}
	if tool.Mutates() {
		t.Fatalf("Mutates() = true, want false")
	}
}

func TestRegisterChargeCurveClustersTools_RegistersBoth(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	RegisterChargeCurveClustersTools(r, ChargeCurveClustersSources{
		Trainer: mlchargingcurves.NewTrainer(&fakeChargeSessionSource{}),
	})
	for _, name := range []string{
		"train_charge_curve_clusters",
		"query_charge_curve_clusters",
	} {
		if _, ok := r.Get(name); !ok {
			t.Errorf("tool %q not registered", name)
		}
	}
}
