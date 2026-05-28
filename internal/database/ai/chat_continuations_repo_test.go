// Phase-50 / 0005 — F4 ai_chat_continuations repo tests.
//
// Pure-Go validators run unconditionally (no DSN). Live SQL coverage
// runs only when DATABASE_URL or TESLASYNC_TEST_DSN points at a
// reachable PostgreSQL instance, mirroring the rest of
// internal/database (ai_call_log_repo_test.go, scheduled_export_repo_test.go).
package ai

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TestContinuationsRepo_Save_RejectsEmptyID covers a defence-in-depth
// invariant: callers cannot insert a row with an empty handle. Pure
// Go — no DB needed.
func TestContinuationsRepo_Save_RejectsEmptyID(t *testing.T) {
	t.Parallel()
	repo := &AIChatContinuationsRepo{db: nil, nowFn: time.Now}
	_, err := repo.Save(context.Background(), "", "alice", "feature-x", json.RawMessage(`{}`))
	if err == nil {
		t.Fatal("expected empty-id error")
	}
}

// TestContinuationsRepo_Save_RejectsEmptyFeatureID is the symmetric
// check for feature_id (NOT NULL in the schema; failing fast keeps
// the DB constraint as a defence-in-depth layer rather than the
// only enforcement).
func TestContinuationsRepo_Save_RejectsEmptyFeatureID(t *testing.T) {
	t.Parallel()
	repo := &AIChatContinuationsRepo{db: nil, nowFn: time.Now}
	_, err := repo.Save(context.Background(), "id", "alice", "", json.RawMessage(`{}`))
	if err == nil {
		t.Fatal("expected empty-feature-id error")
	}
}

// TestContinuationsRepo_Save_RejectsEmptyState ensures we don't
// persist a row with no payload — the dispatcher MUST always have
// something to resume.
func TestContinuationsRepo_Save_RejectsEmptyState(t *testing.T) {
	t.Parallel()
	repo := &AIChatContinuationsRepo{db: nil, nowFn: time.Now}
	_, err := repo.Save(context.Background(), "id", "alice", "feature-x", nil)
	if err == nil {
		t.Fatal("expected empty-state error")
	}
}

// TestContinuationsRepo_Load_EmptyIDIsNotFound covers the constant-
// time defence: an attacker probing /continue/{id} with the empty
// string gets the same answer as an attacker probing for an
// unknown UUID.
func TestContinuationsRepo_Load_EmptyIDIsNotFound(t *testing.T) {
	t.Parallel()
	repo := &AIChatContinuationsRepo{db: nil, nowFn: time.Now}
	_, err := repo.Load(context.Background(), "", "alice")
	if !errors.Is(err, ErrContinuationNotFound) {
		t.Errorf("Load(empty) = %v, want ErrContinuationNotFound", err)
	}
}

// TestContinuationsRepo_DefaultTTL is the contract pin: the migration
// CHECK constraint and the repo's expiry math must agree on 24h.
// If anyone changes one without the other, this test breaks.
func TestContinuationsRepo_DefaultTTL(t *testing.T) {
	t.Parallel()
	if got, want := DefaultContinuationTTL, 24*time.Hour; got != want {
		t.Errorf("DefaultContinuationTTL = %v, want %v", got, want)
	}
}

// TestContinuationsRepo_RoundTrip is the live-DB coverage: insert,
// load (current), load (after expiry), delete, cleanup.
func TestContinuationsRepo_RoundTrip(t *testing.T) {
	dsn := dsnOrSkip(t)
	ctx := context.Background()

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Skipf("cannot open pool: %v", err)
	}
	t.Cleanup(pool.Close)

	var has bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM information_schema.tables
		                WHERE table_schema='public' AND table_name='ai_chat_continuations')`,
	).Scan(&has); err != nil {
		t.Skipf("ai_chat_continuations table check: %v", err)
	}
	if !has {
		t.Skip("ai_chat_continuations table missing; run migrations against this DSN")
	}

	db := &database.DB{Pool: pool}
	repo := NewAIChatContinuationsRepo(db)

	subject := "continuations-roundtrip-test@example.com"
	id := "test-continuation-roundtrip-" + time.Now().UTC().Format("20060102150405.000")
	state := json.RawMessage(`{"feature_id":"feature-x","messages":[],"pending_call":null,"created_at":"2025-01-01T00:00:00Z"}`)

	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM ai_chat_continuations WHERE user_subject = $1`, subject)
	})

	row, err := repo.Save(ctx, id, subject, "feature-x", state)
	if err != nil {
		t.Fatalf("Save: %v", err)
	}
	if row.ID != id {
		t.Errorf("Save: id = %q, want %q", row.ID, id)
	}
	if want := 24 * time.Hour; row.ExpiresAt.Sub(row.CreatedAt) < want-time.Minute || row.ExpiresAt.Sub(row.CreatedAt) > want+time.Minute {
		t.Errorf("expiry window = %v, want ≈24h", row.ExpiresAt.Sub(row.CreatedAt))
	}

	loaded, err := repo.Load(ctx, id, subject)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if loaded.FeatureID != "feature-x" {
		t.Errorf("Load: feature_id = %q", loaded.FeatureID)
	}

	// Wrong-subject load returns NotFound (constant-time defence).
	if _, err := repo.Load(ctx, id, "someone-else@example.com"); !errors.Is(err, ErrContinuationNotFound) {
		t.Errorf("wrong-subject Load = %v, want ErrContinuationNotFound", err)
	}

	if err := repo.Delete(ctx, id, subject); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, err := repo.Load(ctx, id, subject); !errors.Is(err, ErrContinuationNotFound) {
		t.Errorf("post-delete Load = %v, want ErrContinuationNotFound", err)
	}

	// CleanupExpired with no expired rows returns 0 (and no error).
	n, err := repo.CleanupExpired(ctx)
	if err != nil {
		t.Fatalf("CleanupExpired: %v", err)
	}
	if n < 0 {
		t.Errorf("CleanupExpired = %d, want ≥ 0", n)
	}
}

// TestContinuationsRepo_RoundTrip_ExpiredRowNotResumable inserts a
// row and then advances the repo's clock past the TTL; Load must
// return NotFound rather than the stale row, and CleanupExpired
// must remove it.
func TestContinuationsRepo_RoundTrip_ExpiredRowNotResumable(t *testing.T) {
	dsn := dsnOrSkip(t)
	ctx := context.Background()

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Skipf("cannot open pool: %v", err)
	}
	t.Cleanup(pool.Close)

	var has bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM information_schema.tables
		                WHERE table_schema='public' AND table_name='ai_chat_continuations')`,
	).Scan(&has); err != nil {
		t.Skipf("ai_chat_continuations table check: %v", err)
	}
	if !has {
		t.Skip("ai_chat_continuations table missing")
	}

	db := &database.DB{Pool: pool}

	subject := "continuations-expiry-test@example.com"
	id := "test-continuation-expiry-" + time.Now().UTC().Format("20060102150405.000")

	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM ai_chat_continuations WHERE user_subject = $1`, subject)
	})

	// Step 1: save with a clock pinned in the past so the row's
	// expiry is also in the past.
	pastClock := func() time.Time { return time.Now().UTC().Add(-48 * time.Hour) }
	repoSave := NewAIChatContinuationsRepoFor(db, pastClock)
	if _, err := repoSave.Save(ctx, id, subject, "feature-x", json.RawMessage(`{"x":1}`)); err != nil {
		t.Fatalf("Save (pinned past): %v", err)
	}

	// Step 2: load with the real clock — row is expired, must
	// return NotFound.
	repoNow := NewAIChatContinuationsRepo(db)
	if _, err := repoNow.Load(ctx, id, subject); !errors.Is(err, ErrContinuationNotFound) {
		t.Errorf("expired Load = %v, want ErrContinuationNotFound", err)
	}

	// Step 3: cleanup removes ≥1 row.
	n, err := repoNow.CleanupExpired(ctx)
	if err != nil {
		t.Fatalf("CleanupExpired: %v", err)
	}
	if n < 1 {
		t.Errorf("CleanupExpired = %d, want ≥ 1", n)
	}
}
