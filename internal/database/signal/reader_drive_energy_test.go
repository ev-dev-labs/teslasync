package signal

import (
	"context"
	"fmt"
	"math"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

func TestDriveAggregatesWeightSparsePowerIntervals(t *testing.T) {
	dsn := os.Getenv("TESLASYNC_TEST_DSN")
	if dsn == "" {
		t.Skip("TESLASYNC_TEST_DSN is required for isolated PostgreSQL coverage")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	schema := pgx.Identifier{fmt.Sprintf("bug3_power_%d", time.Now().UnixNano())}.Sanitize()
	if _, err := pool.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if _, err := pool.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE"); err != nil {
			t.Errorf("remove isolated schema: %v", err)
		}
	}()
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema
	isolated, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer isolated.Close()
	_, err = isolated.Exec(ctx, `CREATE TABLE signal_log (
		vehicle_id bigint, ts timestamptz, field text, value_kind smallint DEFAULT 6,
		float_value double precision, int_value bigint, str_value text,
		bool_value boolean, time_value timestamptz, received_at timestamptz
	)`)
	if err != nil {
		t.Fatal(err)
	}
	start := time.Date(2026, 10, 29, 12, 0, 0, 0, time.UTC)
	insert := func(seconds int, field string, value float64) {
		t.Helper()
		if _, err := isolated.Exec(ctx, `INSERT INTO signal_log
			(vehicle_id, ts, field, float_value) VALUES (1,$1,$2,$3)`,
			start.Add(time.Duration(seconds)*time.Second), field, value); err != nil {
			t.Fatal(err)
		}
	}
	insert(0, "PackVoltage", 400)
	insert(0, "PackCurrent", 40)
	insert(30, "PackVoltage", 420)
	for second := 52; second < 60; second++ {
		insert(second, "PackCurrent", -float64(second-42))
	}
	insert(60, "PackCurrent", 0)
	reader := NewSignalLogReader(&database.DB{Pool: isolated})
	_, _, meanKW := reader.DriveAggregates(ctx, 1, start, start.Add(time.Minute))
	regenKWh := reader.RegenEnergy(ctx, 1, start, start.Add(time.Minute))
	// 30s at 16kW + 22s at 16.8kW, then eight 1s regen intervals.
	if math.Abs(meanKW-13.404) > 1e-8 {
		t.Errorf("mean power = %g kW, want +13.404 kW from paired elapsed intervals", meanKW)
	}
	if math.Abs(regenKWh-.0126) > 1e-8 {
		t.Errorf("recovered = %g kWh, want 0.0126, independent of emission frequency", regenKWh)
	}
	if regenKWh > .236 || meanKW <= 0 {
		t.Errorf("normal net-consuming drive has inconsistent recovery/power: %g kWh, %g kW", regenKWh, meanKW)
	}
}
