package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/backup"
	"github.com/ev-dev-labs/teslasync/internal/backuprestore"
	"github.com/ev-dev-labs/teslasync/internal/backupverify"
	"github.com/ev-dev-labs/teslasync/internal/database"
	dbbackup "github.com/ev-dev-labs/teslasync/internal/database/backup"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

func main() {
	os.Exit(run(os.Stdout, os.Stderr, os.Getenv))
}

func run(stdout, stderr io.Writer, getenv func(string) string) int {
	zerolog.TimeFieldFormat = time.RFC3339
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: stderr, TimeFormat: time.RFC3339})

	sourceURL := strings.TrimSpace(getenv("BACKUP_DRILL_DATABASE_URL"))
	targetURL := strings.TrimSpace(getenv("BACKUP_DRILL_TARGET_DATABASE_URL"))
	guard := strings.TrimSpace(getenv("BACKUP_DRILL_TARGET_GUARD"))
	if sourceURL == "" || targetURL == "" || guard == "" {
		emit(stdout, &backuprestore.Result{
			Error: "BACKUP_DRILL_DATABASE_URL, BACKUP_DRILL_TARGET_DATABASE_URL, and BACKUP_DRILL_TARGET_GUARD are required",
		})
		return 1
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	sourcePool, err := pgxpool.New(ctx, sourceURL)
	if err != nil {
		emit(stdout, &backuprestore.Result{Error: fmt.Sprintf("connect source database: %v", err)})
		return 1
	}
	defer sourcePool.Close()
	targetPool, err := pgxpool.New(ctx, targetURL)
	if err != nil {
		emit(stdout, &backuprestore.Result{Error: fmt.Sprintf("connect scratch database: %v", err)})
		return 1
	}
	defer targetPool.Close()

	sourceDB := &database.DB{Pool: sourcePool}
	processor := backup.NewProcessor(sourceDB)
	verifier := backupverify.NewVerifier(
		processor,
		dbbackup.NewBackupRunRepo(sourceDB),
		dbbackup.NewBackupConfigRepo(sourceDB),
		parseCriticalTables(getenv("BACKUP_VERIFY_CRITICAL_TABLES")),
		parseDuration(getenv("BACKUP_VERIFY_MAX_AGE"), 24*time.Hour),
	)
	restorer := backuprestore.New(verifier, sourcePool, targetPool)
	return runWithDeps(
		ctx,
		restorer,
		guard,
		parseCriticalTables(getenv("BACKUP_VERIFY_CRITICAL_TABLES")),
		stdout,
	)
}

type drillRunner interface {
	Run(ctx context.Context, guard string, criticalTables []string) (*backuprestore.Result, error)
}

func runWithDeps(
	ctx context.Context,
	runner drillRunner,
	guard string,
	criticalTables []string,
	stdout io.Writer,
) int {
	result, err := runner.Run(ctx, guard, criticalTables)
	emit(stdout, result)
	if err != nil || result == nil || !result.OK {
		log.Error().Err(err).Msg("production backup restore drill failed")
		return 1
	}
	return 0
}

func emit(writer io.Writer, result *backuprestore.Result) {
	if result == nil {
		result = &backuprestore.Result{Error: "nil restore result"}
	}
	body, err := json.Marshal(result)
	if err != nil {
		fmt.Fprintf(writer, `{"ok":false,"error":"encode restore result: %s"}`+"\n", err)
		return
	}
	fmt.Fprintln(writer, string(body))
}

func parseCriticalTables(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return []string{"vehicles", "drives", "charging_sessions"}
	}
	parts := strings.Split(raw, ",")
	tables := make([]string, 0, len(parts))
	for _, part := range parts {
		if table := strings.TrimSpace(part); table != "" {
			tables = append(tables, table)
		}
	}
	return tables
}

func parseDuration(raw string, fallback time.Duration) time.Duration {
	duration, err := time.ParseDuration(strings.TrimSpace(raw))
	if err != nil || duration <= 0 {
		return fallback
	}
	return duration
}
