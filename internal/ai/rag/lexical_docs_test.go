package rag

import (
	"context"
	"errors"
	"testing"
	"testing/fstest"
)

func TestLexicalDocsRetrieverRanksRelevantDocument(t *testing.T) {
	t.Parallel()
	fsys := fstest.MapFS{
		"guide/helix-ai.md":      {Data: []byte("# Helix AI\n\nConfigure local or cloud providers and feature toggles.")},
		"guide/charging.md":      {Data: []byte("# Charging\n\nReview charging sessions and energy.")},
		"runbooks/recover-ai.md": {Data: []byte("# Recover AI\n\nTroubleshoot provider connectivity.")},
		"features/dashboard.md":  {Data: []byte("# Dashboard\n\nArrange widgets.")},
	}
	retriever, err := NewLexicalDocsRetriever(fsys)
	if err != nil {
		t.Fatalf("NewLexicalDocsRetriever: %v", err)
	}

	chunks, err := retriever.Retrieve(context.Background(), "", "configure Helix AI provider", []string{SourceDocs}, 3)
	if err != nil {
		t.Fatalf("Retrieve: %v", err)
	}
	if len(chunks) == 0 || chunks[0].SourceID != "guide/helix-ai.md" {
		t.Fatalf("top result = %+v, want guide/helix-ai.md", chunks)
	}
	if chunks[0].Score <= 0 || chunks[0].Score >= 1 {
		t.Fatalf("normalized score = %v, want 0 < score < 1", chunks[0].Score)
	}
}

func TestLexicalDocsRetrieverHonorsSourceFilter(t *testing.T) {
	t.Parallel()
	fsys := fstest.MapFS{
		"guide/ai.md":         {Data: []byte("provider troubleshooting")},
		"runbooks/recover.md": {Data: []byte("provider troubleshooting recovery")},
	}
	retriever, err := NewLexicalDocsRetriever(fsys)
	if err != nil {
		t.Fatalf("NewLexicalDocsRetriever: %v", err)
	}

	chunks, err := retriever.Retrieve(context.Background(), "", "provider troubleshooting", []string{"runbooks"}, 5)
	if err != nil {
		t.Fatalf("Retrieve: %v", err)
	}
	if len(chunks) != 1 || chunks[0].SourceType != "runbooks" {
		t.Fatalf("filtered chunks = %+v", chunks)
	}
}

func TestLexicalDocsRetrieverIsReadOnly(t *testing.T) {
	t.Parallel()
	retriever, err := NewLexicalDocsRetriever(fstest.MapFS{
		"guide/start.md": {Data: []byte("getting started")},
	})
	if err != nil {
		t.Fatalf("NewLexicalDocsRetriever: %v", err)
	}
	if err := retriever.Index(context.Background(), "", SourceDocs, "x", []string{"x"}); !errors.Is(err, ErrReadOnlyRetriever) {
		t.Fatalf("Index error = %v", err)
	}
	if err := retriever.Forget(context.Background(), "", SourceDocs, "x"); !errors.Is(err, ErrReadOnlyRetriever) {
		t.Fatalf("Forget error = %v", err)
	}
}
