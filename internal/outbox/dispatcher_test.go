package outbox

import (
	"context"
	"errors"
	"testing"
	"time"
)

// recorderPublisher implements Publisher for unit tests; records every
// PublishOutbox call and returns the err sequence in order.
type recorderPublisher struct {
	calls []Row
	errs  []error
	i     int
}

func (r *recorderPublisher) PublishOutbox(_ context.Context, row Row) error {
	r.calls = append(r.calls, row)
	if r.i >= len(r.errs) {
		return nil
	}
	err := r.errs[r.i]
	r.i++
	return err
}

func TestBackoff_DoublingCappedAtMax(t *testing.T) {
	base := 100 * time.Millisecond
	max := 1 * time.Second
	cases := []struct {
		attempts int
		want     time.Duration
	}{
		{0, 100 * time.Millisecond},
		{1, 200 * time.Millisecond},
		{2, 400 * time.Millisecond},
		{3, 800 * time.Millisecond},
		{4, 1 * time.Second}, // capped
		{10, 1 * time.Second},
		{-1, 100 * time.Millisecond},
		{50, 1 * time.Second}, // exponent capped, then duration capped
	}
	for _, tc := range cases {
		got := Backoff(tc.attempts, base, max)
		if got != tc.want {
			t.Errorf("Backoff(%d) = %s, want %s", tc.attempts, got, tc.want)
		}
	}
}

func TestIsTerminal_BoundaryConditions(t *testing.T) {
	cases := []struct {
		attempts int
		max      int
		want     bool
	}{
		{0, 10, false},
		{8, 10, false},
		{9, 10, true},  // attempt 10 is the last
		{10, 10, true}, // already at cap
		{0, 1, true},   // single-attempt rows are immediately terminal
	}
	for _, tc := range cases {
		got := isTerminal(Row{Attempts: tc.attempts}, tc.max)
		if got != tc.want {
			t.Errorf("isTerminal(attempts=%d, max=%d) = %v, want %v",
				tc.attempts, tc.max, got, tc.want)
		}
	}
}

func TestTruncateError_LongStrings(t *testing.T) {
	long := make([]byte, 5000)
	for i := range long {
		long[i] = 'x'
	}
	err := errors.New(string(long))
	got := truncateError(err)
	if len(got) == 0 || len(got) > 1100 {
		t.Fatalf("truncateError did not clip: len=%d", len(got))
	}
	if got[len(got)-len("...[truncated]"):] != "...[truncated]" {
		t.Fatalf("truncateError did not add marker, got %q", got[len(got)-20:])
	}
}

func TestTruncateError_NilAndShort(t *testing.T) {
	if got := truncateError(nil); got != "" {
		t.Errorf("nil error → %q, want empty", got)
	}
	if got := truncateError(errors.New("boom")); got != "boom" {
		t.Errorf("short error mangled, got %q", got)
	}
}

func TestNewDispatcher_NilSafety(t *testing.T) {
	if NewDispatcher(nil, nil, DispatcherConfig{}) != nil {
		t.Error("expected nil dispatcher when store+publisher both nil")
	}
	if NewDispatcher(nil, &recorderPublisher{}, DispatcherConfig{}) != nil {
		t.Error("expected nil dispatcher when store nil")
	}
	if NewDispatcher(&Store{}, nil, DispatcherConfig{}) != nil {
		t.Error("expected nil dispatcher when publisher nil")
	}
}

func TestNewDispatcher_DefaultsApplied(t *testing.T) {
	d := NewDispatcher(&Store{pool: nil}, &recorderPublisher{}, DispatcherConfig{})
	if d == nil {
		t.Fatal("dispatcher was nil despite non-nil store+publisher")
	}
	if d.cfg.PollInterval != 2*time.Second {
		t.Errorf("PollInterval default = %s, want 2s", d.cfg.PollInterval)
	}
	if d.cfg.BatchSize != 50 {
		t.Errorf("BatchSize default = %d, want 50", d.cfg.BatchSize)
	}
	if d.cfg.MaxAttempts != 10 {
		t.Errorf("MaxAttempts default = %d, want 10", d.cfg.MaxAttempts)
	}
	if d.cfg.LeaseDuration != 30*time.Second {
		t.Errorf("LeaseDuration default = %s, want 30s", d.cfg.LeaseDuration)
	}
}

func TestNewDispatcher_BatchSizeCapped(t *testing.T) {
	d := NewDispatcher(&Store{pool: nil}, &recorderPublisher{},
		DispatcherConfig{BatchSize: 9999})
	if d.cfg.BatchSize != 500 {
		t.Errorf("BatchSize not capped: got %d, want 500", d.cfg.BatchSize)
	}
}

func TestDispatcher_DoneOnNilSafe(t *testing.T) {
	var d *Dispatcher
	select {
	case <-d.Done():
		// expected: closed channel returned for nil dispatcher
	case <-time.After(100 * time.Millisecond):
		t.Error("Done on nil dispatcher should return closed channel")
	}
}

func TestRunOnce_NilDispatcher(t *testing.T) {
	var d *Dispatcher
	_, _, _, err := d.RunOnce(context.Background())
	if err == nil {
		t.Error("expected error from RunOnce on nil dispatcher")
	}
}

func TestStoreAppend_NilStore(t *testing.T) {
	var s *Store
	_, err := s.Append(context.Background(), nil, Event{Type: "x"})
	if !errors.Is(err, ErrNoPool) {
		t.Errorf("want ErrNoPool, got %v", err)
	}
}

func TestStoreAppend_EmptyType(t *testing.T) {
	s := &Store{pool: nil}
	_, err := s.Append(context.Background(), nil, Event{Type: ""})
	if err == nil {
		t.Error("want error for empty Type")
	}
}

func TestMQTTBusPublisher_NilClient(t *testing.T) {
	if NewMQTTBusPublisher(nil) != nil {
		t.Error("expected nil MQTTBusPublisher for nil client")
	}
	var p *MQTTBusPublisher
	if err := p.PublishOutbox(context.Background(), Row{}); !errors.Is(err, ErrBrokerDisconnected) {
		t.Errorf("want ErrBrokerDisconnected, got %v", err)
	}
}
