// Phase-46 / Prompt 57 — AuthSubjectsRepo unit tests.
//
// The repo's queries themselves require a live PostgreSQL connection
// so the SQL-touching coverage lives in the API handler integration
// tests (which exercise the handler against a fake store) and in
// CI's migration-up smoke. These tests pin the parts that are pure
// Go and are easy to verify without a database round-trip:
//
//   - Empty / whitespace-only subjects are rejected at the Upsert /
//     Get boundary so a misconfigured proxy can never plant a
//     phantom "" row.
//   - The repo refuses to act on a nil pool rather than panicking,
//     so the open-mode wiring path is safe.
//   - isNoRowsError uses errors.Is against pgx.ErrNoRows (not a raw
//     string compare) so a future driver upgrade does not silently
//     break "subject not found" semantics.
package auth

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5"
)

func TestAuthSubjectsRepo_NilPoolGuards(t *testing.T) {
	repo := NewAuthSubjectsRepo(nil)
	ctx := context.Background()
	now := time.Date(2026, 5, 5, 12, 0, 0, 0, time.UTC)

	if _, err := repo.Upsert(ctx, "alice", now); err == nil {
		t.Fatalf("Upsert against nil pool should error")
	}
	if _, err := repo.Get(ctx, "alice"); err == nil {
		t.Fatalf("Get against nil pool should error")
	}
	if _, err := repo.List(ctx); err == nil {
		t.Fatalf("List against nil pool should error")
	}
}

func TestAuthSubjectsRepo_UpsertRejectsEmptySubject(t *testing.T) {
	// Even with a configured pool, an empty/whitespace subject must
	// be rejected before any SQL runs. We exercise the guard by
	// passing a non-nil but unused pool wrapper.
	repo := NewAuthSubjectsRepo(&database.DB{})
	ctx := context.Background()
	now := time.Date(2026, 5, 5, 12, 0, 0, 0, time.UTC)

	for _, in := range []string{"", "   ", "\t\n"} {
		t.Run(fmt.Sprintf("subject=%q", in), func(t *testing.T) {
			_, err := repo.Upsert(ctx, in, now)
			if err == nil {
				t.Fatalf("Upsert(%q) should reject empty subject", in)
			}
		})
	}
}

func TestAuthSubjectsRepo_GetRejectsEmptySubject(t *testing.T) {
	repo := NewAuthSubjectsRepo(&database.DB{})
	ctx := context.Background()
	for _, in := range []string{"", "   "} {
		t.Run(fmt.Sprintf("subject=%q", in), func(t *testing.T) {
			_, err := repo.Get(ctx, in)
			if !errors.Is(err, ErrAuthSubjectNotFound) {
				t.Fatalf("Get(%q): want ErrAuthSubjectNotFound, got %v", in, err)
			}
		})
	}
}

func TestAuthSubjectsRepo_IsNoRowsError(t *testing.T) {
	if !isNoRowsError(pgx.ErrNoRows) {
		t.Fatalf("isNoRowsError(pgx.ErrNoRows) = false; want true")
	}
	if !isNoRowsError(fmt.Errorf("wrapped: %w", pgx.ErrNoRows)) {
		t.Fatalf("isNoRowsError must unwrap")
	}
	if isNoRowsError(errors.New("some other error")) {
		t.Fatalf("isNoRowsError matched an unrelated error")
	}
	if isNoRowsError(nil) {
		t.Fatalf("isNoRowsError(nil) = true; want false")
	}
}
