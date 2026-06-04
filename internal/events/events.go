// Package events provides a domain event bus backed by MQTT.
//
// Components publish events when state changes occur (vehicle updated,
// drive started, charge completed, alert triggered). Subscribers can
// react asynchronously — e.g., the notification worker can trigger
// alerts on vehicle events without coupling to the polling loop.
package events

import (
	"encoding/json"
	"time"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/rs/zerolog/log"
)

const (
	VehicleUpdated   = "vehicle.updated"
	VehicleAsleep    = "vehicle.asleep"
	VehicleOnline    = "vehicle.online"
	DriveStarted     = "drive.started"
	DriveEnded       = "drive.ended"
	ChargeStarted    = "charge.started"
	ChargeCompleted  = "charge.completed"
	AlertTriggered   = "alert.triggered"
	GeofenceEntered  = "geofence.entered"
	GeofenceExited   = "geofence.exited"
	BatteryLow       = "battery.low"
	ExportQueued     = "export.queued"
	ExportProcessing = "export.processing"
	ExportCompleted  = "export.completed"
	ExportFailed     = "export.failed"
)

// TopicPrefix is the MQTT topic prefix for domain events.
const TopicPrefix = "teslasync/events/"

// Event represents a domain event published to the message queue.
type Event struct {
	Type      string                 `json:"type"`
	VehicleID int64                  `json:"vehicle_id,omitempty"`
	VIN       string                 `json:"vin,omitempty"`
	Data      map[string]interface{} `json:"data,omitempty"`
	Timestamp time.Time              `json:"timestamp"`
}

// Bus publishes and subscribes to domain events via MQTT.
type Bus struct {
	client pahomqtt.Client
}

// NewBus creates an event bus. If the MQTT client is nil, events are
// logged but not published (degraded mode).
func NewBus(client pahomqtt.Client) *Bus {
	return &Bus{client: client}
}

func (b *Bus) Publish(evt Event) {
	if evt.Timestamp.IsZero() {
		evt.Timestamp = time.Now().UTC()
	}

	data, err := json.Marshal(evt)
	if err != nil {
		log.Error().Err(err).Str("type", evt.Type).Msg("event: failed to marshal")
		return
	}

	topic := TopicPrefix + evt.Type

	if b.client == nil || !b.client.IsConnected() {
		log.Debug().Str("type", evt.Type).Msg("event: MQTT unavailable, event logged only")
		return
	}

	token := b.client.Publish(topic, 1, false, data)
	if !token.WaitTimeout(5 * time.Second) {
		log.Warn().Str("type", evt.Type).Msg("event: publish timeout")
	}
}

// Handler is a function that processes a domain event.
type Handler func(evt Event)

// Subscribe registers a handler for events matching the given type pattern.
// Use "+" as a wildcard segment (e.g., "vehicle.+" matches all vehicle events).
func (b *Bus) Subscribe(eventType string, handler Handler) {
	if b.client == nil {
		return
	}

	topic := TopicPrefix + eventType
	b.client.Subscribe(topic, 1, func(_ pahomqtt.Client, msg pahomqtt.Message) {
		var evt Event
		if err := json.Unmarshal(msg.Payload(), &evt); err != nil {
			log.Error().Err(err).Msg("event: failed to unmarshal")
			return
		}
		handler(evt)
	})

	log.Debug().Str("topic", topic).Msg("event: subscribed")
}
