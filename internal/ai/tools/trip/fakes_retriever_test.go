// Phase-R / R6.14 — local fakeRetriever fixture for the trip subpackage.
//
// fakeRetriever is duplicated here from the parent internal/ai/tools
// package because the carve into bounded-context subpackages cannot
// import test-only fixtures across package boundaries. A future
// internal/ai/tools/toolstest exported fixture package (deferred per
// Lesson 6 R6.7) will eliminate this duplication.

package trip

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/ai/rag"
)

// fakeRetriever records every Retrieve call + returns canned chunks.
// Implements rag.Retriever; Index + Forget are no-ops because the
// tools never call them.
type fakeRetriever struct {
	subjects    []string
	queries     []string
	sourceTypes [][]string
	ks          []int
	out         []rag.Chunk
	err         error
}

func (f *fakeRetriever) Retrieve(_ context.Context, subject, query string, sourceTypes []string, k int) ([]rag.Chunk, error) {
	f.subjects = append(f.subjects, subject)
	f.queries = append(f.queries, query)
	dup := make([]string, len(sourceTypes))
	copy(dup, sourceTypes)
	f.sourceTypes = append(f.sourceTypes, dup)
	f.ks = append(f.ks, k)
	if f.err != nil {
		return nil, f.err
	}
	return f.out, nil
}

func (f *fakeRetriever) Index(_ context.Context, _, _, _ string, _ []string) error {
	return nil
}

func (f *fakeRetriever) Forget(_ context.Context, _, _, _ string) error { return nil }
