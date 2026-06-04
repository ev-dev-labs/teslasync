//go:build integration
// +build integration

package postgres_test

import (
	"context"
	"testing"
	"time"

	"github.com/testcontainers/testcontainers-go"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/ev-dev-labs/teslasync/internal/adapter/postgres"
	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/domain/signal"
	platformdb "github.com/ev-dev-labs/teslasync/internal/platform/database"
)

// TestRawSignalStore_AppendRaw_Idempotent is the Phase 5 / prompt 03 merge-gate
// integration test for the append-only raw_signal writer. It proves H17
// (append-only — an existing row is NEVER mutated) and H24 (idempotent
// at-least-once writes) against a REAL TimescaleDB container (H25 — no mocked
// DB), using the same timescale/timescaledb-ha:pg17 image CI runs.
//
// Build tag `integration` keeps it out of the default `go test ./...` lane;
// it requires a reachable Docker daemon (Testcontainers spins the container).
func TestRawSignalStore_AppendRaw_Idempotent(t *testing.T) {
	ctx := context.Background()

	pgC, err := tcpostgres.Run(ctx,
		"timescale/timescaledb-ha:pg17",
		tcpostgres.WithDatabase("teslasync_test"),
		tcpostgres.WithUsername("test"),
		tcpostgres.WithPassword("test"),
		testcontainers.WithWaitStrategy(
			wait.ForListeningPort("5432/tcp").WithStartupTimeout(120*time.Second),
			wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2).WithStartupTimeout(120*time.Second),
		),
	)
	if err != nil {
		t.Fatalf("start timescaledb container: %v", err)
	}
	t.Cleanup(func() {
		if err := pgC.Terminate(context.Background()); err != nil {
			t.Logf("terminate container: %v", err)
		}
	})

	host, err := pgC.Host(ctx)
	if err != nil {
		t.Fatalf("container host: %v", err)
	}
	mapped, err := pgC.MappedPort(ctx, "5432/tcp")
	if err != nil {
		t.Fatalf("container port: %v", err)
	}

	cfg := config.DatabaseConfig{
		Host:              host,
		Port:              mapped.Int(),
		User:              "test",
		Password:          "test",
		Name:              "teslasync_test",
		SSLMode:           "disable",
		MaxConns:          5,
		MinConns:          1,
		ConnMaxLifetime:   30 * time.Minute,
		ConnMaxIdleTime:   5 * time.Minute,
		ConnectTimeout:    10,
		StatementTimeout:  30000,
		HealthCheckPeriod: time.Minute,
	}

	// Apply the full repo migration sequence against the real container so the
	// adapter writes through the actual raw_signal table (PK, FK, indexes,
	// created_at DEFAULT now()) — not a hand-rolled fixture.
	if err := platformdb.RunMigrations(cfg.MigrationDSN(), "file://../../../migrations"); err != nil {
		t.Fatalf("apply migrations: %v", err)
	}

	db, err := database.New(ctx, cfg)
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	t.Cleanup(db.Close)

	vehicleID := insertVehicle(t, db, "5YJ3E1EA7KF000001")

	store := postgres.NewRawSignalStore(db.Pool)

	// Fixed UTC, microsecond precision: PostgreSQL stores TIMESTAMPTZ at
	// microsecond resolution and does not preserve Go's monotonic clock, so a
	// fixed instant keeps the (vehicle_id, observed_at, provider_kind)
	// idempotency key byte-stable across re-delivery.
	base := time.Date(2025, 1, 2, 3, 4, 5, 123456000, time.UTC)

	batch := []signal.RawSignalRow{
		{
			VehicleID:    vehicleID,
			ObservedAt:   base,
			ProviderKind: "BatteryLevel",
			ValueType:    signal.ValueTypeDouble,
			RawValue:     "87.5",
			Brand:        "tesla",
			PrivacyClass: signal.PrivacyClassInternal,
		},
		{
			VehicleID:    vehicleID,
			ObservedAt:   base.Add(1 * time.Second),
			ProviderKind: "VehicleSpeed",
			ValueType:    signal.ValueTypeDouble,
			RawValue:     "0",
			Brand:        "tesla",
			PrivacyClass: signal.PrivacyClassInternal,
		},
		{
			VehicleID:    vehicleID,
			ObservedAt:   base.Add(2 * time.Second),
			ProviderKind: "Gear",
			ValueType:    signal.ValueTypeString,
			// Opaque provider-native text — proves H13: no parse-to-number.
			RawValue:     "P",
			Brand:        "tesla",
			PrivacyClass: signal.PrivacyClassInternal,
		},
	}

	// (1) First append persists every distinct row.
	if err := store.AppendRaw(ctx, batch); err != nil {
		t.Fatalf("first AppendRaw: %v", err)
	}
	if got := countRaw(t, db, vehicleID); got != len(batch) {
		t.Fatalf("after first append: row count = %d, want %d", got, len(batch))
	}

	// (2) H24 — re-delivering the identical batch is a no-op.
	if err := store.AppendRaw(ctx, batch); err != nil {
		t.Fatalf("re-deliver AppendRaw: %v", err)
	}
	if got := countRaw(t, db, vehicleID); got != len(batch) {
		t.Fatalf("after re-deliver: row count = %d, want %d (idempotency broken)", got, len(batch))
	}

	// (3) H17 — append-only. Snapshot the physical tuple identity of the first
	// row, then re-append the SAME key with a DIFFERENT raw_value. ON CONFLICT
	// DO NOTHING must leave the on-disk row entirely untouched: an UPDATE (even
	// a no-op one) would mint a new tuple version, changing ctid/xmin.
	ctidBefore, xminBefore, rawBefore, createdBefore := tupleIdentity(t, db, vehicleID, base, "BatteryLevel")

	mutated := []signal.RawSignalRow{
		{
			VehicleID:    vehicleID,
			ObservedAt:   base,
			ProviderKind: "BatteryLevel",
			ValueType:    signal.ValueTypeDouble,
			RawValue:     "12.3", // different value, same key
			Brand:        "tesla",
			PrivacyClass: signal.PrivacyClassRestricted,
		},
	}
	if err := store.AppendRaw(ctx, mutated); err != nil {
		t.Fatalf("conflicting AppendRaw: %v", err)
	}
	if got := countRaw(t, db, vehicleID); got != len(batch) {
		t.Fatalf("after conflicting append: row count = %d, want %d", got, len(batch))
	}

	ctidAfter, xminAfter, rawAfter, createdAfter := tupleIdentity(t, db, vehicleID, base, "BatteryLevel")
	if rawAfter != rawBefore {
		t.Errorf("raw_value mutated: before=%q after=%q (DO NOTHING violated, H17)", rawBefore, rawAfter)
	}
	if rawAfter != "87.5" {
		t.Errorf("raw_value = %q, want original %q", rawAfter, "87.5")
	}
	if !createdAfter.Equal(createdBefore) {
		t.Errorf("created_at mutated: before=%s after=%s", createdBefore, createdAfter)
	}
	if ctidAfter != ctidBefore {
		t.Errorf("ctid changed %s -> %s: a new tuple version was written (UPDATE happened, H17 violated)", ctidBefore, ctidAfter)
	}
	if xminAfter != xminBefore {
		t.Errorf("xmin changed %s -> %s: the row was re-inserted/updated (H17 violated)", xminBefore, xminAfter)
	}

	// (4) Intra-batch duplicate keys collapse onto a single row.
	dupTS := base.Add(10 * time.Second)
	dupBatch := []signal.RawSignalRow{
		{VehicleID: vehicleID, ObservedAt: dupTS, ProviderKind: "Odometer", ValueType: signal.ValueTypeDouble, RawValue: "1000", Brand: "tesla", PrivacyClass: signal.PrivacyClassInternal},
		{VehicleID: vehicleID, ObservedAt: dupTS, ProviderKind: "Odometer", ValueType: signal.ValueTypeDouble, RawValue: "1000", Brand: "tesla", PrivacyClass: signal.PrivacyClassInternal},
	}
	if err := store.AppendRaw(ctx, dupBatch); err != nil {
		t.Fatalf("intra-batch duplicate AppendRaw: %v", err)
	}
	if got := countRawKey(t, db, vehicleID, dupTS, "Odometer"); got != 1 {
		t.Errorf("intra-batch duplicate produced %d rows, want 1", got)
	}

	// (5) H13 — opaque text round-trips verbatim (the string row from batch).
	if got := readRawValue(t, db, vehicleID, base.Add(2*time.Second), "Gear"); got != "P" {
		t.Errorf("opaque raw_value round-trip = %q, want %q", got, "P")
	}

	// (6) Empty slice is a no-op.
	if err := store.AppendRaw(ctx, nil); err != nil {
		t.Errorf("AppendRaw(nil) = %v, want nil", err)
	}
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

func insertVehicle(t *testing.T, db *database.DB, vin string) int64 {
	t.Helper()
	var id int64
	err := db.Pool.QueryRow(context.Background(), `
		INSERT INTO vehicles (tesla_id, vin, display_name)
		VALUES ($1, $2, $3)
		ON CONFLICT (vin) DO UPDATE SET display_name = EXCLUDED.display_name
		RETURNING id
	`, int64(1), vin, "raw-signal-it").Scan(&id)
	if err != nil {
		t.Fatalf("insert vehicle: %v", err)
	}
	return id
}

func countRaw(t *testing.T, db *database.DB, vehicleID int64) int {
	t.Helper()
	var n int
	if err := db.Pool.QueryRow(context.Background(),
		`SELECT count(*) FROM raw_signal WHERE vehicle_id = $1`, vehicleID).Scan(&n); err != nil {
		t.Fatalf("count raw_signal: %v", err)
	}
	return n
}

func countRawKey(t *testing.T, db *database.DB, vehicleID int64, observedAt time.Time, providerKind string) int {
	t.Helper()
	var n int
	if err := db.Pool.QueryRow(context.Background(),
		`SELECT count(*) FROM raw_signal WHERE vehicle_id = $1 AND observed_at = $2 AND provider_kind = $3`,
		vehicleID, observedAt, providerKind).Scan(&n); err != nil {
		t.Fatalf("count raw_signal key: %v", err)
	}
	return n
}

func readRawValue(t *testing.T, db *database.DB, vehicleID int64, observedAt time.Time, providerKind string) string {
	t.Helper()
	var v string
	if err := db.Pool.QueryRow(context.Background(),
		`SELECT raw_value FROM raw_signal WHERE vehicle_id = $1 AND observed_at = $2 AND provider_kind = $3`,
		vehicleID, observedAt, providerKind).Scan(&v); err != nil {
		t.Fatalf("read raw_value: %v", err)
	}
	return v
}

// tupleIdentity returns the physical tuple markers (ctid, xmin) plus the
// observable raw_value and created_at for one raw_signal row. ctid/xmin change
// iff a new tuple version is written — the Postgres-level fingerprint of an
// UPDATE, which an append-only writer must never produce.
func tupleIdentity(t *testing.T, db *database.DB, vehicleID int64, observedAt time.Time, providerKind string) (ctid, xmin, rawValue string, createdAt time.Time) {
	t.Helper()
	err := db.Pool.QueryRow(context.Background(),
		`SELECT ctid::text, xmin::text, raw_value, created_at
		   FROM raw_signal
		  WHERE vehicle_id = $1 AND observed_at = $2 AND provider_kind = $3`,
		vehicleID, observedAt, providerKind).Scan(&ctid, &xmin, &rawValue, &createdAt)
	if err != nil {
		t.Fatalf("tuple identity: %v", err)
	}
	return ctid, xmin, rawValue, createdAt
}
