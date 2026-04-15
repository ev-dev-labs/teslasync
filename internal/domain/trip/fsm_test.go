package trip

import (
	"context"
	"errors"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/domain/fsm"
)

func TestTripFSM_ValidTransitions(t *testing.T) {
	def := NewTripFSM()
	engine := fsm.NewEngine[*Trip](def)
	ctx := context.Background()
	tr := &Trip{ID: "t1"}

	tests := []struct {
		name  string
		from  fsm.State
		event fsm.Event
		want  fsm.State
	}{
		{"started → in_progress", StateStarted, EventBegin, StateInProgress},
		{"in_progress → paused", StateInProgress, EventPause, StatePaused},
		{"in_progress → completed", StateInProgress, EventComplete, StateCompleted},
		{"in_progress → cancelled", StateInProgress, EventCancel, StateCancelled},
		{"paused → in_progress", StatePaused, EventResume, StateInProgress},
		{"paused → cancelled", StatePaused, EventCancel, StateCancelled},
		{"started → cancelled", StateStarted, EventCancel, StateCancelled},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := engine.Fire(ctx, tr, tt.from, tt.event)
			if err != nil {
				t.Fatalf("Fire() error: %v", err)
			}
			if got != tt.want {
				t.Errorf("Fire() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestTripFSM_InvalidTransitions(t *testing.T) {
	def := NewTripFSM()
	engine := fsm.NewEngine[*Trip](def)
	ctx := context.Background()
	tr := &Trip{ID: "t1"}

	tests := []struct {
		name  string
		from  fsm.State
		event fsm.Event
	}{
		{"completed cannot resume", StateCompleted, EventResume},
		{"cancelled cannot begin", StateCancelled, EventBegin},
		{"started cannot complete", StateStarted, EventComplete},
		{"paused cannot complete", StatePaused, EventComplete},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := engine.Fire(ctx, tr, tt.from, tt.event)
			if !errors.Is(err, fsm.ErrInvalidTransition) {
				t.Errorf("expected ErrInvalidTransition, got: %v", err)
			}
		})
	}
}
