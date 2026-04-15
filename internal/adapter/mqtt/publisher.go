package mqtt

import (
	"context"
	"fmt"
	"time"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/platform/config"
	"github.com/ev-dev-labs/teslasync/internal/port/messaging"
)

// Publisher implements messaging.MQTTPublisher using Paho MQTT.
type Publisher struct {
	client pahomqtt.Client
	qos    byte
}

// NewPublisher creates a new MQTT publisher.
func NewPublisher(cfg config.MQTTConfig) (*Publisher, error) {
	opts := pahomqtt.NewClientOptions().
		AddBroker(cfg.BrokerURL()).
		SetClientID(cfg.ClientID + "_pub").
		SetUsername(cfg.Username).
		SetPassword(cfg.Password).
		SetAutoReconnect(true).
		SetConnectRetry(true).
		SetConnectRetryInterval(5 * time.Second)

	client := pahomqtt.NewClient(opts)
	token := client.Connect()
	if token.WaitTimeout(10*time.Second) && token.Error() != nil {
		return nil, fmt.Errorf("connecting to MQTT broker: %w", token.Error())
	}

	log.Info().Str("broker", cfg.BrokerURL()).Msg("MQTT publisher connected")
	return &Publisher{client: client, qos: 1}, nil
}

func (p *Publisher) Publish(ctx context.Context, topic string, payload []byte) error {
	token := p.client.Publish(topic, p.qos, false, payload)
	if token.WaitTimeout(5 * time.Second) && token.Error() != nil {
		return fmt.Errorf("publishing to %s: %w", topic, token.Error())
	}
	return nil
}

// Subscriber implements messaging.MQTTSubscriber using Paho MQTT.
type Subscriber struct {
	client pahomqtt.Client
}

// NewSubscriber creates a new MQTT subscriber.
func NewSubscriber(cfg config.MQTTConfig) (*Subscriber, error) {
	opts := pahomqtt.NewClientOptions().
		AddBroker(cfg.BrokerURL()).
		SetClientID(cfg.ClientID + "_sub").
		SetUsername(cfg.Username).
		SetPassword(cfg.Password).
		SetAutoReconnect(true)

	client := pahomqtt.NewClient(opts)
	token := client.Connect()
	if token.WaitTimeout(10*time.Second) && token.Error() != nil {
		return nil, fmt.Errorf("connecting to MQTT broker: %w", token.Error())
	}

	log.Info().Str("broker", cfg.BrokerURL()).Msg("MQTT subscriber connected")
	return &Subscriber{client: client}, nil
}

func (s *Subscriber) Subscribe(ctx context.Context, topic string, handler messaging.MQTTHandler) error {
	token := s.client.Subscribe(topic, 1, func(_ pahomqtt.Client, msg pahomqtt.Message) {
		if err := handler(ctx, msg.Topic(), msg.Payload()); err != nil {
			log.Error().Err(err).Str("topic", msg.Topic()).Msg("MQTT message handler error")
		}
	})
	if token.WaitTimeout(5*time.Second) && token.Error() != nil {
		return fmt.Errorf("subscribing to %s: %w", topic, token.Error())
	}
	return nil
}

func (s *Subscriber) Unsubscribe(ctx context.Context, topic string) error {
	token := s.client.Unsubscribe(topic)
	if token.WaitTimeout(5*time.Second) && token.Error() != nil {
		return fmt.Errorf("unsubscribing from %s: %w", topic, token.Error())
	}
	return nil
}
