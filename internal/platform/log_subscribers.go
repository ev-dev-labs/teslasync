// Package platform — log_subscribers.go
//
// Phase-46 / Prompt 34 — Live log tail viewer.
//
// LogSubscriberRegistry is a fan-out tap that an SSE handler can attach
// to the global zerolog Logger so a web client can stream structured
// log events live. It implements both io.Writer and zerolog.LevelWriter
// so the same instance can be wired into a `zerolog.MultiLevelWriter`
// alongside the original stdout/stderr writer without losing per-event
// level information.
//
// The registry is concurrency-safe and non-blocking. Each subscriber
// owns a bounded channel; when its buffer fills the registry drops the
// event for that subscriber and increments a per-subscriber drop
// counter. The original writer (stdout/stderr) is unaffected — the tap
// never returns an error and never holds the writer's lock for the
// duration of a slow subscriber.
//
// This module deliberately knows nothing about HTTP. The SSE handler
// in internal/api owns the wire protocol; this package owns the
// pub/sub primitive.
package platform

import (
	"sync"
	"sync/atomic"

	"github.com/rs/zerolog"
)

// LogLevel is an alias for zerolog.Level so callers that import
// platform without zerolog still have a compact name to pass into
// Subscribe. The values mirror zerolog: -1 trace, 0 debug, 1 info,
// 2 warn, 3 error, 4 fatal, 5 panic, 6 no-level, 7 disabled.
type LogLevel = zerolog.Level

// Re-export the zerolog level constants under platform-local names so
// the SSE handler in internal/api can build subscriber filters
// without taking a direct dependency on zerolog.
const (
	LogLevelTrace    = zerolog.TraceLevel
	LogLevelDebug    = zerolog.DebugLevel
	LogLevelInfo     = zerolog.InfoLevel
	LogLevelWarn     = zerolog.WarnLevel
	LogLevelError    = zerolog.ErrorLevel
	LogLevelFatal    = zerolog.FatalLevel
	LogLevelPanic    = zerolog.PanicLevel
	LogLevelNoLevel  = zerolog.NoLevel
	LogLevelDisabled = zerolog.Disabled
)

// DefaultLogSubscriberBuffer is the capacity of each subscriber's
// channel. Picked so a 1 kHz log burst gives the SSE handler ~1s of
// headroom before drops start, which is enough for jitter between the
// hot path producing events and the goroutine writing them to the
// browser. Operators can tune via NewLogSubscriberRegistryWithCapacity.
const DefaultLogSubscriberBuffer = 1024

// LogEvent is one structured log entry handed to a subscriber. The
// Payload field is the raw JSON bytes that zerolog wrote — owned by
// the receiver after delivery (the registry copies the slice before
// fan-out so the original writer's buffer can be reused).
type LogEvent struct {
	Level   LogLevel
	Payload []byte
}

// LogSubscriber is the receive-side handle returned from Subscribe.
// The subscriber must drain Events promptly; events queue up to the
// configured buffer and are then dropped (Drops counter increments).
// Call Close exactly once when the consumer is finished — typically
// in a defer in the SSE handler.
//
// The events channel is intentionally NEVER closed by the registry.
// Closing it would race with in-flight fan-out sends from a snapshot
// taken before the close. Instead, Close removes the subscriber from
// the registry (so no NEW events arrive) and closes the Done channel
// so the consumer's select loop can exit. Once the consumer stops
// reading, any racing in-flight send will fill the buffer (incrementing
// Drops) without panicking.
type LogSubscriber struct {
	id        uint64
	minLevel  LogLevel
	events    chan LogEvent
	done      chan struct{}
	drops     atomic.Uint64
	closeOnce sync.Once
	registry  *LogSubscriberRegistry
}

// Events returns a receive-only channel of log events. The channel is
// NEVER closed by the registry — consumers should select on Done() to
// know when the subscriber has been torn down.
func (s *LogSubscriber) Events() <-chan LogEvent { return s.events }

// Done returns a channel that is closed when Close is called. Use this
// in the consumer's select loop to exit the read loop without racing
// the fan-out path.
func (s *LogSubscriber) Done() <-chan struct{} { return s.done }

// Drops returns the running count of events the registry could not
// deliver to this subscriber because its buffer was full. The SSE
// handler can surface this as a "you missed N events" notice.
func (s *LogSubscriber) Drops() uint64 { return s.drops.Load() }

// Close removes the subscriber from the registry and signals the
// consumer to exit. Safe to call multiple times. Does NOT close the
// events channel — see the type doc comment for why.
func (s *LogSubscriber) Close() {
	s.closeOnce.Do(func() {
		s.registry.remove(s.id)
		close(s.done)
	})
}

// LogSubscriberRegistry is the central pub/sub hub. Construct one per
// process at router-wire time; share it between the zerolog writer
// chain and the SSE handler.
type LogSubscriberRegistry struct {
	mu          sync.RWMutex
	bufferSize  int
	nextID      uint64
	subscribers map[uint64]*LogSubscriber
}

// NewLogSubscriberRegistry returns a registry sized for the default
// per-subscriber buffer. Most callers want this constructor; tests
// that need a tiny buffer to exercise drop semantics should use
// NewLogSubscriberRegistryWithCapacity.
func NewLogSubscriberRegistry() *LogSubscriberRegistry {
	return NewLogSubscriberRegistryWithCapacity(DefaultLogSubscriberBuffer)
}

// NewLogSubscriberRegistryWithCapacity returns a registry whose
// subscribers are created with channels of the given buffer size. A
// non-positive value falls back to DefaultLogSubscriberBuffer so
// misconfiguration cannot accidentally produce a zero-buffered
// channel that drops every event.
func NewLogSubscriberRegistryWithCapacity(bufferSize int) *LogSubscriberRegistry {
	if bufferSize <= 0 {
		bufferSize = DefaultLogSubscriberBuffer
	}
	return &LogSubscriberRegistry{
		bufferSize:  bufferSize,
		subscribers: make(map[uint64]*LogSubscriber),
	}
}

// Subscribe registers a new subscriber that receives every log event
// at or above minLevel. The returned subscriber MUST be closed when
// the consumer is finished or the registry will leak the entry.
func (r *LogSubscriberRegistry) Subscribe(minLevel LogLevel) *LogSubscriber {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.nextID++
	s := &LogSubscriber{
		id:       r.nextID,
		minLevel: minLevel,
		events:   make(chan LogEvent, r.bufferSize),
		done:     make(chan struct{}),
		registry: r,
	}
	r.subscribers[s.id] = s
	return s
}

// SubscriberCount returns the number of currently-registered
// subscribers. Useful for /metrics, tests, and the diagnostic page.
func (r *LogSubscriberRegistry) SubscriberCount() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.subscribers)
}

func (r *LogSubscriberRegistry) remove(id uint64) {
	r.mu.Lock()
	delete(r.subscribers, id)
	r.mu.Unlock()
}

// Write satisfies io.Writer. zerolog falls back to the plain writer
// path when the multi-level writer pipeline cannot determine an
// event's level (which happens for unleveled writes). We treat that
// case as LogLevelNoLevel so subscribers with a minimum level above
// "no level" still skip it.
func (r *LogSubscriberRegistry) Write(p []byte) (int, error) {
	r.fanout(LogLevelNoLevel, p)
	return len(p), nil
}

// WriteLevel satisfies zerolog.LevelWriter. The level argument is
// passed straight through to subscribers via LogEvent.Level so the
// SSE handler can render colour, badges, or filters on the wire-side
// without re-parsing the JSON.
func (r *LogSubscriberRegistry) WriteLevel(level zerolog.Level, p []byte) (int, error) {
	r.fanout(level, p)
	return len(p), nil
}

func (r *LogSubscriberRegistry) fanout(level LogLevel, p []byte) {
	r.mu.RLock()
	if len(r.subscribers) == 0 {
		r.mu.RUnlock()
		return
	}
	// Snapshot subscribers under the read lock so a slow consumer
	// cannot block other producers. We hold the lock only long
	// enough to copy the map; the actual sends happen lock-free.
	subs := make([]*LogSubscriber, 0, len(r.subscribers))
	for _, s := range r.subscribers {
		subs = append(subs, s)
	}
	r.mu.RUnlock()

	// Copy the bytes once: zerolog reuses its internal buffer for
	// the next event the moment Write returns, so we cannot share
	// the slice across goroutines / channels.
	payload := make([]byte, len(p))
	copy(payload, p)

	evt := LogEvent{Level: level, Payload: payload}
	for _, s := range subs {
		if level < s.minLevel {
			continue
		}
		select {
		case s.events <- evt:
		default:
			s.drops.Add(1)
		}
	}
}
