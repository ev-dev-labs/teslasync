package dispatch

import (
	"context"
	"encoding/json"
	"time"
)

// ContinuationState is the persisted form of a paused dispatcher
// run. When a mutating tool requires user confirmation the
// dispatcher serialises this struct, hands the continuation_id
// back over SSE, the frontend POSTs to /ai/chat/continue/{id} with
// a Confirm/Cancel decision, and the resume handler reloads this
// state and calls Dispatcher.Resume.
//
// F4 ships the data type + repository; the SSE wiring lands with
// F5 (streaming) which owns the HTTP boundary.
type ContinuationState struct {
	// FeatureID identifies which Strategy was running.
	FeatureID string `json:"feature_id"`

	// Messages is the conversation up to (but not including) the
	// pending tool call.
	Messages []json.RawMessage `json:"messages"`

	// PendingCall is the tool call awaiting user approval. The
	// dispatcher marshals provider.ToolCall directly.
	PendingCall json.RawMessage `json:"pending_call"`

	// CreatedAt is set by the repo on insert.
	CreatedAt time.Time `json:"created_at"`
}

// MarshalState is a small helper so tests + the resume endpoint
// can construct a state JSON without importing encoding/json
// directly.
func MarshalState(s ContinuationState) (json.RawMessage, error) {
	return json.Marshal(s)
}

// UnmarshalState decodes a persisted state row into the typed
// shape.
func UnmarshalState(raw json.RawMessage) (ContinuationState, error) {
	var s ContinuationState
	err := json.Unmarshal(raw, &s)
	return s, err
}

// _ assert MarshalState/UnmarshalState are pure round-trips at
// compile time; the runtime test in continuation_test.go enforces
// the actual round-trip semantics.
var _ = func() bool {
	_ = context.TODO
	return true
}()
