package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/rs/zerolog"
	oteltrace "go.opentelemetry.io/otel/trace"

	alertmodel "github.com/ev-dev-labs/teslasync/internal/models/alert"
	notificationmodel "github.com/ev-dev-labs/teslasync/internal/models/notification"
	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/notification"
	"github.com/ev-dev-labs/teslasync/internal/notification/computed"
)

// ── shared helpers ────────────────────────────────────────────────────

func ptr[T any](v T) *T { return &v }

var errSentinel = errors.New("sentinel failure")

// testSpan returns a non-recording OpenTelemetry span. The global tracer
// provider is a no-op in tests (tracing.Init is never called), so every
// span method used by runComputedMetricTick is a safe no-op.
func testSpan() oteltrace.Span { return oteltrace.SpanFromContext(context.Background()) }

// ── fake MQTT client + token (mirrors internal/mqtt test doubles) ──────

// fakeToken satisfies pahomqtt.Token with a controllable error and always
// reports completion so PublishCtx never falls back to the synchronous
// Send() HTTP path.
type fakeToken struct{ err error }

func (t fakeToken) Wait() bool                     { return true }
func (t fakeToken) WaitTimeout(time.Duration) bool { return true }
func (t fakeToken) Done() <-chan struct{} {
	ch := make(chan struct{})
	close(ch)
	return ch
}
func (t fakeToken) Error() error { return t.err }

// fakeMQTTClient records every published payload so tests can assert the
// number and contents of dispatched notifications without a broker.
type fakeMQTTClient struct {
	mu         sync.Mutex
	connected  bool
	publishErr error
	published  [][]byte
}

func (c *fakeMQTTClient) IsConnected() bool      { return c.connected }
func (c *fakeMQTTClient) IsConnectionOpen() bool { return c.connected }

func (c *fakeMQTTClient) Publish(_ string, _ byte, _ bool, payload interface{}) pahomqtt.Token {
	c.mu.Lock()
	defer c.mu.Unlock()
	if b, ok := payload.([]byte); ok {
		cp := make([]byte, len(b))
		copy(cp, b)
		c.published = append(c.published, cp)
	}
	return fakeToken{err: c.publishErr}
}

func (c *fakeMQTTClient) count() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.published)
}

// requests unwraps every recorded trace envelope back into the original
// notification.Request documents so assertions can inspect title/body/etc.
func (c *fakeMQTTClient) requests(t *testing.T) []notification.Request {
	t.Helper()
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]notification.Request, 0, len(c.published))
	for _, raw := range c.published {
		var env struct {
			Payload json.RawMessage `json:"payload"`
		}
		if err := json.Unmarshal(raw, &env); err != nil {
			t.Fatalf("unmarshal envelope: %v (raw=%s)", err, raw)
		}
		var req notification.Request
		if err := json.Unmarshal(env.Payload, &req); err != nil {
			t.Fatalf("unmarshal request: %v (payload=%s)", err, env.Payload)
		}
		out = append(out, req)
	}
	return out
}

// Unused pahomqtt.Client methods. The token-returning ones panic so an
// accidental dependency on broker behaviour surfaces immediately; the
// void ones are harmless no-ops.
func (c *fakeMQTTClient) Connect() pahomqtt.Token { panic("Connect not used") }
func (c *fakeMQTTClient) Disconnect(uint)         {}
func (c *fakeMQTTClient) Subscribe(string, byte, pahomqtt.MessageHandler) pahomqtt.Token {
	panic("Subscribe not used")
}
func (c *fakeMQTTClient) SubscribeMultiple(map[string]byte, pahomqtt.MessageHandler) pahomqtt.Token {
	panic("SubscribeMultiple not used")
}
func (c *fakeMQTTClient) Unsubscribe(...string) pahomqtt.Token     { panic("Unsubscribe not used") }
func (c *fakeMQTTClient) AddRoute(string, pahomqtt.MessageHandler) {}
func (c *fakeMQTTClient) OptionsReader() pahomqtt.ClientOptionsReader {
	panic("OptionsReader not used")
}

var _ pahomqtt.Client = (*fakeMQTTClient)(nil)

func connectedClient() *fakeMQTTClient { return &fakeMQTTClient{connected: true} }

// ── fake ports ────────────────────────────────────────────────────────

type fakeRuleLister struct {
	rules []*alertmodel.AlertRule
	err   error
}

func (f *fakeRuleLister) GetEnabledByKind(context.Context, string) ([]*alertmodel.AlertRule, error) {
	return f.rules, f.err
}

type fakeVehicleLister struct {
	vehicles []*vehiclemodel.Vehicle
	err      error
}

func (f *fakeVehicleLister) GetAll(context.Context) ([]*vehiclemodel.Vehicle, error) {
	return f.vehicles, f.err
}

type fakeChannelLister struct {
	channels []*notificationmodel.NotificationChannel
	err      error
}

func (f *fakeChannelLister) GetAllChannels(context.Context) ([]*notificationmodel.NotificationChannel, error) {
	return f.channels, f.err
}

type fakeEvaluator struct {
	fn func(rule *alertmodel.AlertRule, vehicleID int64) (computed.Result, error)
}

func (f *fakeEvaluator) Evaluate(_ context.Context, rule *alertmodel.AlertRule, vid int64) (computed.Result, error) {
	if f.fn == nil {
		return computed.Result{}, nil
	}
	return f.fn(rule, vid)
}

type fakeHealth struct{ err error }

func (f fakeHealth) Health(context.Context) error { return f.err }

// Compile-time confirmation the fakes satisfy the production ports.
var (
	_ computedRuleLister      = (*fakeRuleLister)(nil)
	_ fleetVehicleLister      = (*fakeVehicleLister)(nil)
	_ channelLister           = (*fakeChannelLister)(nil)
	_ computedMetricEvaluator = (*fakeEvaluator)(nil)
	_ healthChecker           = fakeHealth{}
)

func computedRule(id int64) *alertmodel.AlertRule {
	return &alertmodel.AlertRule{
		ID:              id,
		Name:            "High Charge Cost",
		Kind:            alertmodel.AlertRuleKindComputedMetric,
		Severity:        "warn",
		AllVehicles:     true,
		IncludeTitle:    true,
		MetricID:        ptr("charging_cost"),
		MetricWindow:    ptr("day"),
		MetricThreshold: ptr(100.0),
		MetricOp:        ptr(">"),
	}
}

func enabledChannel(id int64, kind string) *notificationmodel.NotificationChannel {
	return &notificationmodel.NotificationChannel{ID: id, Name: kind, Type: kind, Enabled: true}
}

// ── vehiclesForRule ───────────────────────────────────────────────────

func TestVehiclesForRule(t *testing.T) {
	fleet := []*vehiclemodel.Vehicle{{ID: 1}, {ID: 2}, {ID: 3}}

	tests := []struct {
		name string
		rule *alertmodel.AlertRule
		all  []*vehiclemodel.Vehicle
		want []int64
	}{
		{
			name: "nil rule targets nothing",
			rule: nil,
			all:  fleet,
			want: nil,
		},
		{
			name: "all vehicles fans out over fleet",
			rule: &alertmodel.AlertRule{AllVehicles: true},
			all:  fleet,
			want: []int64{1, 2, 3},
		},
		{
			name: "all vehicles over empty fleet is empty",
			rule: &alertmodel.AlertRule{AllVehicles: true},
			all:  nil,
			want: []int64{},
		},
		{
			name: "all vehicles skips nil entries",
			rule: &alertmodel.AlertRule{AllVehicles: true},
			all:  []*vehiclemodel.Vehicle{{ID: 1}, nil, {ID: 3}},
			want: []int64{1, 3},
		},
		{
			name: "explicit subset is honored",
			rule: &alertmodel.AlertRule{AllVehicles: false, VehicleIDs: []int64{5, 7}},
			all:  fleet,
			want: []int64{5, 7},
		},
		{
			name: "legacy single vehicle fallback",
			rule: &alertmodel.AlertRule{AllVehicles: false, VehicleID: ptr(int64(9))},
			all:  fleet,
			want: []int64{9},
		},
		{
			name: "no targets when subset empty and vehicle_id nil",
			rule: &alertmodel.AlertRule{AllVehicles: false},
			all:  fleet,
			want: nil,
		},
		{
			name: "subset takes precedence over legacy vehicle_id",
			rule: &alertmodel.AlertRule{AllVehicles: false, VehicleIDs: []int64{4}, VehicleID: ptr(int64(9))},
			all:  fleet,
			want: []int64{4},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := vehiclesForRule(tt.rule, tt.all)
			if !slices.Equal(got, tt.want) {
				t.Fatalf("vehiclesForRule() = %v, want %v", got, tt.want)
			}
		})
	}
}

// TestVehiclesForRule_ReturnsIndependentCopy guards against the caller
// mutating the returned slice and corrupting the rule's hydrated
// VehicleIDs backing array.
func TestVehiclesForRule_ReturnsIndependentCopy(t *testing.T) {
	rule := &alertmodel.AlertRule{VehicleIDs: []int64{5, 7}}
	got := vehiclesForRule(rule, nil)
	if len(got) != 2 {
		t.Fatalf("expected 2 targets, got %v", got)
	}
	got[0] = 999
	if rule.VehicleIDs[0] != 5 {
		t.Fatalf("mutating result changed rule.VehicleIDs: %v", rule.VehicleIDs)
	}
}

// ── setupLogger ───────────────────────────────────────────────────────

func TestSetupLogger(t *testing.T) {
	origLevel := zerolog.GlobalLevel()
	origTimeFmt := zerolog.TimeFieldFormat
	t.Cleanup(func() {
		zerolog.SetGlobalLevel(origLevel)
		zerolog.TimeFieldFormat = origTimeFmt
	})

	tests := []struct {
		name  string
		level string
		want  zerolog.Level
	}{
		{"debug", "debug", zerolog.DebugLevel},
		{"info", "info", zerolog.InfoLevel},
		{"warn", "warn", zerolog.WarnLevel},
		{"error", "error", zerolog.ErrorLevel},
		{"case insensitive", "DEBUG", zerolog.DebugLevel},
		{"unknown falls back to info", "bogus", zerolog.InfoLevel},
		{"garbage falls back to info", "not-a-level", zerolog.InfoLevel},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Force a known-different starting level so the assertion
			// proves setupLogger actually set it.
			zerolog.SetGlobalLevel(zerolog.PanicLevel)
			setupLogger(tt.level)
			if got := zerolog.GlobalLevel(); got != tt.want {
				t.Fatalf("setupLogger(%q) global level = %v, want %v", tt.level, got, tt.want)
			}
		})
	}

	// setupLogger must always normalize the time format regardless of level.
	setupLogger("info")
	if zerolog.TimeFieldFormat != zerolog.TimeFormatUnix {
		t.Fatalf("TimeFieldFormat = %q, want %q", zerolog.TimeFieldFormat, zerolog.TimeFormatUnix)
	}
}

// ── workerTracer ──────────────────────────────────────────────────────

func TestWorkerTracer(t *testing.T) {
	if tracerName != "cmd/notification-worker" {
		t.Fatalf("tracerName = %q, want cmd/notification-worker", tracerName)
	}
	tr := workerTracer()
	if tr == nil {
		t.Fatal("workerTracer() returned nil")
	}
	// The returned tracer must be usable: starting a span must not panic
	// and must yield a non-nil span and a derived context.
	ctx, span := tr.Start(context.Background(), "unit-test")
	if ctx == nil {
		t.Fatal("tracer.Start returned nil context")
	}
	if span == nil {
		t.Fatal("tracer.Start returned nil span")
	}
	span.End()
}

// ── healthzHandler ────────────────────────────────────────────────────

func TestHealthzHandler(t *testing.T) {
	tests := []struct {
		name       string
		healthErr  error
		wantStatus int
		wantBody   healthResponse
	}{
		{
			name:       "healthy returns 200 ok",
			healthErr:  nil,
			wantStatus: http.StatusOK,
			wantBody:   healthResponse{Status: "ok"},
		},
		{
			name:       "unhealthy returns 503 with error",
			healthErr:  errors.New("db down"),
			wantStatus: http.StatusServiceUnavailable,
			wantBody:   healthResponse{Status: "unhealthy", Error: "db down"},
		},
		{
			name:       "error with quotes stays valid json",
			healthErr:  errors.New(`pq: bad "quote" and \slash`),
			wantStatus: http.StatusServiceUnavailable,
			wantBody:   healthResponse{Status: "unhealthy", Error: `pq: bad "quote" and \slash`},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := healthzHandler(fakeHealth{err: tt.healthErr})
			rr := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/healthz", nil)

			h.ServeHTTP(rr, req)

			if rr.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d", rr.Code, tt.wantStatus)
			}
			if ct := rr.Header().Get("Content-Type"); ct != "application/json" {
				t.Fatalf("Content-Type = %q, want application/json", ct)
			}
			var got healthResponse
			if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
				t.Fatalf("response body is not valid JSON: %v (body=%q)", err, rr.Body.String())
			}
			if got != tt.wantBody {
				t.Fatalf("body = %+v, want %+v", got, tt.wantBody)
			}
		})
	}
}

// ── runComputedMetricTick ─────────────────────────────────────────────

func TestRunComputedMetricTick_Publishes(t *testing.T) {
	triggerAll := func(*alertmodel.AlertRule, int64) (computed.Result, error) {
		return computed.Result{Triggered: true, Value: 147.82}, nil
	}
	triggerNone := func(*alertmodel.AlertRule, int64) (computed.Result, error) {
		return computed.Result{Triggered: false, Value: 1}, nil
	}

	twoVehicles := []*vehiclemodel.Vehicle{{ID: 1, DisplayName: "Model 3"}, {ID: 2, DisplayName: "Model Y"}}
	twoChannels := []*notificationmodel.NotificationChannel{enabledChannel(10, "discord"), enabledChannel(11, "slack")}

	tests := []struct {
		name          string
		ruleErr       error
		rules         []*alertmodel.AlertRule
		vehicleErr    error
		vehicles      []*vehiclemodel.Vehicle
		channelErr    error
		channels      []*notificationmodel.NotificationChannel
		evalFn        func(*alertmodel.AlertRule, int64) (computed.Result, error)
		wantPublishes int
	}{
		{
			name:          "rule load error short-circuits",
			ruleErr:       errSentinel,
			vehicles:      twoVehicles,
			channels:      twoChannels,
			evalFn:        triggerAll,
			wantPublishes: 0,
		},
		{
			name:          "no rules is a no-op",
			rules:         nil,
			vehicles:      twoVehicles,
			channels:      twoChannels,
			evalFn:        triggerAll,
			wantPublishes: 0,
		},
		{
			name:          "vehicle load error short-circuits",
			rules:         []*alertmodel.AlertRule{computedRule(1)},
			vehicleErr:    errSentinel,
			channels:      twoChannels,
			evalFn:        triggerAll,
			wantPublishes: 0,
		},
		{
			name:          "channel load error short-circuits",
			rules:         []*alertmodel.AlertRule{computedRule(1)},
			vehicles:      twoVehicles,
			channelErr:    errSentinel,
			evalFn:        triggerAll,
			wantPublishes: 0,
		},
		{
			name:          "triggered fans out over vehicles x channels",
			rules:         []*alertmodel.AlertRule{computedRule(1)},
			vehicles:      twoVehicles,
			channels:      twoChannels,
			evalFn:        triggerAll,
			wantPublishes: 4,
		},
		{
			name:          "not triggered dispatches nothing",
			rules:         []*alertmodel.AlertRule{computedRule(1)},
			vehicles:      twoVehicles,
			channels:      twoChannels,
			evalFn:        triggerNone,
			wantPublishes: 0,
		},
		{
			name:     "evaluator error skips only that vehicle",
			rules:    []*alertmodel.AlertRule{computedRule(1)},
			vehicles: twoVehicles,
			channels: twoChannels,
			evalFn: func(_ *alertmodel.AlertRule, vid int64) (computed.Result, error) {
				if vid == 1 {
					return computed.Result{}, errSentinel
				}
				return computed.Result{Triggered: true, Value: 5}, nil
			},
			wantPublishes: 2,
		},
		{
			name:          "disabled and nil channels are skipped",
			rules:         []*alertmodel.AlertRule{computedRule(1)},
			vehicles:      []*vehiclemodel.Vehicle{{ID: 1, DisplayName: "Solo"}},
			channels:      []*notificationmodel.NotificationChannel{enabledChannel(10, "discord"), {ID: 11, Type: "slack", Enabled: false}, nil},
			evalFn:        triggerAll,
			wantPublishes: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := connectedClient()
			runComputedMetricTick(
				context.Background(),
				&fakeRuleLister{rules: tt.rules, err: tt.ruleErr},
				&fakeVehicleLister{vehicles: tt.vehicles, err: tt.vehicleErr},
				&fakeChannelLister{channels: tt.channels, err: tt.channelErr},
				&fakeEvaluator{fn: tt.evalFn},
				client,
				testSpan(),
			)
			if got := client.count(); got != tt.wantPublishes {
				t.Fatalf("publishes = %d, want %d", got, tt.wantPublishes)
			}
		})
	}
}

// TestRunComputedMetricTick_ResolvesVehicleName asserts the dispatched
// title carries the vehicle's display name (or VIN fallback) and the
// rule metadata survives the round-trip through the MQTT envelope.
func TestRunComputedMetricTick_ResolvesVehicleName(t *testing.T) {
	rule := computedRule(42)
	vehicles := []*vehiclemodel.Vehicle{
		{ID: 1, DisplayName: "Model 3"},
		{ID: 2, DisplayName: "", VIN: "5YJ3E1EA000VIN2"},
	}
	client := connectedClient()

	runComputedMetricTick(
		context.Background(),
		&fakeRuleLister{rules: []*alertmodel.AlertRule{rule}},
		&fakeVehicleLister{vehicles: vehicles},
		&fakeChannelLister{channels: []*notificationmodel.NotificationChannel{enabledChannel(10, "discord")}},
		&fakeEvaluator{fn: func(*alertmodel.AlertRule, int64) (computed.Result, error) {
			return computed.Result{Triggered: true, Value: 200}, nil
		}},
		client,
		testSpan(),
	)

	reqs := client.requests(t)
	if len(reqs) != 2 {
		t.Fatalf("expected 2 dispatched requests, got %d", len(reqs))
	}
	joined := reqs[0].Title + "|" + reqs[1].Title
	if !strings.Contains(joined, "Model 3") {
		t.Errorf("expected a title with display name 'Model 3', got %q", joined)
	}
	if !strings.Contains(joined, "5YJ3E1EA000VIN2") {
		t.Errorf("expected a title with VIN fallback, got %q", joined)
	}
	for _, r := range reqs {
		if r.AlertID != rule.ID {
			t.Errorf("AlertID = %d, want %d", r.AlertID, rule.ID)
		}
		if r.Severity != "warn" {
			t.Errorf("Severity = %q, want warn", r.Severity)
		}
		if !strings.Contains(r.Title, rule.Name) {
			t.Errorf("Title %q missing rule name %q", r.Title, rule.Name)
		}
	}
}

// ── dispatchComputedMetricNotification ────────────────────────────────

func TestDispatchComputedMetricNotification(t *testing.T) {
	channels := []*notificationmodel.NotificationChannel{
		enabledChannel(10, "discord"),
		{ID: 11, Type: "slack", Enabled: false}, // disabled → skipped
		nil,                                     // nil → skipped
		enabledChannel(12, "ntfy"),
	}
	rule := computedRule(7)
	result := computed.Result{Triggered: true, Value: 321.5, PreviousValue: 300, PercentChange: 7.1}
	client := connectedClient()

	dispatchComputedMetricNotification(context.Background(), rule, 1, "Model 3", result, channels, client)

	reqs := client.requests(t)
	if len(reqs) != 2 {
		t.Fatalf("expected 2 publishes (2 enabled channels), got %d", len(reqs))
	}
	for _, r := range reqs {
		if r.SuppressTransportTitle {
			t.Errorf("IncludeTitle=true rule must not suppress transport title")
		}
		if r.Title == "" {
			t.Errorf("expected non-empty title, got empty")
		}
		if r.Severity != "warn" {
			t.Errorf("Severity = %q, want warn", r.Severity)
		}
		if r.AlertID != rule.ID {
			t.Errorf("AlertID = %d, want %d", r.AlertID, rule.ID)
		}
	}
}

// TestDispatchComputedMetricNotification_TitleSuppressed exercises the
// IncludeTitle=false branch: transports are asked to suppress the title
// and an empty body falls back to the rule name.
func TestDispatchComputedMetricNotification_TitleSuppressed(t *testing.T) {
	// A signal-kind "=" rule with a text operand renders an empty default
	// body, which forces the `!IncludeTitle && body == ""` fallback path.
	rule := &alertmodel.AlertRule{
		ID:           8,
		Name:         "Fallback Body Rule",
		Kind:         alertmodel.AlertRuleKindSignal,
		Severity:     "critical",
		Op:           "=",
		ValueText:    ptr("R"),
		IncludeTitle: false,
	}
	client := connectedClient()

	dispatchComputedMetricNotification(context.Background(), rule, 1, "Model 3",
		computed.Result{Triggered: true, Value: 1}, []*notificationmodel.NotificationChannel{enabledChannel(10, "discord")}, client)

	reqs := client.requests(t)
	if len(reqs) != 1 {
		t.Fatalf("expected 1 publish, got %d", len(reqs))
	}
	if !reqs[0].SuppressTransportTitle {
		t.Errorf("expected SuppressTransportTitle=true for IncludeTitle=false rule")
	}
	if reqs[0].Message != rule.Name {
		t.Errorf("empty body should fall back to rule name; Message = %q, want %q", reqs[0].Message, rule.Name)
	}
	if reqs[0].Severity != "critical" {
		t.Errorf("Severity = %q, want critical", reqs[0].Severity)
	}
}

// TestDispatchComputedMetricNotification_PublishErrorContinues asserts a
// failing publish on one channel does not abort dispatch to the rest and
// does not panic.
func TestDispatchComputedMetricNotification_PublishErrorContinues(t *testing.T) {
	client := connectedClient()
	client.publishErr = errSentinel

	channels := []*notificationmodel.NotificationChannel{
		enabledChannel(10, "discord"),
		enabledChannel(11, "slack"),
	}
	dispatchComputedMetricNotification(context.Background(), computedRule(9), 1, "Model 3",
		computed.Result{Triggered: true, Value: 5}, channels, client)

	// Both channels were attempted despite the publish error.
	if got := client.count(); got != 2 {
		t.Fatalf("expected 2 publish attempts, got %d", got)
	}
}

// TestDispatchComputedMetricNotification_NoEnabledChannels covers the
// empty/degenerate case: nothing enabled means nothing published.
func TestDispatchComputedMetricNotification_NoEnabledChannels(t *testing.T) {
	client := connectedClient()
	channels := []*notificationmodel.NotificationChannel{
		{ID: 1, Type: "discord", Enabled: false},
		nil,
	}
	dispatchComputedMetricNotification(context.Background(), computedRule(1), 1, "Model 3",
		computed.Result{Triggered: true, Value: 5}, channels, client)

	if got := client.count(); got != 0 {
		t.Fatalf("expected 0 publishes, got %d", got)
	}
}
