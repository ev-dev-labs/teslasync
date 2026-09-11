package tripplanner

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestComputeConfidenceComfortable(t *testing.T) {
	rep, err := ComputeConfidence(confidenceRequest{
		CurrentSOC: 80, BatteryCapacityKWh: 75, RemainingKm: 150,
		EfficiencyWhKm: 160, EfficiencyFactor: 1, MinArrivalSOC: 10,
	})
	if err != nil {
		t.Fatal(err)
	}
	if rep.Verdict != confidenceComfortable {
		t.Fatalf("verdict = %s, want comfortable (%+v)", rep.Verdict, rep)
	}
	// usable 60kWh, needed 24kWh → arrival 48%.
	if rep.ArrivalSOC != 48 {
		t.Fatalf("arrival = %v, want 48", rep.ArrivalSOC)
	}
}

func TestComputeConfidenceTight(t *testing.T) {
	rep, err := ComputeConfidence(confidenceRequest{
		CurrentSOC: 50, BatteryCapacityKWh: 75, RemainingKm: 150,
		EfficiencyWhKm: 160, MinArrivalSOC: 10,
	})
	if err != nil {
		t.Fatal(err)
	}
	if rep.Verdict != confidenceTight {
		t.Fatalf("verdict = %s, want tight (%+v)", rep.Verdict, rep)
	}
}

func TestComputeConfidenceChargeNow(t *testing.T) {
	rep, err := ComputeConfidence(confidenceRequest{
		CurrentSOC: 20, BatteryCapacityKWh: 75, RemainingKm: 300,
		EfficiencyWhKm: 160, MinArrivalSOC: 10,
	})
	if err != nil {
		t.Fatal(err)
	}
	if rep.Verdict != confidenceChargeNow {
		t.Fatalf("verdict = %s, want charge_now (%+v)", rep.Verdict, rep)
	}
	if rep.ChargeNeededKWh <= 0 {
		t.Fatalf("charge needed = %v, want positive", rep.ChargeNeededKWh)
	}
}

func TestComputeConfidenceRejects(t *testing.T) {
	if _, err := ComputeConfidence(confidenceRequest{CurrentSOC: 0, RemainingKm: 10}); err == nil {
		t.Fatal("expected error for zero SOC")
	}
	if _, err := ComputeConfidence(confidenceRequest{CurrentSOC: 50, RemainingKm: 0}); err == nil {
		t.Fatal("expected error for zero distance")
	}
}

func TestCompareTripCost(t *testing.T) {
	// 500 km ≈ 310.7 mi → 10.36 gal @30mpg → $36.25 @ $3.50.
	got := CompareTripCost(500, 12, 0, 0)
	if got.GasCost != 36.25 && (got.GasCost < 36.2 || got.GasCost > 36.3) {
		t.Fatalf("gas cost = %v, want ~36.25", got.GasCost)
	}
	if got.Savings <= 0 || got.GasPrice != 3.5 || got.GasMPG != 30 {
		t.Fatalf("unexpected comparison: %+v", got)
	}
	custom := CompareTripCost(500, 12, 5, 25)
	if custom.GasPrice != 5 || custom.GasMPG != 25 {
		t.Fatalf("custom inputs not honored: %+v", custom)
	}
}

func TestConfidenceEndpoint(t *testing.T) {
	h := &TripPlannerHandler{}
	body := `{"current_soc":80,"battery_capacity_kwh":75,"remaining_km":150,"efficiency_wh_km":160,"min_arrival_soc":10}`
	req := httptest.NewRequest(http.MethodPost, "/confidence", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.Confidence(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	var rep confidenceResponse
	if err := json.NewDecoder(rec.Body).Decode(&rep); err != nil {
		t.Fatal(err)
	}
	if rep.Verdict == "" || rep.Explanation == "" {
		t.Fatalf("incomplete report: %+v", rep)
	}
}
