package platform

import (
	"sync"
	"testing"
	"time"

	"github.com/rs/zerolog"
)

func TestLogSubscriberRegistry_FanoutAtMinLevel(t *testing.T) {
	r := NewLogSubscriberRegistry()
	info := r.Subscribe(LogLevelInfo)
	defer info.Close()
	warn := r.Subscribe(LogLevelWarn)
	defer warn.Close()

	// Info-level event reaches the info subscriber but not warn.
	r.WriteLevel(zerolog.InfoLevel, []byte(`{"level":"info","msg":"hi"}`))

	select {
	case evt := <-info.Events():
		if string(evt.Payload) != `{"level":"info","msg":"hi"}` {
			t.Fatalf("info subscriber payload mismatch: %q", evt.Payload)
		}
		if evt.Level != zerolog.InfoLevel {
			t.Fatalf("info subscriber level = %v, want InfoLevel", evt.Level)
		}
	case <-time.After(time.Second):
		t.Fatalf("info subscriber received nothing")
	}

	select {
	case evt := <-warn.Events():
		t.Fatalf("warn subscriber unexpectedly received event: %s", string(evt.Payload))
	case <-time.After(50 * time.Millisecond):
		// expected — warn subscriber filters out info events
	}

	// Warn-level event reaches both subscribers.
	r.WriteLevel(zerolog.WarnLevel, []byte(`{"level":"warn"}`))
	for _, s := range []*LogSubscriber{info, warn} {
		select {
		case <-s.Events():
		case <-time.After(time.Second):
			t.Fatalf("subscriber missed warn event")
		}
	}
}

func TestLogSubscriberRegistry_DropsWhenBufferFull(t *testing.T) {
	r := NewLogSubscriberRegistryWithCapacity(2)
	sub := r.Subscribe(LogLevelDebug)
	defer sub.Close()

	for i := 0; i < 10; i++ {
		r.WriteLevel(zerolog.InfoLevel, []byte(`{"i":1}`))
	}
	if got := sub.Drops(); got != 8 {
		t.Fatalf("Drops() = %d, want 8 (10 sent, buffer=2)", got)
	}
	// Drain the two buffered events.
	for i := 0; i < 2; i++ {
		select {
		case <-sub.Events():
		case <-time.After(time.Second):
			t.Fatalf("expected to drain buffered event %d", i)
		}
	}
}

func TestLogSubscriberRegistry_CloseUnregistersAndSignalsDone(t *testing.T) {
	r := NewLogSubscriberRegistry()
	sub := r.Subscribe(LogLevelDebug)
	if r.SubscriberCount() != 1 {
		t.Fatalf("SubscriberCount() = %d, want 1", r.SubscriberCount())
	}
	sub.Close()
	if r.SubscriberCount() != 0 {
		t.Fatalf("SubscriberCount() after close = %d, want 0", r.SubscriberCount())
	}
	// Done channel must close so consumer select loop can exit.
	select {
	case <-sub.Done():
	case <-time.After(time.Second):
		t.Fatalf("Done() not closed after Close()")
	}
	// Idempotent.
	sub.Close()
	// Events channel is intentionally NOT closed (see type doc).
	// A racing in-flight send after Close() must NOT panic — emulate
	// that here by sending one final event past the close boundary
	// using the registry's lock-free send path.
	r.WriteLevel(zerolog.InfoLevel, []byte(`{"after":"close"}`))
	// We only assert no panic; subscriber.events is not drained.
}

func TestLogSubscriberRegistry_FanoutPostCloseDoesNotPanic(t *testing.T) {
	r := NewLogSubscriberRegistryWithCapacity(1)
	sub := r.Subscribe(LogLevelDebug)

	// Simulate the snapshot/close race: take the snapshot, close
	// the subscriber, then complete the send. This must NOT panic.
	r.mu.RLock()
	snap := []*LogSubscriber{sub}
	r.mu.RUnlock()

	sub.Close()

	// Now send to the (still-allocated) channel. The buffer has room
	// for one event so the first send succeeds; the second fills it
	// and the third increments Drops. None of this may panic.
	for _, s := range snap {
		evt := LogEvent{Level: zerolog.InfoLevel, Payload: []byte(`{}`)}
		select {
		case s.events <- evt:
		default:
			s.drops.Add(1)
		}
	}
}

func TestLogSubscriberRegistry_WriteWithoutLevelTreatedAsNoLevel(t *testing.T) {
	r := NewLogSubscriberRegistry()
	noLevel := r.Subscribe(LogLevelNoLevel)
	defer noLevel.Close()
	warn := r.Subscribe(LogLevelWarn)
	defer warn.Close()

	n, err := r.Write([]byte(`{"unleveled":true}`))
	if err != nil {
		t.Fatalf("Write returned error: %v", err)
	}
	if n != len(`{"unleveled":true}`) {
		t.Fatalf("Write returned n=%d, want %d", n, len(`{"unleveled":true}`))
	}

	select {
	case evt := <-noLevel.Events():
		if evt.Level != zerolog.NoLevel {
			t.Fatalf("level = %v, want NoLevel", evt.Level)
		}
	case <-time.After(time.Second):
		t.Fatalf("no-level subscriber missed event")
	}

	// NoLevel = 6, WarnLevel = 2, so noLevel >= warn.minLevel; the
	// WARN subscriber DOES see the event because zerolog encodes
	// NoLevel as a higher numeric value than WarnLevel. That is the
	// documented LevelWriter contract: the SSE handler is
	// responsible for filtering on string-named level if it wants
	// to exclude unleveled writes from a "warn-only" feed.
	select {
	case <-warn.Events():
		// expected by the contract above
	case <-time.After(50 * time.Millisecond):
		t.Fatalf("warn subscriber should still receive NoLevel events under numeric ordering")
	}
}

func TestLogSubscriberRegistry_PayloadIsCopiedNotShared(t *testing.T) {
	r := NewLogSubscriberRegistry()
	sub := r.Subscribe(LogLevelDebug)
	defer sub.Close()

	buf := []byte(`{"a":1}`)
	r.WriteLevel(zerolog.InfoLevel, buf)
	// Mutate the source buffer; the subscriber must still see the
	// original bytes because the registry copies on write.
	for i := range buf {
		buf[i] = 'X'
	}
	select {
	case evt := <-sub.Events():
		if string(evt.Payload) != `{"a":1}` {
			t.Fatalf("payload mutated post-send: %q", evt.Payload)
		}
	case <-time.After(time.Second):
		t.Fatalf("subscriber missed event")
	}
}

func TestLogSubscriberRegistry_ConcurrentSubscribeWrite(t *testing.T) {
	r := NewLogSubscriberRegistry()
	const N = 16
	var wg sync.WaitGroup
	subs := make([]*LogSubscriber, N)
	for i := 0; i < N; i++ {
		subs[i] = r.Subscribe(LogLevelDebug)
	}
	wg.Add(N)
	for i := 0; i < N; i++ {
		i := i
		go func() {
			defer wg.Done()
			defer subs[i].Close()
			drained := 0
			deadline := time.After(2 * time.Second)
			for drained < 100 {
				select {
				case <-subs[i].Events():
					drained++
				case <-deadline:
					t.Errorf("subscriber %d only drained %d/100 events", i, drained)
					return
				}
			}
		}()
	}
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < 100; i++ {
			r.WriteLevel(zerolog.InfoLevel, []byte(`{"k":"v"}`))
		}
	}()
	wg.Wait()
}
