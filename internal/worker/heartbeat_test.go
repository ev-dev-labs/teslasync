package worker

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// recordingStore captures every RecordHeartbeat call for assertion.
type recordingStore struct {
	mu      sync.Mutex
	calls   []database.WorkerHeartbeat
	failErr error
}

func (s *recordingStore) RecordHeartbeat(_ context.Context, hb database.WorkerHeartbeat) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls = append(s.calls, hb)
	return s.failErr
}

func (s *recordingStore) GetMany(_ context.Context, _ []string) (map[string]*database.WorkerHeartbeat, error) {
	return nil, nil
}

func (s *recordingStore) snapshot() []database.WorkerHeartbeat {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]database.WorkerHeartbeat, len(s.calls))
	copy(out, s.calls)
	return out
}

func TestNewHeartbeater_NilStore(t *testing.T) {
	if hb := NewHeartbeater(nil, HeartbeaterOptions{Worker: database.WorkerNameNotification}); hb != nil {
		t.Fatalf("expected nil heartbeater when store is nil, got %#v", hb)
	}
}

func TestNewHeartbeater_EmptyWorker(t *testing.T) {
	store := &recordingStore{}
	if hb := NewHeartbeater(store, HeartbeaterOptions{}); hb != nil {
		t.Fatalf("expected nil heartbeater when worker name is empty, got %#v", hb)
	}
}

func TestNewHeartbeater_DefaultsApplied(t *testing.T) {
	store := &recordingStore{}
	hb := NewHeartbeater(store, HeartbeaterOptions{Worker: database.WorkerNameExport})
	if hb == nil {
		t.Fatal("expected non-nil heartbeater")
	}
	if hb.interval != DefaultHeartbeatInterval {
		t.Errorf("interval = %v, want %v", hb.interval, DefaultHeartbeatInterval)
	}
	if hb.writeTimeout != DefaultHeartbeatInterval/2 {
		t.Errorf("writeTimeout = %v, want %v", hb.writeTimeout, DefaultHeartbeatInterval/2)
	}
	if hb.now == nil {
		t.Error("expected non-nil now func")
	}
}

func TestHeartbeater_WriteRecordsHeartbeat(t *testing.T) {
	store := &recordingStore{}
	frozen := time.Date(2026, 5, 5, 12, 0, 0, 0, time.UTC)
	hb := NewHeartbeater(store, HeartbeaterOptions{
		Worker:   database.WorkerNameAutomation,
		Version:  "test-1.2.3",
		Hostname: "fake-host",
		Now:      func() time.Time { return frozen },
	})

	hb.write(context.Background(), frozen)

	calls := store.snapshot()
	if len(calls) != 1 {
		t.Fatalf("expected 1 RecordHeartbeat call, got %d", len(calls))
	}
	got := calls[0]
	if got.Worker != database.WorkerNameAutomation {
		t.Errorf("worker = %q, want %q", got.Worker, database.WorkerNameAutomation)
	}
	if got.Version != "test-1.2.3" {
		t.Errorf("version = %q, want test-1.2.3", got.Version)
	}
	if got.Host != "fake-host" {
		t.Errorf("host = %q, want fake-host", got.Host)
	}
	if !got.LastHeartbeatAt.Equal(frozen) {
		t.Errorf("LastHeartbeatAt = %v, want %v", got.LastHeartbeatAt, frozen)
	}
	if !got.StartedAt.Equal(frozen) {
		t.Errorf("StartedAt = %v, want %v", got.StartedAt, frozen)
	}
}

func TestHeartbeater_WriteSwallowsError(t *testing.T) {
	store := &recordingStore{failErr: errors.New("redis down")}
	hb := NewHeartbeater(store, HeartbeaterOptions{Worker: database.WorkerNameNotification})

	// Must not panic / return an error — heartbeat path is best-effort.
	hb.write(context.Background(), time.Now())

	if len(store.snapshot()) != 1 {
		t.Fatal("expected exactly one RecordHeartbeat attempt")
	}
}

func TestHeartbeater_StartTicks(t *testing.T) {
	store := &recordingStore{}
	hb := NewHeartbeater(store, HeartbeaterOptions{
		Worker:   database.WorkerNameNotification,
		Interval: 10 * time.Millisecond,
	})
	if hb == nil {
		t.Fatal("expected non-nil heartbeater")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Millisecond)
	defer cancel()

	done := make(chan struct{})
	go func() {
		hb.Start(ctx)
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(500 * time.Millisecond):
		t.Fatal("Start did not return after ctx cancel")
	}

	// First heartbeat fires immediately, then at least 1-2 more
	// at the 10ms tick. Floor at 2 keeps the test stable on slow
	// CI runners.
	if got := len(store.snapshot()); got < 2 {
		t.Errorf("expected ≥2 heartbeats, got %d", got)
	}
}

func TestHeartbeater_StartReturnsForNil(t *testing.T) {
	var hb *Heartbeater
	// Should not panic.
	hb.Start(context.Background())
}
