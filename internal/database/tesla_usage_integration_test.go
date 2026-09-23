package database

import (
	"context"
	"math"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Runs only against a disposable, separately created database whose
// migrations were applied by the caller; never connects to the app database.
func TestTeslaUsageSQLIsolatedTimescale(t *testing.T) {
	dsn := os.Getenv("TESLASYNC_USAGE_TEST_DSN")
	if dsn == "" {
		t.Skip("TESLASYNC_USAGE_TEST_DSN not set (requires isolated migrated Timescale DB)")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect isolated Timescale DB: %v", err)
	}
	defer pool.Close()
	var databaseName string
	if err := pool.QueryRow(ctx, `SELECT current_database()`).Scan(&databaseName); err != nil {
		t.Fatal(err)
	}
	if len(databaseName) < len("teslasync_usage_verify_") || databaseName[:len("teslasync_usage_verify_")] != "teslasync_usage_verify_" {
		t.Fatalf("refuse fixture writes to non-isolated database %q", databaseName)
	}
	if _, err := pool.Exec(ctx, `TRUNCATE api_call_logs, tesla_stream_usage`); err != nil {
		t.Fatalf("clear isolated fixtures: %v", err)
	}
	db := &DB{Pool: pool}
	repo := NewTeslaUsageRepo(db)
	boundary := TeslaCycleStart(time.Now().UTC())
	old := boundary.Add(-3 * teslaCycle)
	// The fixture is intentionally well outside the current window.
	insert := func(ts time.Time, service, method, endpoint string, status int) {
		t.Helper()
		if _, err := pool.Exec(ctx, `INSERT INTO api_call_logs (ts, service, http_method, endpoint, status_code)
			VALUES ($1,$2,$3,$4,$5)`, ts, service, method, endpoint, status); err != nil {
			t.Fatalf("seed isolated audit: %v", err)
		}
	}
	insert(boundary.Add(-time.Nanosecond), "tesla-api", "GET", "/api/1/vehicles/7/vehicle_data", 200)
	insert(boundary, "tesla-api", "POST", "/api/1/vehicles/7/command/door_lock", 400)
	// A second outbound HTTP attempt is billable separately, unlike a
	// redelivered MQTT signal with the same fingerprint.
	insert(boundary.Add(500*time.Millisecond), "tesla-api", "POST", "/api/1/vehicles/7/command/door_lock", 400)
	insert(boundary.Add(time.Hour), "tesla-api", "POST", "/api/1/vehicles/7/wake_up", 429)
	insert(boundary.Add(2*time.Hour), "tesla-api", "POST", "/api/1/vehicles/7/wake_up", 503)
	insert(boundary.Add(3*time.Hour), "tesla-api", "POST", "/api/1/vehicles/7/wake_up", 0)
	insert(boundary.Add(4*time.Hour), "teslasync-http", "POST", "/api/1/vehicles/7/command/door_lock", 200)
	insert(boundary.Add(5*time.Hour), "tesla-command-proxy", "POST", "/api/1/vehicles/7/command/door_lock", 403)
	insert(boundary.Add(6*time.Hour), "tesla-command-proxy", "POST", "/api/1/vehicles/7/command/door_lock", 200)
	insert(boundary.Add(7*time.Hour), "tesla-api", "POST", "https://legacy-proxy.example.test/api/1/vehicles/7/command/door_lock", 403)
	insert(old.Add(4*time.Hour), "tesla-api", "GET", "/api/1/vehicles/7/vehicle_data", 200)
	insert(old.Add(4*time.Hour), "tesla-api", "GET", "/api/1/vehicles", 200)
	if err := repo.RecordSignal(ctx, "telemetry/vin/v/Soc", boundary, []byte(`{"ts":"sample","value":81}`)); err != nil {
		t.Fatal(err)
	}
	// A QoS1 retransmission has the same source evidence, not a second billable signal.
	if err := repo.RecordSignal(ctx, "telemetry/vin/v/Soc", boundary, []byte(`{"ts":"sample","value":81}`)); err != nil {
		t.Fatal(err)
	}
	if err := repo.RecordSignal(ctx, "telemetry/vin/v/Speed", old, []byte(`{"ts":"old","value":0}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE tesla_stream_usage SET received_at = $1 WHERE emitted_at = $1`, boundary); err != nil {
		t.Fatalf("set isolated current-cycle receive timestamp: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE tesla_stream_usage SET received_at = $1 WHERE emitted_at = $2`, old, old); err != nil {
		t.Fatalf("backdate isolated observed-signal fixture: %v", err)
	}
	cycles, err := repo.Cycles(ctx, boundary.Add(8*time.Hour), 8, 0)
	if err != nil {
		t.Fatal(err)
	}
	if cycles.Current.Signals != 1 || cycles.Current.Commands != 3 || cycles.Current.Wakes != 1 ||
		cycles.Current.DataRequests != 0 || math.Abs(cycles.Current.EstimatedUSD-(1.0/150000+3.0/1000+1.0/50)) > 1e-10 {
		t.Errorf("current SQL usage incorrectly counted retry, unrelated call or prior boundary: %+v", cycles.Current)
	}
	if len(cycles.History) != 3 || cycles.History[0].DataRequests != 1 ||
		cycles.History[2].Signals != 1 || cycles.History[2].DataRequests != 1 {
		t.Errorf("historic SQL usage lost prior boundary, sparse middle window or old events: %+v", cycles.History)
	}
	series, err := repo.Series(ctx, old, boundary.Add(24*time.Hour), "week", 366, 0)
	if err != nil {
		t.Fatal(err)
	}
	if series.Total.Signals != 2 || series.Total.DataRequests != 2 ||
		series.Total.Commands != 3 || series.Total.Wakes != 1 || len(series.Points) < 2 {
		t.Errorf("filtered weekly SQL history totals or observed buckets wrong: %+v", series)
	}
	daily, err := repo.Series(ctx, boundary, boundary.Add(24*time.Hour), "day", 366, 0)
	if err != nil {
		t.Fatal(err)
	}
	if daily.Total.Signals != 1 || daily.Total.DataRequests != 0 || daily.Total.Wakes != 1 {
		t.Errorf("half-open daily SQL boundary wrong: %+v", daily.Total)
	}
}
