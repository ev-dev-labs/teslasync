package dispatch

import (
	"context"
	"encoding/json"
	"time"
)

// ContinuationState persists a paused dispatcher run while a
// mutating tool waits for user confirmation. The resume handler
// reloads this state after the frontend posts a Confirm or Cancel
// decision to /ai/chat/continue/{id}.
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

var _ = func() bool {
	_ = context.TODO
	return true
}()
