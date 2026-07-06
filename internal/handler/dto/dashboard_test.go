package dto

import "testing"

func TestDashboardStatsResponse_JSON(t *testing.T) {
	wantKeys := []string{
		"totalVehicles", "totalM", "totalEnergyWh", "totalChargingSessions",
		"totalTrips", "avgEfficiency", "totalCostCents",
	}

	t.Run("populated round-trips and keeps every key", func(t *testing.T) {
		s := DashboardStatsResponse{
			TotalVehicles:         3,
			TotalM:                1234567.8,
			TotalEnergyWh:         98000.5,
			TotalChargingSessions: 42,
			TotalTrips:            120,
			AvgEfficiency:         0.18,
			TotalCostCents:        5599,
		}
		m := marshalToMap(t, s)
		assertKeys(t, m, wantKeys...)
		if got := string(m["totalVehicles"]); got != "3" {
			t.Errorf("totalVehicles = %s, want 3", got)
		}
		if got := string(m["totalCostCents"]); got != "5599" {
			t.Errorf("totalCostCents = %s, want 5599", got)
		}
		assertRoundTrip(t, s)
	})

	t.Run("zero value still emits every key (no omitempty)", func(t *testing.T) {
		m := marshalToMap(t, DashboardStatsResponse{})
		assertKeys(t, m, wantKeys...)
	})
}
