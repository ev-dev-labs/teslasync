// Command drive-address-repair re-resolves the end address from the end
// coordinates for drives whose stored end address equals the start
// address while the endpoints are far apart (see
// drivemodel.Drive.HasDuplicateEndAddress). Genuine round trips are
// never touched.
//
// Usage (dry run first — it is the default and writes nothing):
//
//	drive-address-repair -dry-run
//	drive-address-repair -dry-run=false
//
// The same repair also runs at service startup from
// TelemetrySessionTracker.BackfillAddresses. This command exists so an
// operator can preview the affected drives and proposed changes before
// applying them. Lookups bypass the places cache and are paced for the
// geocoding provider's rate limit; every change is logged.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/database"
	dbadmin "github.com/ev-dev-labs/teslasync/internal/database/admin"
	drivedb "github.com/ev-dev-labs/teslasync/internal/database/drive"
	geofencedb "github.com/ev-dev-labs/teslasync/internal/database/geofence"
	signaldb "github.com/ev-dev-labs/teslasync/internal/database/signal"
	"github.com/ev-dev-labs/teslasync/internal/driveaddressrepair"
	"github.com/ev-dev-labs/teslasync/internal/geocoding"
)

// Version is set via -ldflags at build time (matches other cmd/* binaries).
var Version = "dev"

func main() { os.Exit(run()) }

func run() int {
	dryRun := flag.Bool("dry-run", true, "list proposed repairs without writing")
	energy := flag.Bool("energy", false, "repair signed mean power and recovered energy from retained signals instead of addresses")
	driveID := flag.Int64("drive-id", 0, "completed drive to inspect (required with -energy)")
	flag.Parse()
	if *driveID != 0 && !*energy {
		log.Error().Msg("drive-address-repair: -drive-id is currently scoped to -energy repairs")
		return 1
	}
	if *energy && *driveID <= 0 {
		log.Error().Msg("drive-address-repair: -energy requires a positive -drive-id")
		return 1
	}

	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to load config: %v\n", err)
		return 1
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	db, err := database.New(ctx, cfg.Database)
	if err != nil {
		log.Error().Err(err).Msg("drive-address-repair: failed to connect to database")
		return 1
	}
	defer db.Close()

	if *energy {
		report, err := driveaddressrepair.RepairEnergy(ctx, drivedb.NewDriveRepo(db),
			signaldb.NewSignalLogReader(db), *driveID, *dryRun)
		if err != nil {
			log.Error().Err(err).Int64("drive_id", *driveID).Bool("dry_run", *dryRun).
				Msg("drive-address-repair: energy repair failed")
			return 1
		}
		log.Info().Int64("drive_id", *driveID).Bool("dry_run", *dryRun).
			Bool("changed", report.Changed).Interface("old_avg_power_w", report.OldAvgPowerW).
			Interface("avg_power_w", report.AvgPowerW).Interface("old_regen_energy_wh", report.OldRegenWh).
			Interface("regen_energy_wh", report.RegenWh).Str("unrepairable", report.Unrepairable).
			Msg("drive-address-repair: energy evidence; raw signals and cumulative consumption are unchanged")
		return 0
	}

	repairer := driveaddressrepair.NewRepairer(drivedb.NewDriveRepo(db),
		driveaddressrepair.NewResolver(geofencedb.NewGeofenceRepo(db), dbadmin.NewPlacesCacheRepo(db),
			geocoding.NewGeocoder(cfg.GoogleMaps.APIKey, cfg.AzureMaps.APIKey)))
	report, err := repairer.Repair(ctx, *dryRun)
	if err != nil {
		log.Error().Err(err).Msg("drive-address-repair: repair failed")
		return 1
	}
	for _, change := range report.Changed {
		log.Info().Int64("drive_id", change.DriveID).
			Str("old_end", change.OldEnd).Str("new_end", change.NewEnd).
			Float64("distance_m", change.DistanceM).
			Bool("dry_run", *dryRun).
			Msg("drive-address-repair: end address")
	}
	log.Info().Bool("dry_run", *dryRun).Int("scanned", report.Scanned).
		Int("changed", len(report.Changed)).Int("failed", report.Failed).
		Msg("drive-address-repair: done")
	return 0
}
