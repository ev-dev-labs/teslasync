// Command resubscribe pushes a fresh Fleet Telemetry subscription
// configuration to every (or one) vehicle so Tesla's process-startup
// snapshot reseeds all subscribed signals — most importantly the four
// Setting*Unit fields whose absence would otherwise cause the ingest
// pipeline to fail-closed-drop unit-bearing values per ADR-004 #9.
//
// This binary is the operator surface for resubscribing all vehicles after
// deploys that touch Fleet Telemetry subscription state. It MUST refuse to
// run unless TESLASYNC_OPERATOR_TOKEN is set; the token value is not
// validated, because presence is enough to prevent accidental CI or shell
// history invocation.
//
// Audit trail: a structured zerolog "event=resubscribe.start" line is
// emitted before the first push and an "event=resubscribe.end" line at
// exit, both at INFO level, both routed to stdout AND any configured
// structured sink. config_sha256 in the start line is the sha256 of the
// canonical (*config.Builder).BuildSubscription() output and uniquely
// identifies the subscription shape pushed during this run.
//
// See docs/runbooks/fleet-telemetry-resubscribe.md for the full
// operator runbook (required ordering vs. the bootstrap step, canary
// procedure, alert thresholds, downtime expectations).
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"runtime"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	oteltrace "go.opentelemetry.io/otel/trace"

	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/database"
	teslabudgetdb "github.com/ev-dev-labs/teslasync/internal/database/teslabudget"
	vehicledb "github.com/ev-dev-labs/teslasync/internal/database/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/resilience"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
	teslaconfig "github.com/ev-dev-labs/teslasync/internal/tesla/config"
	"github.com/ev-dev-labs/teslasync/internal/tracing"
)

// Version is set via -ldflags at build time (matches other cmd/* binaries).
var Version = "dev"

// tracerName scopes spans for the resubscribe binary.
const tracerName = "cmd/resubscribe"

func cmdTracer() oteltrace.Tracer { return otel.Tracer(tracerName) }

// operatorTokenEnv is the env var that must be set for the binary to run.
// The token value is not validated cryptographically; presence is the
// gate — the goal is to make accidental invocation (e.g., by CI, by a
// developer's shell history) impossible. Rotated quarterly; on-call holds it.
const operatorTokenEnv = "TESLASYNC_OPERATOR_TOKEN"

// Default per-vehicle Tesla API timeout. The Tesla command proxy
// historically returns within 5-15s; 60s gives generous headroom while
// still bounding stuck workers.
const defaultPerVehicleTimeout = 60 * time.Second

// Default worker pool size. Resubscribe is per-vehicle independent so
// concurrency is safe; 4 is a conservative default that keeps the Tesla
// API call rate well below documented limits even for fleets <50 vehicles.
const defaultWorkers = 4

// pusher is the subset of *tesla.Client that resubscribe needs. Carving
// it out as an interface keeps the worker loop decoupled from the
// concrete client and lets main_test.go exercise the success/failure
// branches without spinning up an HTTP server.
type pusher interface {
	SubscribeFleetTelemetry(ctx context.Context, sub tesla.FleetTelemetrySubscription) ([]byte, int, error)
}

// vehicleLister is the subset of *vehicledb.VehicleRepo that resubscribe
// needs. Same rationale as pusher: lets main_test.go inject a fixed
// vehicle list without a real database connection.
type vehicleLister interface {
	GetAll(ctx context.Context) ([]*vehiclemodel.Vehicle, error)
}

func main() {
	exitCode := run(os.Args[1:], os.Stdout, os.Stderr, os.Getenv)
	os.Exit(exitCode)
}

// run is the testable entry point. It returns the process exit code so
// tests can assert exit semantics (0 only when every vehicle succeeds)
// without invoking os.Exit. Stdout/stderr/getenv are injected so tests
// can capture audit lines and override TESLASYNC_OPERATOR_TOKEN without
// mutating the global process environment.
func run(args []string, stdout, stderr *os.File, getenv func(string) string) int {
	fs := flag.NewFlagSet("resubscribe", flag.ContinueOnError)
	fs.SetOutput(stderr)

	var (
		dryRun    = fs.Bool("dry-run", false, "log what would happen without calling Tesla")
		vehicleID = fs.Int64("vehicle", 0, "subscribe a single vehicle by integer ID (0 = all vehicles)")
		workers   = fs.Int("workers", defaultWorkers, "bounded worker-pool size")
		timeout   = fs.Duration("per-vehicle-timeout", defaultPerVehicleTimeout, "context timeout per Tesla API call")
		showVer   = fs.Bool("version", false, "print version and exit")
	)
	if err := fs.Parse(args); err != nil {
		// flag.ErrHelp is already printed by flag's own usage handler;
		// any other parse error is also an exit-2 condition.
		if errors.Is(err, flag.ErrHelp) {
			return 2
		}
		fmt.Fprintf(stderr, "parse flags: %v\n", err)
		return 2
	}

	if *showVer {
		fmt.Fprintf(stdout, "resubscribe %s\n", Version)
		return 0
	}

	// Wire zerolog before anything else so the operator-token guard
	// failure is captured by the same structured sink the audit lines
	// land in.
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	log.Logger = zerolog.New(stdout).With().Timestamp().Str("binary", "resubscribe").Logger()

	if strings.TrimSpace(getenv(operatorTokenEnv)) == "" {
		log.Error().
			Str("env", operatorTokenEnv).
			Msg("refusing to run without TESLASYNC_OPERATOR_TOKEN; this is a privileged operation, see runbook")
		return 1
	}

	if *workers <= 0 {
		log.Error().Int("workers", *workers).Msg("workers must be > 0")
		return 2
	}

	cfg, err := config.Load()
	if err != nil {
		log.Error().Err(err).Msg("load config")
		return 1
	}

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	// ── OpenTelemetry tracing ────────────────────────────────────────
	// resubscribe is a short-lived one-shot. We skip tracing init on
	// --dry-run so CI runs (which exercise the full code path against
	// a fake pusher) stay fast and don't touch a collector. In
	// real-world operator runs the per-vehicle push spans nest under a
	// root resubscribe.run span emitted by runWithDeps — see the
	// resubscribe_push entry in cmd/trace-coverage-audit.
	var tracingShutdown func(context.Context) error
	if !*dryRun {
		shutdown, err := tracing.Init(ctx, cfg, tracing.WithServiceName("teslasync-resubscribe"))
		if err != nil {
			log.Warn().Err(err).Msg("failed to initialize tracing, continuing without it")
		} else {
			tracingShutdown = shutdown
			if cfg.OpenTelemetry.Enabled {
				log.Info().
					Str("service", "teslasync-resubscribe").
					Str("endpoint", cfg.OTLPEndpoint).
					Msg("OpenTelemetry tracing enabled")
			}
		}
	}
	defer func() {
		if tracingShutdown == nil {
			return
		}
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
		if err := tracingShutdown(shutdownCtx); err != nil {
			log.Warn().Err(err).Msg("tracing shutdown failed")
		}
		shutdownCancel()
	}()

	var db *database.DB
	if err := resilience.ConnectWithRetry(ctx, "database", 5, func(ctx context.Context) error {
		var connErr error
		db, connErr = database.New(ctx, cfg.Database)
		return connErr
	}); err != nil {
		log.Error().Err(err).Msg("connect database")
		return 1
	}
	defer db.Close()

	teslaClient := tesla.NewClient(cfg.Tesla)
	budgetPolicy := tesla.NewBudgetPolicy(cfg.Tesla.DailyBudgetUSD, cfg.Tesla.CommandReserveUSD)
	if budgetPolicy.Enabled() {
		teslaClient.SetRequestBudget(teslabudgetdb.New(db.Pool, budgetPolicy))
	}
	vehicleRepo := vehicledb.NewVehicleRepo(db)

	rc := runConfig{
		dryRun:            *dryRun,
		vehicleFilter:     *vehicleID,
		workers:           *workers,
		perVehicleTimeout: *timeout,
		fleetHostname:     cfg.FleetTelemetry.Host,
		fleetPort:         cfg.FleetTelemetry.Port,
		operatorEnv:       deriveOperator(getenv),
	}

	return runWithDeps(ctx, rc, vehicleRepo, teslaClient, stdout)
}

// runConfig groups the inputs to runWithDeps so the testable surface
// stays small. Hostname/Port are sourced from cfg.FleetTelemetry in main
// but injected explicitly here so tests can pin them.
type runConfig struct {
	dryRun            bool
	vehicleFilter     int64
	workers           int
	perVehicleTimeout time.Duration
	fleetHostname     string
	fleetPort         int
	operatorEnv       string
}

// runWithDeps is the dependency-injected core. It builds the canonical
// subscription, emits the resubscribe.start audit line with config_sha256,
// runs the bounded worker pool, then emits resubscribe.end with the
// summary. Returns 0 only if every vehicle succeeded.
func runWithDeps(ctx context.Context, rc runConfig, vehicles vehicleLister, push pusher, stdout *os.File) int {
	ctx, runSpan := cmdTracer().Start(ctx, "resubscribe.run",
		oteltrace.WithSpanKind(oteltrace.SpanKindInternal),
		oteltrace.WithAttributes(
			attribute.Bool("resubscribe.dry_run", rc.dryRun),
			attribute.Int("resubscribe.workers", rc.workers),
			attribute.Int64("resubscribe.vehicle_filter", rc.vehicleFilter),
			attribute.String("resubscribe.operator", rc.operatorEnv),
		),
	)
	defer runSpan.End()

	all, err := vehicles.GetAll(ctx)
	if err != nil {
		runSpan.RecordError(err)
		runSpan.SetStatus(codes.Error, "list vehicles failed")
		log.Error().Err(err).Msg("list vehicles")
		return 1
	}
	targets := filterVehicles(all, rc.vehicleFilter)
	runSpan.SetAttributes(attribute.Int("resubscribe.target_count", len(targets)))
	if len(targets) == 0 {
		if rc.vehicleFilter != 0 {
			runSpan.SetStatus(codes.Error, "vehicle not found")
			log.Error().Int64("vehicle_id", rc.vehicleFilter).Msg("vehicle not found")
			return 1
		}
		log.Warn().Msg("no vehicles to resubscribe; exiting")
		return 0
	}

	builder := teslaconfig.NewBuilder()
	if rc.fleetHostname != "" {
		builder.Hostname = rc.fleetHostname
	}
	if rc.fleetPort != 0 {
		builder.Port = rc.fleetPort
	}
	canonical, err := builder.BuildSubscription()
	if err != nil {
		runSpan.RecordError(err)
		runSpan.SetStatus(codes.Error, "build subscription failed")
		log.Error().Err(err).Msg("build subscription")
		return 1
	}
	cfgSHA := sha256.Sum256(canonical)
	cfgSHAHex := hex.EncodeToString(cfgSHA[:])
	runSpan.SetAttributes(attribute.String("resubscribe.config_sha256", cfgSHAHex))

	fields := buildFieldMap(builder)

	start := time.Now()
	log.Info().
		Str("event", "resubscribe.start").
		Str("operator", rc.operatorEnv).
		Int("vehicle_count", len(targets)).
		Bool("dry_run", rc.dryRun).
		Int("workers", rc.workers).
		Str("config_sha256", cfgSHAHex).
		Msg("resubscribe starting")

	var (
		succeeded atomic.Int64
		failed    atomic.Int64
		skipped   atomic.Int64
	)

	jobs := make(chan *vehiclemodel.Vehicle, rc.workers)
	wg := &sync.WaitGroup{}
	for i := 0; i < rc.workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for v := range jobs {
				switch pushOne(ctx, rc, v, fields, push) {
				case resultOK:
					succeeded.Add(1)
				case resultFailed:
					failed.Add(1)
				case resultSkipped:
					skipped.Add(1)
				}
			}
		}()
	}

	for _, v := range targets {
		select {
		case <-ctx.Done():
			// Drain remaining vehicles into the skip counter so the
			// summary is honest about how many were never attempted.
			skipped.Add(1)
		case jobs <- v:
		}
	}
	close(jobs)
	wg.Wait()

	exitCode := 0
	if failed.Load() > 0 || skipped.Load() > 0 {
		exitCode = 1
	}
	runSpan.SetAttributes(
		attribute.Int64("resubscribe.succeeded", succeeded.Load()),
		attribute.Int64("resubscribe.failed", failed.Load()),
		attribute.Int64("resubscribe.skipped", skipped.Load()),
		attribute.Int("resubscribe.exit_code", exitCode),
	)
	if exitCode != 0 {
		runSpan.SetStatus(codes.Error, "one or more vehicles failed or were skipped")
	}

	log.Info().
		Str("event", "resubscribe.end").
		Int64("succeeded", succeeded.Load()).
		Int64("failed", failed.Load()).
		Int64("skipped", skipped.Load()).
		Float64("duration_seconds", time.Since(start).Seconds()).
		Int("exit_code", exitCode).
		Msg("resubscribe complete")

	return exitCode
}

// pushResult tracks per-vehicle outcomes for the run summary.
type pushResult int

const (
	resultOK pushResult = iota
	resultFailed
	resultSkipped
)

// pushOne handles a single vehicle: dry-run logs and skips, real run
// builds a single-vehicle FleetTelemetrySubscription and calls
// SubscribeFleetTelemetry through the command proxy. A non-2xx HTTP
// status is treated as failure (logged WARN, counted as failed) so the
// summary distinguishes "Tesla rejected" from "we never tried".
func pushOne(ctx context.Context, rc runConfig, v *vehiclemodel.Vehicle, fields map[string]tesla.FleetTelemetryField, push pusher) pushResult {
	ctx, span := cmdTracer().Start(ctx, "resubscribe.push_vehicle",
		oteltrace.WithSpanKind(oteltrace.SpanKindClient),
		oteltrace.WithAttributes(
			attribute.Int64("vehicle.id", v.ID),
			attribute.Bool("resubscribe.dry_run", rc.dryRun),
		),
	)
	defer span.End()

	if v.VIN == "" {
		span.SetAttributes(attribute.String("resubscribe.outcome", "skipped_empty_vin"))
		log.Warn().Int64("vehicle_id", v.ID).Msg("skipping vehicle with empty VIN")
		return resultSkipped
	}
	if rc.dryRun {
		span.SetAttributes(attribute.String("resubscribe.outcome", "dry_run_ok"))
		log.Info().
			Int64("vehicle_id", v.ID).
			Str("vin", v.VIN).
			Bool("dry_run", true).
			Msg("would resubscribe")
		return resultOK
	}

	callCtx, cancel := context.WithTimeout(ctx, rc.perVehicleTimeout)
	defer cancel()

	sub := tesla.FleetTelemetrySubscription{
		VINs: []string{v.VIN},
		Config: tesla.FleetTelemetryConfigPayload{
			Hostname: rc.fleetHostname,
			Port:     rc.fleetPort,
			Fields:   fields,
		},
	}

	_, status, err := push.SubscribeFleetTelemetry(callCtx, sub)
	span.SetAttributes(attribute.Int("http.status_code", status))
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "subscribe failed")
		span.SetAttributes(attribute.String("resubscribe.outcome", "failed_error"))
		log.Warn().
			Err(err).
			Int64("vehicle_id", v.ID).
			Str("vin", v.VIN).
			Int("status", status).
			Msg("subscribe failed")
		return resultFailed
	}
	if status < 200 || status >= 300 {
		span.SetStatus(codes.Error, "non-2xx status")
		span.SetAttributes(attribute.String("resubscribe.outcome", "failed_status"))
		log.Warn().
			Int64("vehicle_id", v.ID).
			Str("vin", v.VIN).
			Int("status", status).
			Msg("subscribe returned non-success status")
		return resultFailed
	}
	span.SetAttributes(attribute.String("resubscribe.outcome", "ok"))
	log.Info().
		Int64("vehicle_id", v.ID).
		Str("vin", v.VIN).
		Int("status", status).
		Msg("subscribed")
	return resultOK
}

// filterVehicles returns the subset of vehicles to resubscribe. When
// vehicleFilter == 0 returns all vehicles sorted by ID for stable
// concurrency-independent log ordering. When vehicleFilter != 0
// returns either the matching single vehicle or an empty slice.
func filterVehicles(all []*vehiclemodel.Vehicle, vehicleFilter int64) []*vehiclemodel.Vehicle {
	if vehicleFilter == 0 {
		out := make([]*vehiclemodel.Vehicle, 0, len(all))
		for _, v := range all {
			if v != nil {
				out = append(out, v)
			}
		}
		sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
		return out
	}
	for _, v := range all {
		if v != nil && v.ID == vehicleFilter {
			return []*vehiclemodel.Vehicle{v}
		}
	}
	return nil
}

// buildFieldMap converts the canonical (*Builder).SubscriptionFields
// list into the wire-format map[Field]FleetTelemetryField that the
// SubscribeFleetTelemetry payload expects. Source of truth is the
// generated protomodel + intervals.go, so any drift surfaces here.
func buildFieldMap(b *teslaconfig.Builder) map[string]tesla.FleetTelemetryField {
	entries := b.SubscriptionFields()
	out := make(map[string]tesla.FleetTelemetryField, len(entries))
	for _, e := range entries {
		out[e.Name] = tesla.FleetTelemetryField{
			IntervalSeconds: e.IntervalSeconds,
			MinimumDelta:    e.MinimumDelta,
			IncludeFields:   append([]string(nil), e.IncludeFields...),
		}
	}
	return out
}

// deriveOperator returns the best-effort operator identity for the
// audit line. Tries USER first (Linux/macOS), USERNAME second (Windows),
// and falls back to the OS+arch hostname-substitute when neither is set
// — better to record "unknown" than to fail the run.
func deriveOperator(getenv func(string) string) string {
	for _, key := range []string{"USER", "USERNAME"} {
		if v := strings.TrimSpace(getenv(key)); v != "" {
			return v
		}
	}
	return fmt.Sprintf("unknown@%s/%s", runtime.GOOS, runtime.GOARCH)
}
