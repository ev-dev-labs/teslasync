package mqtt

// Production wiring helper for the PipelineSubscriber MQTT client and DLQ publisher.
//
// Per ADR-004 #8 and the manual-ack contract documented in mqtt.go,
// PipelineSubscriber requires a paho client constructed with
// SetAutoAckDisabled(true) so messages are acked only AFTER pipeline.Process
// returns or the payload has received a terminal DLQ disposition. Without
// manual ack:
//
//   - A successful Process is acked at message-arrival time (default paho
//     behavior), so a crash mid-Process loses the message.
//   - An ErrPayloadDrop is acked before the bounded DLQ publish attempt,
//     so poison pills can be silently dropped instead of quarantined.
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

	"github.com/ev-dev-labs/teslasync/internal/metrics"
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
	pipelineMaxReconnectInterval = 30 * time.Second
)

// productionPipelineOptions builds the paho ClientOptions used for the
// PipelineSubscriber's broker connection. Returned options encode the
// manual-ack contract + session-persistence + concurrency-tolerant settings
// per Decision #2:
//
//   - SetAutoAckDisabled(true)        — PipelineSubscriber owns ack timing.
//   - SetCleanSession(false)          — broker-side queue persists across
//     reconnects so in-flight messages survive a pod restart.
//   - SetKeepAlive(30s)               — matches legacy + mosquitto default.
//   - SetPingTimeout(10s)             — half-open detection cutoff.
//   - SetConnectTimeout(30s)          — initial handshake cap.
//   - SetMaxReconnectInterval(30s)    — bounded recovery without a multi-minute
//     broker-queue growth window.
//   - SetOrderMatters(false)          — writers are idempotent so concurrent
//     message handling is safe and lets paho fan out across goroutines.
//   - SetAutoReconnect(true)          — reconnect after transport failures;
//     the persistent broker queue then resumes delivery.
//
// We deliberately leave SetResumeSubs at its default (false). Combining it
// with the explicit re-Subscribe path in PipelineSubscriber.OnBrokerReconnect
// would accumulate duplicate persisted SUBSCRIBE packets across reconnects,
// because paho v1.5.0 does not delete completed SUBSCRIBE entries from its
// internal store after SUBACK (see net.go:205-217). The explicit re-Subscribe
// is sufficient on its own and is the mechanism that recovers from a
// broker-dropped persistent session (the failure mode that caused production
// telemetry to silently stop flowing for 5+ days when the OnConnect handler
// only logged).
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
//
// onConnect and onConnectionLost (optional, may be nil) are invoked from the
// corresponding paho callbacks so PipelineSubscriber can keep its connection
// and subscription state accurate.
//
// onConnect is invoked from inside the paho
// SetOnConnectHandler AFTER the broker-connected log line, on every
// successful (re)connect. This is the seam the PipelineSubscriber wires
// its re-subscribe + tracker-reset into so that a session-expired
// reconnect (broker dropped persistent session, paho default
// ResumeSubs=false) re-establishes the SUBSCRIBE; without this the
// client stays connected indefinitely with subscriptions=0 and the
// fleet-telemetry stream silently stops flowing. See the reconnect-
// resubscribe contract in PipelineSubscriber.OnBrokerReconnect (mqtt.go).
//
// Note: the callback runs on a paho-internal goroutine. The PipelineSubscriber
// MUST be safe to invoke concurrently with Start/Stop and tolerate being
// called before its first Start (pre-start invocations are a no-op there).
func NewProductionPipelineMQTT(
	ctx context.Context,
	brokerURL string,
	clientID string,
	username string,
	password string,
	dlqTopic string,
	log zerolog.Logger,
	onConnect func(pahomqtt.Client),
	onConnectionLost func(error),
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
	opts.SetOnConnectHandler(func(c pahomqtt.Client) {
		metrics.MQTTPipelineConnected.WithLabelValues(fleetTelemetryConsumerLabel).Set(1)
		log.Info().Str("broker", brokerURL).Msg("mqtt: PipelineSubscriber broker connected")
		if onConnect != nil {
			onConnect(c)
		}
	})
	opts.SetConnectionLostHandler(func(_ pahomqtt.Client, err error) {
		metrics.MQTTPipelineConnected.WithLabelValues(fleetTelemetryConsumerLabel).Set(0)
		metrics.MQTTPipelineSubscribed.WithLabelValues(fleetTelemetryConsumerLabel).Set(0)
		log.Warn().Err(err).Str("broker", brokerURL).Msg("mqtt: PipelineSubscriber broker connection lost")
		if onConnectionLost != nil {
			onConnectionLost(err)
		}
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
