package v1

import (
	"net/http/httptest"
	"testing"
)

func TestVehicleCostRejectsInvalidBounds(t *testing.T) {
	h := NewAdminObservabilityHandler(nil)
	for _, query := range []string{
		"since=nope&until=2026-01-03T00:00:00Z",
		"since=2026-01-03T00:00:00Z&until=2026-01-03T00:00:00Z",
		"since=2026-01-04T00:00:00Z&until=2026-01-03T00:00:00Z",
		"since=2025-01-01T00:00:00Z&until=2026-01-03T00:00:00Z",
		"until=garbage",
	} {
		w := httptest.NewRecorder()
		h.VehicleCost(w, httptest.NewRequest("GET", "/vehicle-cost?"+query, nil))
		if w.Code != 400 {
			t.Errorf("%s status=%d want400", query, w.Code)
		}
	}
}
