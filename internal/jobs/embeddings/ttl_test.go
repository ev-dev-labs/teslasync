package embeddings

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ev-dev-labs/teslasync/internal/ai/rag"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

type fakeSettings struct {
	mode string
	err  error
}

func (f fakeSettings) AIMode(_ context.Context) (string, error) {
	return f.mode, f.err
}

// TestRunTTL_OffMode_NoDeletes is the §I12 evidence test:
// when ai_mode='off' the cron MUST NOT touch the embeddings tables.
// Pure Go — no DB required because the off-mode branch returns
// before any SQL is issued.
func TestRunTTL_OffMode_NoDeletes(t *testing.T) {
	t.Parallel()
	settings := fakeSettings{mode: rag.AIModeOff}
	// Pass a sentinel *database.DB whose nil Pool will panic on use.
	// Off-mode short-circuit MUST happen before db.Pool is touched.
	res, err := RunTTL(context.Background(), &database.DB{}, settings)
	if err != nil {
		t.Fatalf("off mode: unexpected error %v", err)
	}
	if res.Total() != 0 {
		t.Fatalf("off mode: want 0 deletes, got %d", res.Total())
	}
}

// TestRunTTL_SettingsErrorIsFailClosed proves that a
// settings-read failure does NOT cascade into deletes against a
// degraded DB.
func TestRunTTL_SettingsErrorIsFailClosed(t *testing.T) {
	t.Parallel()
	settings := fakeSettings{err: errors.New("db unreachable")}
	res, err := RunTTL(context.Background(), &database.DB{}, settings)
	if err != nil {
		t.Fatalf("settings error: want nil err (fail-closed), got %v", err)
	}
	if res.Total() != 0 {
		t.Fatal("settings error: want 0 deletes")
	}
}

func TestRunTTL_NilDeps(t *testing.T) {
	t.Parallel()
	if _, err := RunTTL(context.Background(), nil, fakeSettings{mode: "off"}); err == nil {
		t.Fatal("nil db: want error")
	}
	if _, err := RunTTL(context.Background(), &database.DB{}, nil); err == nil {
		t.Fatal("nil settings: want error")
	}
}

func ttlDSNOrSkip(t *testing.T) string {
	t.Helper()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("TESLASYNC_TEST_DSN")
	}
	if dsn == "" {
		t.Skip("DATABASE_URL/TESLASYNC_TEST_DSN not set; skipping embeddings TTL SQL tests")
	}
	return dsn
}

// TestRunTTL_DeletesExpired exercises the live DB path.
// Inserts two rows — one expired and one in the future — and proves
// the cron deletes only the expired one.
func TestRunTTL_DeletesExpired(t *testing.T) {
	dsn := ttlDSNOrSkip(t)
	ctx := context.Background()

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Skipf("cannot open pool: %v", err)
	}
	t.Cleanup(pool.Close)

	// Skip cleanly when migrations have not been applied to the
	// target DSN.
	var has bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'embeddings_768')`,
	).Scan(&has); err != nil {
		t.Skipf("table existence check: %v", err)
	}
	if !has {
		t.Skip("embeddings_768 table missing; run migrations first")
	}

	subject := "ttl-test-subject"
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM embeddings_768 WHERE user_subject=$1`, subject)
	})
	_, _ = pool.Exec(ctx, `DELETE FROM embeddings_768 WHERE user_subject=$1`, subject)

	// Insert one expired row and one fresh row using a synthetic
	// 768-dim vector built inline ([0,0,…,0]).
	zeroVec := "[" + repeatString("0,", 767) + "0]"
	insertSQL := `INSERT INTO embeddings_768
		(user_subject, source_type, source_id, chunk_idx, text, text_hash, embedding, model, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7::vector, $8, $9)`

	pastExpiry := time.Now().UTC().Add(-time.Hour)
	if _, err := pool.Exec(ctx, insertSQL,
		subject, rag.SourceDriveSummary, "expired", 0, "x", "h1", zeroVec, rag.ModelNomicEmbedText, pastExpiry,
	); err != nil {
		t.Fatalf("insert expired: %v", err)
	}

	futureExpiry := time.Now().UTC().Add(time.Hour)
	if _, err := pool.Exec(ctx, insertSQL,
		subject, rag.SourceDriveSummary, "fresh", 0, "y", "h2", zeroVec, rag.ModelNomicEmbedText, futureExpiry,
	); err != nil {
		t.Fatalf("insert fresh: %v", err)
	}

	res, err := RunTTL(ctx, &database.DB{Pool: pool}, fakeSettings{mode: "local"})
	if err != nil {
		t.Fatalf("RunTTL: %v", err)
	}
	if res.Deleted768 < 1 {
		t.Fatalf("want >=1 delete, got %d", res.Deleted768)
	}

	var remaining int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM embeddings_768 WHERE user_subject=$1`, subject,
	).Scan(&remaining); err != nil {
		t.Fatalf("count: %v", err)
	}
	if remaining != 1 {
		t.Errorf("want 1 row remaining (fresh), got %d", remaining)
	}
}

func repeatString(s string, n int) string {
	out := make([]byte, 0, len(s)*n)
	for i := 0; i < n; i++ {
		out = append(out, s...)
	}
	return string(out)
}
