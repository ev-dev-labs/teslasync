// Phase-49 / p49-backup-verify.
//
// cmd/backup-verify is a one-shot binary that exercises the most
// recent successful backup_run artifact and verifies it round-trips
// through the storage provider, decompresses cleanly, matches its
// recorded checksum, and contains a non-zero count of the operator-
// configured critical tables (default {"vehicles"}; comma-separated
// override via BACKUP_VERIFY_CRITICAL_TABLES).
//
// Designed to run on a weekly cron / k8s CronJob:
//
//	0 4 * * 0 /app/backup-verify
//
// Emits a JSON-shaped result line to stdout (cron-friendly) and exits
// 0 on success / 1 on failure so a scheduler can alert directly.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/backup"
	"github.com/ev-dev-labs/teslasync/internal/backupverify"
	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

func main() {
	zerolog.TimeFieldFormat = time.RFC3339
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: time.RFC3339})

	cfg, err := config.Load()
	if err != nil {
		log.Fatal().Err(err).Msg("config load failed")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	db, err := database.New(ctx, cfg.Database)
	if err != nil {
		log.Fatal().Err(err).Msg("database connect failed")
	}
	defer db.Close()

	processor := backup.NewProcessor(db)
	runsRepo := database.NewBackupRunRepo(db)
	configsRepo := database.NewBackupConfigRepo(db)

	criticals := parseCriticals(os.Getenv("BACKUP_VERIFY_CRITICAL_TABLES"))
	maxAge := parseDuration(os.Getenv("BACKUP_VERIFY_MAX_AGE"), 7*24*time.Hour)

	v := backupverify.NewVerifier(processor, runsRepo, configsRepo, criticals, maxAge)
	res, err := v.VerifyLatest(ctx)
	emit(res)
	if err != nil || res == nil || !res.OK {
		log.Error().Err(err).Msg("backup verification FAILED")
		os.Exit(1)
	}
	log.Info().Int64("run_id", res.RunID).Int64("duration_ms", res.DurationMs).Msg("backup verification OK")
}

func emit(res *backupverify.Result) {
	if res == nil {
		fmt.Fprintln(os.Stdout, `{"ok":false,"error":"nil result"}`)
		return
	}
	body, err := json.Marshal(res)
	if err != nil {
		fmt.Fprintf(os.Stdout, `{"ok":false,"error":"marshal: %s"}`+"\n", err)
		return
	}
	fmt.Fprintln(os.Stdout, string(body))
}

func parseCriticals(raw string) []string {
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		t := strings.TrimSpace(p)
		if t != "" {
			out = append(out, t)
		}
	}
	return out
}

func parseDuration(raw string, def time.Duration) time.Duration {
	if raw == "" {
		return def
	}
	d, err := time.ParseDuration(raw)
	if err != nil {
		log.Warn().Str("raw", raw).Err(err).Msg("BACKUP_VERIFY_MAX_AGE parse failed; using default")
		return def
	}
	return d
}
