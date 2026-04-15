package export

import (
	"context"
	"errors"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/domain/fsm"
)

func TestExportFSM_ValidTransitions(t *testing.T) {
	def := NewExportFSM()
	engine := fsm.NewEngine[*ExportJob](def)
	ctx := context.Background()
	job := &ExportJob{ID: "e1"}

	tests := []struct {
		name  string
		from  fsm.State
		event fsm.Event
		want  fsm.State
	}{
		{"queued → validating", StateQueued, EventValidate, StateValidating},
		{"validating → processing", StateValidating, EventProcess, StateProcessing},
		{"processing → uploading", StateProcessing, EventUpload, StateUploading},
		{"uploading → completed", StateUploading, EventComplete, StateCompleted},
		{"queued → failed", StateQueued, EventFail, StateFailed},
		{"validating → failed", StateValidating, EventFail, StateFailed},
		{"processing → failed", StateProcessing, EventFail, StateFailed},
		{"uploading → failed", StateUploading, EventFail, StateFailed},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := engine.Fire(ctx, job, tt.from, tt.event)
			if err != nil {
				t.Fatalf("Fire() error: %v", err)
			}
			if got != tt.want {
				t.Errorf("Fire() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestExportFSM_InvalidTransitions(t *testing.T) {
	def := NewExportFSM()
	engine := fsm.NewEngine[*ExportJob](def)
	ctx := context.Background()
	job := &ExportJob{ID: "e1"}

	tests := []struct {
		name  string
		from  fsm.State
		event fsm.Event
	}{
		{"completed cannot fail", StateCompleted, EventFail},
		{"failed cannot complete", StateFailed, EventComplete},
		{"queued cannot complete", StateQueued, EventComplete},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := engine.Fire(ctx, job, tt.from, tt.event)
			if !errors.Is(err, fsm.ErrInvalidTransition) {
				t.Errorf("expected ErrInvalidTransition, got: %v", err)
			}
		})
	}
}
