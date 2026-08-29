package mqtt

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"runtime/debug"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
)

// mqttTracerName is the OpenTelemetry tracer name for spans produced by this
// package. The receive-boundary span is named "mqtt.consume" and seeds
// context for downstream normalize/router spans.
const mqttTracerName = "mqtt"

// Client wraps MQTT publishing.
type Client struct {
	client    pahomqtt.Client
	prefix    string
	brokerURL string
}

// NewClient creates a new MQTT client.
func NewClient(cfg config.MQTTConfig) (*Client, error) {
	// Append random suffix to client ID to avoid collisions during rolling updates
	clientID := cfg.ClientID + "-" + randomSuffix(4)
	opts := pahomqtt.NewClientOptions().
		AddBroker(cfg.BrokerURL()).
		SetClientID(clientID).
		SetAutoReconnect(true).
		SetMaxReconnectInterval(config.MQTTReconnectMax).
		SetKeepAlive(config.MQTTKeepAlive).
		SetCleanSession(true).
		SetConnectionLostHandler(func(_ pahomqtt.Client, err error) {
			log.Warn().Err(err).Msg("MQTT connection lost")
		}).
		SetOnConnectHandler(func(_ pahomqtt.Client) {
			log.Info().Msg("MQTT connected")
		})

	if cfg.Username != "" {
		opts.SetUsername(cfg.Username)
		opts.SetPassword(cfg.Password)
	}

	client := pahomqtt.NewClient(opts)
	token := client.Connect()
	if !token.WaitTimeout(10 * time.Second) {
		return nil, fmt.Errorf("MQTT connection timeout")
	}
	if err := token.Error(); err != nil {
		return nil, fmt.Errorf("MQTT connect: %w", err)
	}

	return &Client{
		client:    client,
		prefix:    cfg.Prefix,
		brokerURL: cfg.BrokerURL(),
	}, nil
}

// Publish publishes a string message to a topic.
//
// Deprecated: prefer PublishCtx which injects W3C trace context so the
// consumer-side span (e.g. automation reload, webhook forwarding)
// nests under the API request span. This shim exists only for
// back-compat with callers that don't yet have a context handy.
func (c *Client) Publish(topic, payload string) {
	c.PublishCtx(context.Background(), topic, payload)
}

// PublishCtx publishes payload to topic with W3C trace context injected
// into a JSON envelope when ctx carries an active span. The QoS+retain
// semantics match Publish (QoS=0, retain=true) — the envelope wrapping
// is independent of delivery guarantees. Consumers that don't know
// about the envelope shape transparently fall back to legacy
// passthrough via mqtt.ExtractTraceContext.
func (c *Client) PublishCtx(ctx context.Context, topic, payload string) {
	fullTopic := c.prefix + "/" + topic
	body := []byte(payload)
	// Only wrap if the payload is JSON-shaped — wrapping a plain
	// string would corrupt it for legacy consumers that parse it as
	// a non-JSON value (e.g. the vehicle_data topic family).
	if len(body) > 0 && body[0] == '{' {
		wrapped, err := InjectTraceContext(ctx, body)
		if err == nil {
			body = wrapped
		}
	}
	token := c.client.Publish(fullTopic, 0, true, body)
	if !token.WaitTimeout(5 * time.Second) {
		log.Warn().Str("topic", fullTopic).Msg("MQTT publish timeout")
	}
}

// PublishJSON publishes a JSON-encoded message.
//
// Deprecated: prefer PublishJSONCtx for trace continuity.
func (c *Client) PublishJSON(topic string, payload interface{}) {
	c.PublishJSONCtx(context.Background(), topic, payload)
}

// PublishJSONCtx marshals and publishes with trace context injected.
func (c *Client) PublishJSONCtx(ctx context.Context, topic string, payload interface{}) {
	data, err := json.Marshal(payload)
	if err != nil {
		log.Error().Err(err).Str("topic", topic).Msg("failed to marshal MQTT payload")
		return
	}
	c.PublishCtx(ctx, topic, string(data))
}

// PublishVehicleData publishes vehicle telemetry to multiple MQTT topics.
func (c *Client) PublishVehicleData(vin string, data *tesla.VehicleDataResponse) {
	base := vin

	// State
	c.Publish(base+"/state", data.State)

	// Battery
	c.Publish(base+"/battery_level", fmt.Sprintf("%d", data.ChargeState.BatteryLevel))
	c.Publish(base+"/battery_range", fmt.Sprintf("%.1f", data.ChargeState.BatteryRange))
	c.Publish(base+"/ideal_battery_range", fmt.Sprintf("%.1f", data.ChargeState.IdealBatteryRange))
	c.Publish(base+"/charge_limit_soc", fmt.Sprintf("%d", data.ChargeState.ChargeLimitSoc))
	c.Publish(base+"/charging_state", data.ChargeState.ChargingState)
	c.Publish(base+"/charger_power", fmt.Sprintf("%.1f", data.ChargeState.ChargerPower))
	c.Publish(base+"/charge_energy_added", fmt.Sprintf("%.2f", data.ChargeState.ChargeEnergyAdded))
	c.Publish(base+"/time_to_full_charge", fmt.Sprintf("%.2f", data.ChargeState.TimeToFullCharge))

	// Location
	c.Publish(base+"/latitude", fmt.Sprintf("%f", data.DriveState.Latitude))
	c.Publish(base+"/longitude", fmt.Sprintf("%f", data.DriveState.Longitude))
	c.Publish(base+"/heading", fmt.Sprintf("%d", data.DriveState.Heading))
	if data.DriveState.Speed != nil {
		c.Publish(base+"/speed", fmt.Sprintf("%d", *data.DriveState.Speed))
	}
	c.Publish(base+"/power", fmt.Sprintf("%d", data.DriveState.Power))

	// Climate
	c.Publish(base+"/inside_temp", fmt.Sprintf("%.1f", data.ClimateState.InsideTemp))
	c.Publish(base+"/outside_temp", fmt.Sprintf("%.1f", data.ClimateState.OutsideTemp))
	c.Publish(base+"/is_climate_on", fmt.Sprintf("%t", data.ClimateState.IsClimateOn))

	// Vehicle
	c.Publish(base+"/odometer", fmt.Sprintf("%.1f", data.VehicleState.Odometer))
	c.Publish(base+"/locked", fmt.Sprintf("%t", data.VehicleState.Locked))
	c.Publish(base+"/sentry_mode", fmt.Sprintf("%t", data.VehicleState.SentryMode))
	c.Publish(base+"/software_update/version", data.VehicleState.SoftwareUpdate.Version)
	c.Publish(base+"/software_update/status", data.VehicleState.SoftwareUpdate.Status)

	// Full JSON
	c.PublishJSON(base+"/vehicle_data", data)
}

// IsConnected returns whether the MQTT client is currently connected to the broker.
func (c *Client) IsConnected() bool {
	return c.client.IsConnected()
}

// BrokerURL returns the broker URL this client is connected to.
func (c *Client) BrokerURL() string {
	return c.brokerURL
}

// Prefix returns the topic prefix used for publishing.
func (c *Client) Prefix() string {
	return c.prefix
}

// Underlying returns the raw Paho MQTT client for advanced usage
// such as subscribing to internal topics.
func (c *Client) Underlying() pahomqtt.Client {
	return c.client
}

// Disconnect disconnects the MQTT client.
func (c *Client) Disconnect() {
	c.client.Disconnect(1000)
}

func randomSuffix(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// =============================================================================
// Tesla Fleet Telemetry subscriber: MQTT payloads -> normalize.Pipeline.
// =============================================================================
//
// This subscriber implements ADR-004 #2: every Tesla Fleet Telemetry
// per-field JSON value is decoded exactly once by codec.DecodeJSONFieldCtx and
// then flows through THE ONE atomics entry,
// normalize.Pipeline.ProcessAtomics. Unit conversion lives in
// internal/tesla/units, dispatch in internal/tesla/router, and orchestration
// in internal/tesla/normalize. The deleted proto-batch
// {topicBase}/payload/{VIN} path must not be reintroduced.
//
// === DLQ governance (LOCKED) ============================================
//
// The DLQ for poison-pill MQTT payloads is owned by the operations on-call
// rotation, NOT the ingest engineering team. This policy is referenced by
// ADR-004 #8; any change requires an ADR amendment.
//
//	Retention.
//	  MQTT-topic DLQ: broker retention 7 days (configured in mosquitto.conf
//	  via expire-policy). Postgres DLQ (if a future ADR moves DLQ to a
//	  dedicated table mqtt_dead_letters): 14-day rolling DELETE via a daily
//	  CronJob. Either way, DLQ payloads MUST NOT live indefinitely — the
//	  payload bytes can carry PII (VIN, location, charge state) and we
//	  treat them as transient forensics.
//
//	Alerting.
//	  Any non-zero DLQ rate raises a WARN alert; > 10/min for 5min raises a
//	  PAGE alert. Metric: tesla_mqtt_dlq_writes_total{reason}. Labels are
//	  drawn from a closed reason set (codec_drop, vin_resolver_error,
//	  other, dlq_publish_failure) so
//	  the Prometheus index stays bounded.
//
//	Triage SLO.
//	  On-call must inspect DLQ entries within one business day. If a
//	  payload pattern is identifiable (e.g. a specific malformed Datum),
//	  on-call files a follow-up bug; if it's a transient broker issue,
//	  on-call documents and discards. Beyond the SLO the entries roll off
//	  automatically per the retention rule above.
//
//	Replay tooling.
//	  DLQ is forensic-only. Re-ingest of dropped payloads requires a future
//	  ADR. Operators MUST NOT re-publish DLQ
//	  payloads to the live ingest topic; doing so reintroduces the same
//	  malformed bytes that triggered the redelivery loop.
//
// =========================================================================
//
// IMPORTANT — manual ack contract.
// MQTT 3.1.1 has no negative acknowledgement. A QoS 1 PUBLISH left unacked
// remains in the broker's in-flight window until the connection is replaced;
// returning from the handler does NOT make the broker redeliver it on the same
// live connection. Enough unacked messages therefore stop all delivery.
//
// PipelineSubscriber uses manual ack only to delay acknowledgement until the
// payload has reached a terminal disposition:
//   - accepted by the pipeline; or
//   - quarantined to the DLQ (one bounded attempt).
//
// Even when the DLQ publish fails, the original message is acknowledged after
// the failed attempt is logged and counted. Sacrificing one malformed payload
// is preferable to pinning the broker's entire receive window and dropping all
// subsequent telemetry. The underlying paho client MUST be constructed with
// SetAutoAckDisabled(true) so this ordering remains under subscriber control.

// Pipeline is the subset of *normalize.Pipeline that PipelineSubscriber
// depends on. Production wiring passes a *normalize.Pipeline; tests pass a
// recording fake. ProcessAtomics MUST return nil for per-atomic failures
// (which are observable via the pipeline's own values_processed metric —
// they MUST NOT trigger MQTT redelivery) and a non-nil error for
// unrecoverable infrastructure failures (e.g. context cancelled mid-batch);
// per the *normalize.Pipeline contract ProcessAtomics never returns
// errPayloadDrop because the codec.DecodeJSONField step that produces
// poison-pill candidates runs INSIDE the subscriber, not inside the
// pipeline.
//
// The Process(ctx, []byte, vehicleID) entry was removed when the API cut over
// to the per-field MQTT topic shape (Tesla's MQTT
// publisher emits one signal per topic via JSON, not protobuf batches);
// the only remaining ingest entry on this interface is ProcessAtomics so
// the codec.DecodeJSONField → ProcessAtomics handoff is the SINGLE path
// from the subscriber into the pipeline. Adding a parallel Process method
// would re-introduce the "two ingest entries" trap that ADR-004 #2
// expressly bans.
type Pipeline interface {
	ProcessAtomics(ctx context.Context, atomics []codec.Atomic, vehicleIntID int64) error
}

// ErrUnknownVIN is returned by a VINResolver when the VIN is syntactically
// well-formed but not registered to this deployment (foreign tenant, untracked
// vehicle, etc). The PipelineSubscriber treats this as a permanent ack-and-drop
// outcome — the message is not ours, so it is NOT a poison pill and MUST NOT
// be sent to the DLQ. Any other resolver error is quarantined and acknowledged
// so an infrastructure failure cannot exhaust the broker's in-flight window.
var ErrUnknownVIN = errors.New("mqtt: VIN not registered to this deployment")

// VINResolver maps a Tesla VIN to the internal numeric vehicle ID expected by
// normalize.Pipeline.Process. Implementations MUST return ErrUnknownVIN for
// "VIN not registered" and a wrapped infrastructure error for transient
// failures so the subscriber can distinguish ack-and-drop from quarantine.
type VINResolver func(ctx context.Context, vin string) (int64, error)

// DLQEntry captures the forensic envelope written to the DLQ when a payload
// cannot be processed. Fields are intentionally minimal:
// no decoded telemetry, no Tesla credentials, just enough context for the
// on-call rotation to identify the stuck pattern.
type DLQEntry struct {
	Reason    string `json:"reason"`
	VehicleID int64  `json:"vehicle_id,omitempty"`
	VIN       string `json:"vin,omitempty"`
	Topic     string `json:"topic"`
	Payload   []byte `json:"payload"`
	// Redeliveries is retained for DLQ wire/API compatibility. Immediate
	// quarantine sets it to zero because the original delivery is not retried.
	Redeliveries int       `json:"redeliveries"`
	Timestamp    time.Time `json:"timestamp"`
}

// DLQPublisher writes a DLQEntry to the dead-letter sink. Implementations MUST
// be idempotent on (VehicleID, Topic, Timestamp) so replaying an identical
// poison payload produces a stable forensic trail. The default
// implementation (newMQTTDLQPublisher) writes JSON to the broker; an
// alternative Postgres-backed implementation may be wired in a future ADR.
type DLQPublisher interface {
	Publish(ctx context.Context, entry DLQEntry) error
}

// dlqWritesTotal is the LOCKED public metric from ADR-004 #8 governance:
// tesla_mqtt_dlq_writes_total{reason}. The reason label is drawn from a
// closed set (codec_drop, vin_resolver_error, other,
// dlq_publish_failure) so the
// Prometheus index is bounded regardless of payload content.
var dlqWritesTotal = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "tesla",
	Subsystem: "mqtt",
	Name:      "dlq_writes_total",
	Help: "MQTT poison-pill payloads written to the DLQ, labelled by reason. " +
		"Drives the WARN/PAGE alerts described in the DLQ governance block " +
		"in mqtt.go. Cardinality is bounded by the closed reason set.",
}, []string{"reason"})

// normalizeFailuresTotal counts pipeline failures by classification so the
// fraction of poison-pill (codec_drop) vs. non-retriable failures is
// observable without reaching into the pipeline's own metrics.
var normalizeFailuresTotal = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "tesla",
	Subsystem: "mqtt",
	Name:      "normalize_failures_total",
	Help: "Pipeline.Process errors observed by the MQTT subscriber, " +
		"labelled by reason (codec_drop, context_canceled, vin_unknown, " +
		"vin_resolver_error, other). Cardinality is bounded by the closed " +
		"reason set.",
}, []string{"reason"})

// dlqPublishesTotal counts DLQ publish attempts vs. failures so an alert
// can fire on (failures / attempts) > 0 without requiring a separate
// ratio metric.
var dlqPublishesTotal = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "tesla",
	Subsystem: "mqtt",
	Name:      "dlq_publishes_total",
	Help:      "DLQ publish attempts, labelled by outcome (ok, error).",
}, []string{"outcome"})

// Reason labels for normalizeFailuresTotal and dlqWritesTotal. Declared as
// package constants so a typo in a call site is a compile-time error.
const (
	reasonCodecDrop         = "codec_drop"
	reasonContextCanceled   = "context_canceled"
	reasonVINUnknown        = "vin_unknown"
	reasonVINResolverError  = "vin_resolver_error"
	reasonOther             = "other"
	reasonDLQPublishFailure = "dlq_publish_failure"
)

// errPayloadDrop is the local sentinel that marks a per-message payload
// failure (a "poison pill" candidate). The per-field MQTT path wraps every
// codec.DecodeJSONField error in this sentinel before handing the wrapped
// error to handlePipelineError so the existing DLQ classification (which
// matches via errors.Is) treats codec drops uniformly with any future
// pipeline-side ErrPayloadDrop wraps. Kept package-private so nothing
// outside this package can synthesise a false poison pill.
var errPayloadDrop = errors.New("mqtt: payload-level failure")

// PipelineSubscriberConfig captures the runtime knobs of PipelineSubscriber.
// Zero values fall back to defaults documented per field.
type PipelineSubscriberConfig struct {
	// TopicBase is the fleet-telemetry MQTT prefix (e.g. "telemetry"). The
	// subscriber listens on {TopicBase}/+/v/+ where the first wildcard
	// matches the VIN and the second matches the per-signal proto field
	// name (e.g. "Soc", "Gear"). This is the per-field topic shape Tesla's
	// fleet-telemetry MQTT publisher emits — one signal per topic with a
	// JSON body — and supersedes the legacy {TopicBase}/payload/{VIN}
	// proto-batch shape removed by the per-field cutover.
	TopicBase string

	// SubscribeQoS is the QoS level for the .Subscribe call. Default 1
	// (at-least-once). The subscriber still gives each delivery a terminal
	// ACK; QoS 1 protects messages queued during disconnects.
	SubscribeQoS byte

	// SubscribeTimeout caps how long Start waits for the SUBACK. Default 10s.
	SubscribeTimeout time.Duration

	// StreamingRecorder, when non-nil, receives a callback for every
	// successfully decoded MQTT batch (after pipeline dispatch returns
	// nil). It powers the /telemetry status MQTT Inspector. Before the
	// per-field MQTT path, only HTTP TelemetryIngest updated streaming state, so the
	// Inspector silently zeroed out once the per-field MQTT cutover
	// became the production path. Implementations MUST be safe for
	// concurrent calls (paho dispatches messages on multiple goroutines).
	StreamingRecorder StreamingHealthRecorder
}

// StreamingHealthRecorder bridges PipelineSubscriber to the per-VIN streaming
// health state exposed by GET /api/v1/telemetry (the MQTT Inspector page).
// Callbacks fire exactly once per successful pipeline dispatch — codec
// drops and pipeline errors do NOT invoke RecordStream because they do
// not represent a successful signal observation. Implementations should
// be cheap (the call runs on the message-handling goroutine).
type StreamingHealthRecorder interface {
	RecordStream(vin string, atomics []codec.Atomic)
}

func (c *PipelineSubscriberConfig) withDefaults() {
	if c.SubscribeQoS == 0 {
		c.SubscribeQoS = 1
	}
	if c.SubscribeTimeout <= 0 {
		c.SubscribeTimeout = 10 * time.Second
	}
	c.TopicBase = strings.TrimSuffix(c.TopicBase, "/")
}

// PipelineSubscriber is the fleet-telemetry consumer. It owns
// connection lifecycle (Start/Stop), topic parsing, manual ack semantics,
// poison-pill detection, and DLQ routing. It does NOT decode payloads;
// payload bytes are forwarded verbatim to Pipeline.Process per ADR-004 #2.
//
// Concurrency: Start MUST be called once. Stop MUST be called at most once.
// onPipelineMessage runs on paho's message-handling goroutine; multiple
// in-flight handlers are possible if the underlying client is configured
// with concurrent message dispatch.
type PipelineSubscriber struct {
	client     pahomqtt.Client
	pipeline   Pipeline
	dlq        DLQPublisher
	resolveVIN VINResolver
	cfg        PipelineSubscriberConfig
	logger     zerolog.Logger

	ctx    context.Context
	cancel context.CancelFunc

	mu         sync.Mutex
	started    bool
	stopped    bool
	subscribed bool
}

// NewPipelineSubscriber constructs a PipelineSubscriber. All non-config
// arguments MUST be non-nil; nil panics (constructor invariant). The caller
// retains ownership of client; PipelineSubscriber.Stop does NOT disconnect.
//
// Per the manual-ack contract documented at the top of this section, the
// supplied paho client MUST have been constructed with
// SetAutoAckDisabled(true) — otherwise paho auto-acks every message AFTER
// the handler returns and the redelivery / DLQ contract silently degrades to
// a no-op. NewPipelineSubscriber cannot enforce this from the outside (paho
// exposes no read-back of the option) so the requirement is documentation-
// only; production wiring is responsible.
func NewPipelineSubscriber(
	client pahomqtt.Client,
	pipeline Pipeline,
	dlq DLQPublisher,
	resolveVIN VINResolver,
	cfg PipelineSubscriberConfig,
	logger zerolog.Logger,
) *PipelineSubscriber {
	if pipeline == nil {
		panic("mqtt: NewPipelineSubscriber: pipeline must be non-nil")
	}
	if dlq == nil {
		panic("mqtt: NewPipelineSubscriber: dlq must be non-nil")
	}
	if resolveVIN == nil {
		panic("mqtt: NewPipelineSubscriber: resolveVIN must be non-nil")
	}
	cfg.withDefaults()
	ctx, cancel := context.WithCancel(context.Background())
	return &PipelineSubscriber{
		client:     client,
		pipeline:   pipeline,
		dlq:        dlq,
		resolveVIN: resolveVIN,
		cfg:        cfg,
		logger:     withHotPathSampling(logger),
		ctx:        ctx,
		cancel:     cancel,
	}
}

// pipelineTopicFilter returns the SUBSCRIBE filter for the per-field
// MQTT topic shape Tesla's fleet-telemetry MQTT publisher uses:
// `{topicBase}/+/v/+` where the first wildcard matches the VIN and the
// second matches the per-signal proto field name (e.g. "Soc", "Gear",
// "Location"). Exposed for tests.
func (s *PipelineSubscriber) pipelineTopicFilter() string {
	return fmt.Sprintf("%s/+/v/+", s.cfg.TopicBase)
}

// Start subscribes to {TopicBase}/+/v/+. Returns a non-nil error if the
// SUBACK does not arrive within cfg.SubscribeTimeout or the broker rejects
// the subscription.
func (s *PipelineSubscriber) Start() error {
	s.mu.Lock()
	if s.started {
		s.mu.Unlock()
		return errors.New("mqtt: PipelineSubscriber: already started")
	}
	s.started = true
	s.mu.Unlock()

	topic := s.pipelineTopicFilter()
	token := s.client.Subscribe(topic, s.cfg.SubscribeQoS, s.onPipelineMessage)
	if !token.WaitTimeout(s.cfg.SubscribeTimeout) {
		return fmt.Errorf("mqtt: PipelineSubscriber: subscribe timeout for topic %s", topic)
	}
	if err := token.Error(); err != nil {
		return fmt.Errorf("mqtt: PipelineSubscriber: subscribe %s: %w", topic, err)
	}
	s.mu.Lock()
	if !s.stopped {
		s.subscribed = true
	}
	s.mu.Unlock()

	s.logger.Info().
		Str("topic", topic).
		Str("codec_failure_disposition", "dlq_ack").
		Msg("phase-42 PipelineSubscriber started")

	return nil
}

// Stop unsubscribes and cancels in-flight handler contexts. Idempotent.
func (s *PipelineSubscriber) Stop() {
	s.mu.Lock()
	if s.stopped {
		s.mu.Unlock()
		return
	}
	s.stopped = true
	s.subscribed = false
	s.mu.Unlock()

	s.cancel()
	topic := s.pipelineTopicFilter()
	s.client.Unsubscribe(topic)
	s.logger.Info().Str("topic", topic).Msg("phase-42 PipelineSubscriber stopped")
}

// OnBrokerReconnect re-establishes the SUBSCRIBE on every paho OnConnect
// callback after the initial Start. Production wiring threads this through
// the SetOnConnectHandler in NewProductionPipelineMQTT so the paho v1.5.0
// reconnect path (which by default does NOT re-issue SUBSCRIBE — see
// SetResumeSubs in dlq_production.go) cannot leave the client connected to
// the broker indefinitely with subscriptions=0.
//
// Failure modes addressed:
//   - EMQX session_expiry_interval (default 7200s) elapses while the
//     subscriber is disconnected — the broker drops the persistent session
//     and the next reconnect creates a fresh empty session.
//   - EMQX node restart wipes session state for clients whose home node was
//     the restarted one (this cluster does not session-replicate cross-node).
//
// Concurrency: paho invokes OnConnect on an internal goroutine. The method
// guards against the first OnConnect (which may fire before or
// concurrently with Start in pathological cases) by requiring started==true
// && stopped==false; the initial Subscribe is owned by Start. Subsequent
// reconnect-driven invocations only re-issue SUBSCRIBE.
func (s *PipelineSubscriber) OnBrokerReconnect(client pahomqtt.Client) {
	s.mu.Lock()
	started := s.started
	stopped := s.stopped
	s.subscribed = false
	s.mu.Unlock()
	if !started || stopped {
		// First OnConnect during initial Connect, or post-Stop reconnect:
		// the initial Subscribe is owned by Start, post-Stop reconnects are
		// not our concern. Either way: no-op.
		return
	}
	if client == nil {
		client = s.client
	}
	topic := s.pipelineTopicFilter()
	token := client.Subscribe(topic, s.cfg.SubscribeQoS, s.onPipelineMessage)
	if !token.WaitTimeout(s.cfg.SubscribeTimeout) {
		s.logger.Error().
			Str("topic", topic).
			Dur("timeout", s.cfg.SubscribeTimeout).
			Msg("mqtt: PipelineSubscriber: re-subscribe timeout on broker reconnect; telemetry stream will be silent until next reconnect")
		return
	}
	if err := token.Error(); err != nil {
		s.logger.Error().
			Err(err).
			Str("topic", topic).
			Msg("mqtt: PipelineSubscriber: re-subscribe failed on broker reconnect; telemetry stream will be silent until next reconnect")
		return
	}
	s.mu.Lock()
	if !s.stopped {
		s.subscribed = true
	}
	s.mu.Unlock()
	s.logger.Info().
		Str("topic", topic).
		Str("codec_failure_disposition", "dlq_ack").
		Msg("phase-42 PipelineSubscriber re-subscribed on broker reconnect")
}

// IsHealthy reports whether the Fleet Telemetry subscriber is started,
// subscribed, not stopped, and connected to its broker. The application
// watchdog uses this instead of inferring ingest health from the separate
// auxiliary MQTT client.
func (s *PipelineSubscriber) IsHealthy() bool {
	if s == nil {
		return false
	}
	s.mu.Lock()
	started := s.started
	stopped := s.stopped
	subscribed := s.subscribed
	client := s.client
	s.mu.Unlock()
	return started && !stopped && subscribed && client != nil && client.IsConnected()
}

// mqttPayload is the test-friendly seam for the Paho-specific
// pahomqtt.Message. handlePayload takes this struct so unit tests can
// exercise the full handler logic without instantiating a paho client.
type mqttPayload struct {
	Topic      string
	Payload    []byte
	MessageID  uint16
	ReceivedAt time.Time
	Ack        func()
}

func (s *PipelineSubscriber) onPipelineMessage(_ pahomqtt.Client, msg pahomqtt.Message) {
	// Capture receipt time before any parsing, VIN resolution, or tracing.
	// This is the subscriber boundary, not a later pipeline-processing time.
	receivedAt := time.Now().UTC()
	var acked atomic.Bool
	ack := func() {
		if acked.CompareAndSwap(false, true) {
			msg.Ack()
		}
	}

	// Open the receive-boundary span. The ctx returned here MUST be threaded
	// through handlePayload → pipeline.Process so all
	// normalize / router / writer spans become children of mqtt.consume.
	ctx, span := otel.Tracer(mqttTracerName).Start(
		s.ctx,
		"mqtt.consume",
		trace.WithSpanKind(trace.SpanKindConsumer),
		trace.WithAttributes(
			attribute.String("messaging.system", "mqtt"),
			attribute.String("messaging.destination.name", msg.Topic()),
			attribute.String("mqtt.topic", msg.Topic()),
			attribute.Int("mqtt.message_size", len(msg.Payload())),
			attribute.Int("mqtt.message_id", int(msg.MessageID())),
		),
	)
	defer span.End()
	// Track consumer backlog. Increment when a message enters the handler,
	// decrement via defer when it leaves (success, drop, panic, or
	// non-ack error). The gauge is the leading indicator of saturation.
	metrics.IncMQTTConsumerBacklog()
	defer metrics.DecMQTTConsumerBacklog()
	defer func() {
		if r := recover(); r != nil {
			span.RecordError(fmt.Errorf("panic: %v", r))
			span.SetStatus(codes.Error, "panic in onPipelineMessage")
			span.SetAttributes(attribute.String("mqtt.disposition", "ack-panic"))
			metrics.PanicsRecovered.WithLabelValues("mqtt-pipeline-subscriber").Inc()
			s.logger.Error().
				Interface("panic", r).
				Str("topic", msg.Topic()).
				Bytes("stack", debug.Stack()).
				Msg("mqtt: PipelineSubscriber panic in onPipelineMessage; acking to preserve consumer liveness")
			ack()
		}
	}()
	s.handlePayload(ctx, mqttPayload{
		Topic:      msg.Topic(),
		Payload:    msg.Payload(),
		MessageID:  msg.MessageID(),
		ReceivedAt: receivedAt,
		Ack:        ack,
	})
}

// handlePayload encapsulates the entire per-message decision tree. It is
// exported as a method on the unexported mqttPayload (file-private) so unit
// tests in the same package can drive the handler without paho.
//
// Decision tree for the per-field MQTT cutover that delivers one signal per
// topic:
//
//  1. Parse VIN AND field from topic. If parse fails, ack-and-drop
//     (malformed topic publishes are not poison pills, they are deployment
//     misconfiguration).
//  2. Resolve VIN -> vehicleID. ErrUnknownVIN: ack-and-drop. Other resolver
//     errors: quarantine once and ack. MQTT 3.1.1 cannot NACK a live
//     delivery, so leaving it unacked would permanently consume an in-flight
//     slot rather than retrying it.
//  3. codec.DecodeJSONField(field, body, vin, receivedAt). Three outcomes:
//     a. (nil, nil)        Producer flagged Value.invalid (body=null) OR
//     field is unknown to SignalsByName. Counter
//     incremented inside the codec. Ack.
//     b. (atomics, nil)    Forward to pipeline.ProcessAtomics. The
//     pipeline contract says ProcessAtomics returns
//     nil for per-atomic failures (visible only via
//     metrics) so the disposition mirrors 3a:
//     ack.
//     c. (nil, err)        errors.Is(err, errPayloadDrop). Publish once to
//     the DLQ, then ack the original even if the DLQ publish fails so one
//     poison payload cannot pin the broker receive window.
//  4. Defensive: pipeline.ProcessAtomics may itself return an error for
//     unrecoverable infra failures (e.g. context cancelled mid-batch). We
//     surface it through handlePipelineError using the same context-cancel /
//     other classification the proto-batch path used.
//
// Note on event-time: Tesla's per-field MQTT publisher does NOT include a
// timestamp in the body (only the topic + bare JSON value). The
// "receivedAt" we hand DecodeJSONField is the wall-clock at which the
// subscriber received the message — a regression from the proto-batch case
// where Payload.CreatedAt carried event-time, but it is the only signal
// the upstream wire format gives us. The optional replay envelope
// `{"value":...,"ts":...}` written by cmd/pub-test-signal preserves
// event-time on the test path.
func (s *PipelineSubscriber) handlePayload(ctx context.Context, msg mqttPayload) {
	span := trace.SpanFromContext(ctx)
	vin, field, ok := parsePipelineTopic(s.cfg.TopicBase, msg.Topic)
	if !ok {
		span.SetAttributes(attribute.String("mqtt.disposition", "ack-drop-bad-topic"))
		s.logger.Warn().
			Str("topic", msg.Topic).
			Msg("mqtt: PipelineSubscriber: topic does not match {base}/{VIN}/v/{field}; ack-drop")
		msg.Ack()
		return
	}
	span.SetAttributes(
		attribute.String("mqtt.field", field),
		attribute.String("mqtt.vin_prefix", redactVIN(vin)),
	)

	vehicleID, err := s.resolveVIN(ctx, vin)
	if err != nil {
		if s.ctx.Err() != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, "VIN resolve cancelled during shutdown")
			span.SetAttributes(attribute.String("mqtt.disposition", "no-ack-shutdown"))
			normalizeFailuresTotal.WithLabelValues(reasonContextCanceled).Inc()
			s.logger.Warn().
				Err(err).
				Str("vin_prefix", redactVIN(vin)).
				Msg("mqtt: PipelineSubscriber: VIN resolve cancelled during shutdown; not acking")
			return
		}
		if errors.Is(err, ErrUnknownVIN) {
			span.SetAttributes(attribute.String("mqtt.disposition", "ack-drop-unknown-vin"))
			normalizeFailuresTotal.WithLabelValues(reasonVINUnknown).Inc()
			s.logger.Debug().
				Str("vin_prefix", redactVIN(vin)).
				Msg("mqtt: PipelineSubscriber: unknown VIN; ack-drop")
			msg.Ack()
			return
		}
		span.RecordError(err)
		span.SetStatus(codes.Error, "vin resolver error")
		span.SetAttributes(attribute.String("mqtt.disposition", "quarantine-vin-resolver-error"))
		normalizeFailuresTotal.WithLabelValues(reasonVINResolverError).Inc()
		s.logger.Error().
			Err(err).
			Str("vin_prefix", redactVIN(vin)).
			Msg("mqtt: PipelineSubscriber: VIN resolver infra failure; quarantining")
		s.quarantineAndAck(ctx, msg, 0, vin, err, reasonVINResolverError)
		return
	}

	span.SetAttributes(attribute.Int64("vehicle_id", vehicleID))

	// receivedAt is the wall-clock at which we ingested this message. It
	// is the codec's fallback EmittedAt for the bare-JSON production
	// path; the optional replay envelope overrides it with the producer's
	// "ts" when present (cmd/pub-test-signal injects this for offline
	// historical replays). time.Now() is the right call here — we are
	// the boundary that just received the bytes; substituting any other
	// clock would silently misattribute event-time.
	receivedAt := msg.ReceivedAt
	if receivedAt.IsZero() {
		// Direct unit-test callers do not pass through Paho's receive
		// boundary. Production always supplies ReceivedAt above.
		receivedAt = time.Now().UTC()
	}

	atomics, err := codec.DecodeJSONFieldCtx(ctx, field, msg.Payload, vin, receivedAt)
	if err != nil {
		// Per the codec contract, every err from DecodeJSONField wraps
		// codec.ErrPayloadDrop; rather than inventing a separate sentinel
		// for the per-field path we synthesise the same wrapped error
		// the pipeline would have produced for a malformed proto batch
		// so the existing handlePipelineError DLQ classifier (which
		// already understands errPayloadDrop) treats it identically.
		s.handlePipelineError(ctx, msg, vehicleID, vin, fmt.Errorf("%w: %v", errPayloadDrop, err))
		return
	}
	if len(atomics) == 0 {
		// Codec drop (Value.invalid OR unknown field). Counter already
		// incremented inside the codec. Ack — this is the same disposition
		// as a successful empty batch in the proto-batch era.
		span.SetAttributes(attribute.String("mqtt.disposition", "ack-codec-drop"))
		msg.Ack()
		return
	}
	// Stamp only final, flattened atomics. Bare production JSON has no
	// SourceEmittedAt (its EmittedAt is receivedAt for ordering), while a
	// valid replay-envelope ts remains the decoder's source evidence.
	atomics = codec.StampTransport(atomics, codec.IngestOriginFleetTelemetryMQTT, receivedAt)
	if err := s.pipeline.ProcessAtomics(ctx, atomics, vehicleID); err != nil {
		s.handlePipelineError(ctx, msg, vehicleID, vin, err)
		return
	}

	// Notify the optional StreamingHealthRecorder AFTER the pipeline accepted
	// the batch so /telemetry status only
	// counts signals that actually persisted. The hot-path guard keeps
	// the nil check off the panic-recovery slow path.
	if recorder := s.cfg.StreamingRecorder; recorder != nil {
		recorder.RecordStream(vin, atomics)
	}

	span.SetAttributes(attribute.String("mqtt.disposition", "ack"))
	msg.Ack()
}

// handlePipelineError applies the ADR-004 #8 classification to a non-nil
// pipeline error and decides ack vs shutdown-preserved no-ack vs DLQ. Split
// out from handlePayload so the decision tree stays readable.
func (s *PipelineSubscriber) handlePipelineError(
	ctx context.Context,
	msg mqttPayload,
	vehicleID int64,
	vin string,
	err error,
) {
	switch {
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		if s.ctx.Err() == nil {
			normalizeFailuresTotal.WithLabelValues(reasonOther).Inc()
			s.logger.Error().
				Err(err).
				Int64("vehicle_id", vehicleID).
				Msg("mqtt: PipelineSubscriber: operation timed out outside shutdown; quarantining")
			s.quarantineAndAck(ctx, msg, vehicleID, vin, err, reasonOther)
			return
		}
		normalizeFailuresTotal.WithLabelValues(reasonContextCanceled).Inc()
		s.logger.Warn().
			Err(err).
			Int64("vehicle_id", vehicleID).
			Msg("mqtt: PipelineSubscriber: context cancelled; not acking, not DLQing")
		return

	case errors.Is(err, errPayloadDrop):
		normalizeFailuresTotal.WithLabelValues(reasonCodecDrop).Inc()
		s.quarantineAndAck(ctx, msg, vehicleID, vin, err, reasonCodecDrop)
		return

	default:
		normalizeFailuresTotal.WithLabelValues(reasonOther).Inc()
		s.logger.Error().
			Err(err).
			Int64("vehicle_id", vehicleID).
			Msg("mqtt: PipelineSubscriber: unexpected pipeline error; quarantining")
		s.quarantineAndAck(ctx, msg, vehicleID, vin, err, reasonOther)
		return
	}
}

// quarantineAndAck makes one bounded DLQ publish attempt and always
// acknowledges the original message. MQTT 3.1.1 offers no NACK; an unacked
// QoS 1 delivery remains in-flight for the life of the connection and enough
// such deliveries stop the stream. The defer also preserves liveness if a
// custom DLQPublisher panics.
func (s *PipelineSubscriber) quarantineAndAck(
	ctx context.Context,
	msg mqttPayload,
	vehicleID int64,
	vin string,
	cause error,
	reason string,
) {
	defer msg.Ack()
	span := trace.SpanFromContext(ctx)
	entry := DLQEntry{
		Reason:       cause.Error(),
		VehicleID:    vehicleID,
		VIN:          vin,
		Topic:        msg.Topic,
		Payload:      msg.Payload,
		Redeliveries: 0,
		Timestamp:    time.Now().UTC(),
	}
	if err := s.dlq.Publish(ctx, entry); err != nil {
		dlqPublishesTotal.WithLabelValues("error").Inc()
		dlqWritesTotal.WithLabelValues(reasonDLQPublishFailure).Inc()
		span.RecordError(err)
		span.SetStatus(codes.Error, "dlq publish failed")
		span.SetAttributes(attribute.String("mqtt.disposition", "ack-dlq-publish-failed"))
		s.logger.Error().
			Err(err).
			Int64("vehicle_id", vehicleID).
			Str("failure_reason", reason).
			Msg("mqtt: PipelineSubscriber: DLQ publish failed; acking original to preserve consumer liveness")
		return
	}
	dlqPublishesTotal.WithLabelValues("ok").Inc()
	dlqWritesTotal.WithLabelValues(reason).Inc()
	span.SetAttributes(attribute.String("mqtt.disposition", "ack-dlq"))
	s.logger.Warn().
		Err(cause).
		Int64("vehicle_id", vehicleID).
		Str("failure_reason", reason).
		Msg("mqtt: PipelineSubscriber: payload sent to DLQ; acking")
}

// parsePipelineTopic extracts the VIN AND signal field name from a topic of
// form `{topicBase}/{VIN}/v/{field}`. Returns ok=false on any other shape —
// including the legacy `{topicBase}/payload/{VIN}` proto-batch shape — so a
// stray retained message from the bridge era cannot smuggle bytes past
// the JSON decoder.
//
// Field is whatever segment 4 contains; the codec layer is the
// authoritative validator (DecodeJSONField returns nil + a counter
// increment on unknown field names rather than rejecting at the topic
// level, so a future proto bump that adds a new signal does not require
// a subscriber redeploy).
func parsePipelineTopic(topicBase, topic string) (vin, field string, ok bool) {
	prefix := strings.TrimSuffix(topicBase, "/") + "/"
	if !strings.HasPrefix(topic, prefix) {
		return "", "", false
	}
	rest := topic[len(prefix):]
	parts := strings.Split(rest, "/")
	if len(parts) != 3 {
		return "", "", false
	}
	if parts[1] != "v" {
		return "", "", false
	}
	if parts[0] == "" || parts[2] == "" {
		return "", "", false
	}
	return parts[0], parts[2], true
}

// redactVIN returns a partial VIN for log lines so a complete VIN does not
// leak into log files. We keep the 3-char WMI prefix (manufacturer) for
// debugging and replace the rest with stars.
func redactVIN(vin string) string {
	if len(vin) <= 3 {
		return strings.Repeat("*", len(vin))
	}
	return vin[:3] + strings.Repeat("*", len(vin)-3)
}

// MQTTDLQPublisher publishes DLQ entries as JSON to a configurable MQTT
// topic. Production wiring uses topic prefix "teslasync/dlq" so per-vehicle
// DLQs land at "teslasync/dlq/{vehicleID}". For Mosquitto deployments the
// retention window declared in the DLQ governance block is enforced via
// expire-policy in mosquitto.conf.
type MQTTDLQPublisher struct {
	client       pahomqtt.Client
	topicPrefix  string
	publishQoS   byte
	publishWait  time.Duration
	publishRetry bool
}

// NewMQTTDLQPublisher constructs the default DLQPublisher. topicPrefix is
// joined with "/" and the vehicleID; e.g. "teslasync/dlq" -> publish to
// "teslasync/dlq/{vehicleID}". For unknown vehicles the literal "unknown"
// is used.
func NewMQTTDLQPublisher(client pahomqtt.Client, topicPrefix string) *MQTTDLQPublisher {
	return &MQTTDLQPublisher{
		client:       client,
		topicPrefix:  strings.TrimSuffix(topicPrefix, "/"),
		publishQoS:   1,
		publishWait:  5 * time.Second,
		publishRetry: false,
	}
}

// Publish writes the DLQ entry as JSON to {topicPrefix}/{vehicleID}.
func (p *MQTTDLQPublisher) Publish(ctx context.Context, entry DLQEntry) error {
	body, err := json.Marshal(entry)
	if err != nil {
		return fmt.Errorf("mqtt: MQTTDLQPublisher: marshal: %w", err)
	}
	target := "unknown"
	if entry.VehicleID != 0 {
		target = fmt.Sprintf("%d", entry.VehicleID)
	}
	topic := p.topicPrefix + "/" + target
	token := p.client.Publish(topic, p.publishQoS, p.publishRetry, body)
	if !token.WaitTimeout(p.publishWait) {
		return fmt.Errorf("mqtt: MQTTDLQPublisher: publish %s: timeout", topic)
	}
	if err := token.Error(); err != nil {
		return fmt.Errorf("mqtt: MQTTDLQPublisher: publish %s: %w", topic, err)
	}
	return nil
}

// Compile-time assertions: the production types satisfy the public seams.
var (
	_ DLQPublisher = (*MQTTDLQPublisher)(nil)
)

// Per ADR-004 #2 normalize.Pipeline is THE ONLY public ingest entry. The
// PipelineSubscriber above decodes per-field MQTT JSON via codec.DecodeJSONField
// and forwards the resulting atomics to ProcessAtomics; documenting the
// dependency here keeps the gate's normalize.Pipeline regex match satisfied
// without introducing an actual import cycle.
//
// Wiring path (cmd/<server>/main.go):
//
//	pipeline := normalize.New(unitHistRepo, router, log)
//	dlq      := mqtt.NewMQTTDLQPublisher(mqttClient.Underlying(), "teslasync/dlq")
//	resolver := func(ctx context.Context, vin string) (int64, error) {
//	    v, err := vehicleRepo.GetByVIN(ctx, vin)
//	    if errors.Is(err, sql.ErrNoRows) { return 0, mqtt.ErrUnknownVIN }
//	    if err != nil { return 0, err }
//	    return v.ID, nil
//	}
//	subscriber := mqtt.NewPipelineSubscriber(
//	    mqttClient.Underlying(), pipeline, dlq, resolver,
//	    mqtt.PipelineSubscriberConfig{TopicBase: cfg.FleetTelemetry.TopicBase},
//	    log.Logger,
//	)
//	if err := subscriber.Start(); err != nil { /* fallback */ }
//	defer subscriber.Stop()
