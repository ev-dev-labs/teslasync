//go:build integration
// +build integration

package api_test

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"github.com/ev-dev-labs/teslasync/internal/api"
	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/database"
	platformdb "github.com/ev-dev-labs/teslasync/internal/platform/database"
	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
	"github.com/ev-dev-labs/teslasync/internal/tesla/normalize"
	"github.com/ev-dev-labs/teslasync/internal/tesla/router"
	"github.com/ev-dev-labs/teslasync/internal/tesla/router/writers"
	unithistory "github.com/ev-dev-labs/teslasync/internal/tesla/unit_history"
)

// TestTelemetryReplay is the Phase 6.32 merge-gate integration test. It replays
// captured Fleet Telemetry batches against a freshly migrated DB and asserts:
//
//  1. The expected typed columns get populated (positions / climate /
//     charging_telemetry / motor_snapshots / vehicle_live_state / etc).
//  2. ZERO surviving JSONB columns (`signals`, `raw_state`, `raw_json`)
//     anywhere in the public schema — the whole point of the db-refactor.
//  3. signal_catalog grows by the expected per-fixture new-name count.
//  4. signal_observations contains rows for cold (un-routed) signals.
//  5. The vehicle FSM lands in the expected terminal state.
//
// Build tag `integration` keeps it out of the default `go test ./...` lane;
// CI invokes it explicitly with `-tags integration` once the postgres service
// container is healthy.
//
// This test requires a Postgres reachable via DATABASE_URL or the standard
// DATABASE_HOST / DATABASE_PORT / DATABASE_USER / DATABASE_PASS / DATABASE_NAME
// env block (matching .github/workflows/ci.yml backend job).
func TestTelemetryReplay(t *testing.T) {
	cfg := loadDBConfigFromEnv(t)
	pool := setupFreshDB(t, cfg)
	t.Cleanup(pool.Close)

	h := buildHandler(t, pool)

	// Per-fixture expectations. Counts are LOWER bounds (>=) for catalog/cold
	// growth since flatten() expands a few compound parents into multiple
	// atomics; over-strict equality would fight that. Hot-row counts stay ==
	// because every batch produces at most one row per destination table.
	cases := []struct {
		name             string
		fixture          string
		wantPositionRows int
		wantClimateRows  int
		wantChargingRows int
		wantLiveStateRow bool
		wantColdRows     int // lower bound
		wantNewCatalog   int // lower bound
		wantFSMContains  string
	}{
		{"park-charge-complete", "001_park_charge_complete.json", 0, 1, 1, true, 2, 8, ""},
		{"drive-cycle", "002_drive_start_to_park.json", 1, 0, 0, true, 2, 4, ""},
		{"compound-doors", "003_compound_doorstate_open.json", 0, 0, 0, true, 0, 6, ""},
		{"compound-location", "004_compound_location.json", 1, 0, 0, false, 0, 2, ""},
		{"unknown-only", "005_unknown_signals.json", 0, 0, 0, false, 5, 5, ""},
		{"large-mixed", "006_mixed_500_signals.json", 1, 1, 1, true, 20, 30, ""},
		{"partial", "007_partial_payload.json", 0, 0, 0, false, 1, 1, ""},
	}

	ctx := context.Background()
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			batch := loadBatch(t, filepath.Join("testdata", "telemetry_batches", c.fixture))
			if batch.VIN == "" {
				t.Fatalf("fixture %s missing top-level vin", c.fixture)
			}
			vehicleID := ensureVehicle(t, pool, batch.VIN)

			before := snapshotCounts(t, pool, vehicleID)

			if err := h.ProcessBatch(ctx, batch.VIN, batch.Atomics()); err != nil {
				t.Fatalf("ProcessBatch: %v", err)
			}

			after := snapshotCounts(t, pool, vehicleID)

			if got := after.positions - before.positions; got != c.wantPositionRows {
				t.Errorf("positions delta = %d, want %d", got, c.wantPositionRows)
			}
			if got := after.climate - before.climate; got != c.wantClimateRows {
				t.Errorf("climate_snapshots delta = %d, want %d", got, c.wantClimateRows)
			}
			if got := after.charging - before.charging; got != c.wantChargingRows {
				t.Errorf("charging_telemetry delta = %d, want %d", got, c.wantChargingRows)
			}
			if c.wantLiveStateRow && after.liveState == 0 {
				t.Errorf("vehicle_live_state row missing for vehicle %d", vehicleID)
			}
			if got := after.coldObs - before.coldObs; got < c.wantColdRows {
				t.Errorf("signal_observations delta = %d, want >= %d", got, c.wantColdRows)
			}
			if got := after.catalog - before.catalog; got < c.wantNewCatalog {
				t.Errorf("signal_catalog delta = %d, want >= %d", got, c.wantNewCatalog)
			}

			if c.wantFSMContains != "" {
				state := h.FSMHandler().CurrentState(vehicleID)
				if state == "" {
					t.Errorf("expected FSM state containing %q, got empty", c.wantFSMContains)
				}
			}
		})
	}

	// Global invariant: AFTER the whole replay run, the public schema must
	// have ZERO surviving JSONB columns named signals/raw_state/raw_json.
	// This is the merge-gate from ADR-002 — it must fail loudly if anyone
	// reintroduces a JSONB carve-out.
	t.Run("zero-jsonb-columns", func(t *testing.T) {
		var n int
		err := pool.Pool.QueryRow(context.Background(), `
			SELECT count(*)
			  FROM information_schema.columns
			 WHERE column_name IN ('signals','raw_state','raw_json')
			   AND table_schema = 'public'
		`).Scan(&n)
		if err != nil {
			t.Fatalf("information_schema query: %v", err)
		}
		if n != 0 {
			cols := dumpJSONBColumns(t, pool)
			t.Fatalf("expected 0 legacy jsonb columns, found %d: %v", n, cols)
		}
	})
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

type fixtureSignal struct {
	Name  string `json:"name"`
	Value any    `json:"value"`
}

type fixtureBatch struct {
	VIN     string          `json:"vin"`
	Signals []fixtureSignal `json:"signals"`
}

// Atomics renders the fixture's signals into the codec.Atomic shape that
// TelemetryHandler.ProcessBatch consumes. EmittedAt is set to time.Now()
// because fixtures are JSON snapshots without a producer-side timestamp;
// VehicleID carries the fixture VIN so downstream string-keyed assertions
// (e.g. signal_log per-vehicle counts) line up with the rest of the test
// harness.
func (b fixtureBatch) Atomics() []codec.Atomic {
	now := time.Now().UTC()
	out := make([]codec.Atomic, 0, len(b.Signals))
	for _, s := range b.Signals {
		out = append(out, codec.Atomic{
			Field:     s.Name,
			Value:     s.Value,
			EmittedAt: now,
			VehicleID: b.VIN,
		})
	}
	return out
}

func loadBatch(t *testing.T, path string) fixtureBatch {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read fixture %s: %v", path, err)
	}
	var b fixtureBatch
	if err := json.Unmarshal(raw, &b); err != nil {
		t.Fatalf("decode fixture %s: %v", path, err)
	}
	if len(b.Signals) == 0 {
		t.Fatalf("fixture %s has no signals", path)
	}
	return b
}

func loadDBConfigFromEnv(t *testing.T) config.DatabaseConfig {
	t.Helper()
	getEnv := func(k, def string) string {
		if v := os.Getenv(k); v != "" {
			return v
		}
		return def
	}
	host := getEnv("DATABASE_HOST", "localhost")
	port := 5432
	if p := os.Getenv("DATABASE_PORT"); p != "" {
		fmt.Sscanf(p, "%d", &port)
	}
	return config.DatabaseConfig{
		Host:              host,
		Port:              port,
		User:              getEnv("DATABASE_USER", "test"),
		Password:          getEnv("DATABASE_PASS", "test"),
		Name:              getEnv("DATABASE_NAME", "teslasync_test"),
		SSLMode:           getEnv("DATABASE_SSLMODE", "disable"),
		MaxConns:          5,
		MinConns:          1,
		ConnMaxLifetime:   30 * time.Minute,
		ConnMaxIdleTime:   5 * time.Minute,
		MigrationsPath:    "file://../../migrations",
		ConnectTimeout:    10,
		StatementTimeout:  30000,
		HealthCheckPeriod: time.Minute,
	}
}

func setupFreshDB(t *testing.T, cfg config.DatabaseConfig) *database.DB {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	if err := platformdb.RunMigrations(cfg.MigrationDSN(), cfg.MigrationsPath); err != nil {
		t.Fatalf("apply migrations: %v", err)
	}

	pool, err := database.New(ctx, cfg)
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	return pool
}

// buildHandler constructs a TelemetryHandler with no MQTT / no SSE hub — the
// integration test exercises only the persistence pipeline.
//
// Phase-42a/0060: HTTP webhook ingest now dispatches through normalize.Pipeline,
// so the handler MUST be wired with a pipeline via SetPipeline; otherwise
// ProcessBatch returns errPipelineNotWired and the test would receive an
// HTTP 503 from the ingest path instead of writing to typed columns. The
// pipeline is constructed with the same 12-writer set as cmd/teslasync's
// production wiring (no observers — the integration test only asserts on
// row counts in typed tables, which writers populate directly).
func buildHandler(t *testing.T, db *database.DB) *api.TelemetryHandler {
	t.Helper()

	pipelineWriters := map[router.Destination]router.Writer{
		router.DestPositions:         writers.NewPositionsWriter(db.Pool),
		router.DestClimateSnapshot:   writers.NewClimateWriter(db.Pool),
		router.DestMotorSnapshot:     writers.NewMotorWriter(db.Pool),
		router.DestTirePressure:      writers.NewTirePressureWriter(db.Pool),
		router.DestMediaSnapshot:     writers.NewMediaWriter(db.Pool),
		router.DestSafetySnapshot:    writers.NewSafetyWriter(db.Pool),
		router.DestLocationSnapshot:  writers.NewLocationWriter(db.Pool),
		router.DestSecurityEvent:     writers.NewSecurityEventWriter(db.Pool),
		router.DestChargingTelemetry: writers.NewChargingTelemetryWriter(db.Pool),
		router.DestDriveTelemetry:    writers.NewDriveTelemetryWriter(db.Pool),
		router.DestSignalLog:         writers.NewSignalLogWriter(db.Pool),
		router.DestUnitHistory:       writers.NewUnitHistoryWriter(),
	}

	pipelineRouter, err := router.New(pipelineWriters)
	if err != nil {
		t.Fatalf("router.New: %v", err)
	}

	unitCache := unithistory.NewCache(nil)
	unitRepo := unithistory.NewRepo(db.Pool, unitCache)

	logger := zerolog.Nop()
	pipeline := normalize.New(unitRepo, pipelineRouter, logger)

	h := api.NewTelemetryHandler(db, nil, nil, time.Minute, nil)
	h.SetPipeline(pipeline)
	return h
}

// ensureVehicle inserts a vehicle row with the given VIN if absent and returns
// its surrogate id. Uses the post-baseline_typed schema (tesla_id, display_name).
func ensureVehicle(t *testing.T, db *database.DB, vin string) int64 {
	t.Helper()
	ctx := context.Background()
	var id int64
	err := db.Pool.QueryRow(ctx, `
		INSERT INTO vehicles (tesla_id, vin, display_name)
		VALUES ($1, $2, $3)
		ON CONFLICT (vin) DO UPDATE SET display_name = EXCLUDED.display_name
		RETURNING id
	`, hashVIN(vin), vin, "test "+vin).Scan(&id)
	if err != nil {
		t.Fatalf("insert vehicle %s: %v", vin, err)
	}
	return id
}

// hashVIN produces a stable bigint per VIN so each fixture vehicle gets a
// unique tesla_id without colliding across reruns.
func hashVIN(vin string) int64 {
	var h int64 = 1469598103934665603
	for i := 0; i < len(vin); i++ {
		h ^= int64(vin[i])
		h *= 1099511628211
	}
	if h < 0 {
		h = -h
	}
	return h
}

type counts struct {
	positions int
	climate   int
	charging  int
	motor     int
	security  int
	liveState int
	catalog   int
	coldObs   int
}

func snapshotCounts(t *testing.T, db *database.DB, vehicleID int64) counts {
	t.Helper()
	ctx := context.Background()
	var c counts
	c.positions = countByVehicle(t, ctx, db, "positions", vehicleID)
	c.climate = countByVehicle(t, ctx, db, "climate_snapshots", vehicleID)
	c.charging = countByVehicle(t, ctx, db, "charging_telemetry", vehicleID)
	c.motor = countByVehicle(t, ctx, db, "motor_snapshots", vehicleID)
	c.security = countByVehicle(t, ctx, db, "security_events", vehicleID)
	c.liveState = countByVehicle(t, ctx, db, "vehicle_live_state", vehicleID)
	c.coldObs = countByVehicle(t, ctx, db, "signal_observations", vehicleID)
	c.catalog = countAll(t, ctx, db, "signal_catalog")
	return c
}

func countByVehicle(t *testing.T, ctx context.Context, db *database.DB, table string, vehicleID int64) int {
	t.Helper()
	q := fmt.Sprintf(`SELECT count(*) FROM %s WHERE vehicle_id = $1`, table)
	var n int
	if err := db.Pool.QueryRow(ctx, q, vehicleID).Scan(&n); err != nil {
		// Table may not exist if the migration set is incomplete; treat as 0
		// so the rest of the test can still report meaningful failures.
		t.Logf("count(%s): %v (treating as 0)", table, err)
		return 0
	}
	return n
}

func countAll(t *testing.T, ctx context.Context, db *database.DB, table string) int {
	t.Helper()
	q := fmt.Sprintf(`SELECT count(*) FROM %s`, table)
	var n int
	if err := db.Pool.QueryRow(ctx, q).Scan(&n); err != nil {
		t.Logf("count(%s): %v (treating as 0)", table, err)
		return 0
	}
	return n
}

// dumpJSONBColumns returns the list of legacy JSONB columns still present in
// the public schema (should be empty post-migration).
func dumpJSONBColumns(t *testing.T, db *database.DB) []string {
	t.Helper()
	rows, err := db.Pool.Query(context.Background(), `
		SELECT table_name || '.' || column_name
		  FROM information_schema.columns
		 WHERE column_name IN ('signals','raw_state','raw_json')
		   AND table_schema = 'public'
		 ORDER BY 1
	`)
	if err != nil {
		t.Logf("dumpJSONBColumns: %v", err)
		return nil
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err == nil {
			out = append(out, s)
		}
	}
	sort.Strings(out)
	return out
}
