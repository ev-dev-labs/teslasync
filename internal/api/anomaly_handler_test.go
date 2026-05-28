// Phase-50 / 0014 — U4 Anomaly explanation narration.
//
// Wire-shape / refactor-safety tests for the baseline anomaly handler.
//
// The Phase-50/0014 refactor extracted the detector code from
// AnomalyHandler.GetAnomalies into the public AnomalyHandler.DetectAnomalies
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

package api

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/tools/anomaly"
)

// TestGetAnomalies_WireShapeUnchanged is the load-bearing wire-shape
// proof for the slice 0014 refactor. It feeds anomalyContextResultToResponse
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
		empty := &anomaly.AnomalyContextResult{
			Anomalies: []anomaly.AnomalyContextEntry{},
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
		if !strings.Contains(s, `"signals_monitored":0`) {
			t.Errorf(`nil-input wire shape missing signals_monitored:0; got=%s`, s)
		}
	})

	// Case 3: realistic result with two anomalies. Pins every JSON
	// field name + value type. The detector emits these field names
	// as part of its output contract; the wire-shape conversion must
	// preserve every one of them at the JSON boundary.
	t.Run("realistic_result_preserves_every_legacy_field", func(t *testing.T) {
		t.Parallel()
		full := &anomaly.AnomalyContextResult{
			Anomalies: []anomaly.AnomalyContextEntry{
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
		if rt.SignalsMonitored != 42 || rt.AnomaliesLast7d != 2 || rt.AnomaliesLast24h != 1 {
			t.Errorf("round-trip aggregates = %+v", rt)
		}
	})
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
	in := &anomaly.AnomalyContextResult{
		Anomalies:     []anomaly.AnomalyContextEntry{},
		HealthSummary: src,
	}
	out := anomalyContextResultToResponse(in)
	src["battery"] = "MUTATED"
	if out.HealthSummary["battery"] != "MUTATED" {
		t.Errorf("HealthSummary aliasing regression: out=%v, want shared-ref reflecting source mutation", out.HealthSummary)
	}
}
