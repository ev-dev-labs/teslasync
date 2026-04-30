package mqtt

import (
	"context"
	"encoding/json"
	"fmt"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/metrics"
)

// SignalBatch contains batched signals for a single VIN.
type SignalBatch struct {
	VIN     string
	Signals map[string]interface{}
}

// SignalHandler processes a batch of signals for a VIN.
type SignalHandler func(ctx context.Context, vin string, signals map[string]interface{})

// Subscriber listens to fleet-telemetry MQTT topics and batches signals per VIN
// before forwarding them for processing. Fleet-telemetry publishes each field as
// a separate MQTT message; the subscriber collects them into a single batch per
// VIN using a configurable time window.
type Subscriber struct {
	client    pahomqtt.Client
	topicBase string
	handler   SignalHandler
	batchMs   int

	mu      sync.Mutex
	batches map[string]*pendingBatch // keyed by VIN

	ctx    context.Context
	cancel context.CancelFunc
}

type pendingBatch struct {
	signals map[string]interface{}
	timer   *time.Timer
}

// NewSubscriber creates a fleet-telemetry MQTT subscriber.
// topicBase is the fleet-telemetry topic prefix (e.g., "telemetry").
// batchMs is the batching window in milliseconds (signals for the same VIN
// within this window are grouped into one processing call).
func NewSubscriber(client pahomqtt.Client, topicBase string, batchMs int, handler SignalHandler) *Subscriber {
	if batchMs <= 0 {
		batchMs = 100
	}
	ctx, cancel := context.WithCancel(context.Background())
	return &Subscriber{
		client:    client,
		topicBase: strings.TrimSuffix(topicBase, "/"),
		handler:   handler,
		batchMs:   batchMs,
		batches:   make(map[string]*pendingBatch),
		ctx:       ctx,
		cancel:    cancel,
	}
}

// Start subscribes to fleet-telemetry topics and begins processing.
// It subscribes to {topicBase}/+/v/# to receive all vehicle metric fields.
func (s *Subscriber) Start() error {
	topic := fmt.Sprintf("%s/+/v/#", s.topicBase)

	// Resubscribe on reconnect
	s.client.AddRoute(topic, s.onMessage)

	// NOTE: Each pod gets a unique client ID (cfg.ClientID + random suffix), so
	// Mosquitto delivers every message to ALL subscribers — causing duplicate
	// processing during rolling deploys. The DB layer guards against this with
	// ON CONFLICT DO NOTHING on signal_log's composite PK.
	//
	// If DB-level dedup proves insufficient under high load, switch to MQTT v5
	// shared subscriptions: subscribe to "$share/teslasync/{topic}" instead.
	// The broker then delivers each message to exactly ONE subscriber in the
	// "teslasync" group, eliminating duplicates at the source.
	token := s.client.Subscribe(topic, 1, s.onMessage)
	if !token.WaitTimeout(10 * time.Second) {
		return fmt.Errorf("fleet-telemetry MQTT subscribe timeout for topic %s", topic)
	}
	if err := token.Error(); err != nil {
		return fmt.Errorf("fleet-telemetry MQTT subscribe: %w", err)
	}

	log.Info().
		Str("topic", topic).
		Int("batch_ms", s.batchMs).
		Msg("fleet-telemetry MQTT subscriber started")

	return nil
}

// Stop unsubscribes and cancels pending batches.
func (s *Subscriber) Stop() {
	s.cancel()

	topic := fmt.Sprintf("%s/+/v/#", s.topicBase)
	s.client.Unsubscribe(topic)

	s.mu.Lock()
	defer s.mu.Unlock()
	for _, b := range s.batches {
		b.timer.Stop()
	}
	s.batches = make(map[string]*pendingBatch)

	log.Info().Msg("fleet-telemetry MQTT subscriber stopped")
}

// onMessage handles an incoming MQTT message from fleet-telemetry.
// Topic format: {topicBase}/{VIN}/v/{fieldName}
// Payload: JSON-encoded field value
func (s *Subscriber) onMessage(_ pahomqtt.Client, msg pahomqtt.Message) {
	topic := msg.Topic()
	payload := msg.Payload()

	// Parse topic: {topicBase}/{VIN}/v/{fieldName}
	vin, fieldName, ok := s.parseTopic(topic)
	if !ok {
		return
	}

	// Parse the payload value
	var value interface{}
	if err := json.Unmarshal(payload, &value); err != nil {
		// If it's not valid JSON, treat as raw string
		value = string(payload)
	}

	s.addSignal(vin, fieldName, value)
}

// parseTopic extracts VIN and field name from a fleet-telemetry topic.
// Expected format: {topicBase}/{VIN}/v/{fieldName}
func (s *Subscriber) parseTopic(topic string) (vin, fieldName string, ok bool) {
	prefix := s.topicBase + "/"
	if !strings.HasPrefix(topic, prefix) {
		return "", "", false
	}
	rest := topic[len(prefix):]

	// rest = "{VIN}/v/{fieldName}"
	parts := strings.SplitN(rest, "/v/", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", "", false
	}
	return parts[0], parts[1], true
}

// addSignal adds a signal to the VIN's pending batch. If this is the first
// signal for the VIN, a flush timer is started.
func (s *Subscriber) addSignal(vin, fieldName string, value interface{}) {
	s.mu.Lock()
	defer s.mu.Unlock()

	batch, exists := s.batches[vin]
	if !exists {
		batch = &pendingBatch{
			signals: make(map[string]interface{}),
		}
		batch.timer = time.AfterFunc(time.Duration(s.batchMs)*time.Millisecond, func() {
			defer func() {
				if r := recover(); r != nil {
					metrics.PanicsRecovered.WithLabelValues("mqtt-batch-flush").Inc()
					log.Error().
						Interface("panic", r).
						Str("vin", vin).
						Bytes("stack", debug.Stack()).
						Msg("mqtt: panic in batch flush")
				}
			}()
			s.flushBatch(vin)
		})
		s.batches[vin] = batch
	}

	batch.signals[fieldName] = value
}

// flushBatch sends the accumulated signals for a VIN to the handler.
func (s *Subscriber) flushBatch(vin string) {
	s.mu.Lock()
	batch, exists := s.batches[vin]
	if !exists {
		s.mu.Unlock()
		return
	}
	signals := batch.signals
	delete(s.batches, vin)
	s.mu.Unlock()

	if len(signals) == 0 {
		return
	}

	log.Debug().
		Str("vin", vin).
		Int("signals", len(signals)).
		Msg("fleet-telemetry MQTT batch flushing")

	s.handler(s.ctx, vin, signals)
}
