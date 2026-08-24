package user

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TestOnboardingStateRepo_GetMarkComplete_Roundtrip exercises the real
// OnboardingStateRepo.Get/MarkComplete methods (production SQL, table
// name `onboarding_state`) against a live Postgres. It is the targeted
// regression test for setup-state PERSISTENCE: the durable ratchet must
// (a) start not-completed, (b) flip to completed exactly once, and
// (c) never move back to not-completed, preserving the original
// completed_at across repeated MarkComplete calls.
//
// Skipped when TESLASYNC_TEST_DB is unset (matches existing precedent —
// see internal/database/alert/rule_state_repo_integration_test.go).
// Local runs use the docker-compose Postgres:
//
//	$env:TESLASYNC_TEST_DB="******localhost:15432/teslasync?sslmode=disable"
//	go test ./internal/database/user/ -run TestOnboardingStateRepo -count=1 -v
func TestOnboardingStateRepo_GetMarkComplete_Roundtrip(t *testing.T) {
	pool := openOnboardingTestPool(t)
	defer pool.Close()

	ctx := context.Background()
	const setup = `
CREATE TABLE IF NOT EXISTS onboarding_state (
  id                  integer     PRIMARY KEY CHECK (id = 1),
  setup_completed     boolean     NOT NULL DEFAULT false,
  setup_completed_at  timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT NOW()
);
TRUNCATE onboarding_state;`
	if _, err := pool.Exec(ctx, setup); err != nil {
		t.Fatalf("setup schema: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `TRUNCATE onboarding_state`)
	})

	repo := &OnboardingStateRepo{db: &database.DB{Pool: pool}}

	state, err := repo.Get(ctx)
	if err != nil {
		t.Fatalf("Get (no row yet): %v", err)
	}
	if state.Completed {
		t.Fatalf("Completed = true before any row exists, want false")
	}

	first, err := repo.MarkComplete(ctx)
	if err != nil {
		t.Fatalf("MarkComplete (first call): %v", err)
	}
	if !first.Completed {
		t.Fatalf("Completed = false after MarkComplete, want true")
	}
	if first.CompletedAt == nil {
		t.Fatalf("CompletedAt = nil after MarkComplete, want non-nil")
	}
	firstCompletedAt := *first.CompletedAt

	// The ratchet: a second MarkComplete call must be a no-op that
	// preserves the original CompletedAt timestamp, never resetting it.
	time.Sleep(10 * time.Millisecond)
	second, err := repo.MarkComplete(ctx)
	if err != nil {
		t.Fatalf("MarkComplete (second call): %v", err)
	}
	if !second.Completed {
		t.Fatalf("Completed = false after second MarkComplete, want true")
	}
	if second.CompletedAt == nil || !second.CompletedAt.Equal(firstCompletedAt) {
		t.Fatalf("CompletedAt drifted across MarkComplete calls: first=%v second=%v", firstCompletedAt, second.CompletedAt)
	}

	// Get() must report the same persisted state.
	reread, err := repo.Get(ctx)
	if err != nil {
		t.Fatalf("Get (after MarkComplete): %v", err)
	}
	if !reread.Completed {
		t.Fatalf("Get().Completed = false after MarkComplete, want true")
	}
}

func TestOnboardingStateRepo_NilDependencyReturnsError(t *testing.T) {
	var repo *OnboardingStateRepo
	if _, err := repo.Get(context.Background()); err == nil {
		t.Fatal("Get() error = nil, want explicit configuration error")
	}
	if _, err := repo.MarkComplete(context.Background()); err == nil {
		t.Fatal("MarkComplete() error = nil, want explicit configuration error")
	}
}

// TestOnboardingStateMigration_Backfill_Semantics pins the exact
// backfill predicate from migrations/000230_onboarding_setup_state.up.sql
// against a real Postgres planner, using an isolated clone of the three
// tables involved (onboarding_state, vehicles, tokens) so the test never
// touches production data even when pointed at a shared DB. Each
// subtest reproduces one pre-existing-installation scenario described
// in the migration's comments.
func TestOnboardingStateMigration_Backfill_Semantics(t *testing.T) {
	pool := openOnboardingTestPool(t)
	defer pool.Close()

	ctx := context.Background()
	const schema = `
DROP TABLE IF EXISTS onboarding_state_backfilltest;
DROP TABLE IF EXISTS vehicles_backfilltest;
DROP TABLE IF EXISTS tokens_backfilltest;

CREATE TABLE onboarding_state_backfilltest (
  id                  integer     PRIMARY KEY CHECK (id = 1),
  setup_completed     boolean     NOT NULL DEFAULT false,
  setup_completed_at  timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT NOW()
);
CREATE TABLE vehicles_backfilltest (id bigserial PRIMARY KEY);
CREATE TABLE tokens_backfilltest (id integer PRIMARY KEY, access_token text);`
	if _, err := pool.Exec(ctx, schema); err != nil {
		t.Fatalf("setup schema: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `
DROP TABLE IF EXISTS onboarding_state_backfilltest;
DROP TABLE IF EXISTS vehicles_backfilltest;
DROP TABLE IF EXISTS tokens_backfilltest;`)
	})

	// Mirrors the up.sql backfill INSERT verbatim, with table names
	// swapped for the isolated clones above.
	const backfillSQL = `
INSERT INTO onboarding_state_backfilltest (id, setup_completed, setup_completed_at)
SELECT 1, true, NOW()
WHERE EXISTS (SELECT 1 FROM vehicles_backfilltest)
  AND EXISTS (
    SELECT 1 FROM tokens_backfilltest
     WHERE id = 1 AND access_token IS NOT NULL AND access_token <> ''
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO onboarding_state_backfilltest (id, setup_completed)
VALUES (1, false)
ON CONFLICT (id) DO NOTHING;`

	reset := func(t *testing.T) {
		t.Helper()
		if _, err := pool.Exec(ctx, `TRUNCATE onboarding_state_backfilltest, vehicles_backfilltest, tokens_backfilltest`); err != nil {
			t.Fatalf("truncate: %v", err)
		}
	}
	backfilledCompleted := func(t *testing.T) bool {
		t.Helper()
		if _, err := pool.Exec(ctx, backfillSQL); err != nil {
			t.Fatalf("backfill: %v", err)
		}
		var completed bool
		if err := pool.QueryRow(ctx, `SELECT setup_completed FROM onboarding_state_backfilltest WHERE id = 1`).Scan(&completed); err != nil {
			t.Fatalf("select: %v", err)
		}
		return completed
	}

	t.Run("vehicle_and_token_backfills_completed_true", func(t *testing.T) {
		reset(t)
		if _, err := pool.Exec(ctx, `INSERT INTO vehicles_backfilltest DEFAULT VALUES`); err != nil {
			t.Fatalf("insert vehicle: %v", err)
		}
		if _, err := pool.Exec(ctx, `INSERT INTO tokens_backfilltest (id, access_token) VALUES (1, 'ciphertext')`); err != nil {
			t.Fatalf("insert token: %v", err)
		}
		if got := backfilledCompleted(t); !got {
			t.Errorf("setup_completed = %v, want true for an already-configured install (vehicle + token both exist)", got)
		}
	})

	t.Run("vehicle_without_token_backfills_completed_false", func(t *testing.T) {
		reset(t)
		if _, err := pool.Exec(ctx, `INSERT INTO vehicles_backfilltest DEFAULT VALUES`); err != nil {
			t.Fatalf("insert vehicle: %v", err)
		}
		if got := backfilledCompleted(t); got {
			t.Errorf("setup_completed = %v, want false when no Tesla token is stored", got)
		}
	})

	t.Run("token_without_vehicle_backfills_completed_false", func(t *testing.T) {
		reset(t)
		if _, err := pool.Exec(ctx, `INSERT INTO tokens_backfilltest (id, access_token) VALUES (1, 'ciphertext')`); err != nil {
			t.Fatalf("insert token: %v", err)
		}
		if got := backfilledCompleted(t); got {
			t.Errorf("setup_completed = %v, want false when no vehicle is registered yet", got)
		}
	})

	t.Run("empty_access_token_does_not_count_as_connected", func(t *testing.T) {
		reset(t)
		if _, err := pool.Exec(ctx, `INSERT INTO vehicles_backfilltest DEFAULT VALUES`); err != nil {
			t.Fatalf("insert vehicle: %v", err)
		}
		if _, err := pool.Exec(ctx, `INSERT INTO tokens_backfilltest (id, access_token) VALUES (1, '')`); err != nil {
			t.Fatalf("insert token: %v", err)
		}
		if got := backfilledCompleted(t); got {
			t.Errorf("setup_completed = %v, want false for a blank access_token (partial-write guard)", got)
		}
	})

	t.Run("fresh_install_backfills_completed_false", func(t *testing.T) {
		reset(t)
		if got := backfilledCompleted(t); got {
			t.Errorf("setup_completed = %v, want false for a genuinely fresh install (no vehicles, no tokens)", got)
		}
	})

	t.Run("idempotent_on_conflict_do_nothing", func(t *testing.T) {
		reset(t)
		if _, err := pool.Exec(ctx, `INSERT INTO vehicles_backfilltest DEFAULT VALUES`); err != nil {
			t.Fatalf("insert vehicle: %v", err)
		}
		if _, err := pool.Exec(ctx, `INSERT INTO tokens_backfilltest (id, access_token) VALUES (1, 'ciphertext')`); err != nil {
			t.Fatalf("insert token: %v", err)
		}
		if got := backfilledCompleted(t); !got {
			t.Fatalf("first backfill run: setup_completed = %v, want true", got)
		}
		// Re-running the backfill (e.g. a migration retry) must not error
		// and must not change the already-persisted row.
		if got := backfilledCompleted(t); !got {
			t.Errorf("second backfill run: setup_completed = %v, want true (idempotent ON CONFLICT DO NOTHING)", got)
		}
	})
}

// openOnboardingTestPool connects to TESLASYNC_TEST_DB, skipping the
// test entirely when it's unset or unreachable — matching the
// established convention across the codebase (see
// internal/database/alert/rule_state_repo_integration_test.go).
func openOnboardingTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
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
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Skipf("TESLASYNC_TEST_DB unreachable: %v", err)
	}
	return pool
}
