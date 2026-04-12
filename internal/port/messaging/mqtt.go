package messaging

import "context"

// MQTTPublisher defines the interface for publishing MQTT messages.
type MQTTPublisher interface {
	Publish(ctx context.Context, topic string, payload []byte) error
}

// MQTTHandler is a function that handles incoming MQTT messages.
type MQTTHandler func(ctx context.Context, topic string, payload []byte) error

// MQTTSubscriber defines the interface for subscribing to MQTT topics.
type MQTTSubscriber interface {
	Subscribe(ctx context.Context, topic string, handler MQTTHandler) error
	Unsubscribe(ctx context.Context, topic string) error
}
