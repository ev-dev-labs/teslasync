package mqtt

// dlq_production.go — phase-42a/0040 production wiring helper for the
// PipelineSubscriber's MQTT client + DLQ publisher.
//
// Per ADR-004 #8 and the manual-ack contract documented at
// internal/mqtt/mqtt.go:224-236, PipelineSubscriber requires a paho client
// constructed with SetAutoAckDisabled(true) so messages are acked only AFTER
// pipeline.Process returns. Without manual ack:
//
//   - A successful Process is acked at message-arrival time (default paho
//     behavior), so a crash mid-Process loses the message.
//   - An ErrPayloadDrop cannot be NACKed — the broker would never redeliver,
//     so poison pills would be silently dropped on the floor instead of
//     captured for forensic analysis in the DLQ.
//
// Phase-42 prompt 0060 added the MQTTDLQPublisher type but did NOT wire it
// into a production constructor — it was only constructible by tests. This
// file is the production-side helper; the cutover prompt (phase-42a/0050)
// invokes it from cmd/teslasync.
//
// SCOPE — what this file does NOT do:
//   - It does NOT implement ack/nack logic. Ack/nack lives in
//     PipelineSubscriber.handlePayload (mqtt.go ~line 672+) and only requires
//     that the underlying client was constructed with AutoAckDisabled=true.
//   - It does NOT register a subscription. The caller wires the connected
//     client into NewPipelineSubscriber + Start which performs the subscribe.
//   - It does NOT persist DLQ payloads. Persistence is broker-side
//     (mosquitto.conf retention rules per the DLQ governance block in
//     mqtt.go:191-220).

import (
	"context"
	"fmt"
	"strings"
	"time"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/rs/zerolog"
)

const (
	// pipelineConnectTimeout caps how long NewProductionPipelineMQTT waits for
	// the broker handshake. If the caller-supplied ctx has an earlier
	// deadline, that takes precedence (Decision #3).
	pipelineConnectTimeout = 30 * time.Second

	// pipelineKeepAlive matches the legacy NewClient cadence and the
	// Mosquitto default tolerance window.
	pipelineKeepAlive = 30 * time.Second

	// pipelinePingTimeout is the broker-ping cutoff before the client treats
	// the connection as half-open and triggers reconnect.
	pipelinePingTimeout = 10 * time.Second

	// pipelineMaxReconnectInterval is the cap on backoff between reconnect
	// attempts.
	pipelineMaxReconnectInterval = 5 * time.Minute
)

// productionPipelineOptions builds the paho ClientOptions used for the
// PipelineSubscriber's broker connection. Returned options encode the
// manual-ack contract + session-persistence + concurrency-tolerant settings
// per Decision #2:
//
//   - SetAutoAckDisabled(true)        — pipeline.Process owns ack timing.
//   - SetCleanSession(false)          — broker-side queue persists across
//     reconnects so in-flight messages survive a pod restart.
//   - SetKeepAlive(30s)               — matches legacy + mosquitto default.
//   - SetPingTimeout(10s)             — half-open detection cutoff.
//   - SetConnectTimeout(30s)          — initial handshake cap.
//   - SetMaxReconnectInterval(5min)   — backoff cap between reconnects.
//   - SetOrderMatters(false)          — writers are idempotent so concurrent
//     message handling is safe and lets paho fan out across goroutines.
//   - SetAutoReconnect(true)          — broker reconnect is mandatory; the
//     PipelineSubscriber explicitly relies on broker redelivery.
//
// Exported as package-private to support direct field inspection in
// dlq_production_test.go (paho's *Client does not expose its options
// post-construction; the *ClientOptions return value here is the test seam).
func productionPipelineOptions(brokerURL, clientID, username, password string) *pahomqtt.ClientOptions {
	opts := pahomqtt.NewClientOptions().
		AddBroker(brokerURL).
		SetClientID(clientID).
		SetAutoAckDisabled(true).
		SetCleanSession(false).
		SetKeepAlive(pipelineKeepAlive).
		SetPingTimeout(pipelinePingTimeout).
		SetConnectTimeout(pipelineConnectTimeout).
		SetMaxReconnectInterval(pipelineMaxReconnectInterval).
		SetOrderMatters(false).
		SetAutoReconnect(true)

	if username != "" {
		opts.SetUsername(username)
		opts.SetPassword(password)
	}

	return opts
}

// NewProductionPipelineMQTT constructs the paho client and DLQPublisher used
// by PipelineSubscriber in production. It returns the connected client AND a
// *MQTTDLQPublisher wired against the same client.
//
// Connection contract (Decision #3): the function blocks until either
//
//	(a) the broker handshake completes within the lesser of 30 seconds and
//	    ctx.Deadline(), in which case the connected client is returned, or
//	(b) the connection fails / ctx is cancelled / the timeout elapses, in
//	    which case the client is disconnected before the function returns
//	    (so the caller does not have to remember to clean up) and the
//	    returned error wraps the broker URL for triage context.
//
// dlqTopic naming convention (Decision #4 — recommended, NOT enforced):
// "tesla/dlq/{env}" where {env} is one of "dev"/"staging"/"prod". The
// MQTTDLQPublisher appends "/{vehicleID}" to the supplied topic on each
// publish (see NewMQTTDLQPublisher in mqtt.go).
//
// log is captured by reference for the on-connect / on-connection-lost
// callbacks attached to the client; subsequent broker events log against
// this logger asynchronously.
func NewProductionPipelineMQTT(
	ctx context.Context,
	brokerURL string,
	clientID string,
	username string,
	password string,
	dlqTopic string,
	log zerolog.Logger,
) (pahomqtt.Client, *MQTTDLQPublisher, error) {
	if strings.TrimSpace(brokerURL) == "" {
		return nil, nil, fmt.Errorf("mqtt: NewProductionPipelineMQTT: brokerURL must be non-empty")
	}
	if strings.TrimSpace(clientID) == "" {
		return nil, nil, fmt.Errorf("mqtt: NewProductionPipelineMQTT: clientID must be non-empty")
	}
	if strings.TrimSpace(dlqTopic) == "" {
		return nil, nil, fmt.Errorf("mqtt: NewProductionPipelineMQTT: dlqTopic must be non-empty")
	}

	opts := productionPipelineOptions(brokerURL, clientID, username, password)
	opts.SetOnConnectHandler(func(_ pahomqtt.Client) {
		log.Info().Str("broker", brokerURL).Msg("mqtt: PipelineSubscriber broker connected")
	})
	opts.SetConnectionLostHandler(func(_ pahomqtt.Client, err error) {
		log.Warn().Err(err).Str("broker", brokerURL).Msg("mqtt: PipelineSubscriber broker connection lost")
	})

	client := pahomqtt.NewClient(opts)
	token := client.Connect()

	// Decision #3: 30s timeout, but observe ctx.Deadline if earlier;
	// ctx.Done() short-circuits the wait so a shutdown signal is not delayed
	// by the timeout. A token.Wait() that never returns is acceptable
	// because client.Disconnect(0) on the failure path causes paho to fail
	// the in-flight token, which unblocks the wait goroutine; if it does
	// not (paho-internal bug) the goroutine leaks at most once per failed
	// startup attempt — bounded by the deployment's restart count.
	timeout := pipelineConnectTimeout
	if d, ok := ctx.Deadline(); ok {
		if rem := time.Until(d); rem < timeout {
			timeout = rem
		}
	}
	if timeout < 0 {
		timeout = 0
	}

	done := make(chan struct{})
	go func() {
		token.Wait()
		close(done)
	}()

	timer := time.NewTimer(timeout)
	defer timer.Stop()

	select {
	case <-done:
		if err := token.Error(); err != nil {
			client.Disconnect(0)
			return nil, nil, fmt.Errorf("mqtt: NewProductionPipelineMQTT: connect %s: %w", brokerURL, err)
		}
	case <-ctx.Done():
		client.Disconnect(0)
		return nil, nil, fmt.Errorf("mqtt: NewProductionPipelineMQTT: connect %s: %w", brokerURL, ctx.Err())
	case <-timer.C:
		client.Disconnect(0)
		return nil, nil, fmt.Errorf("mqtt: NewProductionPipelineMQTT: connect %s: timeout after %s", brokerURL, timeout)
	}

	dlq := NewMQTTDLQPublisher(client, dlqTopic)
	return client, dlq, nil
}
