package chargeplanner

import (
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/chargeautopilot"
	"github.com/ev-dev-labs/teslasync/internal/api/tou"
)

func TestTOUPlannerAutopilotParity(t *testing.T) {
	now := time.Date(2026, 1, 15, 18, 0, 0, 0, time.UTC)
	departBy := time.Date(2026, 1, 16, 7, 30, 0, 0, time.UTC)

	planner, err := (&Handler{}).computeSchedule(t.Context(), optimizeRequest{
		RatePlanID: "pge-ev2a", TargetSOC: 80, MaxAmps: 32,
		BatteryCapacity: 75, ChargerVoltage: 240,
	}, departBy, 40, now)
	if err != nil {
		t.Fatal(err)
	}

	profile := chargeautopilot.DefaultProfile(42)
	profile.TargetSOC = 80
	profile.DailyCapSOC = 80
	profile.TripOverride = true
	profile.RatePlan = "pge-ev2a"
	profile.MaxAmps = 32
	profile.BatteryCapacityKWh = 75
	profile.ReadyBy = "07:30"
	autopilot, err := chargeautopilot.Preview(chargeautopilot.PreviewInput{
		Profile: profile, CurrentSOC: 40, Now: now,
	})
	if err != nil {
		t.Fatal(err)
	}

	if planner.Schedule.StartTime.Hour() != autopilot.Window.StartTime.Hour() {
		t.Fatalf("planner start = %02d, autopilot start = %02d",
			planner.Schedule.StartTime.Hour(), autopilot.Window.StartTime.Hour())
	}
	if planner.Schedule.RateTier != tou.TierLabel(autopilot.Window.RateTier) {
		t.Fatalf("planner tier = %q, autopilot tier = %q",
			planner.Schedule.RateTier, autopilot.Window.RateTier)
	}
	if planner.Comparison.OptimizedCost != autopilot.OptimizedCost {
		t.Fatalf("planner cost = %.4f, autopilot cost = %.4f",
			planner.Comparison.OptimizedCost, autopilot.OptimizedCost)
	}
}
