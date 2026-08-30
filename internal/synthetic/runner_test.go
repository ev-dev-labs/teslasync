package synthetic

import (
	"context"
	"errors"
	"testing"
	"time"
)

type stubProbe struct {
	name string
	err  error
	dur  time.Duration
}

func (s *stubProbe) Name() string { return s.name }
func (s *stubProbe) Run(_ context.Context) error {
	if s.dur > 0 {
		time.Sleep(s.dur)
	}
	return s.err
}

func TestRunner_RecordsSuccessAndFailureStreaks(t *testing.T) {
	t.Parallel()
	probe := &stubProbe{name: "test"}
	r := NewRunner([]Probe{probe}, time.Hour, time.Second)
	r.runAll(context.Background())
	snap := r.Snapshot()
	if len(snap.Results) != 1 || !snap.Results[0].OK || snap.Results[0].Streak != 1 {
		t.Fatalf("expected first success streak=1, got %+v", snap.Results)
	}

	probe.err = errors.New("boom")
	r.runAll(context.Background())
	snap = r.Snapshot()
	if snap.Results[0].OK {
		t.Fatal("expected probe failure")
	}
	if snap.Results[0].Streak != -1 {
		t.Fatalf("expected streak=-1 after first failure, got %d", snap.Results[0].Streak)
	}
	if snap.Results[0].LastError != "boom" {
		t.Fatalf("expected error message, got %q", snap.Results[0].LastError)
	}

	r.runAll(context.Background())
	snap = r.Snapshot()
	if snap.Results[0].Streak != -2 {
		t.Fatalf("expected streak=-2 after second failure, got %d", snap.Results[0].Streak)
	}

	probe.err = nil
	r.runAll(context.Background())
	snap = r.Snapshot()
	if snap.Results[0].Streak != 1 {
		t.Fatalf("expected streak reset to 1 after recovery, got %d", snap.Results[0].Streak)
	}
}

func TestRunner_PerProbeTimeoutDoesNotBlockOthers(t *testing.T) {
	t.Parallel()
	probes := []Probe{
		&stubProbe{name: "fast"},
		&stubProbe{name: "slow", dur: 200 * time.Millisecond}, // < timeout below
	}
	r := NewRunner(probes, time.Hour, 500*time.Millisecond)
	start := time.Now()
	r.runAll(context.Background())
	elapsed := time.Since(start)
	if elapsed > 1*time.Second {
		t.Fatalf("runAll took too long: %v", elapsed)
	}
	snap := r.Snapshot()
	if len(snap.Results) != 2 {
		t.Fatalf("expected 2 results, got %d", len(snap.Results))
	}
}

func TestHTTPProbe_RejectsEmptyURL(t *testing.T) {
	t.Parallel()
	p := NewHTTPProbe("test", "")
	if err := p.Run(context.Background()); err == nil {
		t.Fatal("expected error for empty url")
	}
}

func TestRunner_StopBeforeStartIsSafeAndIdempotent(t *testing.T) {
	t.Parallel()
	r := NewRunner(nil, time.Hour, time.Second)
	done := make(chan struct{})
	go func() {
		r.Stop()
		r.Stop()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("Stop blocked when Runner had not started")
	}
	r.Start(context.Background())
}
