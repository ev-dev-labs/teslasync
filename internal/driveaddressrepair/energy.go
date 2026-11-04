package driveaddressrepair

import (
	"context"
	"fmt"
	"math"
	"time"

	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

type EnergyDriveRepository interface {
	GetByID(context.Context, int64) (*drivemodel.Drive, error)
	PartialUpdate(context.Context, int64, map[string]interface{}) error
}

type EnergyReader interface {
	DriveEnergy(context.Context, int64, time.Time, time.Time) (signal.PowerIntegral, error)
}

type EnergyReport struct {
	DriveID      int64
	DryRun       bool
	Changed      bool
	OldAvgPowerW *float64
	AvgPowerW    *float64
	OldRegenWh   *float64
	RegenWh      *float64
	Unrepairable string
}

// RepairEnergy is deliberately scoped to one completed drive. Original
// cumulative energy counters and raw range/tire observations remain untouched.
func RepairEnergy(ctx context.Context, drives EnergyDriveRepository, reader EnergyReader, driveID int64, dryRun bool) (EnergyReport, error) {
	report := EnergyReport{DriveID: driveID, DryRun: dryRun}
	if driveID <= 0 {
		return report, fmt.Errorf("energy repair requires a positive drive ID")
	}
	d, err := drives.GetByID(ctx, driveID)
	if err != nil {
		return report, fmt.Errorf("read drive for energy repair: %w", err)
	}
	if d == nil || d.EndTs == nil || !d.EndTs.After(d.StartTs) {
		report.Unrepairable = "drive is missing, active, or has no valid completed time window"
		return report, nil
	}
	report.OldAvgPowerW, report.OldRegenWh = d.AvgPowerW, d.RegenEnergyWh
	energy, err := reader.DriveEnergy(ctx, d.VehicleID, d.StartTs, *d.EndTs)
	if err != nil {
		return report, fmt.Errorf("reconstruct drive energy: %w", err)
	}
	durationS := d.EndTs.Sub(d.StartTs).Seconds()
	if energy.CoveredS <= 0 || math.Abs(energy.CoveredS-durationS) > 1e-6 {
		report.Unrepairable = "retained telemetry does not establish valid paired power for the full drive; no extrapolation applied"
		return report, nil
	}
	meanW, valid := energy.MeanPowerW()
	if !valid || energy.RegenWh < 0 ||
		math.IsNaN(energy.RegenWh) || math.IsInf(energy.RegenWh, 0) {
		report.Unrepairable = "reconstructed power evidence is invalid"
		return report, nil
	}
	report.AvgPowerW, report.RegenWh = &meanW, &energy.RegenWh
	changed := func(old *float64, next float64) bool {
		return old == nil || math.IsNaN(*old) || math.IsInf(*old, 0) || math.Abs(*old-next) > 1e-6
	}
	fields := make(map[string]interface{})
	if changed(d.AvgPowerW, meanW) {
		fields["avg_power_w"] = meanW
	}
	if changed(d.RegenEnergyWh, energy.RegenWh) {
		fields["regen_energy_wh"] = energy.RegenWh
	}
	report.Changed = len(fields) > 0
	if report.Changed && !dryRun {
		if err := drives.PartialUpdate(ctx, driveID, fields); err != nil {
			return report, fmt.Errorf("persist drive energy repair: %w", err)
		}
	}
	return report, nil
}
