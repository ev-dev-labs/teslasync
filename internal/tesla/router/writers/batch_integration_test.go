package writers

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	ftproto "github.com/teslamotors/fleet-telemetry/protos"

	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
	"github.com/ev-dev-labs/teslasync/internal/tesla/router"
)

func TestBatchWriters_PostgresRoundTrip(t *testing.T) {
	dsn := os.Getenv("TESLASYNC_TEST_DB")
	if dsn == "" {
		t.Skip("TESLASYNC_TEST_DB unset")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("open test pool: %v", err)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		t.Skipf("TESLASYNC_TEST_DB unreachable: %v", err)
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin test transaction: %v", err)
	}
	defer func() { _ = tx.Rollback(context.Background()) }()

	const schema = `
CREATE TEMP TABLE vehicles (
	id  BIGINT PRIMARY KEY,
	vin TEXT NOT NULL UNIQUE
) ON COMMIT DROP;
CREATE TEMP TABLE test_snapshots (
	vehicle_id BIGINT NOT NULL,
	ts TIMESTAMPTZ NOT NULL,
	inside_temp_c DOUBLE PRECISION,
	outside_temp_c DOUBLE PRECISION,
	PRIMARY KEY (vehicle_id, ts)
) ON COMMIT DROP;
CREATE TEMP TABLE drive_telemetry (
	vehicle_id BIGINT NOT NULL,
	ts TIMESTAMPTZ NOT NULL,
	gear TEXT,
	speed_mps DOUBLE PRECISION,
	PRIMARY KEY (vehicle_id, ts)
) ON COMMIT DROP;
CREATE TEMP TABLE tire_pressure_snapshots (
	vehicle_id BIGINT NOT NULL,
	ts TIMESTAMPTZ NOT NULL,
	front_left_last_seen_at TIMESTAMPTZ,
	front_left_pa DOUBLE PRECISION,
	PRIMARY KEY (vehicle_id, ts)
) ON COMMIT DROP;
CREATE TEMP TABLE signal_log (
	vehicle_id BIGINT NOT NULL,
	ts TIMESTAMPTZ NOT NULL,
	field TEXT NOT NULL,
	value_kind SMALLINT NOT NULL,
	str_value TEXT,
	bool_value BOOLEAN,
	int_value BIGINT,
	float_value DOUBLE PRECISION,
	time_value TIMESTAMPTZ,
	normalization_version SMALLINT,
	normalization_write_token BOOLEAN,
	ingest_origin TEXT,
	source_emitted_at TIMESTAMPTZ,
	received_at TIMESTAMPTZ,
	provenance_write_token BOOLEAN,
	PRIMARY KEY (vehicle_id, ts, field)
) ON COMMIT DROP;
INSERT INTO vehicles (id, vin) VALUES (42, 'VIN');`
	if _, err := tx.Exec(ctx, schema); err != nil {
		t.Fatalf("create temporary schema: %v", err)
	}

	ts := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	t.Run("snapshot multi-column upsert", func(t *testing.T) {
		columns := map[string]string{
			"InsideTemp":  "inside_temp_c",
			"OutsideTemp": "outside_temp_c",
		}
		writer, err := newSnapshotWriter(tx, "test_snapshots", func(field string) (string, bool) {
			column, ok := columns[field]
			return column, ok
		})
		if err != nil {
			t.Fatalf("newSnapshotWriter: %v", err)
		}
		results := writer.WriteBatch(ctx, []router.RoutedAtomic{
			{Atomic: codec.Atomic{Field: "InsideTemp", Value: float32(21.5), EmittedAt: ts, VehicleID: "VIN"}},
			{Atomic: codec.Atomic{Field: "OutsideTemp", Value: float64(12.25), EmittedAt: ts, VehicleID: "VIN"}},
		})
		assertBatchResultsOK(t, results)

		var inside, outside float64
		if err := tx.QueryRow(
			ctx,
			`SELECT inside_temp_c, outside_temp_c FROM test_snapshots WHERE vehicle_id = 42 AND ts = $1`,
			ts,
		).Scan(&inside, &outside); err != nil {
			t.Fatalf("read snapshot row: %v", err)
		}
		if inside != 21.5 || outside != 12.25 {
			t.Fatalf("snapshot values = (%v, %v), want (21.5, 12.25)", inside, outside)
		}
	})

	t.Run("drive enum and numeric upsert", func(t *testing.T) {
		snapshot, err := newSnapshotWriter(tx, "drive_telemetry", driveTelemetryColumnFor)
		if err != nil {
			t.Fatalf("newSnapshotWriter: %v", err)
		}
		writer := &driveTelemetryWriter{snap: snapshot}
		results := writer.WriteBatch(ctx, []router.RoutedAtomic{
			{Atomic: codec.Atomic{Field: "Gear", Value: ftproto.ShiftState_ShiftStateD, EmittedAt: ts, VehicleID: "VIN"}},
			{Atomic: codec.Atomic{Field: "VehicleSpeed", Value: float64(28.5), EmittedAt: ts, VehicleID: "VIN"}},
		})
		assertBatchResultsOK(t, results)

		var gear string
		var speed float64
		if err := tx.QueryRow(
			ctx,
			`SELECT gear, speed_mps FROM drive_telemetry WHERE vehicle_id = 42 AND ts = $1`,
			ts,
		).Scan(&gear, &speed); err != nil {
			t.Fatalf("read drive row: %v", err)
		}
		if gear != "ShiftStateD" || speed != 28.5 {
			t.Fatalf("drive values = (%q, %v), want (ShiftStateD, 28.5)", gear, speed)
		}
	})

	t.Run("tire epoch and pressure upsert", func(t *testing.T) {
		snapshot, err := newSnapshotWriter(tx, "tire_pressure_snapshots", tirePressureColumnFor)
		if err != nil {
			t.Fatalf("newSnapshotWriter: %v", err)
		}
		writer := &tirePressureWriter{
			snap:      snapshot,
			db:        tx,
			table:     "tire_pressure_snapshots",
			columnFor: tirePressureColumnFor,
		}
		results := writer.WriteBatch(ctx, []router.RoutedAtomic{
			{Atomic: codec.Atomic{Field: "TpmsLastSeenPressureTimeFl", Value: float64(1746541200.25), EmittedAt: ts, VehicleID: "VIN"}},
			{Atomic: codec.Atomic{Field: "TpmsPressureFl", Value: float64(222000), EmittedAt: ts, VehicleID: "VIN"}},
		})
		assertBatchResultsOK(t, results)

		var lastSeen time.Time
		var pressure float64
		if err := tx.QueryRow(
			ctx,
			`SELECT front_left_last_seen_at, front_left_pa FROM tire_pressure_snapshots WHERE vehicle_id = 42 AND ts = $1`,
			ts,
		).Scan(&lastSeen, &pressure); err != nil {
			t.Fatalf("read tire-pressure row: %v", err)
		}
		wantLastSeen := time.Unix(1746541200, 250_000_000).UTC()
		if !lastSeen.Equal(wantLastSeen) || pressure != 222000 {
			t.Fatalf("tire values = (%v, %v), want (%v, 222000)", lastSeen, pressure, wantLastSeen)
		}
	})

	t.Run("signal log multi-row insert and redelivery collapse", func(t *testing.T) {
		writer := &signalLogWriter{db: tx}
		results := writer.WriteBatch(ctx, []router.RoutedAtomic{
			{Atomic: codec.Atomic{Field: "Soc", Value: float32(75), EmittedAt: ts, VehicleID: "VIN"}},
			{Atomic: codec.Atomic{Field: "Soc", Value: float32(76), EmittedAt: ts, VehicleID: "VIN"}},
			{Atomic: codec.Atomic{Field: "Locked", Value: true, EmittedAt: ts, VehicleID: "VIN"}},
		})
		assertBatchResultsOK(t, results)

		var count int
		var soc float64
		if err := tx.QueryRow(
			ctx,
			`SELECT count(*), max(float_value) FILTER (WHERE field = 'Soc') FROM signal_log`,
		).Scan(&count, &soc); err != nil {
			t.Fatalf("read signal-log rows: %v", err)
		}
		if count != 2 || soc != 76 {
			t.Fatalf("signal_log = (count %d, Soc %v), want (2, 76)", count, soc)
		}
	})
}

func assertBatchResultsOK(t *testing.T, results []error) {
	t.Helper()
	for i, err := range results {
		if err != nil {
			t.Fatalf("batch result %d: %v", i, err)
		}
	}
}
