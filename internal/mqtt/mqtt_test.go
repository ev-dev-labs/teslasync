package mqtt

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/rs/zerolog"

	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
)

// Type aliases keep the fake-client surface area readable in tests below
// without leaking paho identifiers throughout the file.
type (
	pahoMessageHandler = pahomqtt.MessageHandler
	pahoToken          = pahomqtt.Token
	pahoOptionsReader  = pahomqtt.ClientOptionsReader
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
// PipelineSubscriber tests for per-field MQTT ingest
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

type panickingPipeline struct{}

func (panickingPipeline) ProcessAtomics(context.Context, []codec.Atomic, int64) error {
	panic("simulated pipeline panic")
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
	mu       sync.Mutex
	failNext []error
	entries  []DLQEntry
}

type panickingDLQ struct{}

func (panickingDLQ) Publish(context.Context, DLQEntry) error {
	panic("simulated DLQ panic")
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
		TopicBase: "telemetry",
	}
	cfg.withDefaults()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	return &PipelineSubscriber{
		client:     nil,
		pipeline:   pipeline,
		dlq:        dlq,
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

// TestPipelineSubscriber_CodecError_ImmediateDLQAndAck pins the terminal
// poison-payload contract. MQTT 3.1.1 cannot NACK a live QoS 1 delivery, so a
// malformed payload must be quarantined and acknowledged on its first pass.
func TestPipelineSubscriber_CodecError_ImmediateDLQAndAck(t *testing.T) {
	pipe := &fakePipeline{}
	dlq := &fakeDLQ{}
	sub := newTestSubscriber(t, pipe, dlq, staticResolver(7))

	var ackCalls atomic.Int32
	sub.handlePayload(context.Background(), mqttPayload{
		Topic:     "telemetry/5YJ3E1EA1LF000007/v/Soc",
		Payload:   []byte("garbage"),
		MessageID: 1234,
		Ack:       func() { ackCalls.Add(1) },
	})

	entries := dlq.Entries()
	if len(entries) != 1 {
		t.Fatalf("DLQ entries = %d, want 1", len(entries))
	}
	if entries[0].VehicleID != 7 {
		t.Errorf("DLQ VehicleID = %d, want 7", entries[0].VehicleID)
	}
	if entries[0].Redeliveries != 0 {
		t.Errorf("DLQ Redeliveries = %d, want 0 for immediate quarantine", entries[0].Redeliveries)
	}
	if entries[0].Topic != "telemetry/5YJ3E1EA1LF000007/v/Soc" {
		t.Errorf("DLQ Topic = %q", entries[0].Topic)
	}
	if !bytesEq(entries[0].Payload, []byte("garbage")) {
		t.Errorf("DLQ Payload mismatch: %v", entries[0].Payload)
	}
	if got := ackCalls.Load(); got != 1 {
		t.Errorf("ack called %d times for codec drop, want 1", got)
	}
	if got := len(pipe.Calls()); got != 0 {
		t.Errorf("ProcessAtomics called %d times for codec drop, want 0", got)
	}
}

// TestPipelineSubscriber_CodecError_DLQPublishFails_StillAcks asserts that a
// broken quarantine sink cannot consume a broker in-flight slot forever.
func TestPipelineSubscriber_CodecError_DLQPublishFails_StillAcks(t *testing.T) {
	pipe := &fakePipeline{}
	dlq := &fakeDLQ{failNext: []error{errors.New("broker timeout")}}
	sub := newTestSubscriber(t, pipe, dlq, staticResolver(99))

	var ackCalls atomic.Int32
	sub.handlePayload(context.Background(), mqttPayload{
		Topic:     "telemetry/5YJ3E1EA1LF000099/v/Soc",
		Payload:   []byte("xx"),
		MessageID: 55,
		Ack:       func() { ackCalls.Add(1) },
	})

	if got := len(dlq.Entries()); got != 1 {
		t.Fatalf("DLQ Publish attempts = %d, want 1", got)
	}
	if got := ackCalls.Load(); got != 1 {
		t.Errorf("ack called %d times after DLQ publish failure, want 1", got)
	}
}

// TestPipelineSubscriber_CodecBurst_AcksEntireBrokerWindow reproduces the
// production EMQX failure signature: 32 malformed QoS 1 messages used to fill
// the default receive window (inflight=32/32) and stop all subsequent
// delivery. Every terminal poison payload must now release its slot.
func TestPipelineSubscriber_CodecBurst_AcksEntireBrokerWindow(t *testing.T) {
	pipe := &fakePipeline{}
	dlq := &fakeDLQ{}
	sub := newTestSubscriber(t, pipe, dlq, staticResolver(7))

	var ackCalls atomic.Int32
	const brokerReceiveMaximum = 32
	for i := 0; i < brokerReceiveMaximum; i++ {
		sub.handlePayload(context.Background(), mqttPayload{
			Topic:     "telemetry/V7/v/Soc",
			Payload:   []byte("garbage"),
			MessageID: uint16(i + 1),
			Ack:       func() { ackCalls.Add(1) },
		})
	}

	if got := ackCalls.Load(); got != brokerReceiveMaximum {
		t.Errorf("ack calls = %d, want %d", got, brokerReceiveMaximum)
	}
	if got := len(dlq.Entries()); got != brokerReceiveMaximum {
		t.Errorf("DLQ entries = %d, want %d", got, brokerReceiveMaximum)
	}
}

func TestPipelineSubscriber_Panic_AcksMessage(t *testing.T) {
	sub := newTestSubscriber(t, panickingPipeline{}, &fakeDLQ{}, staticResolver(7))
	msg := &fakePahoMessage{
		topic:     "telemetry/V7/v/Soc",
		payload:   []byte("75.5"),
		messageID: 1,
		qos:       1,
	}

	sub.onPipelineMessage(nil, msg)

	if got := msg.acked.Load(); got != 1 {
		t.Errorf("ack calls after recovered panic = %d, want 1", got)
	}
}

func TestPipelineSubscriber_DLQPanic_AcksExactlyOnce(t *testing.T) {
	sub := newTestSubscriber(t, &fakePipeline{}, panickingDLQ{}, staticResolver(7))
	msg := &fakePahoMessage{
		topic:     "telemetry/V7/v/Soc",
		payload:   []byte("garbage"),
		messageID: 1,
		qos:       1,
	}

	sub.onPipelineMessage(nil, msg)

	if got := msg.acked.Load(); got != 1 {
		t.Errorf("ack calls after recovered DLQ panic = %d, want 1", got)
	}
}

// TestPipelineSubscriber_ShutdownCancellation_NoAck_NoDLQ asserts that a
// cancellation caused by PipelineSubscriber.Stop preserves the broker-side
// QoS 1 message for the next connection.
func TestPipelineSubscriber_ShutdownCancellation_NoAck_NoDLQ(t *testing.T) {
	pipe := &fakePipeline{errs: []error{context.Canceled}}
	dlq := &fakeDLQ{}
	sub := newTestSubscriber(t, pipe, dlq, staticResolver(1))
	sub.cancel()

	var ackCalls atomic.Int32
	sub.handlePayload(context.Background(), mqttPayload{
		Topic:     "telemetry/V1/v/Soc",
		Payload:   []byte("0.5"),
		MessageID: 1,
		Ack:       func() { ackCalls.Add(1) },
	})

	if got := ackCalls.Load(); got != 0 {
		t.Errorf("ack called %d times for shutdown cancellation, want 0", got)
	}
	if got := len(dlq.Entries()); got != 0 {
		t.Errorf("DLQ entries = %d for shutdown cancellation, want 0", got)
	}
}

func TestPipelineSubscriber_DeadlineOutsideShutdown_DLQAndAck(t *testing.T) {
	pipe := &fakePipeline{errs: []error{context.DeadlineExceeded}}
	dlq := &fakeDLQ{}
	sub := newTestSubscriber(t, pipe, dlq, staticResolver(1))

	var ackCalls atomic.Int32
	sub.handlePayload(context.Background(), mqttPayload{
		Topic:     "telemetry/V1/v/Soc",
		Payload:   []byte("0.5"),
		MessageID: 1,
		Ack:       func() { ackCalls.Add(1) },
	})

	if got := ackCalls.Load(); got != 1 {
		t.Errorf("ack called %d times for non-shutdown deadline, want 1", got)
	}
	if got := len(dlq.Entries()); got != 1 {
		t.Errorf("DLQ entries = %d for non-shutdown deadline, want 1", got)
	}
}

// TestPipelineSubscriber_GenericError_DLQAndAck asserts that an unexpected
// non-codec error cannot pin the broker receive window.
func TestPipelineSubscriber_GenericError_DLQAndAck(t *testing.T) {
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

	if got := ackCalls.Load(); got != 1 {
		t.Errorf("ack called %d times for non-codec generic error, want 1", got)
	}
	if got := len(dlq.Entries()); got != 1 {
		t.Errorf("DLQ entries = %d for generic error, want 1", got)
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

// TestPipelineSubscriber_VINResolverInfraError_DLQAndAck asserts that a
// resolver outage is quarantined rather than permanently consuming an
// in-flight slot.
func TestPipelineSubscriber_VINResolverInfraError_DLQAndAck(t *testing.T) {
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

	if got := ackCalls.Load(); got != 1 {
		t.Errorf("ack called %d times for resolver infra error, want 1", got)
	}
	if got := len(pipe.Calls()); got != 0 {
		t.Errorf("Pipeline.ProcessAtomics called %d times for resolver infra error, want 0", got)
	}
	if got := len(dlq.Entries()); got != 1 {
		t.Errorf("DLQ entries for resolver infra error = %d, want 1", got)
	}
}

func TestPipelineSubscriber_VINResolverCancellationDuringShutdown_NoAck(t *testing.T) {
	pipe := &fakePipeline{}
	dlq := &fakeDLQ{}
	resolver := func(_ context.Context, _ string) (int64, error) {
		return 0, context.Canceled
	}
	sub := newTestSubscriber(t, pipe, dlq, resolver)
	sub.cancel()

	var ackCalls atomic.Int32
	sub.handlePayload(context.Background(), mqttPayload{
		Topic:     "telemetry/V42/v/Soc",
		Payload:   []byte("0.5"),
		MessageID: 22,
		Ack:       func() { ackCalls.Add(1) },
	})

	if got := ackCalls.Load(); got != 0 {
		t.Errorf("ack called %d times for resolver cancellation during shutdown, want 0", got)
	}
	if got := len(dlq.Entries()); got != 0 {
		t.Errorf("DLQ entries for resolver cancellation during shutdown = %d, want 0", got)
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
		"telemetry/VIN",                       // missing /v/{field}
		"telemetry/VIN/v",                     // missing {field}
		"telemetry/VIN/v/",                    // empty {field}
		"telemetry//v/Soc",                    // empty VIN
		"telemetry/VIN/x/Soc",                 // wrong segment-3 marker
		"telemetry/VIN/v/Soc/extra",           // too many segments
		"telemetry/payload/5YJ3E1EA1LF000001", // legacy proto-batch shape
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

func TestParsePipelineTopic(t *testing.T) {
	cases := []struct {
		base, topic        string
		wantVIN, wantField string
		wantOK             bool
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

// ---------- OnBrokerReconnect tests ----------------------------------------
//
// Pin the contract documented on PipelineSubscriber.OnBrokerReconnect:
// (a) pre-Start invocations are no-ops (initial Subscribe is owned by Start);
// (b) post-Start invocations re-issue Subscribe;
// (c) post-Stop invocations are no-ops (reconnect during shutdown must not
//     re-establish the subscription);
// (d) a non-nil client argument overrides the embedded client (paho passes
//     the connected client to the OnConnect handler — we honour it so the
//     fix works during the brief reconnect window when s.client may be in
//     a transitional state).

// fakePahoClient is the smallest possible pahomqtt.Client for testing
// OnBrokerReconnect's Subscribe path. Only Subscribe is meaningfully
// implemented; the rest panic if accidentally called by code under test.
type fakePahoClient struct {
	mu               sync.Mutex
	subscribeCalls   int
	lastSubscribeTop string
	lastSubscribeQoS byte
	connected        bool
}

func (f *fakePahoClient) Subscribe(topic string, qos byte, _ pahoMessageHandler) pahoToken {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.subscribeCalls++
	f.lastSubscribeTop = topic
	f.lastSubscribeQoS = qos
	return immediatePahoToken{}
}

func (f *fakePahoClient) Calls() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.subscribeCalls
}

func (f *fakePahoClient) LastTopic() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.lastSubscribeTop
}

func (f *fakePahoClient) LastQoS() byte {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.lastSubscribeQoS
}

// Unused pahomqtt.Client methods. They panic so that an accidental
// dependency on broker-side behaviour in a test surfaces immediately.
func (f *fakePahoClient) IsConnected() bool      { return f.connected }
func (f *fakePahoClient) IsConnectionOpen() bool { return f.connected }
func (f *fakePahoClient) Connect() pahoToken     { panic("Connect not used") }
func (f *fakePahoClient) Disconnect(_ uint)      { panic("Disconnect not used") }
func (f *fakePahoClient) Publish(_ string, _ byte, _ bool, _ interface{}) pahoToken {
	panic("Publish not used")
}
func (f *fakePahoClient) SubscribeMultiple(_ map[string]byte, _ pahoMessageHandler) pahoToken {
	panic("SubscribeMultiple not used")
}
func (f *fakePahoClient) Unsubscribe(_ ...string) pahoToken       { panic("Unsubscribe not used") }
func (f *fakePahoClient) AddRoute(_ string, _ pahoMessageHandler) {}
func (f *fakePahoClient) OptionsReader() pahoOptionsReader        { panic("OptionsReader not used") }

// immediatePahoToken returns success immediately without any I/O. This is
// the contract OnBrokerReconnect expects when it calls token.WaitTimeout
// followed by token.Error: WaitTimeout must return true (token completed),
// and Error must return nil.
type immediatePahoToken struct{}

func (immediatePahoToken) Wait() bool                       { return true }
func (immediatePahoToken) WaitTimeout(_ time.Duration) bool { return true }
func (immediatePahoToken) Done() <-chan struct{} {
	ch := make(chan struct{})
	close(ch)
	return ch
}
func (immediatePahoToken) Error() error { return nil }

// erroringPahoToken simulates a SUBACK that arrives but with a server-side
// error (e.g. ACL rejection).
type erroringPahoToken struct{ err error }

func (e erroringPahoToken) Wait() bool                       { return true }
func (e erroringPahoToken) WaitTimeout(_ time.Duration) bool { return true }
func (e erroringPahoToken) Done() <-chan struct{} {
	ch := make(chan struct{})
	close(ch)
	return ch
}
func (e erroringPahoToken) Error() error { return e.err }

// timeoutPahoToken simulates a SUBACK that never arrives.
type timeoutPahoToken struct{}

func (timeoutPahoToken) Wait() bool                       { return false }
func (timeoutPahoToken) WaitTimeout(_ time.Duration) bool { return false }
func (timeoutPahoToken) Done() <-chan struct{} {
	ch := make(chan struct{})
	return ch // never closes
}
func (timeoutPahoToken) Error() error { return nil }

func TestOnBrokerReconnect_PreStart_NoSubscribe(t *testing.T) {
	sub := newTestSubscriber(t, &fakePipeline{}, &fakeDLQ{}, staticResolver(1))
	fc := &fakePahoClient{}

	sub.OnBrokerReconnect(fc)

	if got := fc.Calls(); got != 0 {
		t.Errorf("Subscribe calls = %d, want 0 (pre-start invocation must be a no-op)", got)
	}
}

func TestOnBrokerReconnect_PostStop_NoSubscribe(t *testing.T) {
	sub := newTestSubscriber(t, &fakePipeline{}, &fakeDLQ{}, staticResolver(1))
	// Manually flag started + stopped without going through Start/Stop
	// (which would touch the embedded nil client).
	sub.mu.Lock()
	sub.started = true
	sub.stopped = true
	sub.mu.Unlock()

	fc := &fakePahoClient{}

	sub.OnBrokerReconnect(fc)

	if got := fc.Calls(); got != 0 {
		t.Errorf("Subscribe calls = %d, want 0 (post-stop invocation must be a no-op)", got)
	}
}

func TestOnBrokerReconnect_PostStart_ReSubscribes(t *testing.T) {
	sub := newTestSubscriber(t, &fakePipeline{}, &fakeDLQ{}, staticResolver(1))
	sub.mu.Lock()
	sub.started = true
	sub.mu.Unlock()

	fc := &fakePahoClient{}

	sub.OnBrokerReconnect(fc)

	if got := fc.Calls(); got != 1 {
		t.Errorf("Subscribe calls = %d, want 1", got)
	}
	if got, want := fc.LastTopic(), sub.pipelineTopicFilter(); got != want {
		t.Errorf("Subscribe topic = %q, want %q", got, want)
	}
	if got, want := fc.LastQoS(), sub.cfg.SubscribeQoS; got != want {
		t.Errorf("Subscribe QoS = %d, want %d", got, want)
	}
}

func TestOnBrokerReconnect_NilClientArg_FallsBackToEmbeddedClient(t *testing.T) {
	sub := newTestSubscriber(t, &fakePipeline{}, &fakeDLQ{}, staticResolver(1))
	embeddedFC := &fakePahoClient{}
	sub.client = embeddedFC // newTestSubscriber leaves this nil
	sub.mu.Lock()
	sub.started = true
	sub.mu.Unlock()

	sub.OnBrokerReconnect(nil)

	if got := embeddedFC.Calls(); got != 1 {
		t.Errorf("embedded client Subscribe calls = %d, want 1 (nil client arg must fall back to s.client)", got)
	}
}

func TestOnBrokerReconnect_SubscribeError_Returns(t *testing.T) {
	sub := newTestSubscriber(t, &fakePipeline{}, &fakeDLQ{}, staticResolver(1))
	sub.mu.Lock()
	sub.started = true
	sub.mu.Unlock()

	// Inject a fake whose Subscribe returns an error token.
	fc := &erroringPahoSubscribeClient{err: errors.New("acl: not authorized")}

	sub.OnBrokerReconnect(fc)

	if got := fc.Calls(); got != 1 {
		t.Errorf("Subscribe calls = %d, want 1", got)
	}
}

func TestOnBrokerReconnect_SubscribeTimeout_Returns(t *testing.T) {
	sub := newTestSubscriber(t, &fakePipeline{}, &fakeDLQ{}, staticResolver(1))
	sub.mu.Lock()
	sub.started = true
	sub.mu.Unlock()

	// Tighten the timeout so the test runs quickly.
	sub.cfg.SubscribeTimeout = 5 * time.Millisecond
	fc := &timeoutPahoSubscribeClient{}

	sub.OnBrokerReconnect(fc)

	if got := fc.Calls(); got != 1 {
		t.Errorf("Subscribe calls = %d, want 1", got)
	}
}

func TestPipelineSubscriber_IsHealthy(t *testing.T) {
	client := &fakePahoClient{connected: true}
	sub := newTestSubscriber(t, &fakePipeline{}, &fakeDLQ{}, staticResolver(1))
	sub.client = client
	sub.mu.Lock()
	sub.started = true
	sub.subscribed = true
	sub.mu.Unlock()

	if !sub.IsHealthy() {
		t.Fatal("IsHealthy() = false for active connected subscription")
	}
	client.connected = false
	if sub.IsHealthy() {
		t.Fatal("IsHealthy() = true after broker disconnect")
	}
	client.connected = true
	sub.mu.Lock()
	sub.subscribed = false
	sub.mu.Unlock()
	if sub.IsHealthy() {
		t.Fatal("IsHealthy() = true without an active subscription")
	}
}

// erroringPahoSubscribeClient wraps fakePahoClient to return an erroring
// SUBACK token from Subscribe.
type erroringPahoSubscribeClient struct {
	fakePahoClient
	err error
}

func (e *erroringPahoSubscribeClient) Subscribe(topic string, qos byte, _ pahoMessageHandler) pahoToken {
	e.fakePahoClient.mu.Lock()
	e.fakePahoClient.subscribeCalls++
	e.fakePahoClient.lastSubscribeTop = topic
	e.fakePahoClient.lastSubscribeQoS = qos
	e.fakePahoClient.mu.Unlock()
	return erroringPahoToken{err: e.err}
}

// timeoutPahoSubscribeClient wraps fakePahoClient to return a timing-out
// SUBACK token from Subscribe.
type timeoutPahoSubscribeClient struct {
	fakePahoClient
}

func (t *timeoutPahoSubscribeClient) Subscribe(topic string, qos byte, _ pahoMessageHandler) pahoToken {
	t.fakePahoClient.mu.Lock()
	t.fakePahoClient.subscribeCalls++
	t.fakePahoClient.lastSubscribeTop = topic
	t.fakePahoClient.lastSubscribeQoS = qos
	t.fakePahoClient.mu.Unlock()
	return timeoutPahoToken{}
}
