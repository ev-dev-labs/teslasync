package rag

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// fakeSettings is a hand-rolled SettingsReader for factory tests.
// We avoid the real *database.SettingsRepo here so the factory test
// can run without a Postgres dependency.
type fakeSettings struct {
	mode string
	err  error
}

func (f fakeSettings) AIMode(_ context.Context) (string, error) {
	return f.mode, f.err
}

// spyProvider counts embed calls. Used to prove that off-mode
// factory wiring produces a retriever that performs zero outbound
// embed calls — the §I4 evidence at the type-system level.
type spyProvider struct {
	embedCalls atomic.Int64
}

func (s *spyProvider) Name() string { return "spy" }

func (s *spyProvider) Chat(_ context.Context, _ provider.ChatRequest) (*provider.ChatResponse, error) {
	return nil, errors.New("not used")
}

func (s *spyProvider) Stream(_ context.Context, _ provider.ChatRequest) (<-chan provider.Chunk, error) {
	return nil, errors.New("not used")
}

func (s *spyProvider) Embed(_ context.Context, req provider.EmbedRequest) (*provider.EmbedResponse, error) {
	s.embedCalls.Add(1)
	out := &provider.EmbedResponse{Vectors: make([][]float32, len(req.Input))}
	for i := range out.Vectors {
		out.Vectors[i] = make([]float32, 768)
	}
	return out, nil
}

func (s *spyProvider) Capabilities() provider.Capabilities {
	return provider.Capabilities{Embeddings: true}
}

// spyResolver wraps spyProvider to satisfy ProviderResolver.
type spyResolver struct{ p *spyProvider }

func (s spyResolver) For(_ context.Context, _ string) (provider.Provider, error) { return s.p, nil }

func TestNew_OffMode_ReturnsNoop(t *testing.T) {
	t.Parallel()
	settings := fakeSettings{mode: "off"}
	r, err := New(context.Background(), settings, nil, nil, "test-feature", ModelNomicEmbedText)
	if err != nil {
		t.Fatalf("New(off): %v", err)
	}
	if _, ok := r.(NoopRetriever); !ok {
		t.Fatalf("want NoopRetriever, got %T", r)
	}
}

// TestNew_OffMode_ZeroEmbedCalls is the §I4 evidence test at the
// factory boundary. With ai_mode='off' a feature handler that calls
// Retrieve / Index / Forget MUST NOT trigger any provider embed
// call. The spyProvider counter pins the invariant.
func TestNew_OffMode_ZeroEmbedCalls(t *testing.T) {
	t.Parallel()
	settings := fakeSettings{mode: "off"}
	spy := &spyProvider{}
	resolver := spyResolver{p: spy}

	r, err := New(context.Background(), settings, nil, resolver, "test-feature", ModelNomicEmbedText)
	if err != nil {
		t.Fatalf("New(off): %v", err)
	}

	// Hammer the retriever — none of these calls may translate to
	// an embed call against the spy.
	for i := 0; i < 20; i++ {
		if _, err := r.Retrieve(context.Background(), "alice", "query", nil, 5); err != nil {
			t.Fatalf("Retrieve: %v", err)
		}
		if err := r.Index(context.Background(), "alice", SourceDocs, "x", []string{"chunk"}); err != nil {
			t.Fatalf("Index: %v", err)
		}
		if err := r.Forget(context.Background(), "alice", SourceDocs, "x"); err != nil {
			t.Fatalf("Forget: %v", err)
		}
	}

	if got := spy.embedCalls.Load(); got != 0 {
		t.Fatalf("AI-Off Contract §I4 violated: got %d embed calls in off mode", got)
	}
}

// TestNew_SettingsErrorIsFailClosed proves that a transient settings
// read failure does NOT silently re-enable AI. A degraded DB at boot
// must produce a NoopRetriever, not return an error that the caller
// might "fall back" past.
func TestNew_SettingsErrorIsFailClosed(t *testing.T) {
	t.Parallel()
	settings := fakeSettings{err: errors.New("db unreachable")}
	r, err := New(context.Background(), settings, nil, nil, "test-feature", ModelNomicEmbedText)
	if err != nil {
		t.Fatalf("New(error): want nil err, got %v", err)
	}
	if _, ok := r.(NoopRetriever); !ok {
		t.Fatalf("want NoopRetriever on settings error, got %T", r)
	}
}

func TestNew_OnMode_RequiresDB(t *testing.T) {
	t.Parallel()
	settings := fakeSettings{mode: "local"}
	resolver := spyResolver{p: &spyProvider{}}
	_, err := New(context.Background(), settings, nil, resolver, "test-feature", ModelNomicEmbedText)
	if err == nil {
		t.Fatal("want error for nil db in on-mode")
	}
}

func TestNew_OnMode_RequiresResolver(t *testing.T) {
	t.Parallel()
	settings := fakeSettings{mode: "local"}
	// Use a zero-value *database.DB to bypass the db nil-check.
	// The constructor checks db != nil before validating model;
	// we pass a non-nil shell that is never dereferenced because
	// the resolver-nil-check fires first.
	db := &database.DB{}
	_, err := New(context.Background(), settings, db, nil, "test-feature", ModelNomicEmbedText)
	if err == nil {
		t.Fatal("want error for nil resolver in on-mode")
	}
}

func TestNewPgvectorRetriever_RejectsUnknownModel(t *testing.T) {
	t.Parallel()
	db := &database.DB{}
	resolver := spyResolver{p: &spyProvider{}}
	_, err := NewPgvectorRetriever(db, resolver, "test-feature", "model-not-real")
	if !errors.Is(err, ErrUnknownModel) {
		t.Fatalf("want ErrUnknownModel, got %v", err)
	}
}

func TestNewPgvectorRetriever_RejectsEmptyFeatureID(t *testing.T) {
	t.Parallel()
	db := &database.DB{}
	resolver := spyResolver{p: &spyProvider{}}
	_, err := NewPgvectorRetriever(db, resolver, "", ModelNomicEmbedText)
	if err == nil {
		t.Fatal("want error for empty featureID")
	}
}

func TestNewPgvectorRetriever_AcceptsKnownModels(t *testing.T) {
	t.Parallel()
	db := &database.DB{}
	resolver := spyResolver{p: &spyProvider{}}
	for _, m := range KnownModels() {
		t.Run(m, func(t *testing.T) {
			r, err := NewPgvectorRetriever(db, resolver, "test-feature", m)
			if err != nil {
				t.Fatalf("NewPgvectorRetriever(%s): %v", m, err)
			}
			if r == nil {
				t.Fatal("nil retriever")
			}
		})
	}
}
