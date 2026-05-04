package mqtt

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/rs/zerolog"

	"github.com/ev-dev-labs/teslasync/internal/config"
)

func TestMQTTConfigBrokerURL(t *testing.T) {
	cfg := config.MQTTConfig{
		Host: "localhost",
		Port: 1883,
	}

	url := cfg.BrokerURL()
	want := "tcp://localhost:1883"
	if url != want {
		t.Errorf("BrokerURL() = %q, want %q", url, want)
	}
}

func TestMQTTConfigBrokerURLCustom(t *testing.T) {
	cfg := config.MQTTConfig{
		Host: "mqtt.example.com",
		Port: 8883,
	}

	url := cfg.BrokerURL()
	want := "tcp://mqtt.example.com:8883"
	if url != want {
		t.Errorf("BrokerURL() = %q, want %q", url, want)
	}
}

func TestMQTTTopicPrefixFormatting(t *testing.T) {
	// The Client uses prefix + "/" + topic for publishing.
	// Test the expected format construction.
	prefix := "teslasync"
	topic := "VIN123/state"
	fullTopic := prefix + "/" + topic

	want := "teslasync/VIN123/state"
	if fullTopic != want {
		t.Errorf("topic = %q, want %q", fullTopic, want)
	}
}

func TestMQTTVehicleDataTopicFormat(t *testing.T) {
	vin := "5YJ3E1EA1LF000001"
	topics := []struct {
		suffix string
		want   string
	}{
		{"state", "5YJ3E1EA1LF000001/state"},
		{"battery_level", "5YJ3E1EA1LF000001/battery_level"},
		{"latitude", "5YJ3E1EA1LF000001/latitude"},
		{"longitude", "5YJ3E1EA1LF000001/longitude"},
		{"is_climate_on", "5YJ3E1EA1LF000001/is_climate_on"},
		{"software_update/version", "5YJ3E1EA1LF000001/software_update/version"},
	}

	for _, tt := range topics {
		t.Run(tt.suffix, func(t *testing.T) {
			got := vin + "/" + tt.suffix
			if got != tt.want {
				t.Errorf("topic = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestMQTTDisabledConfig(t *testing.T) {
	cfg := config.MQTTConfig{
		Enabled: false,
		Host:    "localhost",
		Port:    1883,
	}

	if cfg.Enabled {
		t.Error("MQTT should be disabled")
	}

	// BrokerURL still works even when disabled
	url := cfg.BrokerURL()
	if url != "tcp://localhost:1883" {
		t.Errorf("BrokerURL() = %q, even when disabled should return proper URL", url)
	}
}

func TestNilClientSafety(t *testing.T) {
	// When MQTT is disabled, the mqtt client pointer is nil.
	// The worker checks `if w.mqttClient == nil { return }`.
	// This test documents that a nil *Client should not be used directly.
	var c *Client
	if c != nil {
		t.Error("nil Client should be nil")
	}
}

// =============================================================================
// Phase-42 PipelineSubscriber tests (prompt 0060)
// =============================================================================

// fakePipeline is a recording stub of the Pipeline interface. It returns the
// queued errors in order; once exhausted it returns the last queued error
// (or nil if no errors were queued).
type fakePipeline struct {
	mu        sync.Mutex
	errs      []error
	calls     []fakePipelineCall
	callCount atomic.Int64
}

type fakePipelineCall struct {
	Payload   []byte
	VehicleID int64
}

func (f *fakePipeline) Process(_ context.Context, payload []byte, vehicleID int64) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	// Copy payload so test assertions are stable even if caller reuses the slice.
	cp := make([]byte, len(payload))
	copy(cp, payload)
	f.calls = append(f.calls, fakePipelineCall{Payload: cp, VehicleID: vehicleID})
	f.callCount.Add(1)
	if len(f.errs) == 0 {
		return nil
	}
	err := f.errs[0]
	if len(f.errs) > 1 {
		f.errs = f.errs[1:]
	} else {
		f.errs = nil
	}
	return err
}

func (f *fakePipeline) Calls() []fakePipelineCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]fakePipelineCall, len(f.calls))
	copy(out, f.calls)
	return out
}

// fakeDLQ is a recording stub of DLQPublisher with a configurable failure
// queue (returns an error per call until exhausted).
type fakeDLQ struct {
	mu      sync.Mutex
	failNext []error
	entries  []DLQEntry
}

func (f *fakeDLQ) Publish(_ context.Context, entry DLQEntry) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.entries = append(f.entries, entry)
	if len(f.failNext) == 0 {
		return nil
	}
	err := f.failNext[0]
	f.failNext = f.failNext[1:]
	return err
}

func (f *fakeDLQ) Entries() []DLQEntry {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]DLQEntry, len(f.entries))
	copy(out, f.entries)
	return out
}

// newTestSubscriber builds a PipelineSubscriber wired against fakes for the
// per-test scenarios. The paho.Client field is intentionally nil because the
// tests drive handlePayload directly without going through Start/Subscribe.
func newTestSubscriber(t *testing.T, pipeline Pipeline, dlq DLQPublisher, resolver VINResolver) *PipelineSubscriber {
	t.Helper()
	cfg := PipelineSubscriberConfig{
		TopicBase:       "telemetry",
		MaxRedeliveries: 3,
		TrackerCapacity: 16,
	}
	cfg.withDefaults()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	return &PipelineSubscriber{
		client:     nil,
		pipeline:   pipeline,
		dlq:        dlq,
		tracker:    NewRedeliveryTracker(cfg.TrackerCapacity),
		resolveVIN: resolver,
		cfg:        cfg,
		logger:     zerolog.New(zerolog.NewTestWriter(t)),
		ctx:        ctx,
		cancel:     cancel,
	}
}

func staticResolver(id int64) VINResolver {
	return func(_ context.Context, _ string) (int64, error) { return id, nil }
}

// TestPipelineSubscriber_ValidPayload_DelegatesToPipeline asserts that a
// well-formed payload is forwarded byte-identical to Pipeline.Process and the
// message is acked exactly once.
func TestPipelineSubscriber_ValidPayload_DelegatesToPipeline(t *testing.T) {
	pipe := &fakePipeline{}
	dlq := &fakeDLQ{}
	sub := newTestSubscriber(t, pipe, dlq, staticResolver(42))

	var ackCalls atomic.Int32
	payload := []byte{0x01, 0x02, 0x03, 0xff, 0x00, 0xaa}

	sub.handlePayload(context.Background(), mqttPayload{
		Topic:     "telemetry/payload/5YJ3E1EA1LF000001",
		Payload:   payload,
		MessageID: 42,
		Ack:       func() { ackCalls.Add(1) },
	})

	calls := pipe.Calls()
	if len(calls) != 1 {
		t.Fatalf("Pipeline.Process called %d times, want 1", len(calls))
	}
	if !bytesEq(calls[0].Payload, payload) {
		t.Errorf("payload mismatch: got %v want %v", calls[0].Payload, payload)
	}
	if calls[0].VehicleID != 42 {
		t.Errorf("vehicleID = %d, want 42", calls[0].VehicleID)
	}
	if got := ackCalls.Load(); got != 1 {
		t.Errorf("ack called %d times, want 1", got)
	}
	if got := len(dlq.Entries()); got != 0 {
		t.Errorf("DLQ entries = %d, want 0", got)
	}
}

// TestPipelineSubscriber_TransientCodecError_NoAck_IncrementsRedeliveries
// asserts that an ErrPayloadDrop below MaxRedeliveries does NOT ack and the
// tracker count grows with each redelivery.
func TestPipelineSubscriber_TransientCodecError_NoAck_IncrementsRedeliveries(t *testing.T) {
	prev := PayloadDropSentinel()
	t.Cleanup(func() { SetPayloadDropSentinel(prev) })
	customDrop := errors.New("test: codec drop")
	SetPayloadDropSentinel(customDrop)

	pipe := &fakePipeline{errs: []error{customDrop, customDrop}}
	dlq := &fakeDLQ{}
	sub := newTestSubscriber(t, pipe, dlq, staticResolver(7))

	var ackCalls atomic.Int32
	deliver := func() {
		sub.handlePayload(context.Background(), mqttPayload{
			Topic:     "telemetry/payload/5YJ3E1EA1LF000007",
			Payload:   []byte("garbage"),
			MessageID: 1234,
			Ack:       func() { ackCalls.Add(1) },
		})
	}

	deliver()
	if got := sub.tracker.Len(); got != 1 {
		t.Fatalf("tracker.Len() = %d after first redeliver, want 1", got)
	}
	deliver()
	if got := sub.tracker.Len(); got != 1 {
		t.Fatalf("tracker.Len() = %d after second redeliver (same MessageID), want 1", got)
	}

	if got := ackCalls.Load(); got != 0 {
		t.Errorf("ack called %d times during transient redeliveries, want 0", got)
	}
	if got := len(dlq.Entries()); got != 0 {
		t.Errorf("DLQ entries = %d, want 0 (below MaxRedeliveries)", got)
	}
}

// TestPipelineSubscriber_PoisonPill_ReachesMaxRedeliveries_DLQAndAck asserts
// that once the redelivery counter reaches MaxRedeliveries the payload is
// published to the DLQ and acked.
func TestPipelineSubscriber_PoisonPill_ReachesMaxRedeliveries_DLQAndAck(t *testing.T) {
	prev := PayloadDropSentinel()
	t.Cleanup(func() { SetPayloadDropSentinel(prev) })
	customDrop := errors.New("test: codec drop")
	SetPayloadDropSentinel(customDrop)

	pipe := &fakePipeline{errs: []error{customDrop, customDrop, customDrop, customDrop}}
	dlq := &fakeDLQ{}
	sub := newTestSubscriber(t, pipe, dlq, staticResolver(13))
	// MaxRedeliveries = 3 from newTestSubscriber.

	var ackCalls atomic.Int32
	deliver := func() {
		sub.handlePayload(context.Background(), mqttPayload{
			Topic:     "telemetry/payload/5YJ3E1EA1LF000013",
			Payload:   []byte{0xde, 0xad},
			MessageID: 9999,
			Ack:       func() { ackCalls.Add(1) },
		})
	}

	deliver() // count=1, no ack
	deliver() // count=2, no ack
	if got := ackCalls.Load(); got != 0 {
		t.Fatalf("ack called %d times before MaxRedeliveries, want 0", got)
	}
	deliver() // count=3 == MaxRedeliveries, DLQ + ack

	entries := dlq.Entries()
	if len(entries) != 1 {
		t.Fatalf("DLQ entries = %d, want 1", len(entries))
	}
	if entries[0].VehicleID != 13 {
		t.Errorf("DLQ VehicleID = %d, want 13", entries[0].VehicleID)
	}
	if entries[0].Redeliveries != 3 {
		t.Errorf("DLQ Redeliveries = %d, want 3", entries[0].Redeliveries)
	}
	if entries[0].Topic != "telemetry/payload/5YJ3E1EA1LF000013" {
		t.Errorf("DLQ Topic = %q", entries[0].Topic)
	}
	if !bytesEq(entries[0].Payload, []byte{0xde, 0xad}) {
		t.Errorf("DLQ Payload mismatch: %v", entries[0].Payload)
	}
	if got := ackCalls.Load(); got != 1 {
		t.Errorf("ack called %d times at MaxRedeliveries, want 1", got)
	}

	// Tracker forgets the entry once DLQ succeeds, so a subsequent unrelated
	// message reusing MessageID=9999 starts at count=1.
	if got := sub.tracker.Len(); got != 0 {
		t.Errorf("tracker.Len() = %d after DLQ ack, want 0", got)
	}
}

// TestPipelineSubscriber_PoisonPill_DLQPublishFails_NoAck asserts that a DLQ
// publish failure does NOT ack the message — leaving it for the broker to
// redeliver and retry the DLQ write on the next pass.
func TestPipelineSubscriber_PoisonPill_DLQPublishFails_NoAck(t *testing.T) {
	prev := PayloadDropSentinel()
	t.Cleanup(func() { SetPayloadDropSentinel(prev) })
	customDrop := errors.New("test: codec drop")
	SetPayloadDropSentinel(customDrop)

	pipe := &fakePipeline{errs: []error{customDrop, customDrop, customDrop}}
	dlq := &fakeDLQ{failNext: []error{errors.New("broker timeout")}}
	sub := newTestSubscriber(t, pipe, dlq, staticResolver(99))

	var ackCalls atomic.Int32
	deliver := func() {
		sub.handlePayload(context.Background(), mqttPayload{
			Topic:     "telemetry/payload/5YJ3E1EA1LF000099",
			Payload:   []byte("xx"),
			MessageID: 55,
			Ack:       func() { ackCalls.Add(1) },
		})
	}
	deliver() // 1
	deliver() // 2
	deliver() // 3 (== MaxRedeliveries) → DLQ.Publish fails

	if got := len(dlq.Entries()); got != 1 {
		t.Fatalf("DLQ Publish attempts = %d, want 1", got)
	}
	if got := ackCalls.Load(); got != 0 {
		t.Errorf("ack called %d times after DLQ publish failure, want 0", got)
	}
	// Tracker still holds the entry because the DLQ write failed — the
	// next redelivery will retry the DLQ write.
	if got := sub.tracker.Len(); got != 1 {
		t.Errorf("tracker.Len() = %d after DLQ failure, want 1", got)
	}
}

// TestPipelineSubscriber_NonPayloadDropError_NoAck_NoDLQ asserts that a
// non-ErrPayloadDrop pipeline error (e.g. context.Canceled per ADR-004 #8)
// does NOT ack and does NOT enter the DLQ flow — it is reserved for
// shutdown / non-retriable infra failures.
func TestPipelineSubscriber_NonPayloadDropError_NoAck_NoDLQ(t *testing.T) {
	prev := PayloadDropSentinel()
	t.Cleanup(func() { SetPayloadDropSentinel(prev) })
	customDrop := errors.New("test: codec drop")
	SetPayloadDropSentinel(customDrop)

	pipe := &fakePipeline{errs: []error{context.Canceled}}
	dlq := &fakeDLQ{}
	sub := newTestSubscriber(t, pipe, dlq, staticResolver(1))

	var ackCalls atomic.Int32
	sub.handlePayload(context.Background(), mqttPayload{
		Topic:     "telemetry/payload/V1",
		Payload:   []byte("x"),
		MessageID: 1,
		Ack:       func() { ackCalls.Add(1) },
	})

	if got := ackCalls.Load(); got != 0 {
		t.Errorf("ack called %d times for non-ErrPayloadDrop error, want 0", got)
	}
	if got := len(dlq.Entries()); got != 0 {
		t.Errorf("DLQ entries = %d for non-ErrPayloadDrop error, want 0", got)
	}
	if got := sub.tracker.Len(); got != 0 {
		t.Errorf("tracker.Len() = %d for non-ErrPayloadDrop error, want 0", got)
	}
}

// TestPipelineSubscriber_GenericError_NoAck_NoDLQ asserts the same for an
// arbitrary non-codec error (e.g. unrecoverable infra failure).
func TestPipelineSubscriber_GenericError_NoAck_NoDLQ(t *testing.T) {
	prev := PayloadDropSentinel()
	t.Cleanup(func() { SetPayloadDropSentinel(prev) })
	customDrop := errors.New("test: codec drop")
	SetPayloadDropSentinel(customDrop)

	pipe := &fakePipeline{errs: []error{errors.New("totally unexpected")}}
	dlq := &fakeDLQ{}
	sub := newTestSubscriber(t, pipe, dlq, staticResolver(1))

	var ackCalls atomic.Int32
	sub.handlePayload(context.Background(), mqttPayload{
		Topic:     "telemetry/payload/V1",
		Payload:   []byte("x"),
		MessageID: 2,
		Ack:       func() { ackCalls.Add(1) },
	})

	if got := ackCalls.Load(); got != 0 {
		t.Errorf("ack called %d times for non-codec generic error, want 0", got)
	}
	if got := len(dlq.Entries()); got != 0 {
		t.Errorf("DLQ entries = %d for generic error, want 0", got)
	}
}

// TestPipelineSubscriber_SuccessAfterRetry_ForgetsTracker exercises the
// happy-path-after-retry scenario: the first delivery fails with codec drop,
// the second succeeds (perhaps because the upstream caught up), and the
// tracker entry for that MessageID is forgotten.
func TestPipelineSubscriber_SuccessAfterRetry_ForgetsTracker(t *testing.T) {
	prev := PayloadDropSentinel()
	t.Cleanup(func() { SetPayloadDropSentinel(prev) })
	customDrop := errors.New("test: codec drop")
	SetPayloadDropSentinel(customDrop)

	// First call returns codec drop; second call returns nil.
	pipe := &fakePipeline{errs: []error{customDrop, nil}}
	dlq := &fakeDLQ{}
	sub := newTestSubscriber(t, pipe, dlq, staticResolver(7))

	var ackCalls atomic.Int32
	deliver := func() {
		sub.handlePayload(context.Background(), mqttPayload{
			Topic:     "telemetry/payload/V7",
			Payload:   []byte("p"),
			MessageID: 77,
			Ack:       func() { ackCalls.Add(1) },
		})
	}

	deliver() // 1st delivery → codec drop, no ack, tracker count = 1
	if got := sub.tracker.Len(); got != 1 {
		t.Fatalf("tracker.Len() after first redeliver = %d, want 1", got)
	}
	if got := ackCalls.Load(); got != 0 {
		t.Fatalf("ack called %d times after first redeliver, want 0", got)
	}

	deliver() // 2nd delivery → success, ack, tracker forgotten
	if got := ackCalls.Load(); got != 1 {
		t.Errorf("ack called %d times after success-after-retry, want 1", got)
	}
	if got := sub.tracker.Len(); got != 0 {
		t.Errorf("tracker.Len() after success-after-retry = %d, want 0", got)
	}
	if got := len(dlq.Entries()); got != 0 {
		t.Errorf("DLQ entries after success-after-retry = %d, want 0", got)
	}
}

// TestPipelineSubscriber_VINNotFound_AckAndDrop_NoDLQ asserts that an
// ErrUnknownVIN from the resolver acks the message and does NOT publish to
// the DLQ — the message is for a foreign tenant, not a poison pill.
func TestPipelineSubscriber_VINNotFound_AckAndDrop_NoDLQ(t *testing.T) {
	pipe := &fakePipeline{}
	dlq := &fakeDLQ{}
	resolver := func(_ context.Context, _ string) (int64, error) { return 0, ErrUnknownVIN }
	sub := newTestSubscriber(t, pipe, dlq, resolver)

	var ackCalls atomic.Int32
	sub.handlePayload(context.Background(), mqttPayload{
		Topic:     "telemetry/payload/UNKNOWN-VIN",
		Payload:   []byte("p"),
		MessageID: 11,
		Ack:       func() { ackCalls.Add(1) },
	})

	if got := ackCalls.Load(); got != 1 {
		t.Errorf("ack called %d times for unknown VIN, want 1", got)
	}
	if got := len(pipe.Calls()); got != 0 {
		t.Errorf("Pipeline.Process called %d times for unknown VIN, want 0", got)
	}
	if got := len(dlq.Entries()); got != 0 {
		t.Errorf("DLQ entries for unknown VIN = %d, want 0", got)
	}
}

// TestPipelineSubscriber_VINResolverInfraError_NoAck asserts that a transient
// VIN resolver failure (not ErrUnknownVIN) does NOT ack — the broker will
// redeliver and the next attempt may succeed once the resolver recovers.
func TestPipelineSubscriber_VINResolverInfraError_NoAck(t *testing.T) {
	pipe := &fakePipeline{}
	dlq := &fakeDLQ{}
	resolver := func(_ context.Context, _ string) (int64, error) {
		return 0, fmt.Errorf("DB outage: %w", errors.New("connection refused"))
	}
	sub := newTestSubscriber(t, pipe, dlq, resolver)

	var ackCalls atomic.Int32
	sub.handlePayload(context.Background(), mqttPayload{
		Topic:     "telemetry/payload/V42",
		Payload:   []byte("p"),
		MessageID: 22,
		Ack:       func() { ackCalls.Add(1) },
	})

	if got := ackCalls.Load(); got != 0 {
		t.Errorf("ack called %d times for resolver infra error, want 0", got)
	}
	if got := len(pipe.Calls()); got != 0 {
		t.Errorf("Pipeline.Process called %d times for resolver infra error, want 0", got)
	}
	if got := len(dlq.Entries()); got != 0 {
		t.Errorf("DLQ entries for resolver infra error = %d, want 0", got)
	}
}

// TestPipelineSubscriber_TopicMismatch_AckAndDrop asserts that a topic that
// does not match {topicBase}/payload/{VIN} is acked and dropped: malformed
// topics are deployment misconfiguration, not poison pills.
func TestPipelineSubscriber_TopicMismatch_AckAndDrop(t *testing.T) {
	pipe := &fakePipeline{}
	dlq := &fakeDLQ{}
	sub := newTestSubscriber(t, pipe, dlq, staticResolver(1))

	var ackCalls atomic.Int32
	for _, topic := range []string{
		"unrelated/topic",
		"telemetry/something_else",
		"telemetry/payload/", // missing VIN
		"telemetry/payload/VIN/extra",
	} {
		sub.handlePayload(context.Background(), mqttPayload{
			Topic:     topic,
			Payload:   []byte("p"),
			MessageID: 33,
			Ack:       func() { ackCalls.Add(1) },
		})
	}

	if got := ackCalls.Load(); got != 4 {
		t.Errorf("ack called %d times for topic mismatch, want 4", got)
	}
	if got := len(pipe.Calls()); got != 0 {
		t.Errorf("Pipeline.Process called %d times for topic mismatch, want 0", got)
	}
}

// TestRedeliveryTracker_BoundedLRU asserts the tracker evicts the oldest
// entry when capacity is exceeded.
func TestRedeliveryTracker_BoundedLRU(t *testing.T) {
	tr := NewRedeliveryTracker(3)

	if got := tr.Increment(1); got != 1 {
		t.Errorf("Increment(1) = %d, want 1", got)
	}
	if got := tr.Increment(2); got != 1 {
		t.Errorf("Increment(2) = %d, want 1", got)
	}
	if got := tr.Increment(1); got != 2 {
		t.Errorf("second Increment(1) = %d, want 2", got)
	}
	if got := tr.Increment(3); got != 1 {
		t.Errorf("Increment(3) = %d, want 1", got)
	}
	// Tracker holds {2, 1, 3} (1 most-recently-touched). Adding a 4th evicts
	// the least-recently-touched, which is 2.
	if got := tr.Increment(4); got != 1 {
		t.Errorf("Increment(4) = %d, want 1", got)
	}
	if got := tr.Len(); got != 3 {
		t.Errorf("tracker.Len() = %d, want 3", got)
	}
	// MessageID 2 was evicted, so a fresh Increment(2) starts at 1 again.
	if got := tr.Increment(2); got != 1 {
		t.Errorf("post-eviction Increment(2) = %d, want 1", got)
	}
}

func TestRedeliveryTracker_Forget(t *testing.T) {
	tr := NewRedeliveryTracker(4)
	tr.Increment(7)
	tr.Increment(7)
	if got := tr.Len(); got != 1 {
		t.Fatalf("tracker.Len() = %d before Forget, want 1", got)
	}
	tr.Forget(7)
	if got := tr.Len(); got != 0 {
		t.Errorf("tracker.Len() = %d after Forget, want 0", got)
	}
	if got := tr.Increment(7); got != 1 {
		t.Errorf("post-Forget Increment(7) = %d, want 1", got)
	}
}

func TestRedeliveryTracker_Reset(t *testing.T) {
	tr := NewRedeliveryTracker(4)
	tr.Increment(1)
	tr.Increment(2)
	tr.Increment(3)
	tr.Reset()
	if got := tr.Len(); got != 0 {
		t.Errorf("tracker.Len() = %d after Reset, want 0", got)
	}
	if got := tr.Increment(1); got != 1 {
		t.Errorf("post-Reset Increment(1) = %d, want 1", got)
	}
}

func TestParsePipelineTopic(t *testing.T) {
	cases := []struct {
		base, topic, wantVIN string
		wantOK               bool
	}{
		{"telemetry", "telemetry/payload/5YJ3E1EA1LF000001", "5YJ3E1EA1LF000001", true},
		{"telemetry/", "telemetry/payload/X", "X", true},
		{"telemetry", "telemetry/payload/", "", false},
		{"telemetry", "telemetry/payload/A/B", "", false},
		{"telemetry", "different/payload/X", "", false},
		{"telemetry", "telemetry/v/X", "", false},
		{"", "/payload/X", "X", true},
	}
	for _, c := range cases {
		got, ok := parsePipelineTopic(c.base, c.topic)
		if ok != c.wantOK || got != c.wantVIN {
			t.Errorf("parsePipelineTopic(%q,%q) = (%q,%v), want (%q,%v)",
				c.base, c.topic, got, ok, c.wantVIN, c.wantOK)
		}
	}
}

func TestRedactVIN(t *testing.T) {
	cases := []struct{ in, want string }{
		{"", ""},
		{"AB", "**"},
		{"ABC", "***"},
		{"5YJ3E1EA1LF000001", "5YJ**************"},
	}
	for _, c := range cases {
		if got := redactVIN(c.in); got != c.want {
			t.Errorf("redactVIN(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestNewPipelineSubscriber_NilArgsPanic(t *testing.T) {
	pipe := &fakePipeline{}
	dlq := &fakeDLQ{}
	resolver := staticResolver(1)
	cfg := PipelineSubscriberConfig{TopicBase: "x"}

	// Nil pipeline panics.
	mustPanic(t, "nil pipeline", func() {
		NewPipelineSubscriber(nil, nil, dlq, resolver, cfg, zerolog.Nop())
	})
	// Nil dlq panics.
	mustPanic(t, "nil dlq", func() {
		NewPipelineSubscriber(nil, pipe, nil, resolver, cfg, zerolog.Nop())
	})
	// Nil resolver panics.
	mustPanic(t, "nil resolver", func() {
		NewPipelineSubscriber(nil, pipe, dlq, nil, cfg, zerolog.Nop())
	})
}

func TestNewPipelineSubscriber_DefaultsApplied(t *testing.T) {
	sub := NewPipelineSubscriber(
		nil,
		&fakePipeline{}, &fakeDLQ{}, staticResolver(1),
		PipelineSubscriberConfig{TopicBase: "x"},
		zerolog.Nop(),
	)
	if sub.cfg.MaxRedeliveries != 5 {
		t.Errorf("MaxRedeliveries default = %d, want 5", sub.cfg.MaxRedeliveries)
	}
	if sub.cfg.TrackerCapacity != 4096 {
		t.Errorf("TrackerCapacity default = %d, want 4096", sub.cfg.TrackerCapacity)
	}
	if sub.cfg.SubscribeQoS != 1 {
		t.Errorf("SubscribeQoS default = %d, want 1", sub.cfg.SubscribeQoS)
	}
}

func TestSetPayloadDropSentinel_NilPanics(t *testing.T) {
	mustPanic(t, "nil sentinel", func() { SetPayloadDropSentinel(nil) })
}

func TestDLQEntryRoundTrip(t *testing.T) {
	in := DLQEntry{
		Reason:       "test",
		VehicleID:    42,
		VIN:          "VIN1",
		Topic:        "telemetry/payload/VIN1",
		Payload:      []byte{0x01, 0x02},
		Redeliveries: 3,
	}
	body, err := json.Marshal(in)
	if err != nil {
		t.Fatal(err)
	}
	var out DLQEntry
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatal(err)
	}
	if out.VehicleID != in.VehicleID || out.Reason != in.Reason || !bytesEq(out.Payload, in.Payload) {
		t.Errorf("round-trip mismatch: %+v vs %+v", in, out)
	}
}

// ---------- helpers ---------------------------------------------------------

func bytesEq(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func mustPanic(t *testing.T, name string, fn func()) {
	t.Helper()
	defer func() {
		if r := recover(); r == nil {
			t.Errorf("%s: expected panic, got none", name)
		}
	}()
	fn()
}
