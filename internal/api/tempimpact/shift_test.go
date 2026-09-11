package tempimpact

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func shiftMonth(month string, temp, eff float64, drives int) monthlyTempTrend {
	return monthlyTempTrend{Month: month, AvgTemp: temp, AvgEfficiency: eff, DriveCount: drives}
}

func TestAnalyzeShiftStable(t *testing.T) {
	rep := AnalyzeShift([]monthlyTempTrend{
		shiftMonth("2025-11", 10, 20.0, 20),
		shiftMonth("2025-12", 9, 20.5, 22),
	})
	if rep.Verdict != shiftStable {
		t.Fatalf("verdict = %s, want stable (%+v)", rep.Verdict, rep)
	}
}

func TestAnalyzeShiftColderWeather(t *testing.T) {
	rep := AnalyzeShift([]monthlyTempTrend{
		shiftMonth("2025-09", 20, 17.0, 20),
		shiftMonth("2025-10", 15, 18.5, 20),
		shiftMonth("2025-11", 10, 20.0, 20),
		shiftMonth("2025-12", 2, 23.0, 22),
	})
	if rep.Verdict != shiftColderWeather {
		t.Fatalf("verdict = %s, want colder_weather (%+v)", rep.Verdict, rep)
	}
	if rep.TempSensitivity >= 0 {
		t.Fatalf("sensitivity = %v, want negative (warmer = leaner)", rep.TempSensitivity)
	}
	if rep.Explanation == "" {
		t.Fatal("expected an explanation")
	}
}

func TestAnalyzeShiftDrivingPattern(t *testing.T) {
	// Same temperature, efficiency jumps anyway → residual dominates.
	rep := AnalyzeShift([]monthlyTempTrend{
		shiftMonth("2025-09", 20, 17.0, 20),
		shiftMonth("2025-10", 20, 17.2, 20),
		shiftMonth("2025-11", 20, 17.1, 20),
		shiftMonth("2025-12", 20, 22.0, 22),
	})
	if rep.Verdict != shiftDrivingPattern {
		t.Fatalf("verdict = %s, want driving_pattern (%+v)", rep.Verdict, rep)
	}
}

func TestAnalyzeShiftInsufficient(t *testing.T) {
	rep := AnalyzeShift([]monthlyTempTrend{shiftMonth("2025-12", 2, 23.0, 22)})
	if rep.Verdict != shiftInsufficient {
		t.Fatalf("verdict = %s, want insufficient_data", rep.Verdict)
	}
	// Thin months don't qualify.
	rep = AnalyzeShift([]monthlyTempTrend{
		shiftMonth("2025-11", 10, 20.0, 1),
		shiftMonth("2025-12", 2, 23.0, 1),
	})
	if rep.Verdict != shiftInsufficient {
		t.Fatalf("verdict = %s, want insufficient_data", rep.Verdict)
	}
}

func TestShiftServesReport(t *testing.T) {
	h := newHandler(&fakeTempImpactRepo{trend: []monthlyTempTrend{
		shiftMonth("2025-11", 10, 20.0, 20),
		shiftMonth("2025-12", 2, 23.0, 22),
	}})
	req := httptest.NewRequest(http.MethodGet, "/shift?vehicle_id=4", nil)
	rec := httptest.NewRecorder()
	h.Shift(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	var rep EfficiencyShift
	if err := json.NewDecoder(rec.Body).Decode(&rep); err != nil {
		t.Fatal(err)
	}
	if rep.PriorMonth == "" || rep.LatestMonth == "" || rep.Verdict == "" {
		t.Fatalf("incomplete report: %+v", rep)
	}
}

func TestShiftRejectsBadVehicle(t *testing.T) {
	h := newHandler(&fakeTempImpactRepo{})
	req := httptest.NewRequest(http.MethodGet, "/shift?vehicle_id=x", nil)
	rec := httptest.NewRecorder()
	h.Shift(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}
