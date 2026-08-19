// DLQ inspector unit tests.
//
// These tests use an in-file fakeDLQInspectorClient that satisfies the
// subset of pahomqtt.Client the inspector touches (Subscribe + Publish +
// Unsubscribe). We deliberately do NOT share fakePahoClient from
// mqtt_test.go because that fake panics on Publish/Unsubscribe — the
// inspector exercises both, and adding inspector concerns to that fake
// would defeat its "panic on unexpected call" guarantee for the
// subscriber's tests.

package mqtt

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/rs/zerolog"
)

func TestDLQInspectorEntry_Replayable(t *testing.T) {
	tests := []struct {
		name string
		e    DLQInspectorEntry
		want bool
	}{
		{"happy", DLQInspectorEntry{ParsedSourceTopic: "telemetry/abc/v/Field"}, true},
		{"parse error", DLQInspectorEntry{ParseError: "boom", ParsedSourceTopic: "x"}, false},
		{"empty topic", DLQInspectorEntry{ParsedSourceTopic: ""}, false},
		{"whitespace topic", DLQInspectorEntry{ParsedSourceTopic: "   "}, false},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.e.Replayable(); got != tc.want {
				t.Errorf("Replayable() = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestNewDLQInspector_Validation(t *testing.T) {
	t.Run("nil client rejected", func(t *testing.T) {
		_, err := NewDLQInspector(nil, "telemetry/dlq", DLQInspectorConfig{}, zerolog.Nop())
		if err == nil {
			t.Fatal("expected error for nil client, got nil")
		}
	})
	t.Run("empty topic rejected", func(t *testing.T) {
		_, err := NewDLQInspector(&fakeDLQInspectorClient{}, "  ", DLQInspectorConfig{}, zerolog.Nop())
		if err == nil {
			t.Fatal("expected error for blank topic, got nil")
		}
	})
	t.Run("zero capacity defaults", func(t *testing.T) {
		ins, err := NewDLQInspector(&fakeDLQInspectorClient{}, "telemetry/dlq", DLQInspectorConfig{}, zerolog.Nop())
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got, want := len(ins.ring), DefaultDLQRingCapacity; got != want {
			t.Errorf("ring capacity = %d, want default %d", got, want)
		}
	})
	t.Run("trailing slash trimmed", func(t *testing.T) {
		ins, err := NewDLQInspector(&fakeDLQInspectorClient{}, "telemetry/dlq/", DLQInspectorConfig{}, zerolog.Nop())
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if ins.dlqTopic != "telemetry/dlq" {
			t.Errorf("dlqTopic = %q, want trailing slash stripped", ins.dlqTopic)
		}
	})
}

func TestDLQInspector_Start_Subscribes(t *testing.T) {
	fc := &fakeDLQInspectorClient{}
	ins, err := NewDLQInspector(fc, "telemetry/dlq", DLQInspectorConfig{}, zerolog.Nop())
	if err != nil {
		t.Fatalf("NewDLQInspector: %v", err)
	}
	if err := ins.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if got, want := fc.subscribeTopic(), "telemetry/dlq/#"; got != want {
		t.Errorf("subscribe topic = %q, want %q", got, want)
	}
}

func TestDLQInspector_HandleMessage_ParsesEnvelope(t *testing.T) {
	ins, fc := newTestInspector(t, DLQInspectorConfig{Capacity: 5})
	body := encodeDLQEnvelope(t, DLQEntry{
		Reason:       "codec_drop",
		VehicleID:    42,
		VIN:          "TEST00000000000VIN",
		Topic:        "telemetry/TEST00000000000VIN/v/VehicleSpeed",
		Payload:      []byte("inner-bytes"),
		Redeliveries: 0,
		Timestamp:    time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC),
	})
	deliverDLQ(fc, "telemetry/dlq/42", body)

	snap := ins.Snapshot()
	if len(snap) != 1 {
		t.Fatalf("snapshot len = %d, want 1", len(snap))
	}
	got := snap[0]
	if got.ParseError != "" {
		t.Errorf("ParseError = %q, want empty", got.ParseError)
	}
	if got.ParsedReason != "codec_drop" {
		t.Errorf("ParsedReason = %q", got.ParsedReason)
	}
	if got.ParsedVehicleID != 42 {
		t.Errorf("ParsedVehicleID = %d, want 42", got.ParsedVehicleID)
	}
	if got.ParsedVIN != "TEST00000000000VIN" {
		t.Errorf("ParsedVIN = %q", got.ParsedVIN)
	}
	if got.ParsedSourceTopic != "telemetry/TEST00000000000VIN/v/VehicleSpeed" {
		t.Errorf("ParsedSourceTopic = %q", got.ParsedSourceTopic)
	}
	if got.ParsedRedeliveries != 0 {
		t.Errorf("ParsedRedeliveries = %d, want 0", got.ParsedRedeliveries)
	}
	if !bytes.Equal(got.ParsedInnerPayload, []byte("inner-bytes")) {
		t.Errorf("ParsedInnerPayload = %q, want %q", got.ParsedInnerPayload, "inner-bytes")
	}
	if !got.Replayable() {
		t.Error("Replayable() = false, want true for fully-parsed entry")
	}
}

func TestDLQInspector_HandleMessage_MalformedSurfacedAsParseError(t *testing.T) {
	ins, fc := newTestInspector(t, DLQInspectorConfig{Capacity: 5})
	deliverDLQ(fc, "telemetry/dlq/unknown", []byte("{not-json"))
	snap := ins.Snapshot()
	if len(snap) != 1 {
		t.Fatalf("snapshot len = %d, want 1", len(snap))
	}
	got := snap[0]
	if got.ParseError == "" {
		t.Error("ParseError = empty, want non-empty for malformed body")
	}
	if !bytes.Equal(got.RawPayload, []byte("{not-json")) {
		t.Errorf("RawPayload = %q, want raw bytes preserved", got.RawPayload)
	}
	if got.Replayable() {
		t.Error("Replayable() = true, want false for parse-error entry")
	}
}

func TestDLQInspector_RingWraps_OldestDropped(t *testing.T) {
	ins, fc := newTestInspector(t, DLQInspectorConfig{Capacity: 3})
	for _, body := range []string{"a", "b", "c", "d", "e"} {
		env := encodeDLQEnvelope(t, DLQEntry{Topic: "telemetry/X/v/F", Payload: []byte(body)})
		deliverDLQ(fc, "telemetry/dlq/X", env)
	}
	snap := ins.Snapshot()
	if len(snap) != 3 {
		t.Fatalf("snapshot len = %d, want 3", len(snap))
	}
	want := []string{"e", "d", "c"}
	for i, w := range want {
		if string(snap[i].ParsedInnerPayload) != w {
			t.Errorf("snap[%d].ParsedInnerPayload = %q, want %q", i, snap[i].ParsedInnerPayload, w)
		}
	}
}

func TestDLQInspector_Get_FoundAndMissing(t *testing.T) {
	ins, fc := newTestInspector(t, DLQInspectorConfig{Capacity: 5})
	deliverDLQ(fc, "telemetry/dlq/1", encodeDLQEnvelope(t, DLQEntry{Topic: "telemetry/1/v/F", Payload: []byte("p")}))
	snap := ins.Snapshot()
	if len(snap) != 1 {
		t.Fatalf("len = %d", len(snap))
	}
	id := snap[0].ID

	got, err := ins.Get(id)
	if err != nil {
		t.Fatalf("Get(%q): %v", id, err)
	}
	if got.ID != id {
		t.Errorf("got.ID = %q, want %q", got.ID, id)
	}

	if _, err := ins.Get("does-not-exist"); !errors.Is(err, ErrDLQEntryNotFound) {
		t.Errorf("Get(missing) err = %v, want ErrDLQEntryNotFound", err)
	}
}

func TestDLQInspector_Replay_DisabledByDefault(t *testing.T) {
	ins, fc := newTestInspector(t, DLQInspectorConfig{Capacity: 5, ReplayEnabled: false})
	deliverDLQ(fc, "telemetry/dlq/1", encodeDLQEnvelope(t, DLQEntry{Topic: "telemetry/1/v/F", Payload: []byte("p")}))
	id := ins.Snapshot()[0].ID

	_, err := ins.Replay(context.Background(), id)
	if !errors.Is(err, ErrDLQReplayDisabled) {
		t.Errorf("Replay err = %v, want ErrDLQReplayDisabled", err)
	}
	if fc.publishCount() != 0 {
		t.Errorf("publishes = %d, want 0 when replay disabled", fc.publishCount())
	}
}

func TestDLQInspector_Replay_PublishesToParsedSourceTopic(t *testing.T) {
	ins, fc := newTestInspector(t, DLQInspectorConfig{Capacity: 5, ReplayEnabled: true})
	body := encodeDLQEnvelope(t, DLQEntry{
		Topic:   "telemetry/TEST/v/Field",
		Payload: []byte("inner-bytes"),
	})
	deliverDLQ(fc, "telemetry/dlq/TEST", body)
	id := ins.Snapshot()[0].ID

	got, err := ins.Replay(context.Background(), id)
	if err != nil {
		t.Fatalf("Replay: %v", err)
	}
	if got.ID != id {
		t.Errorf("returned entry id = %q, want %q", got.ID, id)
	}
	if fc.publishCount() != 1 {
		t.Fatalf("publishes = %d, want 1", fc.publishCount())
	}
	if got, want := fc.lastPublishTopic(), "telemetry/TEST/v/Field"; got != want {
		t.Errorf("publish topic = %q, want %q (must be ParsedSourceTopic, not DLQTopic)", got, want)
	}
	if !bytes.Equal(fc.lastPublishPayload(), []byte("inner-bytes")) {
		t.Errorf("publish payload = %q, want inner-bytes (NOT the JSON envelope)", fc.lastPublishPayload())
	}
}

func TestDLQInspector_Replay_UnparseableRejected(t *testing.T) {
	ins, fc := newTestInspector(t, DLQInspectorConfig{Capacity: 5, ReplayEnabled: true})
	deliverDLQ(fc, "telemetry/dlq/X", []byte("{malformed"))
	id := ins.Snapshot()[0].ID

	_, err := ins.Replay(context.Background(), id)
	if !errors.Is(err, ErrDLQEntryUnparseable) {
		t.Errorf("Replay err = %v, want ErrDLQEntryUnparseable", err)
	}
	if fc.publishCount() != 0 {
		t.Errorf("publishes = %d, want 0 for unparseable entry", fc.publishCount())
	}
}

func TestDLQInspector_Replay_EmptyInnerPayloadRejected(t *testing.T) {
	ins, fc := newTestInspector(t, DLQInspectorConfig{Capacity: 5, ReplayEnabled: true})
	// Envelope parses fine, but inner Payload is empty (corrupted publisher).
	body := encodeDLQEnvelope(t, DLQEntry{Topic: "telemetry/X/v/F", Payload: nil})
	deliverDLQ(fc, "telemetry/dlq/X", body)
	id := ins.Snapshot()[0].ID

	_, err := ins.Replay(context.Background(), id)
	if !errors.Is(err, ErrDLQEntryUnparseable) {
		t.Errorf("Replay err = %v, want ErrDLQEntryUnparseable for empty inner payload", err)
	}
	if fc.publishCount() != 0 {
		t.Errorf("publishes = %d, want 0", fc.publishCount())
	}
}

func TestDLQInspector_Replay_MissingID(t *testing.T) {
	ins, _ := newTestInspector(t, DLQInspectorConfig{Capacity: 5, ReplayEnabled: true})
	_, err := ins.Replay(context.Background(), "not-in-ring")
	if !errors.Is(err, ErrDLQEntryNotFound) {
		t.Errorf("Replay(missing) err = %v, want ErrDLQEntryNotFound", err)
	}
}

func TestDLQInspector_Replay_RespectsContext(t *testing.T) {
	fc := &fakeDLQInspectorClient{publishBlocks: true}
	ins, err := NewDLQInspector(fc, "telemetry/dlq", DLQInspectorConfig{Capacity: 5, ReplayEnabled: true}, zerolog.Nop())
	if err != nil {
		t.Fatalf("NewDLQInspector: %v", err)
	}
	if err := ins.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	deliverDLQ(fc, "telemetry/dlq/X", encodeDLQEnvelope(t, DLQEntry{Topic: "telemetry/X/v/F", Payload: []byte("p")}))
	id := ins.Snapshot()[0].ID

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = ins.Replay(ctx, id)
	if !errors.Is(err, context.Canceled) {
		t.Errorf("Replay(cancelled) err = %v, want context.Canceled", err)
	}
}

func TestDLQInspector_Snapshot_EmptyReturnsNonNil(t *testing.T) {
	ins, _ := newTestInspector(t, DLQInspectorConfig{Capacity: 5})
	snap := ins.Snapshot()
	if snap == nil {
		t.Error("Snapshot() = nil, want non-nil empty slice")
	}
	if len(snap) != 0 {
		t.Errorf("snapshot len = %d, want 0", len(snap))
	}
}

// --- helpers ---

func encodeDLQEnvelope(t *testing.T, env DLQEntry) []byte {
	t.Helper()
	b, err := json.Marshal(env)
	if err != nil {
		t.Fatalf("marshal DLQEntry: %v", err)
	}
	return b
}

func newTestInspector(t *testing.T, cfg DLQInspectorConfig) (*DLQInspector, *fakeDLQInspectorClient) {
	t.Helper()
	fc := &fakeDLQInspectorClient{}
	ins, err := NewDLQInspector(fc, "telemetry/dlq", cfg, zerolog.Nop())
	if err != nil {
		t.Fatalf("NewDLQInspector: %v", err)
	}
	if err := ins.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	return ins, fc
}

func deliverDLQ(fc *fakeDLQInspectorClient, topic string, body []byte) {
	h := fc.subscribeHandler()
	if h == nil {
		panic("subscribeHandler is nil — Start was not called or Subscribe was not invoked")
	}
	h(fc, &fakeDLQMessage{topic: topic, payload: body})
}

// fakeDLQInspectorClient is the smallest pahomqtt.Client satisfying the
// inspector's needs (Subscribe + Publish + Unsubscribe). All other methods
// panic — accidental dependency on broker-side behaviour surfaces loudly.
type fakeDLQInspectorClient struct {
	mu             sync.Mutex
	subTopic       string
	subHandler     pahomqtt.MessageHandler
	publishCalls   int
	lastPubTopic   string
	lastPubPayload []byte
	publishBlocks  bool // true → Publish returns a never-completing token
}

func (f *fakeDLQInspectorClient) Subscribe(topic string, _ byte, h pahomqtt.MessageHandler) pahomqtt.Token {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.subTopic = topic
	f.subHandler = h
	return immediatePahoToken{}
}

func (f *fakeDLQInspectorClient) Publish(topic string, _ byte, _ bool, body interface{}) pahomqtt.Token {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.publishCalls++
	f.lastPubTopic = topic
	if b, ok := body.([]byte); ok {
		f.lastPubPayload = append([]byte(nil), b...)
	}
	if f.publishBlocks {
		return blockingPahoToken{}
	}
	return immediatePahoToken{}
}

func (f *fakeDLQInspectorClient) Unsubscribe(_ ...string) pahomqtt.Token {
	return immediatePahoToken{}
}

func (f *fakeDLQInspectorClient) subscribeTopic() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.subTopic
}

func (f *fakeDLQInspectorClient) subscribeHandler() pahomqtt.MessageHandler {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.subHandler
}

func (f *fakeDLQInspectorClient) publishCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.publishCalls
}

func (f *fakeDLQInspectorClient) lastPublishTopic() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.lastPubTopic
}

func (f *fakeDLQInspectorClient) lastPublishPayload() []byte {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]byte, len(f.lastPubPayload))
	copy(out, f.lastPubPayload)
	return out
}

// Unused pahomqtt.Client methods.
func (f *fakeDLQInspectorClient) IsConnected() bool       { return true }
func (f *fakeDLQInspectorClient) IsConnectionOpen() bool  { return true }
func (f *fakeDLQInspectorClient) Connect() pahomqtt.Token { panic("not used") }
func (f *fakeDLQInspectorClient) Disconnect(_ uint)       { panic("not used") }
func (f *fakeDLQInspectorClient) SubscribeMultiple(_ map[string]byte, _ pahomqtt.MessageHandler) pahomqtt.Token {
	panic("not used")
}
func (f *fakeDLQInspectorClient) AddRoute(_ string, _ pahomqtt.MessageHandler) {}
func (f *fakeDLQInspectorClient) OptionsReader() pahomqtt.ClientOptionsReader  { panic("not used") }

// blockingPahoToken simulates a Publish that never completes (broker hung,
// network gone). Used by TestDLQInspector_Replay_RespectsContext.
type blockingPahoToken struct{}

func (blockingPahoToken) Wait() bool                       { time.Sleep(10 * time.Second); return false }
func (blockingPahoToken) WaitTimeout(_ time.Duration) bool { return false }
func (blockingPahoToken) Done() <-chan struct{}            { return make(chan struct{}) }
func (blockingPahoToken) Error() error                     { return nil }

// fakeDLQMessage satisfies the small subset of pahomqtt.Message that the
// inspector's handler reads (Topic + Payload). Duplicate IDs / acks /
// retained / QoS getters return zero values.
type fakeDLQMessage struct {
	topic   string
	payload []byte
}

func (m *fakeDLQMessage) Duplicate() bool   { return false }
func (m *fakeDLQMessage) Qos() byte         { return 0 }
func (m *fakeDLQMessage) Retained() bool    { return false }
func (m *fakeDLQMessage) Topic() string     { return m.topic }
func (m *fakeDLQMessage) MessageID() uint16 { return 0 }
func (m *fakeDLQMessage) Payload() []byte   { return m.payload }
func (m *fakeDLQMessage) Ack()              {}

// Guard against silent rename: if pahomqtt.Message changes shape, this
// assignment will fail to compile.
var _ pahomqtt.Message = (*fakeDLQMessage)(nil)
var _ pahomqtt.Client = (*fakeDLQInspectorClient)(nil)

// String concatenation used in tests above relies on this — keep an
// import so refactors don't drop it.
var _ = strings.HasPrefix
