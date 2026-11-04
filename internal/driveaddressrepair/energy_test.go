package driveaddressrepair

import (
	"context"
	"errors"
	"testing"
	"time"

	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

type energyRepairRepo struct {
	drive  *drivemodel.Drive
	writes int
	err    error
}

func (r *energyRepairRepo) GetByID(context.Context, int64) (*drivemodel.Drive, error) {
	return r.drive, nil
}
func (r *energyRepairRepo) PartialUpdate(_ context.Context, _ int64, fields map[string]interface{}) error {
	if r.err != nil {
		return r.err
	}
	r.writes++
	if v, ok := fields["avg_power_w"].(float64); ok {
		r.drive.AvgPowerW = &v
	}
	if v, ok := fields["regen_energy_wh"].(float64); ok {
		r.drive.RegenEnergyWh = &v
	}
	return nil
}

type energyRepairReader struct{ evidence signal.PowerIntegral }

func (r energyRepairReader) DriveEnergy(context.Context, int64, time.Time, time.Time) (signal.PowerIntegral, error) {
	return r.evidence, nil
}

func TestEnergyRepairDryRunApplyAndIdempotence(t *testing.T) {
	start := time.Date(2026, 10, 29, 12, 0, 0, 0, time.UTC)
	end := start.Add(time.Minute)
	usedWh := 236.0
	repo := &energyRepairRepo{drive: &drivemodel.Drive{
		ID: 555, VehicleID: 1, StartTs: start, EndTs: &end, EnergyUsedWh: &usedWh,
	}}
	reader := energyRepairReader{signal.PowerIntegral{DrawWh: 236, RegenWh: 12.6, CoveredS: 60}}
	report, err := RepairEnergy(context.Background(), repo, reader, 555, true)
	if err != nil || !report.Changed || repo.writes != 0 || repo.drive.AvgPowerW != nil {
		t.Fatalf("dry run wrote or lost proposal: %+v, %v, writes=%d", report, err, repo.writes)
	}
	for i := 0; i < 2; i++ {
		report, err = RepairEnergy(context.Background(), repo, reader, 555, false)
		if err != nil {
			t.Fatal(err)
		}
		if report.Changed != (i == 0) {
			t.Fatalf("idempotence pass %d: %+v", i, report)
		}
	}
	if repo.writes != 1 || *repo.drive.EnergyUsedWh != usedWh || *repo.drive.AvgPowerW != 13404 {
		t.Fatalf("unexpected writes or SI values: writes=%d drive=%+v", repo.writes, repo.drive)
	}
}

func TestEnergyRepairLeavesIncompleteEvidenceUntouchedAndSurfacesWriteFailure(t *testing.T) {
	start := time.Date(2026, 10, 29, 12, 0, 0, 0, time.UTC)
	end := start.Add(time.Minute)
	repo := &energyRepairRepo{drive: &drivemodel.Drive{StartTs: start, EndTs: &end}}
	report, err := RepairEnergy(context.Background(), repo,
		energyRepairReader{signal.PowerIntegral{CoveredS: 10}}, 555, false)
	if err != nil || report.Unrepairable == "" || repo.writes != 0 {
		t.Fatalf("missing history was not preserved: %+v, %v", report, err)
	}
	repo.err = errors.New("write unavailable")
	_, err = RepairEnergy(context.Background(), repo,
		energyRepairReader{signal.PowerIntegral{DrawWh: 236, RegenWh: 12.6, CoveredS: 60}}, 555, false)
	if !errors.Is(err, repo.err) {
		t.Fatalf("write failure not surfaced: %v", err)
	}
}
