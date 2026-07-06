package mqtt

import (
	"context"
	"errors"
	"fmt"
	"time"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/platform/config"
	"github.com/ev-dev-labs/teslasync/internal/port/messaging"
)

const (
	// connectTimeout bounds the initial broker handshake.
	connectTimeout = 10 * time.Second
	// opTimeout bounds a single publish / subscribe / unsubscribe round-trip.
	opTimeout = 5 * time.Second
	// reconnectInterval is the backoff between automatic reconnect attempts.
	reconnectInterval = 5 * time.Second
)

// Sentinel errors for input validation so callers can match with errors.Is.
var (
	errEmptyTopic = errors.New("topic must not be empty")
	errNilHandler = errors.New("handler must not be nil")
)

// newClient is the Paho client constructor. It is a package-level seam so
// tests can inject a fake broker client without a live network connection;
// production always uses pahomqtt.NewClient.
var newClient = pahomqtt.NewClient

// waitToken blocks until the Paho token completes, ctx is cancelled, or the
// timeout elapses — whichever happens first. It returns nil only when the
// token completed successfully; every other outcome yields an error wrapped
// with op for context.
//
// This closes a classic Paho foot-gun. The naive form
//
//	if token.WaitTimeout(d) && token.Error() != nil { ... }
//
// treats a timeout as success: WaitTimeout reports false on timeout and, per
// its contract, does NOT set an error on the token, so the && short-circuits
// and the caller silently proceeds as if the operation had confirmed.
func waitToken(ctx context.Context, token pahomqtt.Token, timeout time.Duration, op string) error {
	timer := time.NewTimer(timeout)
	defer timer.Stop()

	select {
	case <-token.Done():
		if err := token.Error(); err != nil {
			return fmt.Errorf("%s: %w", op, err)
		}
		return nil
	case <-ctx.Done():
		return fmt.Errorf("%s: %w", op, ctx.Err())
	case <-timer.C:
		return fmt.Errorf("%s: timed out after %s", op, timeout)
	}
}

// Publisher implements messaging.MQTTPublisher using Paho MQTT.
type Publisher struct {
	client pahomqtt.Client
	qos    byte
}

// Compile-time assertion that *Publisher satisfies the port.
var _ messaging.MQTTPublisher = (*Publisher)(nil)

// NewPublisher creates a new MQTT publisher and blocks until the broker
// connection is established or the connect timeout elapses.
func NewPublisher(cfg config.MQTTConfig) (*Publisher, error) {
	opts := pahomqtt.NewClientOptions().
		AddBroker(cfg.BrokerURL()).
		SetClientID(cfg.ClientID + "_pub").
		SetUsername(cfg.Username).
		SetPassword(cfg.Password).
		SetAutoReconnect(true).
		SetConnectRetry(true).
		SetConnectRetryInterval(reconnectInterval)

	client := newClient(opts)
	if err := waitToken(context.Background(), client.Connect(), connectTimeout, "connecting to MQTT broker"); err != nil {
		return nil, err
	}

	log.Info().
		Str("broker", cfg.BrokerURL()).
		Str("client_id", cfg.ClientID+"_pub").
		Msg("MQTT publisher connected")
	return &Publisher{client: client, qos: 1}, nil
}

// Publish sends payload to topic and waits for broker confirmation, honouring
// both ctx cancellation and a bounded operation timeout. A timeout or a broker
// error is returned to the caller rather than being silently swallowed.
func (p *Publisher) Publish(ctx context.Context, topic string, payload []byte) error {
	if topic == "" {
		return fmt.Errorf("publishing to MQTT: %w", errEmptyTopic)
	}
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("publishing to %s: %w", topic, err)
	}

	token := p.client.Publish(topic, p.qos, false, payload)
	return waitToken(ctx, token, opTimeout, fmt.Sprintf("publishing to %s", topic))
}

// Subscriber implements messaging.MQTTSubscriber using Paho MQTT.
type Subscriber struct {
	client pahomqtt.Client
}

// Compile-time assertion that *Subscriber satisfies the (legacy) port.
var _ messaging.MQTTSubscriber = (*Subscriber)(nil)

// NewSubscriber creates a new MQTT subscriber and blocks until the broker
// connection is established or the connect timeout elapses.
func NewSubscriber(cfg config.MQTTConfig) (*Subscriber, error) {
	opts := pahomqtt.NewClientOptions().
		AddBroker(cfg.BrokerURL()).
		SetClientID(cfg.ClientID + "_sub").
		SetUsername(cfg.Username).
		SetPassword(cfg.Password).
		SetAutoReconnect(true)

	client := newClient(opts)
	if err := waitToken(context.Background(), client.Connect(), connectTimeout, "connecting to MQTT broker"); err != nil {
		return nil, err
	}

	log.Info().
		Str("broker", cfg.BrokerURL()).
		Str("client_id", cfg.ClientID+"_sub").
		Msg("MQTT subscriber connected")
	return &Subscriber{client: client}, nil
}

// Subscribe registers handler for topic. The handler is invoked for each
// received message with the Subscribe-time context, the message topic, and the
// raw payload; a non-nil handler error is logged (redelivery / DLQ policy is
// owned by the pipeline subscriber, not this generic adapter).
func (s *Subscriber) Subscribe(ctx context.Context, topic string, handler messaging.MQTTHandler) error {
	if topic == "" {
		return fmt.Errorf("subscribing to MQTT: %w", errEmptyTopic)
	}
	if handler == nil {
		return fmt.Errorf("subscribing to %s: %w", topic, errNilHandler)
	}
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("subscribing to %s: %w", topic, err)
	}

	token := s.client.Subscribe(topic, 1, func(_ pahomqtt.Client, msg pahomqtt.Message) {
		if err := handler(ctx, msg.Topic(), msg.Payload()); err != nil {
			log.Error().
				Err(err).
				Str("topic", msg.Topic()).
				Msg("MQTT message handler error")
		}
	})
	return waitToken(ctx, token, opTimeout, fmt.Sprintf("subscribing to %s", topic))
}

// Unsubscribe removes the subscription for topic.
func (s *Subscriber) Unsubscribe(ctx context.Context, topic string) error {
	if topic == "" {
		return fmt.Errorf("unsubscribing from MQTT: %w", errEmptyTopic)
	}
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("unsubscribing from %s: %w", topic, err)
	}

	token := s.client.Unsubscribe(topic)
	return waitToken(ctx, token, opTimeout, fmt.Sprintf("unsubscribing from %s", topic))
}
