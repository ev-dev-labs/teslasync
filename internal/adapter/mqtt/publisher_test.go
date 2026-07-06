package mqtt

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"

	"github.com/ev-dev-labs/teslasync/internal/platform/config"
	"github.com/ev-dev-labs/teslasync/internal/port/messaging"
)

// ---------------------------------------------------------------------------
// Test doubles for the Paho seams (Token / Message / Client are all interfaces).
// ---------------------------------------------------------------------------

// fakeToken is a controllable pahomqtt.Token. A closed done channel signals
// completion; an open one keeps the token pending forever (to exercise
// timeout / cancellation paths).
type fakeToken struct {
	done chan struct{}
	err  error
}

func completedToken(err error) *fakeToken {
	ch := make(chan struct{})
	close(ch)
	return &fakeToken{done: ch, err: err}
}

func pendingToken() *fakeToken {
	return &fakeToken{done: make(chan struct{})}
}

func (t *fakeToken) Wait() bool {
	<-t.done
	return true
}

func (t *fakeToken) WaitTimeout(d time.Duration) bool {
	select {
	case <-t.done:
		return true
	case <-time.After(d):
		return false
	}
}

func (t *fakeToken) Done() <-chan struct{} { return t.done }
func (t *fakeToken) Error() error          { return t.err }

// fakeMessage is a controllable pahomqtt.Message.
type fakeMessage struct {
	topic   string
	payload []byte
}

func (m *fakeMessage) Duplicate() bool   { return false }
func (m *fakeMessage) Qos() byte         { return 1 }
func (m *fakeMessage) Retained() bool    { return false }
func (m *fakeMessage) Topic() string     { return m.topic }
func (m *fakeMessage) MessageID() uint16 { return 0 }
func (m *fakeMessage) Payload() []byte   { return m.payload }
func (m *fakeMessage) Ack()              {}

// publishCall records the arguments forwarded to client.Publish.
type publishCall struct {
	topic    string
	qos      byte
	retained bool
	payload  interface{}
}

// fakeClient is a controllable pahomqtt.Client that records calls and returns
// preconfigured tokens. A nil configured token defaults to an immediately
// completed, error-free token.
type fakeClient struct {
	mu sync.Mutex

	connectToken     pahomqtt.Token
	publishToken     pahomqtt.Token
	subscribeToken   pahomqtt.Token
	unsubscribeToken pahomqtt.Token

	connectCalls      int
	publishCalls      []publishCall
	subscribeCalls    int
	unsubscribeCalls  int
	subscribeTopic    string
	subscribeQos      byte
	subscribeCallback pahomqtt.MessageHandler
	unsubscribeTopics []string
}

func (c *fakeClient) tokenOr(tok pahomqtt.Token) pahomqtt.Token {
	if tok != nil {
		return tok
	}
	return completedToken(nil)
}

func (c *fakeClient) IsConnected() bool      { return true }
func (c *fakeClient) IsConnectionOpen() bool { return true }

func (c *fakeClient) Connect() pahomqtt.Token {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.connectCalls++
	return c.tokenOr(c.connectToken)
}

func (c *fakeClient) Disconnect(uint) {}

func (c *fakeClient) Publish(topic string, qos byte, retained bool, payload interface{}) pahomqtt.Token {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.publishCalls = append(c.publishCalls, publishCall{topic: topic, qos: qos, retained: retained, payload: payload})
	return c.tokenOr(c.publishToken)
}

func (c *fakeClient) Subscribe(topic string, qos byte, cb pahomqtt.MessageHandler) pahomqtt.Token {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.subscribeCalls++
	c.subscribeTopic = topic
	c.subscribeQos = qos
	c.subscribeCallback = cb
	return c.tokenOr(c.subscribeToken)
}

func (c *fakeClient) SubscribeMultiple(map[string]byte, pahomqtt.MessageHandler) pahomqtt.Token {
	return completedToken(nil)
}

func (c *fakeClient) Unsubscribe(topics ...string) pahomqtt.Token {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.unsubscribeCalls++
	c.unsubscribeTopics = topics
	return c.tokenOr(c.unsubscribeToken)
}

func (c *fakeClient) AddRoute(string, pahomqtt.MessageHandler) {}
func (c *fakeClient) OptionsReader() pahomqtt.ClientOptionsReader {
	return pahomqtt.ClientOptionsReader{}
}

func (c *fakeClient) publishCount() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.publishCalls)
}

// Compile-time assertions that the fakes satisfy the Paho interfaces.
var (
	_ pahomqtt.Token   = (*fakeToken)(nil)
	_ pahomqtt.Message = (*fakeMessage)(nil)
	_ pahomqtt.Client  = (*fakeClient)(nil)
)

// withStubbedNewClient swaps the package-level newClient seam for the duration
// of a test and restores it afterwards. Callers must not run in parallel.
func withStubbedNewClient(t *testing.T, fn func(*pahomqtt.ClientOptions) pahomqtt.Client) {
	t.Helper()
	orig := newClient
	newClient = fn
	t.Cleanup(func() { newClient = orig })
}

var errBroker = errors.New("broker boom")

// ---------------------------------------------------------------------------
// waitToken
// ---------------------------------------------------------------------------

func TestWaitToken(t *testing.T) {
	tests := []struct {
		name       string
		token      pahomqtt.Token
		ctx        func() (context.Context, context.CancelFunc)
		timeout    time.Duration
		wantErr    bool
		wantIs     error  // errors.Is target (nil to skip)
		wantSubstr string // substring the error must contain
	}{
		{
			name:    "success",
			token:   completedToken(nil),
			ctx:     func() (context.Context, context.CancelFunc) { return context.Background(), func() {} },
			timeout: time.Second,
			wantErr: false,
		},
		{
			name:       "broker error is wrapped with op",
			token:      completedToken(errBroker),
			ctx:        func() (context.Context, context.CancelFunc) { return context.Background(), func() {} },
			timeout:    time.Second,
			wantErr:    true,
			wantIs:     errBroker,
			wantSubstr: "op-context",
		},
		{
			name:  "context already cancelled",
			token: pendingToken(),
			ctx: func() (context.Context, context.CancelFunc) {
				ctx, cancel := context.WithCancel(context.Background())
				cancel()
				return ctx, func() {}
			},
			timeout:    time.Second,
			wantErr:    true,
			wantIs:     context.Canceled,
			wantSubstr: "op-context",
		},
		{
			name:  "context deadline exceeded",
			token: pendingToken(),
			ctx: func() (context.Context, context.CancelFunc) {
				return context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
			},
			timeout: time.Second,
			wantErr: true,
			wantIs:  context.DeadlineExceeded,
		},
		{
			name:       "timeout when neither token nor ctx fire",
			token:      pendingToken(),
			ctx:        func() (context.Context, context.CancelFunc) { return context.Background(), func() {} },
			timeout:    20 * time.Millisecond,
			wantErr:    true,
			wantSubstr: "timed out after",
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			ctx, cancel := tt.ctx()
			defer cancel()

			err := waitToken(ctx, tt.token, tt.timeout, "op-context")

			if tt.wantErr && err == nil {
				t.Fatalf("waitToken: want error, got nil")
			}
			if !tt.wantErr && err != nil {
				t.Fatalf("waitToken: want nil error, got %v", err)
			}
			if tt.wantIs != nil && !errors.Is(err, tt.wantIs) {
				t.Errorf("waitToken: error %v is not %v", err, tt.wantIs)
			}
			if tt.wantSubstr != "" && (err == nil || !strings.Contains(err.Error(), tt.wantSubstr)) {
				t.Errorf("waitToken: error %v does not contain %q", err, tt.wantSubstr)
			}
		})
	}
}

// TestWaitTokenCancelDuringWait exercises the cancellation branch when the
// context is cancelled *after* the wait begins (not pre-cancelled).
func TestWaitTokenCancelDuringWait(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(10 * time.Millisecond)
		cancel()
	}()

	err := waitToken(ctx, pendingToken(), 5*time.Second, "op-context")
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("want context.Canceled, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// NewPublisher / NewSubscriber
// ---------------------------------------------------------------------------

func testMQTTConfig() config.MQTTConfig {
	return config.MQTTConfig{
		Host:     "broker.example",
		Port:     1883,
		Username: "user",
		Password: "secret",
		ClientID: "teslasync",
	}
}

func TestNewPublisher(t *testing.T) {
	t.Run("success sets options and qos", func(t *testing.T) {
		cfg := testMQTTConfig()
		var captured *pahomqtt.ClientOptions
		fc := &fakeClient{connectToken: completedToken(nil)}
		withStubbedNewClient(t, func(o *pahomqtt.ClientOptions) pahomqtt.Client {
			captured = o
			return fc
		})

		pub, err := NewPublisher(cfg)
		if err != nil {
			t.Fatalf("NewPublisher: unexpected error %v", err)
		}
		if pub == nil || pub.client == nil {
			t.Fatal("NewPublisher: nil publisher/client")
		}
		if pub.qos != 1 {
			t.Errorf("qos: got %d, want 1", pub.qos)
		}
		if fc.connectCalls != 1 {
			t.Errorf("Connect calls: got %d, want 1", fc.connectCalls)
		}
		if captured == nil {
			t.Fatal("client options were not captured")
		}
		if got, want := captured.ClientID, cfg.ClientID+"_pub"; got != want {
			t.Errorf("ClientID: got %q, want %q", got, want)
		}
		if len(captured.Servers) != 1 || captured.Servers[0].String() != cfg.BrokerURL() {
			t.Errorf("Servers: got %v, want [%s]", captured.Servers, cfg.BrokerURL())
		}
		if captured.Username != cfg.Username || captured.Password != cfg.Password {
			t.Errorf("credentials: got %q/%q, want %q/%q", captured.Username, captured.Password, cfg.Username, cfg.Password)
		}
		if !captured.AutoReconnect {
			t.Error("AutoReconnect: want true")
		}
	})

	t.Run("connect error is wrapped and returns nil publisher", func(t *testing.T) {
		fc := &fakeClient{connectToken: completedToken(errBroker)}
		withStubbedNewClient(t, func(*pahomqtt.ClientOptions) pahomqtt.Client { return fc })

		pub, err := NewPublisher(testMQTTConfig())
		if err == nil {
			t.Fatal("NewPublisher: want error, got nil")
		}
		if pub != nil {
			t.Errorf("NewPublisher: want nil publisher on error, got %#v", pub)
		}
		if !errors.Is(err, errBroker) {
			t.Errorf("error %v is not %v", err, errBroker)
		}
		if !strings.Contains(err.Error(), "connecting to MQTT broker") {
			t.Errorf("error %v missing connect context", err)
		}
	})
}

func TestNewSubscriber(t *testing.T) {
	t.Run("success sets sub client id", func(t *testing.T) {
		cfg := testMQTTConfig()
		var captured *pahomqtt.ClientOptions
		fc := &fakeClient{connectToken: completedToken(nil)}
		withStubbedNewClient(t, func(o *pahomqtt.ClientOptions) pahomqtt.Client {
			captured = o
			return fc
		})

		sub, err := NewSubscriber(cfg)
		if err != nil {
			t.Fatalf("NewSubscriber: unexpected error %v", err)
		}
		if sub == nil || sub.client == nil {
			t.Fatal("NewSubscriber: nil subscriber/client")
		}
		if fc.connectCalls != 1 {
			t.Errorf("Connect calls: got %d, want 1", fc.connectCalls)
		}
		if got, want := captured.ClientID, cfg.ClientID+"_sub"; got != want {
			t.Errorf("ClientID: got %q, want %q", got, want)
		}
	})

	t.Run("connect error is wrapped and returns nil subscriber", func(t *testing.T) {
		fc := &fakeClient{connectToken: completedToken(errBroker)}
		withStubbedNewClient(t, func(*pahomqtt.ClientOptions) pahomqtt.Client { return fc })

		sub, err := NewSubscriber(testMQTTConfig())
		if err == nil {
			t.Fatal("NewSubscriber: want error, got nil")
		}
		if sub != nil {
			t.Errorf("NewSubscriber: want nil subscriber on error, got %#v", sub)
		}
		if !errors.Is(err, errBroker) {
			t.Errorf("error %v is not %v", err, errBroker)
		}
	})
}

// ---------------------------------------------------------------------------
// Publisher.Publish
// ---------------------------------------------------------------------------

func TestPublisherPublish(t *testing.T) {
	tests := []struct {
		name         string
		qos          byte
		topic        string
		payload      []byte
		publishToken pahomqtt.Token
		ctx          func() context.Context
		wantErr      bool
		wantIs       error
		wantSubstr   string
		wantPublish  bool // whether client.Publish should have been invoked
	}{
		{
			name:        "success forwards args",
			qos:         2,
			topic:       "sensors/temp",
			payload:     []byte("22.5"),
			ctx:         context.Background,
			wantErr:     false,
			wantPublish: true,
		},
		{
			name:        "empty topic rejected before broker call",
			qos:         1,
			topic:       "",
			payload:     []byte("x"),
			ctx:         context.Background,
			wantErr:     true,
			wantIs:      errEmptyTopic,
			wantPublish: false,
		},
		{
			name:    "cancelled context rejected before broker call",
			qos:     1,
			topic:   "sensors/temp",
			payload: []byte("x"),
			ctx: func() context.Context {
				ctx, cancel := context.WithCancel(context.Background())
				cancel()
				return ctx
			},
			wantErr:     true,
			wantIs:      context.Canceled,
			wantSubstr:  "publishing to sensors/temp",
			wantPublish: false,
		},
		{
			name:         "broker error is wrapped",
			qos:          1,
			topic:        "sensors/temp",
			payload:      []byte("x"),
			publishToken: completedToken(errBroker),
			ctx:          context.Background,
			wantErr:      true,
			wantIs:       errBroker,
			wantSubstr:   "publishing to sensors/temp",
			wantPublish:  true,
		},
		{
			name:        "nil payload is allowed",
			qos:         1,
			topic:       "sensors/temp",
			payload:     nil,
			ctx:         context.Background,
			wantErr:     false,
			wantPublish: true,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			fc := &fakeClient{publishToken: tt.publishToken}
			p := &Publisher{client: fc, qos: tt.qos}

			err := p.Publish(tt.ctx(), tt.topic, tt.payload)

			if tt.wantErr && err == nil {
				t.Fatalf("Publish: want error, got nil")
			}
			if !tt.wantErr && err != nil {
				t.Fatalf("Publish: want nil error, got %v", err)
			}
			if tt.wantIs != nil && !errors.Is(err, tt.wantIs) {
				t.Errorf("Publish: error %v is not %v", err, tt.wantIs)
			}
			if tt.wantSubstr != "" && (err == nil || !strings.Contains(err.Error(), tt.wantSubstr)) {
				t.Errorf("Publish: error %v does not contain %q", err, tt.wantSubstr)
			}

			gotPublished := fc.publishCount() == 1
			if gotPublished != tt.wantPublish {
				t.Fatalf("Publish invoked=%v, want %v", gotPublished, tt.wantPublish)
			}
			if tt.wantPublish {
				call := fc.publishCalls[0]
				if call.topic != tt.topic {
					t.Errorf("forwarded topic: got %q, want %q", call.topic, tt.topic)
				}
				if call.qos != tt.qos {
					t.Errorf("forwarded qos: got %d, want %d", call.qos, tt.qos)
				}
				if call.retained {
					t.Error("forwarded retained: got true, want false")
				}
				gotPayload, ok := call.payload.([]byte)
				if !ok {
					t.Fatalf("forwarded payload type: got %T, want []byte", call.payload)
				}
				if string(gotPayload) != string(tt.payload) {
					t.Errorf("forwarded payload: got %q, want %q", gotPayload, tt.payload)
				}
			}
		})
	}
}

// TestPublisherPublishContextCancelDuringWait verifies that a cancellation
// arriving while the broker round-trip is in flight surfaces as an error
// instead of a swallowed timeout.
func TestPublisherPublishContextCancelDuringWait(t *testing.T) {
	t.Parallel()
	fc := &fakeClient{publishToken: pendingToken()}
	p := &Publisher{client: fc, qos: 1}

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(10 * time.Millisecond)
		cancel()
	}()

	err := p.Publish(ctx, "sensors/temp", []byte("x"))
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("want context.Canceled, got %v", err)
	}
	if fc.publishCount() != 1 {
		t.Errorf("expected exactly one Publish invocation, got %d", fc.publishCount())
	}
}

// ---------------------------------------------------------------------------
// Subscriber.Subscribe
// ---------------------------------------------------------------------------

func okHandler(_ context.Context, _ string, _ []byte) error { return nil }

func TestSubscriberSubscribe(t *testing.T) {
	tests := []struct {
		name           string
		topic          string
		handler        messaging.MQTTHandler
		subscribeToken pahomqtt.Token
		ctx            func() context.Context
		wantErr        bool
		wantIs         error
		wantSubstr     string
		wantSubscribe  bool
	}{
		{
			name:          "success",
			topic:         "telemetry/+/v/+",
			handler:       okHandler,
			ctx:           context.Background,
			wantErr:       false,
			wantSubscribe: true,
		},
		{
			name:          "empty topic rejected",
			topic:         "",
			handler:       okHandler,
			ctx:           context.Background,
			wantErr:       true,
			wantIs:        errEmptyTopic,
			wantSubscribe: false,
		},
		{
			name:          "nil handler rejected",
			topic:         "telemetry/+/v/+",
			handler:       nil,
			ctx:           context.Background,
			wantErr:       true,
			wantIs:        errNilHandler,
			wantSubscribe: false,
		},
		{
			name:    "cancelled context rejected",
			topic:   "telemetry/+/v/+",
			handler: okHandler,
			ctx: func() context.Context {
				ctx, cancel := context.WithCancel(context.Background())
				cancel()
				return ctx
			},
			wantErr:       true,
			wantIs:        context.Canceled,
			wantSubscribe: false,
		},
		{
			name:           "broker error is wrapped",
			topic:          "telemetry/+/v/+",
			handler:        okHandler,
			subscribeToken: completedToken(errBroker),
			ctx:            context.Background,
			wantErr:        true,
			wantIs:         errBroker,
			wantSubstr:     "subscribing to telemetry/+/v/+",
			wantSubscribe:  true,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			fc := &fakeClient{subscribeToken: tt.subscribeToken}
			s := &Subscriber{client: fc}

			err := s.Subscribe(tt.ctx(), tt.topic, tt.handler)

			if tt.wantErr && err == nil {
				t.Fatalf("Subscribe: want error, got nil")
			}
			if !tt.wantErr && err != nil {
				t.Fatalf("Subscribe: want nil error, got %v", err)
			}
			if tt.wantIs != nil && !errors.Is(err, tt.wantIs) {
				t.Errorf("Subscribe: error %v is not %v", err, tt.wantIs)
			}
			if tt.wantSubstr != "" && (err == nil || !strings.Contains(err.Error(), tt.wantSubstr)) {
				t.Errorf("Subscribe: error %v does not contain %q", err, tt.wantSubstr)
			}
			if got := fc.subscribeCalls == 1; got != tt.wantSubscribe {
				t.Errorf("Subscribe invoked=%v, want %v", got, tt.wantSubscribe)
			}
			if tt.wantSubscribe {
				if fc.subscribeTopic != tt.topic {
					t.Errorf("forwarded topic: got %q, want %q", fc.subscribeTopic, tt.topic)
				}
				if fc.subscribeQos != 1 {
					t.Errorf("forwarded qos: got %d, want 1", fc.subscribeQos)
				}
			}
		})
	}
}

// TestSubscriberSubscribeCallbackDelivers verifies the Paho callback wired by
// Subscribe forwards the message topic and payload (and the Subscribe-time
// context) to the domain handler.
func TestSubscriberSubscribeCallbackDelivers(t *testing.T) {
	t.Parallel()
	fc := &fakeClient{}
	s := &Subscriber{client: fc}

	type received struct {
		ctx     context.Context
		topic   string
		payload []byte
	}
	var got received
	var called bool
	handler := func(ctx context.Context, topic string, payload []byte) error {
		called = true
		got = received{ctx: ctx, topic: topic, payload: payload}
		return nil
	}

	type ctxKey string
	const key ctxKey = "trace"
	ctx := context.WithValue(context.Background(), key, "abc123")

	if err := s.Subscribe(ctx, "telemetry/VIN/v/Field", handler); err != nil {
		t.Fatalf("Subscribe: %v", err)
	}
	if fc.subscribeCallback == nil {
		t.Fatal("Subscribe did not register a Paho callback")
	}

	msg := &fakeMessage{topic: "telemetry/VIN/v/Field", payload: []byte{0x01, 0x02, 0x03}}
	fc.subscribeCallback(fc, msg)

	if !called {
		t.Fatal("handler was not invoked by the callback")
	}
	if got.topic != msg.topic {
		t.Errorf("handler topic: got %q, want %q", got.topic, msg.topic)
	}
	if string(got.payload) != string(msg.payload) {
		t.Errorf("handler payload: got %v, want %v", got.payload, msg.payload)
	}
	if v, _ := got.ctx.Value(key).(string); v != "abc123" {
		t.Errorf("handler ctx: subscribe-time context not propagated, got value %q", v)
	}
}

// TestSubscriberSubscribeCallbackHandlerError verifies that a handler error is
// swallowed (logged) inside the callback and does not panic — the generic
// adapter does not drive redelivery.
func TestSubscriberSubscribeCallbackHandlerError(t *testing.T) {
	t.Parallel()
	fc := &fakeClient{}
	s := &Subscriber{client: fc}

	var calls int
	handler := func(context.Context, string, []byte) error {
		calls++
		return errors.New("handler rejected")
	}
	if err := s.Subscribe(context.Background(), "topic", handler); err != nil {
		t.Fatalf("Subscribe: %v", err)
	}

	// Must not panic even though the handler returns an error.
	fc.subscribeCallback(fc, &fakeMessage{topic: "topic", payload: []byte("x")})
	if calls != 1 {
		t.Errorf("handler invocations: got %d, want 1", calls)
	}
}

func TestSubscriberSubscribeContextCancelDuringWait(t *testing.T) {
	t.Parallel()
	fc := &fakeClient{subscribeToken: pendingToken()}
	s := &Subscriber{client: fc}

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(10 * time.Millisecond)
		cancel()
	}()

	err := s.Subscribe(ctx, "telemetry/+/v/+", okHandler)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("want context.Canceled, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// Subscriber.Unsubscribe
// ---------------------------------------------------------------------------

func TestSubscriberUnsubscribe(t *testing.T) {
	tests := []struct {
		name             string
		topic            string
		unsubscribeToken pahomqtt.Token
		ctx              func() context.Context
		wantErr          bool
		wantIs           error
		wantSubstr       string
		wantUnsubscribe  bool
	}{
		{
			name:            "success forwards topic",
			topic:           "telemetry/+/v/+",
			ctx:             context.Background,
			wantErr:         false,
			wantUnsubscribe: true,
		},
		{
			name:            "empty topic rejected",
			topic:           "",
			ctx:             context.Background,
			wantErr:         true,
			wantIs:          errEmptyTopic,
			wantUnsubscribe: false,
		},
		{
			name:  "cancelled context rejected",
			topic: "telemetry/+/v/+",
			ctx: func() context.Context {
				ctx, cancel := context.WithCancel(context.Background())
				cancel()
				return ctx
			},
			wantErr:         true,
			wantIs:          context.Canceled,
			wantUnsubscribe: false,
		},
		{
			name:             "broker error is wrapped",
			topic:            "telemetry/+/v/+",
			unsubscribeToken: completedToken(errBroker),
			ctx:              context.Background,
			wantErr:          true,
			wantIs:           errBroker,
			wantSubstr:       "unsubscribing from telemetry/+/v/+",
			wantUnsubscribe:  true,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			fc := &fakeClient{unsubscribeToken: tt.unsubscribeToken}
			s := &Subscriber{client: fc}

			err := s.Unsubscribe(tt.ctx(), tt.topic)

			if tt.wantErr && err == nil {
				t.Fatalf("Unsubscribe: want error, got nil")
			}
			if !tt.wantErr && err != nil {
				t.Fatalf("Unsubscribe: want nil error, got %v", err)
			}
			if tt.wantIs != nil && !errors.Is(err, tt.wantIs) {
				t.Errorf("Unsubscribe: error %v is not %v", err, tt.wantIs)
			}
			if tt.wantSubstr != "" && (err == nil || !strings.Contains(err.Error(), tt.wantSubstr)) {
				t.Errorf("Unsubscribe: error %v does not contain %q", err, tt.wantSubstr)
			}
			if got := fc.unsubscribeCalls == 1; got != tt.wantUnsubscribe {
				t.Errorf("Unsubscribe invoked=%v, want %v", got, tt.wantUnsubscribe)
			}
			if tt.wantUnsubscribe {
				if len(fc.unsubscribeTopics) != 1 || fc.unsubscribeTopics[0] != tt.topic {
					t.Errorf("forwarded topics: got %v, want [%q]", fc.unsubscribeTopics, tt.topic)
				}
			}
		})
	}
}
