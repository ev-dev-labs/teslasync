package outbox

import (
	"context"
	"errors"
	"fmt"
	"time"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
)

// MQTTBusPublisher adapts a Paho MQTT client to the outbox Publisher
// interface. The publish destination is computed per row as:
//
//	outbox.TopicPrefix + row.EventType
//
// (e.g., "teslasync/events/drive.ended") so subscribers can keep their
// existing subscription paths from internal/events.TopicPrefix.
//
// Why this adapter lives here (not in internal/events)
// ────────────────────────────────────────────────────
// The outbox package is platform-tier and import-free of MQTT
// at the core (dispatcher.go); this file ISOLATES the optional
// Paho dependency so tests of the dispatcher can swap in a recorder
// Publisher without dragging the broker into the test binary.
// Composition root wires NewMQTTBusPublisher(client) and passes the
// result to NewDispatcher.
type MQTTBusPublisher struct {
	client      pahomqtt.Client
	topicPrefix string
	qos         byte
	timeout     time.Duration
}

// DefaultTopicPrefix mirrors internal/events.TopicPrefix so existing
// subscribers do not need to change their subscription patterns.
const DefaultTopicPrefix = "teslasync/events/"

// NewMQTTBusPublisher wires a Paho client. Returns nil if client is
// nil. QoS defaults to 1 (at-least-once on the broker side; the
// outbox layer adds at-least-once across crashes). Timeout defaults
// to 5s to match the existing events.Bus.Publish timing.
func NewMQTTBusPublisher(client pahomqtt.Client) *MQTTBusPublisher {
	if client == nil {
		return nil
	}
	return &MQTTBusPublisher{
		client:      client,
		topicPrefix: DefaultTopicPrefix,
		qos:         1,
		timeout:     5 * time.Second,
	}
}

// WithTopicPrefix overrides the default prefix. Useful for staging
// environments that publish to a sibling prefix to avoid leaking
// events into the prod fan-out.
func (p *MQTTBusPublisher) WithTopicPrefix(prefix string) *MQTTBusPublisher {
	if p == nil {
		return nil
	}
	p.topicPrefix = prefix
	return p
}

// WithQoS overrides the default MQTT QoS. Must be 0, 1, or 2.
func (p *MQTTBusPublisher) WithQoS(qos byte) *MQTTBusPublisher {
	if p == nil || qos > 2 {
		return p
	}
	p.qos = qos
	return p
}

// WithTimeout overrides the default publish ack timeout.
func (p *MQTTBusPublisher) WithTimeout(d time.Duration) *MQTTBusPublisher {
	if p == nil || d <= 0 {
		return p
	}
	p.timeout = d
	return p
}

// PublishOutbox emits one row to the broker. Returns:
//
//   - ErrBrokerDisconnected if the Paho client reports disconnected;
//     the dispatcher will retry per its backoff schedule.
//   - context.DeadlineExceeded if the broker did not ack within
//     WithTimeout; dispatcher retries.
//   - any other error returned by Paho's token.Error() — usually a
//     transient network blip; dispatcher retries.
//   - nil on broker ack within the timeout.
func (p *MQTTBusPublisher) PublishOutbox(ctx context.Context, row Row) error {
	if p == nil || p.client == nil {
		return ErrBrokerDisconnected
	}
	if !p.client.IsConnected() {
		return ErrBrokerDisconnected
	}
	topic := p.topicPrefix + row.EventType
	token := p.client.Publish(topic, p.qos, false, row.Payload)
	// Respect ctx deadline AND our own timeout; whichever is shorter wins.
	dl, hasDL := ctx.Deadline()
	wait := p.timeout
	if hasDL {
		if rem := time.Until(dl); rem > 0 && rem < wait {
			wait = rem
		}
	}
	if !token.WaitTimeout(wait) {
		return fmt.Errorf("outbox: broker publish timeout after %s", wait)
	}
	if err := token.Error(); err != nil {
		return fmt.Errorf("outbox: broker publish: %w", err)
	}
	return nil
}

// ErrBrokerDisconnected is returned by PublishOutbox when the broker
// is unreachable. Surfacing a typed error lets the dispatcher
// distinguish "transient connectivity" from "malformed payload" in
// future slices that classify failures more finely.
var ErrBrokerDisconnected = errors.New("outbox: broker disconnected")
