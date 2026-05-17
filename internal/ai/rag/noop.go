package rag

import "context"

// NoopRetriever is the off-mode implementation of [Retriever]. Every
// method validates its inputs (so callers see consistent errors
// across modes) and otherwise does nothing — no embedding call, no
// SQL, no row written.
//
// This is the type-system gate for ADR-015 §I4 (zero outbound egress)
// and §I1 (default-off): a feature handler that forgot to gate its
// RAG call cannot leak data because the factory ([New]) returns this
// type whenever ai_mode='off'.
//
// The struct is empty by design — it has no state to leak between
// calls and is safe to share across goroutines.
type NoopRetriever struct{}

// Retrieve is a no-op that returns (nil, nil) for valid arguments.
// Invalid arguments still produce the same errors the production
// path returns, so a buggy caller cannot hide its bug behind off
// mode.
func (NoopRetriever) Retrieve(_ context.Context, _, query string, _ []string, k int) ([]Chunk, error) {
	if err := validateRetrieveArgs(query, k); err != nil {
		return nil, err
	}
	return nil, nil
}

// Index is a no-op that returns nil for valid arguments. The
// off-mode AI-Off Contract (§I4) requires that NO row land in either
// embeddings table when ai_mode='off' — this method is the contract
// holder.
func (NoopRetriever) Index(_ context.Context, _, sourceType, sourceID string, chunks []string) error {
	if err := validateIndexArgs(sourceType, sourceID, chunks); err != nil {
		return err
	}
	return nil
}

// Forget is a no-op that returns nil for valid arguments. Symmetric
// with Index: nothing was written, so there is nothing to delete.
func (NoopRetriever) Forget(_ context.Context, _, sourceType, sourceID string) error {
	return validateForgetArgs(sourceType, sourceID)
}

// Compile-time assertion the no-op satisfies the interface so a
// future signature change forces an update here too.
var _ Retriever = NoopRetriever{}
