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
	"io"
	"os"
	"strings"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/backup"
	"github.com/ev-dev-labs/teslasync/internal/backupverify"
	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/database"
	dbbackup "github.com/ev-dev-labs/teslasync/internal/database/backup"
)

// verifier is the narrow surface runWithDeps needs from
// *backupverify.Verifier. Carving it out as an interface keeps the
// verify/emit/exit-decision core decoupled from the concrete verifier
// (and its *database.DB dependency closure) so main_test.go can exercise
// the success/failure branches without a real database or storage provider.
type verifier interface {
	VerifyLatest(ctx context.Context) (*backupverify.Result, error)
}

func main() {
	os.Exit(run(os.Stdout, os.Stderr, os.Getenv))
}

// run wires the real dependencies (config, database, backup processor,
// repos) then delegates the testable core to runWithDeps. It returns the
// process exit code so callers control os.Exit and deferred cleanup
// (db.Close, context cancel) always runs. stdout/stderr/getenv are
// injected so the boundary stays explicit and side-effect-free to import.
func run(stdout, stderr io.Writer, getenv func(string) string) int {
	zerolog.TimeFieldFormat = time.RFC3339
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: stderr, TimeFormat: time.RFC3339})

	cfg, err := config.Load()
	if err != nil {
		log.Error().Err(err).Msg("config load failed")
		return 1
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	db, err := database.New(ctx, cfg.Database)
	if err != nil {
		log.Error().Err(err).Msg("database connect failed")
		return 1
	}
	defer db.Close()

	processor := backup.NewProcessor(db)
	runsRepo := dbbackup.NewBackupRunRepo(db)
	configsRepo := dbbackup.NewBackupConfigRepo(db)

	criticals := parseCriticals(getenv("BACKUP_VERIFY_CRITICAL_TABLES"))
	maxAge := parseDuration(getenv("BACKUP_VERIFY_MAX_AGE"), 7*24*time.Hour)

	v := backupverify.NewVerifier(processor, runsRepo, configsRepo, criticals, maxAge)
	return runWithDeps(ctx, v, stdout)
}

// runWithDeps is the dependency-injected core: run one verification pass,
// emit the JSON result line to stdout (cron-friendly), and translate the
// outcome into an exit code. Returns 1 when the verifier errors, returns a
// nil result, or reports Result.OK == false; 0 only on a clean pass.
func runWithDeps(ctx context.Context, v verifier, stdout io.Writer) int {
	res, err := v.VerifyLatest(ctx)
	emit(stdout, res)
	if err != nil || res == nil || !res.OK {
		log.Error().Err(err).Msg("backup verification FAILED")
		return 1
	}
	log.Info().Int64("run_id", res.RunID).Int64("duration_ms", res.DurationMs).Msg("backup verification OK")
	return 0
}

func emit(w io.Writer, res *backupverify.Result) {
	if res == nil {
		fmt.Fprintln(w, `{"ok":false,"error":"nil result"}`)
		return
	}
	body, err := json.Marshal(res)
	if err != nil {
		fmt.Fprintf(w, `{"ok":false,"error":"marshal: %s"}`+"\n", err)
		return
	}
	fmt.Fprintln(w, string(body))
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
