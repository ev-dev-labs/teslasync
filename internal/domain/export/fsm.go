package export

import "github.com/ev-dev-labs/teslasync/internal/domain/fsm"

// Export job FSM states.
const (
	StateQueued     fsm.State = "queued"
	StateValidating fsm.State = "validating"
	StateProcessing fsm.State = "processing"
	StateUploading  fsm.State = "uploading"
	StateCompleted  fsm.State = "completed"
	StateFailed     fsm.State = "failed"
)

// Export job FSM events.
const (
	EventValidate fsm.Event = "validate"
	EventProcess  fsm.Event = "process"
	EventUpload   fsm.Event = "upload"
	EventComplete fsm.Event = "complete"
	EventFail     fsm.Event = "fail"
)

// NewExportFSM creates the export job state machine definition.
func NewExportFSM() *fsm.Definition {
	return fsm.NewDefinition("export_job").
		InitialState(StateQueued).
		Transition(StateQueued, EventValidate, StateValidating).
		Transition(StateValidating, EventProcess, StateProcessing).
		Transition(StateProcessing, EventUpload, StateUploading).
		Transition(StateUploading, EventComplete, StateCompleted).
		// Failure from any active state
		Transition(StateQueued, EventFail, StateFailed).
		Transition(StateValidating, EventFail, StateFailed).
		Transition(StateProcessing, EventFail, StateFailed).
		Transition(StateUploading, EventFail, StateFailed).
		Build()
}
