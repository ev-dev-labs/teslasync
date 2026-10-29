package telemetry

import (
	"context"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/driveaddressrepair"
	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"
)

// EndAddressRepairChange describes one drive the duplicate-end-address
// repair proposes (dry run) or applied.
type EndAddressRepairChange = driveaddressrepair.Change

// EndAddressRepairReport summarizes one RepairDuplicateEndAddresses pass.
type EndAddressRepairReport = driveaddressrepair.Report

// planEndAddressRepair decides the new end label for a suspect drive; see
// driveaddressrepair.PlanEndAddressRepair.
func planEndAddressRepair(d *drivemodel.Drive, resolved string, lookupOK bool) (string, bool) {
	return driveaddressrepair.PlanEndAddressRepair(d, resolved, lookupOK)
}

// RepairDuplicateEndAddresses re-resolves duplicate end addresses via
// driveaddressrepair.Repairer; see that package for the contract
// (idempotent, dry-run, rate-limited, never genuine round trips).
func (t *TelemetrySessionTracker) RepairDuplicateEndAddresses(ctx context.Context, dryRun bool) (EndAddressRepairReport, error) {
	if t.driveRepo == nil || t.geocoder == nil {
		return EndAddressRepairReport{DryRun: dryRun}, nil
	}
	repairer := driveaddressrepair.NewRepairer(t.driveRepo,
		driveaddressrepair.NewResolver(t.geofenceRepo, t.placesCache, t.geocoder))
	repairer.Pace = func() { time.Sleep(geocodeRateLimit) }
	return repairer.Repair(ctx, dryRun)
}
