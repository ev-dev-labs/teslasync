package maintenance

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestProjectForecastMileageDriven(t *testing.T) {
	now := time.Date(2026, 3, 10, 12, 0, 0, 0, time.UTC)
	fc := ProjectForecast(4, 50000, 100, now) // 100 km/day
	if len(fc.Items) != 10 {
		t.Fatalf("items = %d, want 10", len(fc.Items))
	}
	var rotation *ForecastItem
	for i := range fc.Items {
		if fc.Items[i].Name == "Tire Rotation" {
			rotation = &fc.Items[i]
		}
	}
	if rotation == nil || rotation.KmRemaining == nil || *rotation.KmRemaining != 10000 {
		t.Fatalf("rotation = %+v", rotation)
	}
	// 10000 km @ 100/day → ~100 days out → good, dated.
	if rotation.Status != forecastGood || rotation.DueDate == nil {
		t.Fatalf("rotation = %+v", rotation)
	}
}

func TestProjectForecastZeroRateDegrades(t *testing.T) {
	now := time.Now().UTC()
	fc := ProjectForecast(4, 50000, 0, now)
	for i := range fc.Items {
		if fc.Items[i].Basis == "mileage" && fc.Items[i].KmRemaining == nil {
			t.Fatalf("mileage item missing remainder: %+v", fc.Items[i])
		}
	}
}

func TestProjectForecastDueSoonBand(t *testing.T) {
	now := time.Date(2026, 3, 10, 12, 0, 0, 0, time.UTC)
	// Fast driver: 1000 km/day → 10k rotation due in 10 days.
	fc := ProjectForecast(4, 50000, 1000, now)
	found := false
	for _, it := range fc.Items {
		if it.Name == "Tire Rotation" && it.Status == forecastDueSoon {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected due_soon rotation: %+v", fc.Items)
	}
	if fc.DueSoonCount < 1 {
		t.Fatalf("due soon count = %d", fc.DueSoonCount)
	}
}

func TestForecastServesProjection(t *testing.T) {
	reader := &fakeRowReader{row: fakeRow{scan: func(dest ...any) error {
		*(dest[0].(*float64)) = 55.5
		return nil
	}}}
	h := &Handler{db: reader, redisCache: &fakeSignalReader{signals: map[string]interface{}{"Odometer": float64(48000000)}}}
	req := httptest.NewRequest(http.MethodGet, "/forecast?vehicle_id=4", nil)
	rec := httptest.NewRecorder()
	h.Forecast(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var fc MaintenanceForecast
	if err := json.NewDecoder(rec.Body).Decode(&fc); err != nil {
		t.Fatal(err)
	}
	if fc.VehicleID != 4 || fc.KmPerDay != 55.5 || fc.OdometerKm != 48000 {
		t.Fatalf("unexpected forecast: %+v", fc)
	}
	if len(fc.Items) == 0 {
		t.Fatal("expected forecast items")
	}
}

func TestForecastRejectsBadVehicle(t *testing.T) {
	h := &Handler{}
	req := httptest.NewRequest(http.MethodGet, "/forecast?vehicle_id=x", nil)
	rec := httptest.NewRecorder()
	h.Forecast(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}
