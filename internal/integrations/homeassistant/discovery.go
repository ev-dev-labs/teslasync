// Package homeassistant publishes MQTT discovery messages so an
// installed Home Assistant instance picks up TeslaSync vehicles
// as native HA entities (sensor / binary_sensor / device_tracker /
// lock) without any per-vehicle HA configuration.
//
// The publisher follows the Home Assistant MQTT Discovery v1
// specification (https://www.home-assistant.io/integrations/mqtt/#mqtt-discovery):
//
//	homeassistant/<component>/<node_id>/<object_id>/config
//
// where <node_id> is "teslasync_<vin_first_8>" so multiple
// TeslaSync deployments against the same MQTT broker don't
// collide, and <object_id> identifies the individual entity
// (e.g. "battery_level", "charging_state").
//
// The publisher is idempotent — each Publish call republishes the
// full set of discovery topics with retain=true so HA's discovery
// listener catches up on reconnect / restart. Entities removed
// from the catalog are NOT auto-deleted; callers that want to
// retire an entity must explicitly Unpublish it.
//
// The actual state values are written to the same MQTT topics
// TeslaSync already publishes (see internal/mqtt/mqtt.go::
// PublishVehicleData). Discovery only tells HA where to LOOK.
package homeassistant

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/rs/zerolog/log"
)

// Component is the HA entity component type. Only the subset
// TeslaSync needs is enumerated; the publisher accepts string for
// future extensions.
const (
	ComponentSensor        = "sensor"
	ComponentBinarySensor  = "binary_sensor"
	ComponentDeviceTracker = "device_tracker"
	ComponentLock          = "lock"
)

// Vehicle is the per-vehicle metadata the publisher uses to
// construct discovery messages.
type Vehicle struct {
	VIN         string
	DisplayName string
	Model       string
	SoftwareVer string
}

// PrefixFor returns the HA node_id prefix for the given VIN. Kept
// here so callers (e.g. listeners of the state topic family) can
// reconstruct the same identifier without duplicating the rule.
func PrefixFor(vin string) string {
	v := strings.ToLower(strings.TrimSpace(vin))
	if len(v) < 8 {
		return "teslasync_" + v
	}
	return "teslasync_" + v[:8]
}

// PahoClient is the minimal Paho surface the publisher needs. Kept
// narrow so tests can supply a fake.
type PahoClient interface {
	Publish(topic string, qos byte, retained bool, payload any) pahomqtt.Token
}

// Publisher emits HA discovery messages.
type Publisher struct {
	client        PahoClient
	discoveryRoot string // default "homeassistant"
	stateRoot     string // TeslaSync's MQTT prefix (e.g. "teslasync")
	timeout       time.Duration
}

// NewPublisher wires the publisher. discoveryRoot defaults to
// "homeassistant" when empty; stateRoot is the prefix TeslaSync
// already publishes vehicle state under (typically "teslasync").
func NewPublisher(client PahoClient, discoveryRoot, stateRoot string) *Publisher {
	if discoveryRoot == "" {
		discoveryRoot = "homeassistant"
	}
	return &Publisher{
		client:        client,
		discoveryRoot: discoveryRoot,
		stateRoot:     strings.TrimRight(stateRoot, "/"),
		timeout:       5 * time.Second,
	}
}

// Entity is one HA entity descriptor.
type Entity struct {
	Component         string // sensor / binary_sensor / lock / device_tracker
	ObjectID          string // e.g. "battery_level"
	Name              string // display name shown in HA UI
	StateTopicSuffix  string // appended to <stateRoot>/<vin>/ — e.g. "battery/level"
	ValueTemplate     string // optional HA template ("{{ value_json.value }}")
	UnitOfMeasurement string // optional ("%", "km", "°C")
	DeviceClass       string // optional ("battery", "temperature", "lock")
	StateClass        string // optional ("measurement", "total_increasing")
	Icon              string // optional ("mdi:battery")
}

// PublishVehicle emits the HA discovery messages for the given vehicle
// + entity set. Each entity is published with retain=true so HA
// catches up after a restart. Returns the first publish error if
// any; remaining entities are still attempted.
func (p *Publisher) PublishVehicle(ctx context.Context, v Vehicle, entities []Entity) error {
	if p == nil || p.client == nil {
		return errors.New("nil publisher or client")
	}
	if strings.TrimSpace(v.VIN) == "" {
		return errors.New("empty VIN")
	}
	prefix := PrefixFor(v.VIN)
	stateBase := p.stateRoot + "/" + strings.ToLower(v.VIN)
	device := deviceDoc(v)

	var firstErr error
	for _, e := range entities {
		topic := fmt.Sprintf("%s/%s/%s/%s/config", p.discoveryRoot, e.Component, prefix, e.ObjectID)
		doc := buildConfigDoc(prefix, stateBase, device, e)
		body, err := json.Marshal(doc)
		if err != nil {
			if firstErr == nil {
				firstErr = fmt.Errorf("marshal %s/%s: %w", e.Component, e.ObjectID, err)
			}
			continue
		}
		tok := p.client.Publish(topic, 0, true, body)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-tok.Done():
			if err := tok.Error(); err != nil {
				log.Warn().Err(err).Str("topic", topic).Msg("HA discovery publish failed")
				if firstErr == nil {
					firstErr = err
				}
			}
		case <-time.After(p.timeout):
			log.Warn().Str("topic", topic).Msg("HA discovery publish timeout")
			if firstErr == nil {
				firstErr = fmt.Errorf("timeout publishing %s", topic)
			}
		}
	}
	return firstErr
}

// UnpublishVehicle removes the discovery messages by publishing an
// empty retained payload, which HA interprets as entity removal.
func (p *Publisher) UnpublishVehicle(ctx context.Context, v Vehicle, entities []Entity) error {
	if p == nil || p.client == nil {
		return errors.New("nil publisher or client")
	}
	prefix := PrefixFor(v.VIN)
	var firstErr error
	for _, e := range entities {
		topic := fmt.Sprintf("%s/%s/%s/%s/config", p.discoveryRoot, e.Component, prefix, e.ObjectID)
		tok := p.client.Publish(topic, 0, true, []byte(""))
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-tok.Done():
			if err := tok.Error(); err != nil && firstErr == nil {
				firstErr = err
			}
		case <-time.After(p.timeout):
			if firstErr == nil {
				firstErr = fmt.Errorf("timeout unpublishing %s", topic)
			}
		}
	}
	return firstErr
}

// deviceDoc constructs the HA device block — multiple entities
// pointing at the same device collapse under one card in the HA UI.
func deviceDoc(v Vehicle) map[string]any {
	d := map[string]any{
		"identifiers":  []string{"teslasync_" + strings.ToLower(v.VIN)},
		"manufacturer": "Tesla",
		"via_device":   "teslasync",
	}
	if v.DisplayName != "" {
		d["name"] = v.DisplayName
	} else {
		d["name"] = "Tesla " + v.VIN
	}
	if v.Model != "" {
		d["model"] = v.Model
	}
	if v.SoftwareVer != "" {
		d["sw_version"] = v.SoftwareVer
	}
	return d
}

func buildConfigDoc(prefix, stateBase string, device map[string]any, e Entity) map[string]any {
	doc := map[string]any{
		"unique_id":   prefix + "_" + e.ObjectID,
		"name":        e.Name,
		"state_topic": strings.TrimRight(stateBase, "/") + "/" + strings.TrimLeft(e.StateTopicSuffix, "/"),
		"device":      device,
	}
	if e.ValueTemplate != "" {
		doc["value_template"] = e.ValueTemplate
	}
	if e.UnitOfMeasurement != "" {
		doc["unit_of_measurement"] = e.UnitOfMeasurement
	}
	if e.DeviceClass != "" {
		doc["device_class"] = e.DeviceClass
	}
	if e.StateClass != "" {
		doc["state_class"] = e.StateClass
	}
	if e.Icon != "" {
		doc["icon"] = e.Icon
	}
	return doc
}
