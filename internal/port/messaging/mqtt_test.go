package messaging_test

import (
	"context"
	"errors"
	"reflect"
	"sync"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/port/messaging"
)

// TestMessageHandlerSignature locks the Phase-42 handler shape:
// (ctx, payload, vehicleID) → error. No topic, no decoded values,
// no enum parsing across this seam.
func TestMessageHandlerSignature(t *testing.T) {
	t.Parallel()

	var h messaging.MessageHandler
	typ := reflect.TypeOf(h)
	if typ.Kind() != reflect.Func {
		t.Fatalf("MessageHandler must be a func type, got %v", typ.Kind())
	}

	if got, want := typ.NumIn(), 3; got != want {
		t.Fatalf("MessageHandler arity: got %d in-params, want %d", got, want)
	}
	if got, want := typ.NumOut(), 1; got != want {
		t.Fatalf("MessageHandler arity: got %d out-params, want %d", got, want)
	}

	ctxIface := reflect.TypeOf((*context.Context)(nil)).Elem()
	if !typ.In(0).Implements(ctxIface) {
		t.Errorf("MessageHandler arg 0: got %v, want context.Context", typ.In(0))
	}
	if got, want := typ.In(1), reflect.TypeOf([]byte(nil)); got != want {
		t.Errorf("MessageHandler arg 1: got %v, want []byte", got)
	}
	if got, want := typ.In(2), reflect.TypeOf(int64(0)); got != want {
		t.Errorf("MessageHandler arg 2: got %v, want int64", got)
	}

	errIface := reflect.TypeOf((*error)(nil)).Elem()
	if !typ.Out(0).Implements(errIface) {
		t.Errorf("MessageHandler return: got %v, want error", typ.Out(0))
	}
}

// TestSubscriberInterfaceSurface locks the Phase-42 Subscriber port:
// only Subscribe(topic, MessageHandler) error and Close(). Unsubscribe
// and any decode/enum methods MUST stay out of this seam.
func TestSubscriberInterfaceSurface(t *testing.T) {
	t.Parallel()

	subIface := reflect.TypeOf((*messaging.Subscriber)(nil)).Elem()
	if subIface.Kind() != reflect.Interface {
		t.Fatalf("Subscriber must be an interface, got %v", subIface.Kind())
	}

	if got, want := subIface.NumMethod(), 2; got != want {
		methods := make([]string, 0, subIface.NumMethod())
		for i := 0; i < subIface.NumMethod(); i++ {
			methods = append(methods, subIface.Method(i).Name)
		}
		t.Fatalf("Subscriber method count: got %d (%v), want %d (Subscribe, Close)",
			got, methods, want)
	}

	subscribe, ok := subIface.MethodByName("Subscribe")
	if !ok {
		t.Fatal("Subscriber missing Subscribe method")
	}
	subType := subscribe.Type
	if got, want := subType.NumIn(), 2; got != want {
		t.Errorf("Subscribe arity: got %d in-params, want %d (topic, handler)", got, want)
	}
	if got, want := subType.In(0), reflect.TypeOf(""); got != want {
		t.Errorf("Subscribe arg 0: got %v, want string (topic)", got)
	}
	if got, want := subType.In(1), reflect.TypeOf(messaging.MessageHandler(nil)); got != want {
		t.Errorf("Subscribe arg 1: got %v, want messaging.MessageHandler", got)
	}
	if got, want := subType.NumOut(), 1; got != want {
		t.Errorf("Subscribe return arity: got %d, want %d (error)", got, want)
	}

	closeMethod, ok := subIface.MethodByName("Close")
	if !ok {
		t.Fatal("Subscriber missing Close method")
	}
	if got, want := closeMethod.Type.NumIn(), 0; got != want {
		t.Errorf("Close arity: got %d in-params, want %d", got, want)
	}
	if got, want := closeMethod.Type.NumOut(), 0; got != want {
		t.Errorf("Close return arity: got %d, want %d (no return)", got, want)
	}

	// Forbidden methods that previously lived on the legacy port.
	for _, name := range []string{"Unsubscribe", "Decode", "ParseEnum", "Handler"} {
		if _, found := subIface.MethodByName(name); found {
			t.Errorf("Subscriber must not expose %q on the Phase-42 port", name)
		}
	}
}

// TestMQTTPublisherInterfaceSurface verifies the publisher port is
// untouched by this prompt: Publish(ctx, topic, payload) error.
func TestMQTTPublisherInterfaceSurface(t *testing.T) {
	t.Parallel()

	pubIface := reflect.TypeOf((*messaging.MQTTPublisher)(nil)).Elem()
	if got, want := pubIface.NumMethod(), 1; got != want {
		t.Fatalf("MQTTPublisher method count: got %d, want %d", got, want)
	}
	publish, _ := pubIface.MethodByName("Publish")
	if publish.Type.NumIn() != 3 {
		t.Errorf("Publish arity: got %d in-params, want 3 (ctx, topic, payload)",
			publish.Type.NumIn())
	}
}

// fakeSubscriber is a minimal in-memory implementation used to verify
// the Subscriber contract is satisfiable and behaves as documented.
type fakeSubscriber struct {
	mu       sync.Mutex
	handlers map[string]messaging.MessageHandler
	closed   bool
}

func newFakeSubscriber() *fakeSubscriber {
	return &fakeSubscriber{handlers: make(map[string]messaging.MessageHandler)}
}

func (f *fakeSubscriber) Subscribe(topic string, h messaging.MessageHandler) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.closed {
		return errors.New("subscriber closed")
	}
	f.handlers[topic] = h
	return nil
}

func (f *fakeSubscriber) Close() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.closed = true
}

func (f *fakeSubscriber) deliver(ctx context.Context, topic string, payload []byte, vehicleID int64) error {
	f.mu.Lock()
	h, ok := f.handlers[topic]
	f.mu.Unlock()
	if !ok {
		return errors.New("no handler for topic")
	}
	return h(ctx, payload, vehicleID)
}

func TestSubscriberContractRoundTrip(t *testing.T) {
	t.Parallel()

	// Compile-time assertion: fakeSubscriber satisfies the port.
	var _ messaging.Subscriber = (*fakeSubscriber)(nil)

	sub := newFakeSubscriber()

	type call struct {
		payload   []byte
		vehicleID int64
	}
	var got call
	handler := func(_ context.Context, payload []byte, vehicleID int64) error {
		got = call{payload: payload, vehicleID: vehicleID}
		return nil
	}

	if err := sub.Subscribe("teslatel/payload/+", handler); err != nil {
		t.Fatalf("Subscribe: %v", err)
	}

	wantPayload := []byte{0x01, 0x02, 0x03}
	wantVehicleID := int64(42)
	if err := sub.deliver(context.Background(), "teslatel/payload/+", wantPayload, wantVehicleID); err != nil {
		t.Fatalf("deliver: %v", err)
	}
	if !reflect.DeepEqual(got.payload, wantPayload) {
		t.Errorf("payload: got %v, want %v", got.payload, wantPayload)
	}
	if got.vehicleID != wantVehicleID {
		t.Errorf("vehicleID: got %d, want %d", got.vehicleID, wantVehicleID)
	}

	sub.Close()
	if err := sub.Subscribe("after-close", handler); err == nil {
		t.Error("Subscribe after Close: got nil error, want non-nil")
	}
}

// TestSubscriberHandlerErrorPropagates verifies the handler-error
// contract: a non-nil error from MessageHandler is surfaced to the
// adapter, which then drives redelivery / DLQ policy. The port itself
// stays out of that policy — it just propagates.
func TestSubscriberHandlerErrorPropagates(t *testing.T) {
	t.Parallel()

	sub := newFakeSubscriber()
	wantErr := errors.New("pipeline rejected payload")
	handler := func(_ context.Context, _ []byte, _ int64) error { return wantErr }

	if err := sub.Subscribe("topic", handler); err != nil {
		t.Fatalf("Subscribe: %v", err)
	}
	err := sub.deliver(context.Background(), "topic", []byte{0xFF}, 7)
	if !errors.Is(err, wantErr) {
		t.Fatalf("deliver: got err=%v, want %v", err, wantErr)
	}
}
