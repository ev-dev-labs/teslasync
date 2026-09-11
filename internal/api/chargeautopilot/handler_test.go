package chargeautopilot

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// fakeStores satisfies ProfileStore + SavingsReader without a database.
type fakeStores struct {
	profiles map[int64]Profile
	upserts  int

	savingsTotal float64
	savingsRuns  int64
	savingsErr   error
}

func (f *fakeStores) Get(_ context.Context, vehicleID int64) (*Profile, error) {
	if p, ok := f.profiles[vehicleID]; ok {
		cp := p
		return &cp, nil
	}
	d := DefaultProfile(vehicleID)
	return &d, nil
}

func (f *fakeStores) Upsert(_ context.Context, p *Profile) error {
	f.upserts++
	if f.profiles == nil {
		f.profiles = map[int64]Profile{}
	}
	f.profiles[p.VehicleID] = *p
	return nil
}

func (f *fakeStores) TotalSavings(_ context.Context, _ int64) (float64, int64, error) {
	return f.savingsTotal, f.savingsRuns, f.savingsErr
}

var (
	_ ProfileStore  = (*fakeStores)(nil)
	_ SavingsReader = (*fakeStores)(nil)
)

func newHandlerForTest(f *fakeStores) *Handler {
	h := NewHandler(f, f)
	h.now = func() time.Time { return time.Date(2026, 1, 15, 18, 0, 0, 0, time.UTC) }
	return h
}

func TestGetProfileRejectsMissingVehicle(t *testing.T) {
	h := newHandlerForTest(&fakeStores{})
	req := httptest.NewRequest(http.MethodGet, "/profile", nil)
	rec := httptest.NewRecorder()
	h.GetProfile(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestGetProfileReturnsDefault(t *testing.T) {
	h := newHandlerForTest(&fakeStores{})
	req := httptest.NewRequest(http.MethodGet, "/profile?vehicle_id=9", nil)
	rec := httptest.NewRecorder()
	h.GetProfile(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var p Profile
	if err := json.NewDecoder(rec.Body).Decode(&p); err != nil {
		t.Fatal(err)
	}
	if p.VehicleID != 9 || p.Enabled {
		t.Fatalf("unexpected default profile: %+v", p)
	}
}

func TestUpsertProfileRoundTrips(t *testing.T) {
	f := &fakeStores{}
	h := newHandlerForTest(f)
	body := `{"vehicle_id":9,"enabled":true,"target_soc":85,"ready_by":"06:45","rate_plan":"sce-tou-d","daily_cap_soc":80,"trip_override":false,"precondition":true,"max_amps":40,"battery_capacity_kwh":82}`
	req := httptest.NewRequest(http.MethodPut, "/profile", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.UpsertProfile(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	if f.upserts != 1 {
		t.Fatalf("upserts = %d, want 1", f.upserts)
	}
}

func TestUpsertProfileRejectsBadSOC(t *testing.T) {
	f := &fakeStores{}
	h := newHandlerForTest(f)
	body := `{"vehicle_id":9,"enabled":true,"target_soc":5,"ready_by":"06:45","rate_plan":"sce-tou-d","daily_cap_soc":80,"trip_override":false,"precondition":true,"max_amps":40,"battery_capacity_kwh":82}`
	req := httptest.NewRequest(http.MethodPut, "/profile", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.UpsertProfile(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if f.upserts != 0 {
		t.Fatal("invalid profile must not reach the store")
	}
}

func TestPreviewUsesStoredProfile(t *testing.T) {
	p := DefaultProfile(3)
	p.Enabled = true
	f := &fakeStores{profiles: map[int64]Profile{3: p}}
	h := newHandlerForTest(f)
	req := httptest.NewRequest(http.MethodPost, "/preview", strings.NewReader(`{"vehicle_id":3,"current_soc":50}`))
	rec := httptest.NewRecorder()
	h.Preview(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	var res PreviewResult
	if err := json.NewDecoder(rec.Body).Decode(&res); err != nil {
		t.Fatal(err)
	}
	if res.Window.StartTime.IsZero() || res.Explanation == "" {
		t.Fatalf("incomplete preview: %+v", res)
	}
}

func TestSavingsSurfacesLedger(t *testing.T) {
	f := &fakeStores{savingsTotal: 12.5, savingsRuns: 4}
	h := newHandlerForTest(f)
	req := httptest.NewRequest(http.MethodGet, "/savings?vehicle_id=3", nil)
	rec := httptest.NewRecorder()
	h.Savings(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var res savingsResponse
	if err := json.NewDecoder(rec.Body).Decode(&res); err != nil {
		t.Fatal(err)
	}
	if res.TotalSavings != 12.5 || res.Runs != 4 {
		t.Fatalf("unexpected ledger: %+v", res)
	}
}

func TestSavingsPropagatesStoreError(t *testing.T) {
	f := &fakeStores{savingsErr: errors.New("db down")}
	h := newHandlerForTest(f)
	req := httptest.NewRequest(http.MethodGet, "/savings?vehicle_id=3", nil)
	rec := httptest.NewRecorder()
	h.Savings(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
}
