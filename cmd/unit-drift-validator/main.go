// Package main is the unit-drift-validator CLI.
//
// One-shot or scheduled-pass driver for internal/worker.UnitDriftValidator.
// Designed for two operator workflows:
//
//  1. Triage / on-call investigation: ./unit-drift-validator --vehicle 42
//     --dry-run --once. Prints suspected drifts to stderr WITHOUT
//     incrementing the alert counter. Safe to run from a developer
//     laptop or jump host.
//
//  2. Scheduled cron job (alternate to in-server worker.Start loop):
//     ./unit-drift-validator --once. Single full-fleet pass. Exits
//     0 unconditionally (drift is logged, not raised); a non-zero
//     exit code reflects only pipeline failures (DB unreachable, etc.).
//
// Production validators normally run inside the teslasync server
// process via worker.UnitDriftValidator.Start. This binary exists for
// out-of-band operator use ONLY — it MUST hold the same operator
// credential gate as cmd/resubscribe to prevent CI / dev shells from
// accidentally feeding the alert pipeline.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/database"
	vehicledb "github.com/ev-dev-labs/teslasync/internal/database/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/worker"
)

var version = "dev"

// operatorTokenEnv is the credential gate. Identical sentinel to
// cmd/resubscribe so the same operator-token rotation policy covers
// both binaries.
const operatorTokenEnv = "TESLASYNC_OPERATOR_TOKEN"

type runConfig struct {
	once         bool
	dryRun       bool
	vehicleID    int64
	lookback     time.Duration
	cronInterval time.Duration
	printVersion bool
}

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

// run is the test-friendly entry point. argv is the program args
// (NOT including os.Args[0]); stdout / stderr are injected so tests
// can assert on output without juggling os.Stdout swaps.
func run(argv []string, stdout, stderr io.Writer) int {
	cfg, err := parseArgs(argv, stderr)
	if err != nil {
		return 2
	}
	if cfg.printVersion {
		fmt.Fprintln(stdout, version)
		return 0
	}

	// Operator credential gate. Presence-only — value is never logged
	// or compared. Refusing to launch when unset prevents accidental
	// invocation from cron / shell history / CI.
	if strings.TrimSpace(os.Getenv(operatorTokenEnv)) == "" {
		fmt.Fprintf(stderr,
			"refusing to run: %s must be set (operator credential gate per ADR-004 #9)\n",
			operatorTokenEnv)
		return 3
	}

	// zerolog → stderr (so stdout stays free for --version etc.).
	zerolog.TimeFieldFormat = time.RFC3339Nano
	log.Logger = zerolog.New(stderr).With().Timestamp().Logger()

	appCfg, err := config.Load()
	if err != nil {
		log.Error().Err(err).Msg("config.Load failed")
		return 4
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	db, err := database.New(ctx, appCfg.Database)
	if err != nil {
		log.Error().Err(err).Msg("database.New failed")
		return 5
	}
	defer db.Close()

	vehicleRepo := vehicledb.NewVehicleRepo(db)
	v := worker.NewUnitDriftValidator(db, vehicleRepo)

	opts := worker.Options{
		Lookback:     cfg.lookback,
		CronInterval: cfg.cronInterval,
		DryRun:       cfg.dryRun,
		OnlyVehicle:  cfg.vehicleID,
	}
	operator := deriveOperator()
	log.Info().
		Str("event", "unit_drift_validator.start").
		Str("operator", operator).
		Bool("once", cfg.once).
		Bool("dry_run", cfg.dryRun).
		Int64("vehicle", cfg.vehicleID).
		Dur("lookback", cfg.lookback).
		Dur("cron_interval", cfg.cronInterval).
		Str("version", version).
		Msg("unit-drift validator CLI starting")

	if cfg.once {
		err := v.Run(ctx, opts)
		log.Info().
			Str("event", "unit_drift_validator.end").
			Err(err).
			Msg("unit-drift validator one-shot complete")
		if err != nil && !errors.Is(err, context.Canceled) {
			return 6
		}
		return 0
	}

	v.Start(ctx, opts)
	log.Info().Str("event", "unit_drift_validator.end").Msg("unit-drift validator long-running loop exited")
	return 0
}

// parseArgs is broken out so tests can exercise flag handling without
// invoking the rest of run().
func parseArgs(argv []string, stderr io.Writer) (runConfig, error) {
	fs := flag.NewFlagSet("unit-drift-validator", flag.ContinueOnError)
	fs.SetOutput(stderr)
	cfg := runConfig{}
	fs.BoolVar(&cfg.once, "once", false, "run a single pass and exit (default: long-running cron loop)")
	fs.BoolVar(&cfg.dryRun, "dry-run", false, "log findings WITHOUT incrementing tesla_unit_drift_suspected_total counter")
	fs.Int64Var(&cfg.vehicleID, "vehicle", 0, "limit to one vehicle ID (default: full fleet)")
	fs.DurationVar(&cfg.lookback, "lookback", time.Hour, "how far back into signal_log each pass reads (default: 1h)")
	fs.DurationVar(&cfg.cronInterval, "cron-interval", 24*time.Hour, "cadence for the long-running loop (ignored when --once)")
	fs.BoolVar(&cfg.printVersion, "version", false, "print build version and exit")
	if err := fs.Parse(argv); err != nil {
		return runConfig{}, err
	}
	return cfg, nil
}

// deriveOperator returns the user identity for the audit log. Mirrors
// cmd/resubscribe.deriveOperator so audit-log greps work across both
// binaries.
func deriveOperator() string {
	for _, key := range []string{"USER", "USERNAME"} {
		if v := strings.TrimSpace(os.Getenv(key)); v != "" {
			return v
		}
	}
	return "unknown"
}
