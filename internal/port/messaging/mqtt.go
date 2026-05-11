// Package messaging defines the hexagonal port interfaces for MQTT
// publish / subscribe seams.
//
// Phase-42 contract (see ADR-004 §2 and .github/instructions/tesla-pipeline.instructions.md):
//
//   - Inbound Tesla Fleet Telemetry payloads are opaque proto bytes. The
//     MQTT subscriber adapter is a dumb bytes-and-acks pipe: it resolves
//     VIN→vehicleID, ferries the payload to the application handler, and
//     owns ack / redelivery / DLQ semantics.
//
//   - The application handler receives (ctx, payload, vehicleID) only.
//     It MUST NOT see the topic string, MUST NOT decode protobuf, MUST NOT
//     parse enums, and MUST NOT inspect payload content. Decode lives in
//     internal/tesla/codec; orchestration in internal/tesla/normalize;
//     dispatch in internal/tesla/router.
//
//   - The subscriber port deliberately omits Unsubscribe — Phase-42
//     pipeline subscribers are long-lived per process and tear down via
//     Close() on shutdown.
package messaging

import "context"

// MQTTPublisher defines the interface for publishing MQTT messages.
type MQTTPublisher interface {
	Publish(ctx context.Context, topic string, payload []byte) error
}

// MessageHandler is the Phase-42 pipeline-aware MQTT message handler.
//
// The adapter resolves VIN→vehicleID before invoking the handler; the
// handler receives only the raw payload bytes and the resolved vehicleID.
// Implementations are expected to feed the payload into
// (*normalize.Pipeline).Process — the single ingest entry per ADR-004 §2.
//
// Returning an error signals the adapter to apply its redelivery / DLQ
// policy. Returning nil means the message has been accepted by the
// application and may be acknowledged to the broker.
type MessageHandler func(ctx context.Context, payload []byte, vehicleID int64) error

// Subscriber is the Phase-42 minimal MQTT subscriber port.
//
// Implementations own broker connection lifecycle, VIN resolution,
// manual ack, bounded redelivery, and DLQ publication. The application
// layer interacts with them only via Subscribe (to register a handler
// for a topic filter) and Close (to tear down at shutdown).
//
// The interface deliberately omits decode helpers, enum parsers, and
// per-topic routing — those concerns live behind the seam in the
// adapter, not in the port.
type Subscriber interface {
	Subscribe(topic string, h MessageHandler) error
	Close()
}

// --------------------------------------------------------------------
// Legacy types — retained ONLY to keep the pre-Phase-42 generic adapter
// at internal/adapter/mqtt/publisher.go compiling until it is removed
// in a follow-up cleanup prompt. New consumers MUST use MessageHandler
// and Subscriber above.
// --------------------------------------------------------------------

// MQTTHandler is the legacy topic-aware handler.
//
// Deprecated: use [MessageHandler]. VIN resolution and topic parsing
// belong in the adapter, not in domain handlers.
type MQTTHandler func(ctx context.Context, topic string, payload []byte) error

// MQTTSubscriber is the legacy generic subscribe / unsubscribe surface.
//
// Deprecated: use [Subscriber]. The Phase-42 port drops Unsubscribe —
// pipeline subscribers manage their lifecycle via Close().
type MQTTSubscriber interface {
	Subscribe(ctx context.Context, topic string, handler MQTTHandler) error
	Unsubscribe(ctx context.Context, topic string) error
}
