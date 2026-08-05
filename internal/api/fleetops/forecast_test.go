package fleetops

import (
	"testing"
	"time"

	dbfleetops "github.com/ev-dev-labs/teslasync/internal/database/fleetops"
	models "github.com/ev-dev-labs/teslasync/internal/models/fleetops"
)

func timePtr(value time.Time) *time.Time { return &value }

func TestBuildForecastCombinesRosterReservationsHistoryAndDowntime(t *testing.T) {
	day := time.Date(2026, 8, 5, 0, 0, 0, 0, time.UTC)
	inputs := &dbfleetops.ForecastInputs{
		Vehicles: []models.FleetForecastVehicle{{
			VehicleID: 1, VehicleDisplayName: "Pool Model Y",
		}},
		Assignments: []models.FleetVehicleDriverAssignment{{
			VehicleID: 1, StartsAt: day.Add(8 * time.Hour),
			EndsAt: timePtr(day.Add(18 * time.Hour)),
		}},
		Reservations: []models.FleetReservation{{
			VehicleID: 1, Status: "confirmed",
			StartsAt: day.Add(9 * time.Hour), EndsAt: day.Add(11 * time.Hour),
		}},
		WorkOrders: []models.FleetMaintenanceWorkOrder{{
			VehicleID: 1, Status: "scheduled",
			ScheduledStartAt: timePtr(day.Add(12 * time.Hour)),
			ScheduledEndAt:   timePtr(day.Add(14 * time.Hour)),
		}},
	}
	for weeks := 1; weeks <= 8; weeks++ {
		start := day.AddDate(0, 0, -7*weeks).Add(10 * time.Hour)
		inputs.Drives = append(inputs.Drives, models.FleetForecastDrive{
			VehicleID: 1, StartedAt: start, EndedAt: start.Add(time.Hour), DurationS: 3600,
		})
	}
	generatedAt := day.Add(-time.Hour)
	got := buildForecast(inputs, day, day.Add(24*time.Hour), generatedAt)
	if got.Quality != "sparse" {
		t.Fatalf("quality=%q, want sparse", got.Quality)
	}
	if len(got.Points) != 1 {
		t.Fatalf("points=%d, want 1", len(got.Points))
	}
	point := got.Points[0]
	if point.AvailableS != 8*3600 {
		t.Errorf("available_s=%d, want 28800 (10h roster - 2h maintenance)", point.AvailableS)
	}
	if point.ReservedS != 2*3600 {
		t.Errorf("reserved_s=%d, want 7200", point.ReservedS)
	}
	if point.HistoricalExpectedS != 3600 {
		t.Errorf("historical_expected_s=%d, want 3600", point.HistoricalExpectedS)
	}
	if point.ExpectedUtilizationPct != 25 {
		t.Errorf("expected_utilization_pct=%v, want 25", point.ExpectedUtilizationPct)
	}
	if point.LowerUtilizationPct != 0 || point.UpperUtilizationPct != 50 {
		t.Errorf("uncertainty=[%v,%v], want [0,50]", point.LowerUtilizationPct, point.UpperUtilizationPct)
	}
	if !got.GeneratedAt.Equal(generatedAt) {
		t.Errorf("generated_at=%v, want %v", got.GeneratedAt, generatedAt)
	}
}

func TestBuildForecastSparseHistoryExplainsLimitations(t *testing.T) {
	from := time.Date(2026, 8, 5, 0, 0, 0, 0, time.UTC)
	inputs := &dbfleetops.ForecastInputs{
		Vehicles: []models.FleetForecastVehicle{{VehicleID: 9, VehicleDisplayName: "Fleet 9"}},
	}
	first := buildForecast(inputs, from, from.Add(48*time.Hour), from)
	second := buildForecast(inputs, from, from.Add(48*time.Hour), from)
	if first.Quality != "sparse" || first.HistoryDriveCount != 0 || first.HistoryDayCount != 0 {
		t.Fatalf("unexpected sparse metadata: %+v", first)
	}
	if len(first.Limitations) < 4 {
		t.Fatalf("limitations=%v, want explicit model, timezone, sparse, and roster limitations", first.Limitations)
	}
	if len(first.Points) != len(second.Points) {
		t.Fatal("deterministic runs produced different point counts")
	}
	for i := range first.Points {
		if first.Points[i] != second.Points[i] {
			t.Fatalf("point %d differs between deterministic runs", i)
		}
	}
}

func TestMergeIntervalsAvoidsDoubleCounting(t *testing.T) {
	start := time.Date(2026, 8, 5, 0, 0, 0, 0, time.UTC)
	items := []interval{
		{start: start, end: start.Add(2 * time.Hour)},
		{start: start.Add(time.Hour), end: start.Add(3 * time.Hour)},
	}
	if got := durationS(items); got != 3*3600 {
		t.Fatalf("durationS=%d, want 10800", got)
	}
}
