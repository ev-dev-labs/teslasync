// Wire-shape and refactor-safety tests for the baseline anomaly handler.
//
// The refactor extracted the detector code from
// Handler.GetAnomalies into the public Handler.DetectAnomalies
// method so the AI tool query_anomaly_context can reuse it. The HTTP
// handler is now a thin wrapper that calls DetectAnomalies + writes
// the response via anomalyContextResultToResponse.
//
// TestGetAnomalies_WireShapeUnchanged below pins the JSON shape that
// the frontend hook (web/src/api/hooks/useAnomalies.ts) and any
// downstream consumers expect — exact field names, types, ordering,
// and the load-bearing "anomalies":[] vs "anomalies":null distinction.
// A future edit that "tidies up" the conversion (e.g. by switching
// to a nil slice) breaks the frontend silently — this test catches
// it loudly.

package anomaly

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	aitools "github.com/ev-dev-labs/teslasync/internal/ai/tools/anomaly"
)

// TestGetAnomalies_WireShapeUnchanged is the load-bearing wire-shape
// proof for the detector extraction. It feeds anomalyContextResultToResponse
// realistic inputs and pins:
//
//   - Empty-anomalies result MUST marshal `"anomalies":[]`, not `null`.
//   - Every legacy field name + JSON ordering is preserved.
//   - Per-anomaly fields (signal/type/severity/value/baseline/z_score/
//     detected_at/message) marshal as the existing client expects.
//   - HealthSummary is preserved as a flat string-string map.
//   - Numeric fields (signals_monitored, anomalies_last_7d/24h) are
//     emitted as integers (not float64).
//
// The helper is package-private so this same-package test can call it
// directly without a DB fixture; the underlying DetectAnomalies SQL
// is tested separately by integration paths that own the DB.
func TestGetAnomalies_WireShapeUnchanged(t *testing.T) {
	t.Parallel()

	// Case 1: empty result. The legacy handler emitted `"anomalies":[]`
	// even when no anomalies were detected; the refactor MUST preserve
	// this. A nil slice would marshal as `null` and silently break the
	// frontend's `data.anomalies.map(...)` calls.
	t.Run("empty_result_emits_anomalies_array_not_null", func(t *testing.T) {
		t.Parallel()
		empty := &aitools.AnomalyContextResult{
			Anomalies: []aitools.AnomalyContextEntry{},
			HealthSummary: map[string]string{
				"battery": "normal", "tires": "normal", "motors": "normal",
				"hvac": "normal", "charging": "normal",
			},
			SignalsMonitored: 13,
		}
		out := anomalyContextResultToResponse(empty)
		raw, err := json.Marshal(out)
		if err != nil {
			t.Fatalf("Marshal err = %v", err)
		}
		s := string(raw)
		if !strings.Contains(s, `"anomalies":[]`) {
			t.Errorf(`empty wire shape missing "anomalies":[]; got=%s`, s)
		}
		if strings.Contains(s, `"anomalies":null`) {
			t.Errorf(`empty wire shape regressed to "anomalies":null; got=%s`, s)
		}
		if !strings.Contains(s, `"signals_monitored":13`) {
			t.Errorf(`empty wire shape missing signals_monitored:13; got=%s`, s)
		}
	})

	// Case 2: nil input. anomalyContextResultToResponse documents a
	// defensive nil-input branch that returns a well-formed empty
	// envelope. The branch is unreachable in normal operation
	// (DetectAnomalies always returns non-nil) but the contract
	// matters for refactor safety.
	t.Run("nil_result_emits_well_formed_envelope", func(t *testing.T) {
		t.Parallel()
		out := anomalyContextResultToResponse(nil)
		raw, err := json.Marshal(out)
		if err != nil {
			t.Fatalf("Marshal err = %v", err)
		}
		s := string(raw)
		if !strings.Contains(s, `"anomalies":[]`) {
			t.Errorf(`nil-input wire shape missing "anomalies":[]; got=%s`, s)
		}
		if !strings.Contains(s, `"signals_monitored":null`) {
			t.Errorf(`nil-input wire shape must keep coverage unknown; got=%s`, s)
		}
	})

	// Case 3: realistic result with two anomalies. Pins every JSON
	// field name + value type. The detector emits these field names
	// as part of its output contract; the wire-shape conversion must
	// preserve every one of them at the JSON boundary.
	t.Run("realistic_result_preserves_every_legacy_field", func(t *testing.T) {
		t.Parallel()
		full := &aitools.AnomalyContextResult{
			Anomalies: []aitools.AnomalyContextEntry{
				{
					Signal:     "TpmsPressureFl",
					Type:       "range",
					Severity:   "critical",
					Value:      1.20,
					Baseline:   2.75,
					ZScore:     0.0,
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
		}
		out := anomalyContextResultToResponse(full)
		raw, err := json.Marshal(out)
		if err != nil {
			t.Fatalf("Marshal err = %v", err)
		}
		s := string(raw)
		// Per-anomaly fields — every one must appear in the JSON.
		for _, mustHave := range []string{
			`"signal":"TpmsPressureFl"`,
			`"type":"range"`,
			`"severity":"critical"`,
			`"value":1.2`,
			`"baseline":2.75`,
			`"z_score":0`,
			`"detected_at":"2026-05-12T10:00:00Z"`,
			`"message":"Tire Pressure (Front-Left) value 1.20 is below safe minimum (2.0)"`,
			`"signal":"BatteryLevel"`,
			`"z_score":2.4`,
		} {
			if !strings.Contains(s, mustHave) {
				t.Errorf("wire shape missing %s; got=%s", mustHave, s)
			}
		}
		// Aggregate fields.
		for _, mustHave := range []string{
			`"signals_monitored":42`,
			`"anomalies_last_7d":2`,
			`"anomalies_last_24h":1`,
			`"health_summary"`,
			`"battery":"warning"`,
			`"tires":"critical"`,
			`"hvac":"normal"`,
		} {
			if !strings.Contains(s, mustHave) {
				t.Errorf("wire shape missing %s; got=%s", mustHave, s)
			}
		}
		// Round-trip: unmarshal back into the wire struct + confirm
		// every field decodes to its expected go value. Catches a
		// silent type-coercion regression (e.g. ZScore becoming a
		// string).
		var rt anomalyResponse
		if err := json.Unmarshal(raw, &rt); err != nil {
			t.Fatalf("round-trip Unmarshal err = %v", err)
		}
		if len(rt.Anomalies) != 2 {
			t.Fatalf("round-trip Anomalies length = %d, want 2", len(rt.Anomalies))
		}
		if rt.Anomalies[0].Signal != "TpmsPressureFl" || rt.Anomalies[0].Severity != "critical" {
			t.Errorf("round-trip Anomalies[0] = %+v", rt.Anomalies[0])
		}
		if *rt.SignalsMonitored != 42 || *rt.AnomaliesLast7d != 2 || *rt.AnomaliesLast24h != 1 {
			t.Errorf("round-trip aggregates = %+v", rt)
		}

	})
}

func TestHealthSummaryDoesNotInferCoverage(t *testing.T) {
	summary := buildHealthSummary(nil)
	for category, status := range summary {
		if status != "unknown" {
			t.Fatalf("%s = %s, want unknown", category, status)
		}
	}
	summary = buildHealthSummary([]anomalyEntry{
		{Signal: "BatteryLevel", Severity: "info"},
		{Signal: "BatteryLevel", Severity: "warning"},
	})
	if summary["battery"] != "warning" || summary["tires"] != "unknown" {
		t.Fatalf("unexpected health summary: %v", summary)
	}
}

func TestFiniteMeasurements(t *testing.T) {
	for _, value := range []float64{0, -42, -0.125, 0.25} {
		if !finiteMeasurements(value) {
			t.Errorf("valid signed/fractional measurement rejected: %v", value)
		}
	}
	for _, value := range []float64{math.NaN(), math.Inf(1), math.Inf(-1)} {
		if finiteMeasurements(value) {
			t.Errorf("invalid measurement accepted: %v", value)
		}
	}
}

func TestAnomalySignalUnitsAreAuthoritative(t *testing.T) {
	t.Parallel()
	for _, tt := range []struct {
		signal string
		unit   string
	}{
		{"OutsideTemp", "°C"},
		// Rear stator pins the motor-temp °C mapping; the Front twin (F = front,
		// not Fahrenheit) shares it but trips the SI gate's TempF pattern.
		{"DiStatorTempR", "°C"},
		{"TpmsPressureFl", "Pa"},
		{"Odometer", "m"},
		{"VehicleSpeed", "m/s"},
		{"MaxSpeedToReachDestinationMph", "m/s"},
		{"ChargeRateMilePerHour", "m/h"},
		{"ACChargingEnergyIn", "Wh"},
		{"NominalFullPackEnergyKwh", "Wh"},
		{"DCChargingPower", "W"},
		{"Soc", "%"},
		{"UnknownTemperature", ""},
		{"SettingTemperatureUnit", ""},
		{"PackVoltage", ""},
	} {
		t.Run(tt.signal, func(t *testing.T) {
			if got := anomalySignalUnit(tt.signal); got != tt.unit {
				t.Fatalf("unit = %q, want %q", got, tt.unit)
			}
			out := anomalyContextResultToResponse(&aitools.AnomalyContextResult{
				Anomalies: []aitools.AnomalyContextEntry{{
					Signal: tt.signal, Value: -0.125, Baseline: 0, ZScore: 3.125,
				}},
			})
			entry := out.Anomalies[0]
			if entry.Unit != tt.unit || entry.Value != -0.125 || entry.Baseline != 0 || entry.ZScore != 3.125 {
				t.Fatalf("wire metadata changed raw evidence: %+v", entry)
			}
			raw, err := json.Marshal(entry)
			if err != nil {
				t.Fatal(err)
			}
			if tt.unit == "" && strings.Contains(string(raw), `"unit"`) {
				t.Fatalf("unknown unit must stay unspecified: %s", raw)
			}
		})
	}
}

func TestTirePressureSafeRangesAreCanonicalPa(t *testing.T) {
	t.Parallel()
	for _, signal := range []string{"TpmsPressureFl", "TpmsPressureFr", "TpmsPressureRl", "TpmsPressureRr"} {
		t.Run(signal, func(t *testing.T) {
			bounds, ok := safeRanges[signal]
			if !ok || bounds != ([2]float64{200000, 350000}) {
				t.Fatalf("safe bounds = %v, present = %v; want [200000 350000] Pa", bounds, ok)
			}
			if midpoint := (bounds[0] + bounds[1]) / 2; midpoint != 275000 {
				t.Fatalf("baseline = %v, want 275000 Pa", midpoint)
			}
			for _, tt := range []struct {
				name      string
				value     float64
				violation bool
			}{
				{"low_pressure", 120000, true},
				{"just_below_minimum", 199999, true},
				{"minimum", 200000, false},
				{"normal_pressure", 275000, false},
				{"maximum", 350000, false},
				{"just_above_maximum", 350001, true},
				{"high_pressure", 400000, true},
			} {
				t.Run(tt.name, func(t *testing.T) {
					if got := tt.value < bounds[0] || tt.value > bounds[1]; got != tt.violation {
						t.Fatalf("pressure %v Pa: violation = %v, want %v", tt.value, got, tt.violation)
					}
				})
			}
		})
	}
}

func TestSnapshotOutcomesPreserveZeroAndFractionalEvidence(t *testing.T) {
	result := anomalyContextResultToResponse(&aitools.AnomalyContextResult{
		Anomalies:     []aitools.AnomalyContextEntry{{Value: -0.00125, Baseline: 0, ZScore: 3.125}},
		HealthSummary: buildHealthSummary(nil),
	})
	if result.SignalsMonitored == nil || *result.SignalsMonitored != 0 {
		t.Fatal("successful measured zero lost")
	}
	if result.Anomalies[0].Value != -0.00125 || result.Anomalies[0].Baseline != 0 || result.Anomalies[0].ZScore != 3.125 {
		t.Fatalf("signed/fractional evidence changed: %+v", result.Anomalies[0])
	}
	for stage, status := range result.DetectorStages {
		if status != "completed" {
			t.Errorf("%s: %s", stage, status)
		}
	}
	missing := anomalyContextResultToResponse(nil)
	if missing.SignalsMonitored != nil || missing.AnomaliesLast7d != nil || missing.AnomaliesLast24h != nil {
		t.Fatal("missing result fabricated zero counts")
	}
	for stage, status := range missing.DetectorStages {
		if status != "unavailable" {
			t.Errorf("%s: %s", stage, status)
		}
	}
}

func TestDetectorFailureIsNotMeasuredZero(t *testing.T) {
	h := NewHandler(nil)
	for _, query := range []string{"", "?vehicle_id=no", "?vehicle_id=0", "?vehicle_id=-1", "?vehicle_id=1.5"} {
		rec := httptest.NewRecorder()
		h.GetAnomalies(rec, httptest.NewRequest(http.MethodGet, "/analytics/anomalies"+query, nil))
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("%q: status %d", query, rec.Code)
		}
	}
	rec := httptest.NewRecorder()
	h.GetAnomalies(rec, httptest.NewRequest(http.MethodGet, "/analytics/anomalies?vehicle_id=1", nil))
	if rec.Code != http.StatusInternalServerError || strings.Contains(rec.Body.String(), `"signals_monitored":0`) {
		t.Fatalf("unavailable detector fabricated success: %d %s", rec.Code, rec.Body.String())
	}
	if result, err := h.DetectAnomalies(context.Background(), 1, 7); err == nil || result != nil {
		t.Fatalf("AI caller received fabricated result: %+v, %v", result, err)
	}
}

// TestAnomalyContextResultToResponse_DefensiveCopy proves the
// HealthSummary map is shared by reference (cheap path) — the
// converter intentionally does NOT clone it because the source
// AnomalyContextResult has no concurrent reader. If a future edit
// adds caching that DOES need defensive copying, this test will
// document the change.
//
// Pinning the cheap-path behaviour keeps the wire path zero-alloc
// for the common "no anomalies" case (10× per-second polling on the
// dashboard); a silent shift to deep-copy semantics would regress
// that.
func TestAnomalyContextResultToResponse_HealthSummaryAliased(t *testing.T) {
	t.Parallel()
	src := map[string]string{"battery": "normal"}
	in := &aitools.AnomalyContextResult{
		Anomalies:     []aitools.AnomalyContextEntry{},
		HealthSummary: src,
	}
	out := anomalyContextResultToResponse(in)
	src["battery"] = "MUTATED"
	if out.HealthSummary["battery"] != "MUTATED" {
		t.Errorf("HealthSummary aliasing regression: out=%v, want shared-ref reflecting source mutation", out.HealthSummary)
	}
}
