package database

import (
	"context"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// TestSoftwareUpdateRepo_InsertIfChangedSQL_AtomicUpsert is a string-shape
// test that pins the contract of softwareUpdateInsertIfChangedSQL. The
// production race that surfaced as "50 rows of the same version" was
// rooted in a non-atomic SELECT-then-INSERT; the fix swapped that for an
// atomic INSERT … ON CONFLICT DO NOTHING RETURNING id that depends on
// the UNIQUE INDEX added in migration 000197.
//
// Anchor every clause that participates in the race-safety contract so a
// future refactor that drops one (and re-introduces the dupes) breaks
// loudly here rather than silently in production.
func TestSoftwareUpdateRepo_InsertIfChangedSQL_AtomicUpsert(t *testing.T) {
	t.Parallel()
	mustContain := []string{
		// Operation + table.
		"INSERT INTO software_updates",
		// Atomic conflict resolution — the pivot away from the racy
		// SELECT-then-INSERT pattern. This is THE clause that closes
		// the race; if it disappears the dupes come back.
		"ON CONFLICT (vehicle_id, version) DO NOTHING",
		// RETURNING id distinguishes "newly inserted" from "conflict
		// suppressed" without depending on RowsAffected. The repo's
		// pgx.ErrNoRows branch is the conflict path; without
		// RETURNING that branch can never trigger.
		"RETURNING id",
		// installed_at + created_at are populated server-side via NOW()
		// — the unit test ensures both columns get a value so a future
		// refactor that drops one doesn't leave a NULL trail behind.
		"installed_at",
		"created_at",
	}
	for _, frag := range mustContain {
		if !strings.Contains(softwareUpdateInsertIfChangedSQL, frag) {
			t.Errorf("softwareUpdateInsertIfChangedSQL missing %q\nfull SQL:\n%s", frag, softwareUpdateInsertIfChangedSQL)
		}
	}
	// Reject the un-atomic form. A future refactor that drops the
	// ON CONFLICT clause and goes back to a bare INSERT VALUES would
	// re-introduce the production race; pin against it explicitly.
	bareInsert := "INSERT INTO software_updates (vehicle_id, version, status, installed_at, created_at)\nVALUES ($1, $2, $3, NOW(), NOW())\n"
	if strings.Contains(softwareUpdateInsertIfChangedSQL, bareInsert) && !strings.Contains(softwareUpdateInsertIfChangedSQL, "ON CONFLICT") {
		t.Errorf("softwareUpdateInsertIfChangedSQL is the un-atomic INSERT form (no ON CONFLICT) — race regression. full SQL:\n%s", softwareUpdateInsertIfChangedSQL)
	}
}

// TestSoftwareUpdateRepo_InsertIfChanged_RaceFree is the integration test
// for the production race that surfaced as 50 rows of "2026.14.3" on a
// single vehicle. Spawns N concurrent InsertIfChanged calls for the
// SAME (vehicle_id, version) and asserts:
//
//  1. Exactly ONE row exists in software_updates afterward (no race).
//  2. Exactly ONE call returned inserted=true (the winner).
//  3. The other (N-1) calls returned inserted=false (conflict suppressed).
//  4. No errors propagated from any call.
//
// Pre-fix this test would observe up to N rows for the same version (the
// pre-fix race), 1-N "inserted=true" returns (depending on goroutine
// interleaving), and would still pass the no-error check because the
// pre-fix repo never returned an error on the duplicate insert path —
// the bug was silent at the API boundary.
//
// Skipped when TESLASYNC_TEST_DB is unset (matches existing precedent in
// database_tracing_test.go and alert_rule_state_repo_integration_test.go).
func TestSoftwareUpdateRepo_InsertIfChanged_RaceFree(t *testing.T) {
	dsn := os.Getenv("TESLASYNC_TEST_DB")
	if dsn == "" {
		t.Skip("TESLASYNC_TEST_DB unset")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("pgxpool.New: %v", err)
	}
	// Register pool.Close FIRST via t.Cleanup so it runs LAST (LIFO).
	// Subsequent t.Cleanup calls (DELETE statements) need a live pool.
	// Using `defer pool.Close()` would close the pool BEFORE cleanup
	// runs and silently break the per-test isolation.
	t.Cleanup(pool.Close)

	if err := pool.Ping(ctx); err != nil {
		t.Skipf("TESLASYNC_TEST_DB unreachable: %v", err)
	}

	// Seed an isolated vehicle with a deterministic VIN so the test
	// doesn't collide with production data nor with parallel test runs.
	// vehicles.id is GENERATED ALWAYS AS IDENTITY so we can't INSERT it;
	// tesla_id + vin are NOT NULL UNIQUE so we pick test-namespace
	// values that won't collide with production rows.
	const seedVehicle = `
INSERT INTO vehicles (tesla_id, vin, display_name)
VALUES ($1, $2, $3)
ON CONFLICT (vin) DO UPDATE SET updated_at = NOW()
RETURNING id`
	testVIN := "TESTSWVIN0000RACE1"
	const testTeslaID int64 = -990001
	var vehicleID int64
	if err := pool.QueryRow(ctx, seedVehicle, testTeslaID, testVIN, "race-free-test-vehicle").Scan(&vehicleID); err != nil {
		t.Fatalf("seed vehicle: %v", err)
	}
	// Always start from a clean slate even if a prior test crashed
	// without cleanup. The unique index would otherwise turn the
	// "all 50 calls hit conflict" path on us, masking the race fix.
	if _, err := pool.Exec(ctx, `DELETE FROM software_updates WHERE vehicle_id = $1`, vehicleID); err != nil {
		t.Fatalf("pre-test cleanup: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM software_updates WHERE vehicle_id = $1`, vehicleID)
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM vehicles WHERE id = $1`, vehicleID)
	})

	// Make sure the index exists; if migration 000197 hasn't been
	// applied, skip rather than fail loudly — the integration test
	// asserts behaviour on top of the schema, not the schema itself.
	var hasIdx bool
	if err := pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM pg_indexes
			WHERE indexname = 'uq_software_updates_vehicle_version'
		)`).Scan(&hasIdx); err != nil {
		t.Fatalf("probe unique index: %v", err)
	}
	if !hasIdx {
		t.Skip("uq_software_updates_vehicle_version not present — apply migration 000197 first")
	}

	repo := NewSoftwareUpdateRepo(&DB{Pool: pool})

	const (
		concurrency = 50 // Mirror the prod observation — 50 rows of one version.
		raceVersion = "2026.14.3-race-test"
		raceStatus  = "installed"
	)

	var (
		wg              sync.WaitGroup
		insertedCount   int64
		suppressedCount int64
		errCount        int64
	)
	wg.Add(concurrency)
	for i := 0; i < concurrency; i++ {
		go func() {
			defer wg.Done()
			inserted, err := repo.InsertIfChanged(ctx, vehicleID, raceVersion, raceStatus)
			switch {
			case err != nil:
				atomic.AddInt64(&errCount, 1)
			case inserted:
				atomic.AddInt64(&insertedCount, 1)
			default:
				atomic.AddInt64(&suppressedCount, 1)
			}
		}()
	}
	wg.Wait()

	if errCount != 0 {
		t.Fatalf("InsertIfChanged returned %d errors across %d concurrent calls; want 0", errCount, concurrency)
	}
	if insertedCount != 1 {
		t.Errorf("inserted=true count = %d; want exactly 1 (race regression — pre-fix this could be up to %d)", insertedCount, concurrency)
	}
	if suppressedCount != int64(concurrency-1) {
		t.Errorf("inserted=false count = %d; want %d (conflict path mis-counted)", suppressedCount, concurrency-1)
	}

	var rowCount int64
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM software_updates WHERE vehicle_id = $1 AND version = $2`,
		vehicleID, raceVersion,
	).Scan(&rowCount); err != nil {
		t.Fatalf("count rows: %v", err)
	}
	if rowCount != 1 {
		t.Errorf("software_updates row count = %d; want 1 (this is THE production bug — N concurrent payloads producing N rows)", rowCount)
	}
}

// TestSoftwareUpdateRepo_InsertIfChanged_DistinctVersions asserts that
// distinct firmware versions on the same vehicle each create their own
// row — i.e. the dedupe is keyed on (vehicle_id, version), not just
// vehicle_id. Guards against an over-tight unique key (e.g. accidentally
// adding UNIQUE on vehicle_id alone) regressing the basic version-history
// behaviour.
func TestSoftwareUpdateRepo_InsertIfChanged_DistinctVersions(t *testing.T) {
	dsn := os.Getenv("TESLASYNC_TEST_DB")
	if dsn == "" {
		t.Skip("TESLASYNC_TEST_DB unset")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("pgxpool.New: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(ctx); err != nil {
		t.Skipf("TESLASYNC_TEST_DB unreachable: %v", err)
	}

	testVIN := "TESTSWVIN0000DIST1"
	const testTeslaID int64 = -990002
	var vehicleID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO vehicles (tesla_id, vin, display_name) VALUES ($1, $2, $3)
		 ON CONFLICT (vin) DO UPDATE SET updated_at = NOW() RETURNING id`,
		testTeslaID, testVIN, "distinct-versions-test").Scan(&vehicleID); err != nil {
		t.Fatalf("seed vehicle: %v", err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM software_updates WHERE vehicle_id = $1`, vehicleID); err != nil {
		t.Fatalf("pre-test cleanup: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM software_updates WHERE vehicle_id = $1`, vehicleID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM vehicles WHERE id = $1`, vehicleID)
	})

	repo := NewSoftwareUpdateRepo(&DB{Pool: pool})
	versions := []string{"2026.14.1-dist", "2026.14.2-dist", "2026.14.3-dist"}
	for _, v := range versions {
		inserted, err := repo.InsertIfChanged(ctx, vehicleID, v, "installed")
		if err != nil {
			t.Fatalf("InsertIfChanged(%s): %v", v, err)
		}
		if !inserted {
			t.Errorf("InsertIfChanged(%s) returned inserted=false on first call; want true", v)
		}
	}

	// Re-call each version: must be a no-op.
	for _, v := range versions {
		inserted, err := repo.InsertIfChanged(ctx, vehicleID, v, "installed")
		if err != nil {
			t.Fatalf("InsertIfChanged repeat(%s): %v", v, err)
		}
		if inserted {
			t.Errorf("InsertIfChanged repeat(%s) returned inserted=true; want false (conflict path)", v)
		}
	}

	var rowCount int64
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM software_updates WHERE vehicle_id = $1`, vehicleID,
	).Scan(&rowCount); err != nil {
		t.Fatalf("count rows: %v", err)
	}
	if rowCount != int64(len(versions)) {
		t.Errorf("row count = %d; want %d (one per distinct version)", rowCount, len(versions))
	}
}

// TestSoftwareUpdateRepo_GetLatestVersion_NoRows asserts that the
// no-records path returns ("", nil) rather than ("", pgx.ErrNoRows).
// Pre-fix the method bubbled the error up; that interacted with the
// pre-fix InsertIfChanged in unsafe ways (any error from the SELECT
// bypassed the dedupe guard). The new InsertIfChanged no longer relies
// on this method, but we lock the contract for any future caller.
func TestSoftwareUpdateRepo_GetLatestVersion_NoRows(t *testing.T) {
	dsn := os.Getenv("TESLASYNC_TEST_DB")
	if dsn == "" {
		t.Skip("TESLASYNC_TEST_DB unset")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("pgxpool.New: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(ctx); err != nil {
		t.Skipf("TESLASYNC_TEST_DB unreachable: %v", err)
	}

	repo := NewSoftwareUpdateRepo(&DB{Pool: pool})

	// Use a clearly-invalid vehicle_id that won't exist in the table —
	// negative ids are never assigned by BIGSERIAL and the query joins
	// on vehicle_id only, so no FK lookup happens.
	got, err := repo.GetLatestVersion(ctx, -42)
	if err != nil {
		t.Fatalf("GetLatestVersion(no-rows): unexpected error %v; want nil", err)
	}
	if got != "" {
		t.Errorf("GetLatestVersion(no-rows): got %q; want empty string", got)
	}
}
