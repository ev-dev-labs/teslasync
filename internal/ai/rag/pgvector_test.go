package rag

import (
	"context"
	"hash/fnv"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// deterministicProvider returns vectors whose contents are derived
// from a hash of the input string, so two calls with the same input
// produce the same vector. Used to exercise the pgvector retriever
// without invoking a real embedding service. The dimensionality is
// fixed at 768 to match the default ModelNomicEmbedText.
type deterministicProvider struct {
	calls int
}

func (d *deterministicProvider) Name() string { return "det" }

func (d *deterministicProvider) Chat(_ context.Context, _ provider.ChatRequest) (*provider.ChatResponse, error) {
	return nil, nil
}

func (d *deterministicProvider) Stream(_ context.Context, _ provider.ChatRequest) (<-chan provider.Chunk, error) {
	return nil, nil
}

func (d *deterministicProvider) Embed(_ context.Context, req provider.EmbedRequest) (*provider.EmbedResponse, error) {
	d.calls++
	out := &provider.EmbedResponse{Vectors: make([][]float32, len(req.Input))}
	for i, in := range req.Input {
		out.Vectors[i] = makeVecFromString(in, 768)
	}
	return out, nil
}

func (d *deterministicProvider) Capabilities() provider.Capabilities {
	return provider.Capabilities{Embeddings: true}
}

func makeVecFromString(s string, dim int) []float32 {
	v := make([]float32, dim)
	h := fnv.New64a()
	for i := 0; i < dim; i++ {
		h.Reset()
		_, _ = h.Write([]byte(s))
		_, _ = h.Write([]byte{byte(i), byte(i >> 8)})
		// Map the 64-bit hash into [-1, 1].
		u := h.Sum64()
		v[i] = (float32(u%10000) / 5000.0) - 1.0
	}
	return v
}

type detResolver struct{ p *deterministicProvider }

func (d detResolver) For(_ context.Context, _ string) (provider.Provider, error) { return d.p, nil }

func ragDSNOrSkip(t *testing.T) string {
	t.Helper()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("TESLASYNC_TEST_DSN")
	}
	if dsn == "" {
		t.Skip("DATABASE_URL/TESLASYNC_TEST_DSN not set; skipping rag SQL tests")
	}
	return dsn
}

func openPgvectorRetriever(t *testing.T) (*PgvectorRetriever, *deterministicProvider, *database.DB) {
	t.Helper()
	dsn := ragDSNOrSkip(t)

	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("cannot open pool: %v", err)
	}
	t.Cleanup(pool.Close)

	// Table existence check — skip cleanly if migrations 000205/000206
	// have not been applied to the target DSN.
	var has bool
	if err := pool.QueryRow(context.Background(),
		`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'embeddings_768')`,
	).Scan(&has); err != nil {
		t.Skipf("table existence check failed: %v", err)
	}
	if !has {
		t.Skip("embeddings_768 table missing; run migrations first")
	}

	prov := &deterministicProvider{}
	resolver := detResolver{p: prov}
	db := &database.DB{Pool: pool}
	r, err := NewPgvectorRetriever(db, resolver, "test-feature", ModelNomicEmbedText)
	if err != nil {
		t.Fatalf("NewPgvectorRetriever: %v", err)
	}

	// Clean any leftover rows for the test subject so the suite is
	// re-runnable without manual cleanup.
	_, _ = pool.Exec(context.Background(),
		`DELETE FROM embeddings_768 WHERE user_subject = $1`, "rag-test-subject")

	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM embeddings_768 WHERE user_subject = $1`, "rag-test-subject")
	})

	return r, prov, db
}

func TestPgvectorRetriever_RoundTrip(t *testing.T) {
	r, prov, _ := openPgvectorRetriever(t)
	ctx := context.Background()

	subject := "rag-test-subject"
	chunks := []string{"alpha chunk", "beta chunk", "gamma chunk"}

	if err := r.Index(ctx, subject, SourceDocs, "doc-1", chunks); err != nil {
		t.Fatalf("Index: %v", err)
	}
	if prov.calls == 0 {
		t.Fatal("expected provider to be called at least once on first Index")
	}

	// Re-Index with identical chunks — should NOT re-embed.
	before := prov.calls
	if err := r.Index(ctx, subject, SourceDocs, "doc-1", chunks); err != nil {
		t.Fatalf("re-Index: %v", err)
	}
	if prov.calls != before {
		t.Errorf("dedupe broken: provider called %d times on identical re-Index", prov.calls-before)
	}

	// Retrieve with one of the exact chunks as query — top hit
	// should be that chunk.
	got, err := r.Retrieve(ctx, subject, "alpha chunk", []string{SourceDocs}, 3)
	if err != nil {
		t.Fatalf("Retrieve: %v", err)
	}
	if len(got) == 0 {
		t.Fatal("Retrieve: no rows")
	}
	if got[0].Text != "alpha chunk" {
		t.Errorf("Retrieve: top hit = %q, want %q", got[0].Text, "alpha chunk")
	}
}

func TestPgvectorRetriever_Truncation(t *testing.T) {
	r, _, db := openPgvectorRetriever(t)
	ctx := context.Background()
	subject := "rag-test-subject"

	// Index 5 chunks, then re-Index with only 2 — chunks 2..4 must
	// disappear so a shrunk source cannot leak stale chunks.
	if err := r.Index(ctx, subject, SourceDocs, "doc-2",
		[]string{"a", "b", "c", "d", "e"}); err != nil {
		t.Fatalf("Index initial: %v", err)
	}
	if err := r.Index(ctx, subject, SourceDocs, "doc-2",
		[]string{"a", "b"}); err != nil {
		t.Fatalf("Index shrunk: %v", err)
	}

	var count int
	if err := db.Pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM embeddings_768 WHERE user_subject=$1 AND source_id='doc-2'`,
		subject,
	).Scan(&count); err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 2 {
		t.Errorf("post-truncation count = %d, want 2", count)
	}
}

func TestPgvectorRetriever_Forget(t *testing.T) {
	r, _, db := openPgvectorRetriever(t)
	ctx := context.Background()
	subject := "rag-test-subject"

	if err := r.Index(ctx, subject, SourceDocs, "doc-3",
		[]string{"x", "y", "z"}); err != nil {
		t.Fatalf("Index: %v", err)
	}
	if err := r.Forget(ctx, subject, SourceDocs, "doc-3"); err != nil {
		t.Fatalf("Forget: %v", err)
	}

	var count int
	if err := db.Pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM embeddings_768 WHERE user_subject=$1 AND source_id='doc-3'`,
		subject,
	).Scan(&count); err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 0 {
		t.Errorf("post-forget count = %d, want 0", count)
	}
}
