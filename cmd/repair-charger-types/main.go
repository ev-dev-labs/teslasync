package main

import (
	"context"
	"flag"
	"fmt"
	"net"
	"os"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/app/chargingsvc"
	"github.com/ev-dev-labs/teslasync/internal/database"
	chargingdb "github.com/ev-dev-labs/teslasync/internal/database/charging"
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
			return fmt.Errorf("charger repair requires loopback hosts; production is prohibited")
		}
	}
	if !strings.HasPrefix(cfg.ConnConfig.Database, "teslasync_charging_repair_") {
		return fmt.Errorf("repair database name must begin teslasync_charging_repair_")
	}
	return nil
}

type correction struct {
	id       int64
	previous *string
	next     *string
}

func sameType(a, b *string) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && *a == *b)
}

func run(ctx context.Context, apply bool, afterID int64, limit int) error {
	if limit < 1 || limit > 1000 || afterID < 0 {
		return fmt.Errorf("limit must be 1..1000 and after-id must be nonnegative")
	}
	dsn := os.Getenv("CHARGING_REPAIR_DSN")
	if dsn == "" {
		return fmt.Errorf("CHARGING_REPAIR_DSN must identify an isolated local copy; production is prohibited")
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
	repo := chargingdb.NewChargingRepo(&database.DB{Pool: pool})
	sessions, err := repo.ClassificationRepairBatch(ctx, afterID, limit)
	if err != nil {
		return err
	}
	facts, err := repo.LoadSessionFacts(ctx, sessions)
	if err != nil {
		return err
	}
	plan := make([]correction, 0)
	for _, session := range sessions {
		previous := session.ChargerType
		chargingsvc.ApplySessionFacts(session, facts[session.ID])
		afterID = session.ID
		if sameType(previous, session.ChargerType) {
			continue
		}
		plan = append(plan, correction{session.ID, previous, session.ChargerType})
		log.Info().Bool("dry_run", true).Int64("session_id", session.ID).
			Interface("previous_type", previous).Interface("next_type", session.ChargerType).
			Msg("charging classification repair candidate")
	}
	log.Info().Bool("dry_run", true).Int("scanned", len(sessions)).Int("candidates", len(plan)).
		Int64("next_after_id", afterID).Msg("charging classification repair preview complete")
	if !apply {
		return nil
	}
	for _, item := range plan {
		changed, err := repo.RepairChargerType(ctx, item.id, item.previous, item.next)
		if err != nil {
			return err
		}
		log.Info().Int64("session_id", item.id).Bool("changed", changed).
			Interface("previous_type", item.previous).Interface("next_type", item.next).
			Msg("charging classification repair applied")
	}
	return nil
}

func main() {
	apply := flag.Bool("apply", false, "apply after logging a dry-run; isolated local copies only")
	afterID := flag.Int64("after-id", 0, "scan completed sessions after this ID")
	limit := flag.Int("limit", 100, "maximum completed sessions to inspect (1..1000)")
	flag.Parse()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	if err := run(ctx, *apply, *afterID, *limit); err != nil {
		log.Error().Err(err).Msg("charging classification repair stopped")
		os.Exit(1)
	}
}
