package anomaly

import (
	"encoding/json"
	"math"
	"testing"

	aitools "github.com/ev-dev-labs/teslasync/internal/ai/tools/anomaly"
)

func TestExplanationFactsPreserveProseAndTypedMeasurements(t *testing.T) {
	for _, tc := range []struct {
		kind, signal    string
		value, baseline float64
		code            string
	}{
		{"z_score", "PackVoltage", 450, 400, "z_score"},
		{"range", "ModuleTempMax", 60, 17.5, "above_maximum"},
		{"range", "ModuleTempMax", -25, 17.5, "below_minimum"},
		{"trend", "PackVoltage", 410, 400, "trend_increased_percent"},
		{"trend", "PackVoltage", 390, 400, "trend_decreased_percent"},
		{"trend", "PackVoltage", 10, 0, "trend_increased"},
		{"trend", "PackVoltage", -10, 0, "trend_decreased"},
		{"future", "PackVoltage", 1, 2, ""},
		{"range", "UnknownSignal", 1, 2, ""},
	} {
		a := anomalyEntry{Type: tc.kind, Signal: tc.signal, Value: tc.value, Baseline: tc.baseline, ZScore: 3.5, Message: "Legacy prose remains exact."}
		addExplanationFacts(&a)
		if a.ExplanationCode != tc.code || a.Message != "Legacy prose remains exact." {
			t.Fatalf("%+v", a)
		}
		if tc.code != "" && (a.ExplanationParams == nil || a.ExplanationParams.Value != tc.value || a.ExplanationParams.Baseline != tc.baseline) {
			t.Fatalf("lost measurements: %+v", a)
		}
		raw, err := json.Marshal(a)
		if err != nil {
			t.Fatal(err)
		}
		var decoded map[string]any
		if err = json.Unmarshal(raw, &decoded); err != nil {
			t.Fatal(err)
		}
		if tc.code != "" {
			if _, ok := decoded["explanation_params"].(map[string]any)["value"].(float64); !ok {
				t.Fatalf("untyped values: %s", raw)
			}
		}
	}
}
func TestRangeExplanationKeepsExactLimitsAndZero(t *testing.T) {
	a := anomalyEntry{Type: "range", Signal: "ModuleTempMax", Value: 0, Baseline: 17.5}
	addExplanationFacts(&a)
	if a.ExplanationCode != "" {
		t.Fatal("normal measurement must not invent a violation")
	}
	a.Value = 60
	addExplanationFacts(&a)
	if a.ExplanationParams == nil || a.ExplanationParams.Maximum == nil || *a.ExplanationParams.Maximum != 55 {
		t.Fatalf("lost safe maximum: %+v", a)
	}
	a = anomalyEntry{Type: "z_score", Value: math.NaN()}
	addExplanationFacts(&a)
	if a.ExplanationParams != nil {
		t.Fatal("non-finite facts must not reach JSON")
	}
}

func TestHTTPProjectionIncludesExplanationFacts(t *testing.T) {
	out := anomalyContextResultToResponse(&aitools.AnomalyContextResult{Anomalies: []aitools.AnomalyContextEntry{{Type: "range", Signal: "ModuleTempMax", Value: 60, Baseline: 17.5, Message: "Original prose."}}})
	if len(out.Anomalies) != 1 || out.Anomalies[0].ExplanationCode != "above_maximum" || out.Anomalies[0].ExplanationParams == nil || out.Anomalies[0].Message != "Original prose." {
		t.Fatalf("lost HTTP facts: %+v", out)
	}
}
