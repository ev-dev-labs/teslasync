// Phase-50 / 0014 — U4 Anomaly explanation narration.
//
// anomaly_test.go covers the new query_anomaly_context tool + the
// RegisterAnomalyTools wiring. Mirrors the shape of year_review_test.go
// (slice 0013) and digest_test.go (slice 0012). The fakeAnomaly source
// is tiny; defined locally because no other tool in this package needs
// AnomalySource.

package tools

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
)

// fakeAnomalySource is a deterministic in-memory AnomalySource. The
// rows + err fields are returned verbatim from DetectAnomalies; the
// recordedDays field captures the most recent `days` argument so a
// test can assert the tool propagated the input correctly.
type fakeAnomalySource struct {
	result       *AnomalyContextResult
	err          error
	recordedID   int64
	recordedDays int
	callCount    int
}

func (f *fakeAnomalySource) DetectAnomalies(_ context.Context, vehicleID int64, days int) (*AnomalyContextResult, error) {
	f.callCount++
	f.recordedID = vehicleID
	f.recordedDays = days
	if f.err != nil {
		return nil, f.err
	}
	if f.result != nil {
		return f.result, nil
	}
	// Default: empty-but-well-formed result mirroring AnomalyHandler's
	// graceful-degradation contract.
	return &AnomalyContextResult{
		Anomalies: []AnomalyContextEntry{},
		HealthSummary: map[string]string{
			"battery": "normal", "tires": "normal", "motors": "normal",
			"hvac": "normal", "charging": "normal",
		},
	}, nil
}

// TestRegisterAnomalyTools_RegistersTool proves the wiring helper
// installs the new tool on a fresh registry. Mirrors the existing
// RegisterYearReviewTools test pattern.
func TestRegisterAnomalyTools_RegistersTool(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	RegisterAnomalyTools(r, AnomalySources{Anomaly: &fakeAnomalySource{}})
	if _, ok := r.Get("query_anomaly_context"); !ok {
		t.Fatal("RegisterAnomalyTools did not register query_anomaly_context")
	}
}

// TestRegisterAnomalyTools_DoesNotShadowBuiltins proves that
// installing the anomaly tool AFTER the 12 builtins + the digest
// tool + the year-review tool keeps every previously-registered
// tool reachable. Defends against an accidental same-name collision.
func TestRegisterAnomalyTools_DoesNotShadowBuiltins(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	Register12Builtins(r, Sources{
		Vehicles:      &fakeVehicles{},
		VehicleState:  &fakeState{},
		Drives:        &fakeDrives{},
		Charges:       &fakeCharges{},
		AlertRules:    &fakeRules{},
		Notifications: &fakeNotif{},
		Geofences:     &fakeFences{},
		Efficiency:    &fakeDrives{},
	})
	RegisterYearReviewTools(r, YearReviewSources{
		Drives:  &fakeDrives{},
		Charges: &fakeCharges{},
	})
	RegisterAnomalyTools(r, AnomalySources{Anomaly: &fakeAnomalySource{}})

	for _, name := range BuiltinNames {
		if _, ok := r.Get(name); !ok {
			t.Errorf("builtin %q lost after RegisterAnomalyTools", name)
		}
	}
	for _, name := range []string{
		"query_year_in_review_context",
		"query_anomaly_context",
	} {
		if _, ok := r.Get(name); !ok {
			t.Errorf("tool %q missing after full registration", name)
		}
	}
}

// TestQueryAnomalyContext_NameDescriptionMutates pins the tool's
// static metadata. A regression that flips Mutates() (or renames the
// tool out from under the strategy whitelist) fails here.
func TestQueryAnomalyContext_NameDescriptionMutates(t *testing.T) {
	t.Parallel()
	tool := &queryAnomalyContext{src: &fakeAnomalySource{}}
	if got := tool.Name(); got != "query_anomaly_context" {
		t.Errorf("Name() = %q, want %q", got, "query_anomaly_context")
	}
	if tool.Description() == "" {
		t.Error("Description() returned empty string")
	}
	if tool.Mutates() {
		t.Error("Mutates() = true; anomaly tool MUST be read-only")
	}
	if tool.RequiredScope() != "" {
		t.Errorf("RequiredScope() = %q, want empty", tool.RequiredScope())
	}
}

// TestQueryAnomalyContext_ValidateRejectsBadInput proves the
// validator catches missing vehicle_id and out-of-range days BEFORE
// Execute runs. The dispatcher's confirm gate would never catch a
// typed-input error — that's the validator's job.
func TestQueryAnomalyContext_ValidateRejectsBadInput(t *testing.T) {
	t.Parallel()
	tool := &queryAnomalyContext{src: &fakeAnomalySource{}}

	cases := []struct {
		name string
		raw  string
	}{
		{"missing vehicle_id", `{"days": 7}`},
		{"zero vehicle_id", `{"vehicle_id": 0, "days": 7}`},
		{"negative vehicle_id", `{"vehicle_id": -1, "days": 7}`},
		// days=0 is the "use default" sentinel handled by Execute;
		// the validator allows it via gte=0 so an LLM that omits
		// the field (json zero) passes. Only explicit-negative or
		// over-bound values must fail.
		{"days negative", `{"vehicle_id": 1, "days": -3}`},
		{"days too large", `{"vehicle_id": 1, "days": 31}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := tool.Validate(json.RawMessage(tc.raw))
			if err == nil {
				t.Fatalf("Validate(%q) = nil err, want validation error", tc.raw)
			}
		})
	}
}

// TestQueryAnomalyContext_ValidateAcceptsCanonical proves the
// happy-path input shapes decode for the supported range.
func TestQueryAnomalyContext_ValidateAcceptsCanonical(t *testing.T) {
	t.Parallel()
	tool := &queryAnomalyContext{src: &fakeAnomalySource{}}

	cases := []string{
		`{"vehicle_id": 1}`,
		`{"vehicle_id": 1, "days": 1}`,
		`{"vehicle_id": 1, "days": 7}`,
		`{"vehicle_id": 42, "days": 30}`,
	}
	for _, raw := range cases {
		t.Run(raw, func(t *testing.T) {
			if _, err := tool.Validate(json.RawMessage(raw)); err != nil {
				t.Fatalf("Validate(%q) = %v, want nil", raw, err)
			}
		})
	}
}

// TestQueryAnomalyContext_ExecuteHappyPath is the core behavioural
// test: the tool propagates vehicle_id + days to the AnomalySource,
// shapes the result into the canonical envelope, and preserves every
// field the LLM's narration depends on.
func TestQueryAnomalyContext_ExecuteHappyPath(t *testing.T) {
	t.Parallel()

	src := &fakeAnomalySource{
		result: &AnomalyContextResult{
			Anomalies: []AnomalyContextEntry{
				{
					Signal:     "TpmsPressureFl",
					Type:       "range",
					Severity:   "critical",
					Value:      1.2,
					Baseline:   2.75,
					ZScore:     0,
					DetectedAt: "2026-05-12T10:00:00Z",
					Message:    "Tire Pressure (Front-Left) value 1.20 is below safe minimum (2.0)",
				},
				{
					Signal:     "BatteryLevel",
					Type:       "trend",
					Severity:   "warning",
					Value:      62.5,
					Baseline:   75.0,
					ZScore:     2.4,
					DetectedAt: "2026-05-13T09:30:00Z",
					Message:    "Battery Level decreased 17% in last 24h vs 7-day average",
				},
			},
			HealthSummary: map[string]string{
				"battery":  "warning",
				"tires":    "critical",
				"motors":   "normal",
				"hvac":     "normal",
				"charging": "normal",
			},
			SignalsMonitored: 42,
			AnomaliesLast7d:  2,
			AnomaliesLast24h: 1,
		},
	}
	tool := &queryAnomalyContext{src: src}

	out, err := tool.Execute(context.Background(), queryAnomalyContextInput{VehicleID: 7, Days: 14})
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}

	if src.callCount != 1 {
		t.Errorf("DetectAnomalies call count = %d, want 1", src.callCount)
	}
	if src.recordedID != 7 {
		t.Errorf("DetectAnomalies vehicleID = %d, want 7", src.recordedID)
	}
	if src.recordedDays != 14 {
		t.Errorf("DetectAnomalies days = %d, want 14", src.recordedDays)
	}

	got, ok := out.(map[string]any)
	if !ok {
		t.Fatalf("Execute returned %T, want map[string]any", out)
	}
	if got["vehicle_id"] != int64(7) {
		t.Errorf("out[vehicle_id] = %v, want 7", got["vehicle_id"])
	}
	if got["days"] != 14 {
		t.Errorf("out[days] = %v, want 14", got["days"])
	}
	if got["signals_monitored"] != 42 {
		t.Errorf("out[signals_monitored] = %v, want 42", got["signals_monitored"])
	}
	if got["anomalies_last_7d"] != 2 {
		t.Errorf("out[anomalies_last_7d] = %v, want 2", got["anomalies_last_7d"])
	}
	if got["anomalies_last_24h"] != 1 {
		t.Errorf("out[anomalies_last_24h] = %v, want 1", got["anomalies_last_24h"])
	}
	hs, ok := got["health_summary"].(map[string]string)
	if !ok {
		t.Fatalf("out[health_summary] = %T, want map[string]string", got["health_summary"])
	}
	if hs["tires"] != "critical" {
		t.Errorf("health_summary[tires] = %q, want critical", hs["tires"])
	}
	anomalies, ok := got["anomalies"].([]AnomalyContextEntry)
	if !ok {
		t.Fatalf("out[anomalies] = %T, want []AnomalyContextEntry", got["anomalies"])
	}
	if len(anomalies) != 2 {
		t.Fatalf("anomalies length = %d, want 2", len(anomalies))
	}
}

// TestQueryAnomalyContext_ExecuteAppliesDefaultDays proves the tool
// substitutes the default lookback (7) when the input omits `days`
// (or sends an explicit zero). The HTTP handler does the same; the
// tool MUST mirror that behaviour so the AI narration matches what
// the user sees on the dashboard.
func TestQueryAnomalyContext_ExecuteAppliesDefaultDays(t *testing.T) {
	t.Parallel()

	src := &fakeAnomalySource{}
	tool := &queryAnomalyContext{src: src}
	if _, err := tool.Execute(context.Background(), queryAnomalyContextInput{VehicleID: 1}); err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	if src.recordedDays != defaultAnomalyDays {
		t.Errorf("DetectAnomalies days = %d, want default %d", src.recordedDays, defaultAnomalyDays)
	}
}

// TestQueryAnomalyContext_ExecuteEmptyResult proves the tool returns
// a well-formed envelope (NOT nil) when the detector has nothing to
// report. The "all_clear" canonical golden in goldens.yaml depends
// on this: the LLM must see the empty-but-shaped envelope so it can
// narrate "no anomalies — all systems normal" instead of inventing.
func TestQueryAnomalyContext_ExecuteEmptyResult(t *testing.T) {
	t.Parallel()
	tool := &queryAnomalyContext{src: &fakeAnomalySource{}}
	out, err := tool.Execute(context.Background(), queryAnomalyContextInput{VehicleID: 1, Days: 7})
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	got := out.(map[string]any)
	anoms, ok := got["anomalies"].([]AnomalyContextEntry)
	if !ok {
		t.Fatalf("anomalies = %T, want []AnomalyContextEntry", got["anomalies"])
	}
	if len(anoms) != 0 {
		t.Errorf("anomalies length = %d, want 0", len(anoms))
	}
	hs := got["health_summary"].(map[string]string)
	for _, k := range []string{"battery", "tires", "motors", "hvac", "charging"} {
		if hs[k] != "normal" {
			t.Errorf("health_summary[%q] = %q, want normal", k, hs[k])
		}
	}
}

// TestQueryAnomalyContext_ExecuteRequiresSource proves the tool
// fails fast when wired with a nil source — a misconfigured boot
// surfaces as a clear tool-execution error instead of nil-deref.
func TestQueryAnomalyContext_ExecuteRequiresSource(t *testing.T) {
	t.Parallel()
	tool := &queryAnomalyContext{src: nil}
	_, err := tool.Execute(context.Background(), queryAnomalyContextInput{VehicleID: 1, Days: 7})
	if err == nil {
		t.Fatal("Execute err = nil, want AnomalySource error")
	}
}

// TestQueryAnomalyContext_ExecutePropagatesSourceError proves that a
// non-nil error from DetectAnomalies (rare under the graceful-
// degradation contract, but possible if the implementation is
// changed) propagates as a tool error so the dispatcher's tool-error
// frame surfaces.
func TestQueryAnomalyContext_ExecutePropagatesSourceError(t *testing.T) {
	t.Parallel()
	srcErr := errors.New("simulated detector failure")
	tool := &queryAnomalyContext{src: &fakeAnomalySource{err: srcErr}}
	_, err := tool.Execute(context.Background(), queryAnomalyContextInput{VehicleID: 1, Days: 7})
	if err == nil {
		t.Fatal("Execute err = nil, want propagated source error")
	}
	if !errors.Is(err, srcErr) {
		t.Errorf("Execute err = %v, want errors.Is(err, srcErr)", err)
	}
}
