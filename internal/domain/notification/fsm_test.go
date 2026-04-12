package notification

import (
	"context"
	"errors"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/domain/fsm"
)

func TestNotificationFSM_ValidTransitions(t *testing.T) {
	def := NewNotificationFSM()
	engine := fsm.NewEngine[*Notification](def)
	ctx := context.Background()
	n := &Notification{ID: "n1"}

	tests := []struct {
		name  string
		from  fsm.State
		event fsm.Event
		want  fsm.State
	}{
		{"pending → sending", StatePending, EventSend, StateSending},
		{"sending → sent", StateSending, EventConfirm, StateSent},
		{"sending → failed", StateSending, EventFail, StateFailed},
		{"failed → retrying", StateFailed, EventRetry, StateRetrying},
		{"retrying → sending", StateRetrying, EventSend, StateSending},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := engine.Fire(ctx, n, tt.from, tt.event)
			if err != nil {
				t.Fatalf("Fire() error: %v", err)
			}
			if got != tt.want {
				t.Errorf("Fire() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestNotificationFSM_InvalidTransitions(t *testing.T) {
	def := NewNotificationFSM()
	engine := fsm.NewEngine[*Notification](def)
	ctx := context.Background()
	n := &Notification{ID: "n1"}

	tests := []struct {
		name  string
		from  fsm.State
		event fsm.Event
	}{
		{"sent cannot retry", StateSent, EventRetry},
		{"pending cannot confirm", StatePending, EventConfirm},
		{"sent cannot fail", StateSent, EventFail},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := engine.Fire(ctx, n, tt.from, tt.event)
			if !errors.Is(err, fsm.ErrInvalidTransition) {
				t.Errorf("expected ErrInvalidTransition, got: %v", err)
			}
		})
	}
}
