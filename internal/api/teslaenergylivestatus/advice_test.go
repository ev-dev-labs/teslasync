package teslaenergylivestatus

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"
)

func adviceSnap(solar, battery, load float64) *teslamodel.TeslaEnergyLiveStatus {
	return &teslamodel.TeslaEnergyLiveStatus{
		SolarPower:   &solar,
		BatteryPower: &battery,
		LoadPower:    &load,
		Timestamp:    time.Unix(1_700_000_000, 0).UTC(),
	}
}

func TestAdviseChargeNow(t *testing.T) {
	// 6kW solar, 1kW home, 2kW into Powerwall → 3kW free.
	rep := AdviseCharge(adviceSnap(6000, -2000, 1000), 1_700_000_060)
	if rep.Verdict != adviceChargeNow {
		t.Fatalf("verdict = %s, want charge_now (%+v)", rep.Verdict, rep)
	}
	if rep.SurplusW != 3000 {
		t.Fatalf("surplus = %v, want 3000", rep.SurplusW)
	}
	if rep.RecommendedAmps != 12 { // 3000/240
		t.Fatalf("amps = %d, want 12", rep.RecommendedAmps)
	}
	if rep.SnapshotAgeS != 60 {
		t.Fatalf("age = %d, want 60", rep.SnapshotAgeS)
	}
}

func TestAdviseChargeWaitAtNight(t *testing.T) {
	rep := AdviseCharge(adviceSnap(0, 500, 800), 1_700_000_060)
	if rep.Verdict != adviceWait {
		t.Fatalf("verdict = %s, want wait", rep.Verdict)
	}
	if rep.RecommendedAmps != 0 {
		t.Fatalf("amps = %d, want 0", rep.RecommendedAmps)
	}
}

func TestAdviseChargeExcludesDischargingPack(t *testing.T) {
	// 1kW solar, 0.4kW home, pack discharging 2kW → free surplus is only
	// 0.6kW (stored energy is conservatively excluded).
	rep := AdviseCharge(adviceSnap(1000, 2000, 400), 1_700_000_060)
	if rep.Verdict != adviceChargeSoon {
		t.Fatalf("verdict = %s, want charge_soon (%+v)", rep.Verdict, rep)
	}
}

func TestAdviseChargeNoData(t *testing.T) {
	if rep := AdviseCharge(nil, 0); rep.Verdict != adviceNoData {
		t.Fatalf("verdict = %s, want no_data", rep.Verdict)
	}
}

func TestChargeAdviceServesReport(t *testing.T) {
	h := &Handler{repo: &fakeLiveStatusRepo{
		getLatestFn: func(_ context.Context, _ int64) (*teslamodel.TeslaEnergyLiveStatus, error) {
			return adviceSnap(6000, -2000, 1000), nil
		},
	}}
	r := chi.NewRouter()
	r.Get("/tesla/energy-sites/{siteID}/charge-advice", h.ChargeAdvice)
	req := httptest.NewRequest(http.MethodGet, "/tesla/energy-sites/11/charge-advice", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	var rep ChargeAdvice
	if err := json.NewDecoder(rec.Body).Decode(&rep); err != nil {
		t.Fatal(err)
	}
	if rep.Verdict != adviceChargeNow || rep.RecommendedAmps != 12 {
		t.Fatalf("unexpected advice: %+v", rep)
	}
}
