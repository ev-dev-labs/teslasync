package nextcharge

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/chargeautopilot"
)

type fakeProfiles struct {
	p chargeautopilot.Profile
}

func (f *fakeProfiles) Get(_ context.Context, vehicleID int64) (*chargeautopilot.Profile, error) {
	p := f.p
	if p.VehicleID == 0 {
		d := chargeautopilot.DefaultProfile(vehicleID)
		return &d, nil
	}
	p.VehicleID = vehicleID
	return &p, nil
}

func (f *fakeProfiles) Upsert(_ context.Context, _ *chargeautopilot.Profile) error { return nil }

type fakeVIN struct{ vin string }

func (f fakeVIN) VIN(_ context.Context, _ int64) (string, error) { return f.vin, nil }

type fakeQuotes struct{ q *Quote }

func (f fakeQuotes) Cheapest(_ context.Context, _ string) (*Quote, error) { return f.q, nil }

func TestGetRejectsMissingVehicle(t *testing.T) {
	h := NewHandler(&fakeProfiles{}, nil)
	req := httptest.NewRequest(http.MethodGet, "/decision?current_soc=50", nil)
	rec := httptest.NewRecorder()
	h.Get(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestGetRejectsBadSOC(t *testing.T) {
	h := NewHandler(&fakeProfiles{}, nil)
	req := httptest.NewRequest(http.MethodGet, "/decision?vehicle_id=1&current_soc=140", nil)
	rec := httptest.NewRecorder()
	h.Get(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestGetReturnsEnough(t *testing.T) {
	h := NewHandler(&fakeProfiles{}, nil)
	h.now = func() time.Time { return time.Date(2026, 1, 15, 18, 0, 0, 0, time.UTC) }
	req := httptest.NewRequest(http.MethodGet, "/decision?vehicle_id=3&current_soc=90", nil)
	rec := httptest.NewRecorder()
	h.Get(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	var d Decision
	if err := json.NewDecoder(rec.Body).Decode(&d); err != nil {
		t.Fatal(err)
	}
	if d.Verdict != VerdictEnough || d.CurrentSOC != 90 || d.TargetSOC != 80 {
		t.Fatalf("unexpected decision: %+v", d)
	}
}

func TestGetAttachesSuperchargerQuote(t *testing.T) {
	h := NewHandler(&fakeProfiles{}, nil)
	h.now = func() time.Time { return time.Date(2026, 1, 15, 7, 0, 0, 0, time.UTC) }
	h.vins = fakeVIN{vin: "5YJTEST"}
	h.quotes = fakeQuotes{q: &Quote{Site: "Everett, WA", AvgPerKWh: 0.47}}
	req := httptest.NewRequest(http.MethodGet, "/decision?vehicle_id=3&current_soc=20", nil)
	rec := httptest.NewRecorder()
	h.Get(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	var d Decision
	if err := json.NewDecoder(rec.Body).Decode(&d); err != nil {
		t.Fatal(err)
	}
	if d.Verdict != VerdictSupercharger {
		t.Fatalf("verdict = %s, want supercharger", d.Verdict)
	}
	if d.SuperchargerSite == nil || *d.SuperchargerSite != "Everett, WA" {
		t.Fatalf("quote not attached: %+v", d)
	}
}

func TestNewHandlerPanicsOnNilProfiles(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("expected panic")
		}
	}()
	NewHandler(nil, nil)
}
