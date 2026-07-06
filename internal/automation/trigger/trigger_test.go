package trigger

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"sync"
	"testing"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

// TestMain redirects the package's structured logs to io.Discard so tests
// exercise the logging code paths (field building, levels) without polluting
// the gate output, while keeping events enabled.
func TestMain(m *testing.M) {
	log.Logger = zerolog.New(io.Discard)
	os.Exit(m.Run())
}

// engineCall records a single invocation of the fake engine.
type engineCall struct {
	automationID int64
	snapshot     json.RawMessage
}

// fakeEngine is a race-safe AutomationEngine test double. It records every
// call and can be programmed to fail globally or per automation ID.
type fakeEngine struct {
	mu      sync.Mutex
	calls   []engineCall
	err     error
	errByID map[int64]error
}

func (f *fakeEngine) Evaluate(_ context.Context, automationID int64, snapshot json.RawMessage) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	// Copy the snapshot so later reuse of the caller's buffer can't mutate it.
	snapCopy := append(json.RawMessage(nil), snapshot...)
	f.calls = append(f.calls, engineCall{automationID: automationID, snapshot: snapCopy})
	if f.errByID != nil {
		if e, ok := f.errByID[automationID]; ok {
			return e
		}
	}
	return f.err
}

func (f *fakeEngine) callCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.calls)
}

func (f *fakeEngine) callsCopy() []engineCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]engineCall, len(f.calls))
	copy(out, f.calls)
	return out
}

// lastCall returns the most recent recorded call and whether one exists.
func (f *fakeEngine) lastCall() (engineCall, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.calls) == 0 {
		return engineCall{}, false
	}
	return f.calls[len(f.calls)-1], true
}
