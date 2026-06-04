package alert

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TestAlertRuleStateRepo_MarkFired_Roundtrip is the regression test for
// the SQLSTATE 42804 type mismatch reported in production after the
// 0.33.0-rc.refactor-alert-engine.gbb71e338 deploy.
//
// Before the fix, alertRuleStateMarkFiredSQL used `CASE WHEN $3 THEN $4
// END` (no cast). pgx sent $4 as the unknown OID and PostgreSQL inferred
// the CASE type as text — the INSERT VALUES branch had no ELSE column to
// anchor type inference. Writing text into the latched_at TIMESTAMPTZ
// column failed at execution time, the engine swallowed the error into
// its in-memory fallback, and the downstream notification_logs.alert_id
// FK violation cascaded because the alerts row was never persisted.
//
// The fix is to add `::timestamptz` inside both CASE expressions. This
// test pins the runtime behavior so any future drift breaks loudly here
// rather than silently in production.
//
// Skipped when TESLASYNC_TEST_DB is unset (matches existing precedent in
// database_tracing_test.go). Local runs use the docker-compose Postgres:
//
//	$env:TESLASYNC_TEST_DB="postgres://teslasync:teslasync@localhost:5432/teslasync_test?sslmode=disable"
//	go test ./internal/database/ -run TestAlertRuleStateRepo_MarkFired_Roundtrip -count=1
func TestAlertRuleStateRepo_MarkFired_Roundtrip(t *testing.T) {
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
	defer pool.Close()

	if err := pool.Ping(ctx); err != nil {
		t.Skipf("TESLASYNC_TEST_DB unreachable: %v", err)
	}

	// Build a minimal isolated schema for this test so we don't touch
	// production data even when pointed at a shared DB. We mirror the
	// columns from migration 000193 verbatim — the goal is to exercise
	// the SQL string against a real Postgres planner, not the FKs.
	const setup = `
DROP TABLE IF EXISTS alert_rule_state_typetest;
CREATE TABLE alert_rule_state_typetest (
    rule_id                BIGINT      NOT NULL,
    vehicle_id             BIGINT      NOT NULL,
    latched_at             TIMESTAMPTZ NULL,
    last_fired_at          TIMESTAMPTZ NULL,
    fire_count_since_reset INTEGER     NOT NULL DEFAULT 0,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (rule_id, vehicle_id)
);`
	if _, err := pool.Exec(ctx, setup); err != nil {
		t.Fatalf("setup schema: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DROP TABLE IF EXISTS alert_rule_state_typetest`)
	})

	// Run the EXACT same SQL shape that production uses, but against
	// the isolated table. Any deviation in alertRuleStateMarkFiredSQL
	// (e.g., dropping the ::timestamptz cast) will reproduce the
	// SQLSTATE 42804 here and fail this test.
	const insertSQL = `
INSERT INTO alert_rule_state_typetest (
	rule_id, vehicle_id, latched_at, last_fired_at, fire_count_since_reset, updated_at
) VALUES (
	$1, $2, CASE WHEN $3 THEN $4::timestamptz END, $4, 1, $4
)
ON CONFLICT (rule_id, vehicle_id) DO UPDATE
   SET latched_at             = CASE WHEN $3 THEN $4::timestamptz ELSE alert_rule_state_typetest.latched_at END,
       last_fired_at          = $4,
       fire_count_since_reset = alert_rule_state_typetest.fire_count_since_reset + 1,
       updated_at             = $4
 WHERE alert_rule_state_typetest.latched_at IS NULL
RETURNING (xmax = 0) AS inserted`

	now := time.Now().UTC().Truncate(time.Microsecond)

	t.Run("once_mode_first_fire_inserts_with_latch", func(t *testing.T) {
		var inserted bool
		err := pool.QueryRow(ctx, insertSQL, int64(12), int64(1), true, now).Scan(&inserted)
		if err != nil {
			t.Fatalf("INSERT once-mode: %v (regression: SQLSTATE 42804 if cast is missing)", err)
		}
		if !inserted {
			t.Fatalf("expected inserted=true for first fire, got false")
		}
		var latchedAt *time.Time
		if err := pool.QueryRow(ctx, `SELECT latched_at FROM alert_rule_state_typetest WHERE rule_id = $1 AND vehicle_id = $2`, int64(12), int64(1)).Scan(&latchedAt); err != nil {
			t.Fatalf("SELECT latched_at: %v", err)
		}
		if latchedAt == nil {
			t.Fatalf("expected latched_at set for once-mode fire, got NULL")
		}
		if !latchedAt.Equal(now) {
			t.Fatalf("latched_at = %v, want %v", *latchedAt, now)
		}
	})

	t.Run("repeat_mode_first_fire_inserts_without_latch", func(t *testing.T) {
		var inserted bool
		err := pool.QueryRow(ctx, insertSQL, int64(13), int64(1), false, now).Scan(&inserted)
		if err != nil {
			t.Fatalf("INSERT repeat-mode: %v (regression: SQLSTATE 42804 if cast is missing)", err)
		}
		if !inserted {
			t.Fatalf("expected inserted=true for first fire, got false")
		}
		var latchedAt *time.Time
		if err := pool.QueryRow(ctx, `SELECT latched_at FROM alert_rule_state_typetest WHERE rule_id = $1 AND vehicle_id = $2`, int64(13), int64(1)).Scan(&latchedAt); err != nil {
			t.Fatalf("SELECT latched_at: %v", err)
		}
		if latchedAt != nil {
			t.Fatalf("expected latched_at NULL for repeat-mode fire, got %v", *latchedAt)
		}
	})

	t.Run("once_mode_second_fire_while_latched_returns_no_row", func(t *testing.T) {
		// rule 12 / vehicle 1 was latched in the first sub-test. A
		// second once-mode fire must hit the WHERE-clause filter and
		// return zero rows (race-lost suppression).
		later := now.Add(1 * time.Minute)
		rows, err := pool.Query(ctx, insertSQL, int64(12), int64(1), true, later)
		if err != nil {
			t.Fatalf("INSERT second once-mode: %v", err)
		}
		defer rows.Close()
		if rows.Next() {
			t.Fatalf("expected zero rows when latched, got at least one")
		}
		if err := rows.Err(); err != nil {
			t.Fatalf("rows.Err: %v", err)
		}
	})

	t.Run("MarkFired_via_repo_API_persists_latch", func(t *testing.T) {
		// Exercise the actual production code path (MarkFired method)
		// against a fresh table so we know the live SQL string — not
		// just the inline copy above — also passes the type checker.
		// We can't reuse the full schema (no alert_rules / vehicles
		// tables in our isolated setup), so we point the repo at a
		// table renamed to match what the production SQL expects.
		const cloneSetup = `
DROP TABLE IF EXISTS alert_rule_state;
CREATE TABLE alert_rule_state (
    rule_id                BIGINT      NOT NULL,
    vehicle_id             BIGINT      NOT NULL,
    latched_at             TIMESTAMPTZ NULL,
    last_fired_at          TIMESTAMPTZ NULL,
    fire_count_since_reset INTEGER     NOT NULL DEFAULT 0,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (rule_id, vehicle_id)
);`
		// Skip this sub-test if a real alert_rule_state table already
		// exists with FKs to alert_rules/vehicles — we don't want to
		// drop production schema.
		var hasFK bool
		_ = pool.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM information_schema.table_constraints
				WHERE table_name = 'alert_rule_state' AND constraint_type = 'FOREIGN KEY'
			)`).Scan(&hasFK)
		if hasFK {
			t.Skip("alert_rule_state has FKs (real migration applied) — skipping clone-based MarkFired test to avoid dropping production schema")
		}
		if _, err := pool.Exec(ctx, cloneSetup); err != nil {
			t.Fatalf("clone setup: %v", err)
		}
		t.Cleanup(func() {
			_, _ = pool.Exec(context.Background(), `DROP TABLE IF EXISTS alert_rule_state`)
		})

		repo := NewAlertRuleStateRepo(&database.DB{Pool: pool})
		ok, err := repo.MarkFired(ctx, 99, 7, now, true)
		if err != nil {
			t.Fatalf("MarkFired (live SQL): %v (regression: SQLSTATE 42804 if cast is missing from alertRuleStateMarkFiredSQL)", err)
		}
		if !ok {
			t.Fatalf("MarkFired returned ok=false on first fire, want true")
		}
		var latchedAt *time.Time
		if err := pool.QueryRow(ctx, `SELECT latched_at FROM alert_rule_state WHERE rule_id = 99 AND vehicle_id = 7`).Scan(&latchedAt); err != nil {
			t.Fatalf("SELECT latched_at: %v", err)
		}
		if latchedAt == nil {
			t.Fatalf("expected latched_at set after MarkFired(isOnce=true), got NULL")
		}
	})
}
