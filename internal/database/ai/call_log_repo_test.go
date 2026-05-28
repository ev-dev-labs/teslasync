// Phase-50 / 0004 — F3 ai_call_log repo tests.
//
// Pure-Go validators run unconditionally. The SQL-touching coverage
// requires a live DB and runs only when DATABASE_URL or
// TESLASYNC_TEST_DSN points at a reachable PostgreSQL+TimescaleDB
// instance, mirroring the rest of internal/database (e.g.
// scheduled_export_repo_test.go).
package ai

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// TestAICallLogRepo_Recent_LimitValidator pins the contract that
// out-of-range limit values surface ErrAICallLogInvalidLimit so the
// handler can return 400 without inventing its own validation. Pure
// Go — no DB required.
func TestAICallLogRepo_Recent_LimitValidator(t *testing.T) {
	t.Parallel()
	repo := &AICallLogRepo{db: nil} // pool unused on the validation path

	for _, bad := range []int{0, -1, -1000, AICallRecentMax + 1, AICallRecentMax * 2} {
		_, err := repo.Recent(context.Background(), "alice", bad)
		if !errors.Is(err, ErrAICallLogInvalidLimit) {
			t.Errorf("Recent(limit=%d) = %v, want ErrAICallLogInvalidLimit", bad, err)
		}
	}
}

// TestAICallLogRepo_Insert_NilRecordRejected pins the defence-in-depth
// nil check so a buggy decorator can never wedge the drainer goroutine.
// Pure Go — does not touch the DB pool.
func TestAICallLogRepo_Insert_NilRecordRejected(t *testing.T) {
	t.Parallel()
	repo := &AICallLogRepo{db: nil}
	if err := repo.Insert(context.Background(), nil); err == nil {
		t.Fatal("expected nil-record error")
	}
}

// TestAICallLogRepo_Insert_EmptyProviderRejected covers the second
// defence-in-depth check: provider must be non-empty (the DB CHECK
// constraint also rejects, but failing early avoids a network round
// trip on a guaranteed-bad row).
func TestAICallLogRepo_Insert_EmptyProviderRejected(t *testing.T) {
	t.Parallel()
	repo := &AICallLogRepo{db: nil}
	rec := &provider.AuditRecord{
		FeatureID: "chatbot-llm",
		Model:     "gpt-4o-mini",
		// Provider intentionally empty.
	}
	if err := repo.Insert(context.Background(), rec); err == nil {
		t.Fatal("expected empty-provider error")
	}
}

// TestAICallLogRepo_RoundTrip exercises Insert + Today + ByFeature +
// Recent against a live DB. Skips when no DSN is configured.
func TestAICallLogRepo_RoundTrip(t *testing.T) {
	dsn := dsnOrSkip(t)

	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("cannot open pool: %v", err)
	}
	t.Cleanup(pool.Close)

	// Confirm the table exists — we don't run goose here so the test
	// expects whoever provisioned the DSN to have applied migrations.
	var has bool
	if err := pool.QueryRow(context.Background(),
		`SELECT EXISTS (SELECT 1 FROM information_schema.tables
		                WHERE table_schema='public' AND table_name='ai_call_log')`,
	).Scan(&has); err != nil {
		t.Skipf("ai_call_log table check: %v", err)
	}
	if !has {
		t.Skip("ai_call_log table missing; run migrations against this DSN")
	}

	db := &database.DB{Pool: pool}
	repo := NewAICallLogRepo(db)

	ctx := context.Background()
	subject := "ai-call-log-roundtrip-test@example.com"
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM ai_call_log WHERE user_subject = $1`, subject)
	})
	// Pre-clean any leftover rows from a previous failed run.
	_, _ = pool.Exec(ctx, `DELETE FROM ai_call_log WHERE user_subject = $1`, subject)

	now := time.Now().UTC()
	for i, rec := range []provider.AuditRecord{
		{
			UserSubject: subject, FeatureID: "chatbot-llm", Provider: "openai",
			Model: "gpt-4o-mini", InputTokens: 100, OutputTokens: 50,
			CostMicroCents: 45000, LatencyMs: 320, FinishReason: provider.FinishStop,
			RequestHash: "h1", RedactedDigest: "h1",
			StartedAt: now.Add(-30 * time.Minute), FinishedAt: now.Add(-30 * time.Minute).Add(320 * time.Millisecond),
		},
		{
			UserSubject: subject, FeatureID: "chatbot-llm", Provider: "ollama",
			Model: "llama3.1", InputTokens: 200, OutputTokens: 80,
			CostMicroCents: 0, LatencyMs: 410, FinishReason: provider.FinishStop,
			RequestHash: "h2", RedactedDigest: "h2",
			StartedAt: now.Add(-10 * time.Minute), FinishedAt: now.Add(-10 * time.Minute).Add(410 * time.Millisecond),
		},
		{
			UserSubject: subject, FeatureID: "ai-provider-health", Provider: "openai",
			Model: "gpt-4o-mini", InputTokens: 10, OutputTokens: 5,
			CostMicroCents: 4500, LatencyMs: 90, FinishReason: provider.FinishStop,
			RequestHash: "h3", RedactedDigest: "h3", Error: "",
			StartedAt: now.Add(-5 * time.Minute), FinishedAt: now.Add(-5 * time.Minute).Add(90 * time.Millisecond),
		},
	} {
		r := rec
		if err := repo.Insert(ctx, &r); err != nil {
			t.Fatalf("Insert[%d]: %v", i, err)
		}
	}

	today, err := repo.Today(ctx, subject)
	if err != nil {
		t.Fatalf("Today: %v", err)
	}
	if today.Calls != 3 {
		t.Errorf("Today.Calls = %d, want 3", today.Calls)
	}
	if today.InputTokens != 310 {
		t.Errorf("Today.InputTokens = %d, want 310", today.InputTokens)
	}
	if today.OutputTokens != 135 {
		t.Errorf("Today.OutputTokens = %d, want 135", today.OutputTokens)
	}
	if today.CostMicroCents != 49500 {
		t.Errorf("Today.CostMicroCents = %d, want 49500", today.CostMicroCents)
	}

	byFeature, err := repo.ByFeature(ctx, subject, now.Add(-time.Hour))
	if err != nil {
		t.Fatalf("ByFeature: %v", err)
	}
	if len(byFeature) != 2 {
		t.Fatalf("ByFeature rows = %d, want 2", len(byFeature))
	}
	// Sorted by cost desc: chatbot-llm (45000) > ai-provider-health (4500).
	if byFeature[0].FeatureID != "chatbot-llm" {
		t.Errorf("ByFeature[0] = %q, want chatbot-llm", byFeature[0].FeatureID)
	}
	if byFeature[0].Calls != 2 {
		t.Errorf("ByFeature[0].Calls = %d, want 2", byFeature[0].Calls)
	}
	if byFeature[1].FeatureID != "ai-provider-health" {
		t.Errorf("ByFeature[1] = %q, want ai-provider-health", byFeature[1].FeatureID)
	}

	recent, err := repo.Recent(ctx, subject, 10)
	if err != nil {
		t.Fatalf("Recent: %v", err)
	}
	if len(recent) != 3 {
		t.Fatalf("Recent rows = %d, want 3", len(recent))
	}
	// Newest-first.
	if recent[0].FeatureID != "ai-provider-health" {
		t.Errorf("Recent[0].FeatureID = %q, want ai-provider-health", recent[0].FeatureID)
	}

	// Other-subject row must NOT leak into our reads.
	otherSubject := subject + "-other"
	otherRec := provider.AuditRecord{
		UserSubject: otherSubject, FeatureID: "chatbot-llm", Provider: "openai",
		Model: "gpt-4o-mini", InputTokens: 999, OutputTokens: 999,
		CostMicroCents: 999000, LatencyMs: 999, FinishReason: provider.FinishStop,
		StartedAt: now.Add(-1 * time.Minute), FinishedAt: now.Add(-1 * time.Minute),
	}
	if err := repo.Insert(ctx, &otherRec); err != nil {
		t.Fatalf("Insert other-subject: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM ai_call_log WHERE user_subject = $1`, otherSubject)
	})

	today2, err := repo.Today(ctx, subject)
	if err != nil {
		t.Fatalf("Today after other insert: %v", err)
	}
	if today2.Calls != 3 {
		t.Errorf("subject scoping leaked: Today.Calls = %d, want 3", today2.Calls)
	}
	if today2.CostMicroCents != 49500 {
		t.Errorf("subject scoping leaked: Today.CostMicroCents = %d, want 49500", today2.CostMicroCents)
	}
}

// dsnOrSkip returns the configured live-DB DSN or skips the test.
// Mirrors the helper used by scheduled_export_repo_test.go.
func dsnOrSkip(t *testing.T) string {
	t.Helper()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("TESLASYNC_TEST_DSN")
	}
	if dsn == "" {
		t.Skip("DATABASE_URL/TESLASYNC_TEST_DSN not set; skipping ai_call_log SQL tests")
	}
	return dsn
}
