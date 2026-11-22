package smartreadinesssvc

import (
	"math"
	"testing"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

func TestEvaluateSolarSurplusUsesSustainedSolarWithoutDrawingBackup(t *testing.T) {
	now := time.Date(2026, 6, 18, 12, 0, 0, 0, time.UTC)
	reserve, readings, values := solarSurplusFixture(now)
	match := func(latitude, longitude float64) bool { return latitude == 40 && longitude == -75 }
	got := EvaluateSolarSurplus(reserve, readings, values, now, match)
	if got == nil || got.MinimumExportW != 1600 || got.SampleCount != 3 ||
		got.ChargeLimitPct != 80 || got.BatteryPct != 61 || got.ReservePct != 30 || got.BackupPct != 58 ||
		!got.ExpiresAt.Equal(now.Add(time.Minute)) {
		t.Fatalf("expected a short-lived opportunity based on the weakest export sample, got %+v", got)
	}
}

func TestEvaluateSolarSurplusSuppressesUnsafeOrUnsubstantiatedOpportunities(t *testing.T) {
	now := time.Date(2026, 6, 18, 12, 0, 0, 0, time.UTC)
	type change func(*domain.SolarBackupReserve, []domain.SolarSurplusObservation, map[string]*signal.Value)
	cases := map[string]change{
		"wrong site": func(_ *domain.SolarBackupReserve, rows []domain.SolarSurplusObservation, _ map[string]*signal.Value) {
			rows[1].SiteID = 5
		},
		"point-in-time snapshot repeated": func(_ *domain.SolarBackupReserve, rows []domain.SolarSurplusObservation, _ map[string]*signal.Value) {
			rows[1].ObservedAt = rows[0].ObservedAt
		},
		"gapped history": func(_ *domain.SolarBackupReserve, rows []domain.SolarSurplusObservation, _ map[string]*signal.Value) {
			rows[0].ObservedAt = now.Add(-7 * time.Minute)
		},
		"stale site power": func(_ *domain.SolarBackupReserve, rows []domain.SolarSurplusObservation, _ map[string]*signal.Value) {
			for i := range rows {
				rows[i].ObservedAt = rows[i].ObservedAt.Add(-time.Minute)
			}
		},
		"transient export": func(_ *domain.SolarBackupReserve, rows []domain.SolarSurplusObservation, _ map[string]*signal.Value) {
			rows[1].GridPowerW = -600
		},
		"battery-backed export": func(_ *domain.SolarBackupReserve, rows []domain.SolarSurplusObservation, _ map[string]*signal.Value) {
			rows[1].BatteryPowerW = 1200
		},
		"near reserve": func(_ *domain.SolarBackupReserve, rows []domain.SolarSurplusObservation, _ map[string]*signal.Value) {
			rows[1].BatteryPct = 33
		},
		"reserve unknown": func(r *domain.SolarBackupReserve, _ []domain.SolarSurplusObservation, _ map[string]*signal.Value) {
			r.Percent = math.NaN()
		},
		"reserve stale": func(r *domain.SolarBackupReserve, _ []domain.SolarSurplusObservation, _ map[string]*signal.Value) {
			r.ObservedAt = now.Add(-20 * time.Minute)
		},
		"off grid": func(_ *domain.SolarBackupReserve, rows []domain.SolarSurplusObservation, _ map[string]*signal.Value) {
			rows[2].GridConnected = false
		},
		"storm mode": func(_ *domain.SolarBackupReserve, rows []domain.SolarSurplusObservation, _ map[string]*signal.Value) {
			rows[2].StormMode = true
		},
		"unplugged": func(_ *domain.SolarBackupReserve, _ []domain.SolarSurplusObservation, v map[string]*signal.Value) {
			v["ChargePortLatch"].Raw = "Disengaged"
		},
		"synthetic vehicle reading": func(_ *domain.SolarBackupReserve, _ []domain.SolarSurplusObservation, v map[string]*signal.Value) {
			v["ChargePortLatch"].TimestampSynthetic = true
		},
		"vehicle already charging": func(_ *domain.SolarBackupReserve, _ []domain.SolarSurplusObservation, v map[string]*signal.Value) {
			v["DetailedChargeState"].Raw = "Charging"
		},
		"charger reports no power": func(_ *domain.SolarBackupReserve, _ []domain.SolarSurplusObservation, v map[string]*signal.Value) {
			v["DetailedChargeState"].Raw = "NoPower"
		},
		"vehicle at target": func(_ *domain.SolarBackupReserve, _ []domain.SolarSurplusObservation, v map[string]*signal.Value) {
			v["BatteryLevel"].Raw = 80.0
		},
	}
	for name, modify := range cases {
		t.Run(name, func(t *testing.T) {
			reserve, readings, values := solarSurplusFixture(now)
			modify(&reserve, readings, values)
			if got := EvaluateSolarSurplus(reserve, readings, values, now, func(float64, float64) bool { return true }); got != nil {
				t.Fatalf("unexpected opportunity from %s: %+v", name, got)
			}
		})
	}
	reserve, readings, values := solarSurplusFixture(now)
	if got := EvaluateSolarSurplus(reserve, readings, values, now, func(float64, float64) bool { return false }); got != nil {
		t.Fatalf("unexpected opportunity outside the explicitly linked charger: %+v", got)
	}
}

func solarSurplusFixture(now time.Time) (domain.SolarBackupReserve, []domain.SolarSurplusObservation, map[string]*signal.Value) {
	reserve := domain.SolarBackupReserve{SiteID: 8, ObservedAt: now.Add(-5 * time.Minute), Percent: 30}
	readings := []domain.SolarSurplusObservation{
		{SiteID: 8, ObservedAt: now.Add(-4 * time.Minute), GridConnected: true, GridPowerW: -2300, SolarPowerW: 6000, BatteryPowerW: -800, BatteryPct: 56},
		{SiteID: 8, ObservedAt: now.Add(-2 * time.Minute), GridConnected: true, GridPowerW: -1680, SolarPowerW: 5500, BatteryPowerW: 80, BatteryPct: 57},
		{SiteID: 8, ObservedAt: now.Add(-30 * time.Second), GridConnected: true, GridPowerW: -2400, SolarPowerW: 5900, BatteryPowerW: -1000, BatteryPct: 58},
	}
	values := map[string]*signal.Value{
		"LocationLatitude":    {Raw: 40.0, Timestamp: now},
		"LocationLongitude":   {Raw: -75.0, Timestamp: now},
		"BatteryLevel":        {Raw: 61.0, Timestamp: now},
		"ChargeLimitSoc":      {Raw: 80.0, Timestamp: now},
		"Gear":                {Raw: enums.GearPark, Timestamp: now},
		"DetailedChargeState": {Raw: "Stopped", Timestamp: now},
		"ChargePortLatch":     {Raw: "Engaged", Timestamp: now},
	}
	return reserve, readings, values
}
