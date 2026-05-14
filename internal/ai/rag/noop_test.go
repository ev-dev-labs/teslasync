package rag

import (
	"context"
	"errors"
	"testing"
)

// TestNoopRetriever_AIOffContract is the §I4 (zero outbound egress)
// evidence test. With NoopRetriever every method MUST return nil
// without performing any embedding call or SQL query. Because the
// type holds no provider/db reference, "doesn't call" is a structural
// guarantee — but the test pins behaviour so a future refactor that
// adds state to NoopRetriever will have to revisit ADR-015.
func TestNoopRetriever_AIOffContract(t *testing.T) {
	t.Parallel()
	var r Retriever = NoopRetriever{}

	// Retrieve returns (nil, nil) for valid args.
	got, err := r.Retrieve(context.Background(), "alice", "hello", []string{SourceDocs}, 5)
	if err != nil {
		t.Fatalf("Retrieve: unexpected error: %v", err)
	}
	if got != nil {
		t.Errorf("Retrieve: want nil, got %v", got)
	}

	// Index returns nil for valid args.
	if err := r.Index(context.Background(), "alice", SourceDocs, "intro.md", []string{"hello"}); err != nil {
		t.Fatalf("Index: unexpected error: %v", err)
	}

	// Forget returns nil for valid args.
	if err := r.Forget(context.Background(), "alice", SourceDocs, "intro.md"); err != nil {
		t.Fatalf("Forget: unexpected error: %v", err)
	}
}

// TestNoopRetriever_PropagatesValidation guarantees that off-mode
// callers see the same input-validation errors a production
// PgvectorRetriever would emit. Otherwise a bug in the caller's
// argument prep would lurk in off mode and explode after the admin
// flips ai_mode='local'.
func TestNoopRetriever_PropagatesValidation(t *testing.T) {
	t.Parallel()
	r := NoopRetriever{}

	t.Run("Retrieve empty query", func(t *testing.T) {
		_, err := r.Retrieve(context.Background(), "", "", nil, 5)
		if !errors.Is(err, ErrEmptyQuery) {
			t.Fatalf("want ErrEmptyQuery, got %v", err)
		}
	})

	t.Run("Retrieve k out of range", func(t *testing.T) {
		_, err := r.Retrieve(context.Background(), "", "q", nil, 0)
		if !errors.Is(err, ErrInvalidK) {
			t.Fatalf("k=0: want ErrInvalidK, got %v", err)
		}
		_, err = r.Retrieve(context.Background(), "", "q", nil, MaxK+1)
		if !errors.Is(err, ErrInvalidK) {
			t.Fatalf("k=%d: want ErrInvalidK, got %v", MaxK+1, err)
		}
	})

	t.Run("Index empty source", func(t *testing.T) {
		err := r.Index(context.Background(), "", "", "id", []string{"x"})
		if !errors.Is(err, ErrEmptySource) {
			t.Fatalf("empty type: want ErrEmptySource, got %v", err)
		}
		err = r.Index(context.Background(), "", SourceDocs, "", []string{"x"})
		if !errors.Is(err, ErrEmptySource) {
			t.Fatalf("empty id: want ErrEmptySource, got %v", err)
		}
	})

	t.Run("Index oversized chunk", func(t *testing.T) {
		big := make([]byte, MaxChunkBytes+1)
		for i := range big {
			big[i] = 'a'
		}
		err := r.Index(context.Background(), "", SourceDocs, "x", []string{string(big)})
		if !errors.Is(err, ErrChunkTooLarge) {
			t.Fatalf("want ErrChunkTooLarge, got %v", err)
		}
	})

	t.Run("Forget empty source", func(t *testing.T) {
		err := r.Forget(context.Background(), "", "", "id")
		if !errors.Is(err, ErrEmptySource) {
			t.Fatalf("empty type: want ErrEmptySource, got %v", err)
		}
	})
}

// TestNoopRetriever_AcceptsEmptyChunks documents that an Index call
// with zero chunks is the documented "delete everything" idiom.
// Production PgvectorRetriever also short-circuits to Forget; the
// noop just returns nil.
func TestNoopRetriever_AcceptsEmptyChunks(t *testing.T) {
	t.Parallel()
	r := NoopRetriever{}
	if err := r.Index(context.Background(), "", SourceDocs, "x", nil); err != nil {
		t.Fatalf("nil chunks: %v", err)
	}
	if err := r.Index(context.Background(), "", SourceDocs, "x", []string{}); err != nil {
		t.Fatalf("empty chunks: %v", err)
	}
}
