// repair-notification-vehicles operates only on a disposable local database copy.
// Set NOTIFICATION_REPAIR_DSN to a loopback PostgreSQL database whose name begins
// teslasync_notification_repair_. The default is dry-run; -apply logs the dry-run
// first, then records each change in notification_log_events. No messages are
// rewritten: the schema does not retain original template parameters.
package main

import (
	"context"
	"flag"
	"fmt"
	"net"
	"os"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	dbnotif "github.com/ev-dev-labs/teslasync/internal/database/notification"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"
)

func validateTarget(cfg *pgxpool.Config) error {
	hosts := []string{cfg.ConnConfig.Host}
	for _, fallback := range cfg.ConnConfig.Fallbacks {
		hosts = append(hosts, fallback.Host)
	}
	for _, host := range hosts {
		ip := net.ParseIP(host)
		if host != "localhost" && (ip == nil || !ip.IsLoopback()) {
			return fmt.Errorf("repair requires loopback hosts and an isolated local database copy")
		}
	}
	if !strings.HasPrefix(cfg.ConnConfig.Database, "teslasync_notification_repair_") {
		return fmt.Errorf("repair database name must begin teslasync_notification_repair_")
	}
	return nil
}

func run(ctx context.Context, apply bool, limit int) error {
	dsn := os.Getenv("NOTIFICATION_REPAIR_DSN")
	if dsn == "" {
		return fmt.Errorf("NOTIFICATION_REPAIR_DSN must identify an isolated local copy; production is prohibited")
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return fmt.Errorf("invalid repair database configuration")
	}
	if err := validateTarget(cfg); err != nil {
		return err
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return fmt.Errorf("open repair database: %w", err)
	}
	defer pool.Close()
	repo := dbnotif.NewNotificationRepo(&database.DB{Pool: pool})
	plan, err := repo.RepairVehicleLinks(ctx, false, limit)
	if err != nil {
		return err
	}
	for _, item := range plan {
		log.Info().Bool("dry_run", true).Int64("notification_id", item.LogID).Int64("vehicle_id", item.VehicleID).Msg("notification vehicle repair candidate")
	}
	log.Info().Int("candidates", len(plan)).Bool("dry_run", true).Msg("Historical messages preserved: original template parameters were not stored")
	if !apply {
		return nil
	}
	repaired, err := repo.RepairVehicleLinks(ctx, true, limit)
	if err != nil {
		return err
	}
	for _, item := range repaired {
		log.Info().Int64("notification_id", item.LogID).Int64("vehicle_id", item.VehicleID).Msg("notification vehicle repaired")
	}
	return nil
}

func main() {
	apply := flag.Bool("apply", false, "apply after logging a dry-run; isolated local copies only")
	limit := flag.Int("limit", 1000, "maximum rows per run (1..10000); repeat until no candidates remain")
	flag.Parse()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	if err := run(ctx, *apply, *limit); err != nil {
		log.Error().Err(err).Msg("notification repair stopped")
		os.Exit(1)
	}
}
