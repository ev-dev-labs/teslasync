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
	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
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
// Phase-42 PipelineSubscriber tests (per-field MQTT cutover)
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
	Atomics   []codec.Atomic
	VehicleID int64
}

func (f *fakePipeline) ProcessAtomics(_ context.Context, atomics []codec.Atomic, vehicleID int64) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	cp := make([]codec.Atomic, len(atomics))
	copy(cp, atomics)
	f.calls = append(f.calls, fakePipelineCall{Atomics: cp, VehicleID: vehicleID})
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
// well-formed per-field MQTT payload is decoded and the resulting atomics
// are forwarded to Pipeline.ProcessAtomics with the correct vehicleID, and
// that the message is acked exactly once.
func TestPipelineSubscriber_ValidPayload_DelegatesToPipeline(t *testing.T) {
	pipe := &fakePipeline{}
	dlq := &fakeDLQ{}
	sub := newTestSubscriber(t, pipe, dlq, staticResolver(42))

	var ackCalls atomic.Int32
	body := []byte("75.5") // Soc is a float field; "75.5" is valid JSON for it.

	sub.handlePayload(context.Background(), mqttPayload{
		Topic:     "telemetry/5YJ3E1EA1LF000001/v/Soc",
		Payload:   body,
		MessageID: 42,
		Ack:       func() { ackCalls.Add(1) },
	})

	calls := pipe.Calls()
	if len(calls) != 1 {
		t.Fatalf("Pipeline.ProcessAtomics called %d times, want 1", len(calls))
	}
	if got := len(calls[0].Atomics); got != 1 {
		t.Fatalf("atomics len = %d, want 1", got)
	}
	if calls[0].VehicleID != 42 {
		t.Errorf("vehicleID = %d, want 42", calls[0].VehicleID)
	}
	if got := calls[0].Atomics[0].Field; got != "Soc" {
		t.Errorf("atomic field = %q, want %q", got, "Soc")
	}
	if got := ackCalls.Load(); got != 1 {
		t.Errorf("ack called %d times, want 1", got)
	}
	if got := len(dlq.Entries()); got != 0 {
		t.Errorf("DLQ entries = %d, want 0", got)
	}
}

// TestPipelineSubscriber_TransientCodecError_NoAck_IncrementsRedeliveries
// asserts that a malformed JSON body for a known field (causing
// codec.DecodeJSONField to wrap codec.ErrPayloadDrop) does NOT ack and the
// tracker count grows with each redelivery while the count stays below
// MaxRedeliveries.
func TestPipelineSubscriber_TransientCodecError_NoAck_IncrementsRedeliveries(t *testing.T) {
	pipe := &fakePipeline{}
	dlq := &fakeDLQ{}
	sub := newTestSubscriber(t, pipe, dlq, staticResolver(7))

	var ackCalls atomic.Int32
	deliver := func() {
		sub.handlePayload(context.Background(), mqttPayload{
			Topic:     "telemetry/5YJ3E1EA1LF000007/v/Soc",
			Payload:   []byte("garbage"), // not valid JSON for Soc (a float)
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
	if got := len(pipe.Calls()); got != 0 {
		t.Errorf("ProcessAtomics called %d times for codec drop, want 0", got)
	}
}

// TestPipelineSubscriber_PoisonPill_ReachesMaxRedeliveries_DLQAndAck asserts
// that once the redelivery counter reaches MaxRedeliveries the payload is
// published to the DLQ and acked.
func TestPipelineSubscriber_PoisonPill_ReachesMaxRedeliveries_DLQAndAck(t *testing.T) {
	pipe := &fakePipeline{}
	dlq := &fakeDLQ{}
	sub := newTestSubscriber(t, pipe, dlq, staticResolver(13))
	// MaxRedeliveries = 3 from newTestSubscriber.

	var ackCalls atomic.Int32
	deliver := func() {
		sub.handlePayload(context.Background(), mqttPayload{
			Topic:     "telemetry/5YJ3E1EA1LF000013/v/Soc",
			Payload:   []byte("garbage"),
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
	if entries[0].Topic != "telemetry/5YJ3E1EA1LF000013/v/Soc" {
		t.Errorf("DLQ Topic = %q", entries[0].Topic)
	}
	if !bytesEq(entries[0].Payload, []byte("garbage")) {
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
	pipe := &fakePipeline{}
	dlq := &fakeDLQ{failNext: []error{errors.New("broker timeout")}}
	sub := newTestSubscriber(t, pipe, dlq, staticResolver(99))

	var ackCalls atomic.Int32
	deliver := func() {
		sub.handlePayload(context.Background(), mqttPayload{
			Topic:     "telemetry/5YJ3E1EA1LF000099/v/Soc",
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
// shutdown / non-retriable infra failures. The codec decode succeeds (so we
// reach ProcessAtomics) and the queued ProcessAtomics error drives the
// classification.
func TestPipelineSubscriber_NonPayloadDropError_NoAck_NoDLQ(t *testing.T) {
	pipe := &fakePipeline{errs: []error{context.Canceled}}
	dlq := &fakeDLQ{}
	sub := newTestSubscriber(t, pipe, dlq, staticResolver(1))

	var ackCalls atomic.Int32
	sub.handlePayload(context.Background(), mqttPayload{
		Topic:     "telemetry/V1/v/Soc",
		Payload:   []byte("0.5"),
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
// arbitrary non-codec error returned from ProcessAtomics (e.g. unrecoverable
// infra failure).
func TestPipelineSubscriber_GenericError_NoAck_NoDLQ(t *testing.T) {
	pipe := &fakePipeline{errs: []error{errors.New("totally unexpected")}}
	dlq := &fakeDLQ{}
	sub := newTestSubscriber(t, pipe, dlq, staticResolver(1))

	var ackCalls atomic.Int32
	sub.handlePayload(context.Background(), mqttPayload{
		Topic:     "telemetry/V1/v/Soc",
		Payload:   []byte("0.5"),
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
// happy-path-after-retry scenario: the first delivery fails with codec drop
// (malformed body), the second succeeds (replayed body is well-formed), and
// the tracker entry for that MessageID is forgotten.
func TestPipelineSubscriber_SuccessAfterRetry_ForgetsTracker(t *testing.T) {
	pipe := &fakePipeline{}
	dlq := &fakeDLQ{}
	sub := newTestSubscriber(t, pipe, dlq, staticResolver(7))

	var ackCalls atomic.Int32
	bodies := [][]byte{[]byte("garbage"), []byte("12.5")}
	cursor := 0
	deliver := func() {
		body := bodies[cursor]
		cursor++
		sub.handlePayload(context.Background(), mqttPayload{
			Topic:     "telemetry/V7/v/Soc",
			Payload:   body,
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
		Topic:     "telemetry/UNKNOWN-VIN/v/Soc",
		Payload:   []byte("0.5"),
		MessageID: 11,
		Ack:       func() { ackCalls.Add(1) },
	})

	if got := ackCalls.Load(); got != 1 {
		t.Errorf("ack called %d times for unknown VIN, want 1", got)
	}
	if got := len(pipe.Calls()); got != 0 {
		t.Errorf("Pipeline.ProcessAtomics called %d times for unknown VIN, want 0", got)
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
		Topic:     "telemetry/V42/v/Soc",
		Payload:   []byte("0.5"),
		MessageID: 22,
		Ack:       func() { ackCalls.Add(1) },
	})

	if got := ackCalls.Load(); got != 0 {
		t.Errorf("ack called %d times for resolver infra error, want 0", got)
	}
	if got := len(pipe.Calls()); got != 0 {
		t.Errorf("Pipeline.ProcessAtomics called %d times for resolver infra error, want 0", got)
	}
	if got := len(dlq.Entries()); got != 0 {
		t.Errorf("DLQ entries for resolver infra error = %d, want 0", got)
	}
}

// TestPipelineSubscriber_TopicMismatch_AckAndDrop asserts that a topic that
// does not match {topicBase}/{VIN}/v/{field} is acked and dropped: malformed
// topics are deployment misconfiguration, not poison pills. This ALSO
// covers the legacy {topicBase}/payload/{VIN} proto-batch shape, which the
// per-field cutover intentionally rejects so a stray retained message from
// the bridge era cannot smuggle bytes past the JSON decoder.
func TestPipelineSubscriber_TopicMismatch_AckAndDrop(t *testing.T) {
	pipe := &fakePipeline{}
	dlq := &fakeDLQ{}
	sub := newTestSubscriber(t, pipe, dlq, staticResolver(1))

	var ackCalls atomic.Int32
	for _, topic := range []string{
		"unrelated/topic",
		"telemetry/something_else",
		"telemetry/VIN",                          // missing /v/{field}
		"telemetry/VIN/v",                        // missing {field}
		"telemetry/VIN/v/",                       // empty {field}
		"telemetry//v/Soc",                       // empty VIN
		"telemetry/VIN/x/Soc",                    // wrong segment-3 marker
		"telemetry/VIN/v/Soc/extra",              // too many segments
		"telemetry/payload/5YJ3E1EA1LF000001",    // legacy proto-batch shape
	} {
		sub.handlePayload(context.Background(), mqttPayload{
			Topic:     topic,
			Payload:   []byte("0.5"),
			MessageID: 33,
			Ack:       func() { ackCalls.Add(1) },
		})
	}

	if got := ackCalls.Load(); got != 9 {
		t.Errorf("ack called %d times for topic mismatch, want 9", got)
	}
	if got := len(pipe.Calls()); got != 0 {
		t.Errorf("Pipeline.ProcessAtomics called %d times for topic mismatch, want 0", got)
	}
}

// TestPipelineSubscriber_UnknownField_AckAndDropSilently asserts that a
// well-formed topic naming a field SignalsByName does not know about acks
// and drops without forwarding to the pipeline. New fields a future Tesla
// proto bump may introduce should not crash the subscriber.
func TestPipelineSubscriber_UnknownField_AckAndDropSilently(t *testing.T) {
	pipe := &fakePipeline{}
	dlq := &fakeDLQ{}
	sub := newTestSubscriber(t, pipe, dlq, staticResolver(1))

	var ackCalls atomic.Int32
	sub.handlePayload(context.Background(), mqttPayload{
		Topic:     "telemetry/V1/v/SomeFutureSignalThatDoesNotExist",
		Payload:   []byte("42"),
		MessageID: 44,
		Ack:       func() { ackCalls.Add(1) },
	})

	if got := ackCalls.Load(); got != 1 {
		t.Errorf("ack called %d times for unknown field, want 1", got)
	}
	if got := len(pipe.Calls()); got != 0 {
		t.Errorf("ProcessAtomics called %d times for unknown field, want 0", got)
	}
	if got := len(dlq.Entries()); got != 0 {
		t.Errorf("DLQ entries for unknown field = %d, want 0", got)
	}
	if got := sub.tracker.Len(); got != 0 {
		t.Errorf("tracker.Len() for unknown field = %d, want 0", got)
	}
}

// TestPipelineSubscriber_NullBody_AckAndDropSilently asserts that a null
// body (Tesla's wire signal for "Value.invalid") acks without DLQ.
func TestPipelineSubscriber_NullBody_AckAndDropSilently(t *testing.T) {
	pipe := &fakePipeline{}
	dlq := &fakeDLQ{}
	sub := newTestSubscriber(t, pipe, dlq, staticResolver(1))

	var ackCalls atomic.Int32
	sub.handlePayload(context.Background(), mqttPayload{
		Topic:     "telemetry/V1/v/Soc",
		Payload:   []byte("null"),
		MessageID: 45,
		Ack:       func() { ackCalls.Add(1) },
	})

	if got := ackCalls.Load(); got != 1 {
		t.Errorf("ack called %d times for null body, want 1", got)
	}
	if got := len(pipe.Calls()); got != 0 {
		t.Errorf("ProcessAtomics called %d times for null body, want 0", got)
	}
	if got := len(dlq.Entries()); got != 0 {
		t.Errorf("DLQ entries for null body = %d, want 0", got)
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
		base, topic            string
		wantVIN, wantField     string
		wantOK                 bool
	}{
		{"telemetry", "telemetry/5YJ3E1EA1LF000001/v/Soc", "5YJ3E1EA1LF000001", "Soc", true},
		{"telemetry/", "telemetry/X/v/Gear", "X", "Gear", true},
		{"telemetry", "telemetry/X/v/Location", "X", "Location", true},
		// Empty VIN.
		{"telemetry", "telemetry//v/Soc", "", "", false},
		// Empty field.
		{"telemetry", "telemetry/X/v/", "", "", false},
		// Wrong segment-3 marker.
		{"telemetry", "telemetry/X/x/Soc", "", "", false},
		// Too few segments.
		{"telemetry", "telemetry/X/v", "", "", false},
		{"telemetry", "telemetry/X", "", "", false},
		// Too many segments.
		{"telemetry", "telemetry/X/v/Soc/extra", "", "", false},
		// Wrong base.
		{"telemetry", "different/X/v/Soc", "", "", false},
		// Legacy proto-batch shape rejected.
		{"telemetry", "telemetry/payload/X", "", "", false},
		// Trailing-slash on base normalises to the same prefix.
		{"telemetry/", "telemetry/X/v/Soc", "X", "Soc", true},
		// Empty base + leading slash on topic.
		{"", "/X/v/Soc", "X", "Soc", true},
	}
	for _, c := range cases {
		gotVIN, gotField, ok := parsePipelineTopic(c.base, c.topic)
		if ok != c.wantOK || gotVIN != c.wantVIN || gotField != c.wantField {
			t.Errorf("parsePipelineTopic(%q,%q) = (%q,%q,%v), want (%q,%q,%v)",
				c.base, c.topic, gotVIN, gotField, ok, c.wantVIN, c.wantField, c.wantOK)
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

func TestSetPayloadDropSentinel_Removed(t *testing.T) {
	// Documents that the SetPayloadDropSentinel public API was removed when
	// the per-field MQTT cutover landed. The handler now wraps every
	// codec.DecodeJSONField error in the package-private errPayloadDrop
	// sentinel directly, eliminating the indirection that had been used
	// to bridge to normalize.ErrPayloadDrop. If a future refactor wants
	// the indirection back it will need to add new public API + new test.
	t.Skip("SetPayloadDropSentinel removed in per-field MQTT cutover")
}

func TestDLQEntryRoundTrip(t *testing.T) {
	in := DLQEntry{
		Reason:       "test",
		VehicleID:    42,
		VIN:          "VIN1",
		Topic:        "telemetry/VIN1/v/Soc",
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
