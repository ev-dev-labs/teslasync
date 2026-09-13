package serviceintelligence

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestWarrantyOutlookActive(t *testing.T) {
	now := time.Date(2026, 3, 10, 12, 0, 0, 0, time.UTC)
	out := WarrantyOutlookFor(9, "Model Y", 2024, 30000, now)
	if len(out.Coverages) != 2 {
		t.Fatalf("coverages = %d, want 2", len(out.Coverages))
	}
	if out.Coverages[0].Status != "active" || out.Coverages[1].Status != "active" {
		t.Fatalf("unexpected outlook: %+v", out.Coverages)
	}
	if out.Coverages[1].KmRemaining == nil || *out.Coverages[1].KmRemaining <= 0 {
		t.Fatalf("battery mileage leg = %+v", out.Coverages[1])
	}
	if out.Assumption == "" {
		t.Fatal("expected the delivery-date assumption to be disclosed")
	}
}

func TestWarrantyOutlookExpiredByTime(t *testing.T) {
	now := time.Date(2026, 3, 10, 12, 0, 0, 0, time.UTC)
	out := WarrantyOutlookFor(9, "Model 3", 2019, 60000, now)
	if out.Coverages[0].Status != "expired" {
		t.Fatalf("basic = %+v, want expired", out.Coverages[0])
	}
	if out.Coverages[1].Status == "expired" {
		t.Fatalf("battery = %+v, want still active", out.Coverages[1])
	}
}

func TestWarrantyOutlookExpiredByMileage(t *testing.T) {
	now := time.Date(2026, 3, 10, 12, 0, 0, 0, time.UTC)
	out := WarrantyOutlookFor(9, "Model 3", 2024, 100000, now)
	if out.Coverages[0].Status != "expired" || out.Coverages[0].Basis != "mileage" {
		t.Fatalf("basic = %+v, want mileage-expired", out.Coverages[0])
	}
}

func TestWarrantyOutlookTimeOnly(t *testing.T) {
	now := time.Date(2026, 3, 10, 12, 0, 0, 0, time.UTC)
	out := WarrantyOutlookFor(9, "Model S", 2024, -1, now)
	if out.Coverages[0].KmLimit != nil || out.Coverages[0].KmRemaining != nil {
		t.Fatalf("unknown odometer must omit mileage legs: %+v", out.Coverages[0])
	}
	if out.Coverages[0].Status != "active" {
		t.Fatalf("basic = %+v, want active", out.Coverages[0])
	}
}

func TestWarrantyHandlerServesOutlook(t *testing.T) {
	svc := &fakeIntelligenceService{warranty: &WarrantyOutlook{VehicleID: 7, Model: "Model Y", ModelYear: 2024}}
	req := httptest.NewRequest(http.MethodGet, "/service-intelligence/vehicles/7/warranty?odometer_km=30000", nil)
	rec := httptest.NewRecorder()
	mountedHandler(svc).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	var out WarrantyOutlook
	if err := json.NewDecoder(rec.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if out.VehicleID != 7 || !svc.warrantySeen || svc.warrantyOdo != 30000 {
		t.Fatalf("unexpected call: %+v (%v)", out, svc.warrantyOdo)
	}
}

func TestWarrantyHandlerRejectsBadOdometer(t *testing.T) {
	svc := &fakeIntelligenceService{}
	req := httptest.NewRequest(http.MethodGet, "/service-intelligence/vehicles/7/warranty?odometer_km=nope", nil)
	rec := httptest.NewRecorder()
	mountedHandler(svc).ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if svc.warrantySeen {
		t.Fatal("service must not be called for invalid input")
	}
}
