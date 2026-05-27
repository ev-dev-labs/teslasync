package rag

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
)

// recordingRetriever captures Index calls. Used in IndexDocs tests
// to verify the right files are walked, and to prove that a noop
// retriever produces zero side effects.
type recordingRetriever struct {
	mu      sync.Mutex
	indexed map[string]int // source_id -> chunk count
	failOn  string         // if non-empty, source_id whose Index returns error
}

func (r *recordingRetriever) Retrieve(_ context.Context, _, _ string, _ []string, _ int) ([]Chunk, error) {
	return nil, nil
}

func (r *recordingRetriever) Index(_ context.Context, _, sourceType, sourceID string, chunks []string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.failOn != "" && sourceID == r.failOn {
		return errors.New("forced failure")
	}
	if r.indexed == nil {
		r.indexed = make(map[string]int)
	}
	if sourceType != SourceDocs {
		return errors.New("docs indexer must use SourceDocs")
	}
	r.indexed[sourceID] = len(chunks)
	return nil
}

func (r *recordingRetriever) Forget(_ context.Context, _, _, _ string) error { return nil }

func TestIndexDocs_WalksMarkdown(t *testing.T) {
	t.Parallel()
	fsys := fstest.MapFS{
		"docs/getting-started.md": {Data: []byte("# Getting Started\n\nWelcome to the help.")},
		"docs/charging.md":        {Data: []byte("Charging tips.")},
		"docs/img/logo.png":       {Data: []byte{0x89, 0x50, 0x4E, 0x47}}, // skipped
		"docs/_partial.md":        {Data: []byte("partial")},              // skipped (underscore prefix)
		"docs/.hidden.md":         {Data: []byte("hidden")},               // skipped
		"docs/notes.txt":          {Data: []byte("plain text")},           // skipped
	}
	r := &recordingRetriever{}
	n, err := IndexDocs(context.Background(), r, fsys, "docs", "")
	if err != nil {
		t.Fatalf("IndexDocs: %v", err)
	}
	if n != 2 {
		t.Fatalf("want 2 indexed, got %d", n)
	}
	if _, ok := r.indexed["getting-started.md"]; !ok {
		t.Errorf("missing getting-started.md (got %v)", r.indexed)
	}
	if _, ok := r.indexed["charging.md"]; !ok {
		t.Errorf("missing charging.md (got %v)", r.indexed)
	}
}

func TestIndexDocs_NoopRetriever_NoSideEffects(t *testing.T) {
	t.Parallel()
	fsys := fstest.MapFS{
		"docs/intro.md": {Data: []byte("# Intro\n\nbody")},
		"docs/usage.md": {Data: []byte("# Usage\n\nbody")},
	}
	// IndexDocs against a NoopRetriever — succeeds (each Index
	// returns nil after validation) but writes nothing. The
	// returned count reflects "files passed to Index", not "files
	// actually persisted". This is fine — N6 will gate IndexDocs
	// behind the per-feature toggle so it never runs in off mode
	// in the first place.
	r := NoopRetriever{}
	n, err := IndexDocs(context.Background(), r, fsys, "docs", "")
	if err != nil {
		t.Fatalf("IndexDocs: %v", err)
	}
	if n != 2 {
		t.Fatalf("want 2 indexed, got %d", n)
	}
}

func TestIndexDocs_SkipsDirectories(t *testing.T) {
	t.Parallel()
	fsys := fstest.MapFS{
		"docs/intro.md":            {Data: []byte("intro")},
		"docs/.git/HEAD":           {Data: []byte("ref: ...")},
		"docs/.vitepress/cache.md": {Data: []byte("cache")},
		"docs/_partials/x.md":      {Data: []byte("partial")},
	}
	r := &recordingRetriever{}
	n, err := IndexDocs(context.Background(), r, fsys, "docs", "")
	if err != nil {
		t.Fatalf("IndexDocs: %v", err)
	}
	if n != 1 {
		t.Fatalf("want 1 indexed (only intro.md), got %d (%v)", n, r.indexed)
	}
}

func TestIndexDocs_ContinuesOnIndexError(t *testing.T) {
	t.Parallel()
	fsys := fstest.MapFS{
		"docs/a.md": {Data: []byte("alpha")},
		"docs/b.md": {Data: []byte("beta")},
		"docs/c.md": {Data: []byte("gamma")},
	}
	r := &recordingRetriever{failOn: "b.md"}
	n, err := IndexDocs(context.Background(), r, fsys, "docs", "")
	if err != nil {
		t.Fatalf("IndexDocs: %v", err)
	}
	if n != 2 {
		t.Fatalf("want 2 (a + c, b failed), got %d", n)
	}
}

func TestIndexDocs_NilArgs(t *testing.T) {
	t.Parallel()
	fsys := fstest.MapFS{}

	if _, err := IndexDocs(context.Background(), nil, fsys, "docs", ""); err == nil {
		t.Error("nil retriever: want error")
	}
	if _, err := IndexDocs(context.Background(), NoopRetriever{}, nil, "docs", ""); err == nil {
		t.Error("nil fsys: want error")
	}
}

func TestIndexDocs_EmptyDir(t *testing.T) {
	t.Parallel()
	fsys := fstest.MapFS{
		"docs/.keep": {Data: []byte("")},
	}
	r := &recordingRetriever{}
	n, err := IndexDocs(context.Background(), r, fsys, "docs", "")
	if err != nil {
		t.Fatalf("IndexDocs: %v", err)
	}
	if n != 0 {
		t.Fatalf("want 0 indexed, got %d", n)
	}
}

func TestIndexDocs_ContextCancel(t *testing.T) {
	t.Parallel()
	fsys := fstest.MapFS{
		"docs/a.md": {Data: []byte(strings.Repeat("body\n\n", 100))},
		"docs/b.md": {Data: []byte("more")},
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // cancel before start
	r := &recordingRetriever{}
	_, err := IndexDocs(ctx, r, fsys, "docs", "")
	if err == nil {
		t.Fatal("want context error")
	}
}
