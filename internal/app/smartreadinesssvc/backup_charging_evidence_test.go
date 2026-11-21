package smartreadinesssvc

import (
	"math"
	"testing"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

func TestBackupChargingAttributesOnlyMeasuredBatteryContribution(t *testing.T) {
	now := time.Date(2026, 8, 24, 12, 0, 0, 0, time.UTC)
	for _, tt := range []struct {
		name        string
		change      func(*domain.BackupSiteReading, map[string]*signal.Value)
		wrongSite   bool
		contributes bool
	}{
		{name: "backed-up charger during measured outage", contributes: true},
		{name: "solar could power all EV draw", change: func(r *domain.BackupSiteReading, v map[string]*signal.Value) {
			r.SolarPowerW, r.BatteryPowerW, v["ACChargingPower"].Raw = 3300, 1700, 3000.0
		}},
		{name: "grid restored", change: func(r *domain.BackupSiteReading, _ map[string]*signal.Value) {
			r.Grid = domain.BackupGridConnected
		}},
		{name: "zero grid power is not an outage", change: func(r *domain.BackupSiteReading, _ map[string]*signal.Value) {
			r.Grid = domain.BackupGridUnknown
		}},
		{name: "no same-circuit charger match", wrongSite: true},
		{name: "EV charging stopped", change: func(_ *domain.BackupSiteReading, v map[string]*signal.Value) {
			v["DetailedChargeState"].Raw = "Stopped"
		}},
		{name: "EV power not contemporaneous", change: func(_ *domain.BackupSiteReading, v map[string]*signal.Value) {
			v["ACChargingPower"].Timestamp = now.Add(-time.Minute)
		}},
		{name: "unbalanced site meters", change: func(r *domain.BackupSiteReading, _ map[string]*signal.Value) {
			r.SiteLoadW = 9000
		}},
		{name: "invalid stationary battery reading", change: func(r *domain.BackupSiteReading, _ map[string]*signal.Value) {
			r.BatteryPowerW = math.NaN()
		}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			reading := domain.BackupSiteReading{SiteID: 41, ObservedAt: now.Add(-10 * time.Second), Grid: domain.BackupGridIslanded,
				BackupCapable: true, SolarPowerW: 800, BatteryPowerW: 4200, SiteLoadW: 5000}
			values := map[string]*signal.Value{
				"Gear":                {Raw: "P", Timestamp: now},
				"DetailedChargeState": {Raw: "Charging", Timestamp: now},
				"ChargePortLatch":     {Raw: "Engaged", Timestamp: now},
				"ACChargingPower":     {Raw: 3500.0, Timestamp: now},
				"LocationLatitude":    {Raw: 47.1, Timestamp: now},
				"LocationLongitude":   {Raw: -122.1, Timestamp: now},
			}
			if tt.change != nil {
				tt.change(&reading, values)
			}
			got := evaluateBackupChargingSample(reading, values, now, func(float64, float64) bool { return !tt.wrongSite })
			if !tt.contributes {
				if got != nil {
					t.Fatalf("unsafe backup attribution: %+v", got)
				}
			} else if got == nil || got.MinimumBatteryToLoadW != 2550 || got.VehiclePowerW != 3500 ||
				!got.ExpiresAt.Equal(reading.ObservedAt.Add(backupReadingMaxAge)) {
				t.Fatalf("want a conservative 2550 W of observed backup draw with bounded expiry, got %+v", got)
			}
		})
	}
}
