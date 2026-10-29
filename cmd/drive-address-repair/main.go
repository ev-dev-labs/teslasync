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
	"github.com/ev-dev-labs/teslasync/internal/driveaddressrepair"
	"github.com/ev-dev-labs/teslasync/internal/geocoding"
)

// Version is set via -ldflags at build time (matches other cmd/* binaries).
var Version = "dev"

func main() { os.Exit(run()) }

func run() int {
	dryRun := flag.Bool("dry-run", true, "list affected drives and proposed end addresses without writing")
	flag.Parse()

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
