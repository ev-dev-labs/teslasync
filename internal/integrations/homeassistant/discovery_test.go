package homeassistant

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
)

// fakeToken satisfies pahomqtt.Token with controllable error.
type fakeToken struct {
	err  error
	done chan struct{}
}

func newDoneToken(err error) *fakeToken {
	ch := make(chan struct{})
	close(ch)
	return &fakeToken{err: err, done: ch}
}

func (t *fakeToken) Wait() bool                     { <-t.done; return true }
func (t *fakeToken) WaitTimeout(time.Duration) bool { <-t.done; return true }
func (t *fakeToken) Done() <-chan struct{}          { return t.done }
func (t *fakeToken) Error() error                   { return t.err }

type fakeClient struct {
	mu       sync.Mutex
	messages map[string][]byte
	failOn   string
}

func (c *fakeClient) Publish(topic string, _ byte, _ bool, payload any) pahomqtt.Token {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.messages == nil {
		c.messages = make(map[string][]byte)
	}
	b, _ := payload.([]byte)
	c.messages[topic] = b
	if c.failOn != "" && strings.Contains(topic, c.failOn) {
		return newDoneToken(errors.New("simulated publish error"))
	}
	return newDoneToken(nil)
}

func TestPublisher_PublishesDiscoveryForEveryEntity(t *testing.T) {
	t.Parallel()
	client := &fakeClient{}
	p := NewPublisher(client, "homeassistant", "teslasync")
	v := Vehicle{VIN: "5YJ3E1EA1JF000001", DisplayName: "Test Tesla", Model: "Model 3", SoftwareVer: "2026.4.1"}
	entities := []Entity{
		{Component: ComponentSensor, ObjectID: "battery_level", Name: "Battery", StateTopicSuffix: "battery_level", UnitOfMeasurement: "%", DeviceClass: "battery"},
		{Component: ComponentBinarySensor, ObjectID: "locked", Name: "Lock", StateTopicSuffix: "locked"},
	}
	if err := p.PublishVehicle(context.Background(), v, entities); err != nil {
		t.Fatalf("publish failed: %v", err)
	}
	if len(client.messages) != 2 {
		t.Fatalf("expected 2 discovery messages, got %d", len(client.messages))
	}
	wantTopic := "homeassistant/sensor/teslasync_5yj3e1ea/battery_level/config"
	body, ok := client.messages[wantTopic]
	if !ok {
		t.Fatalf("expected discovery topic %q; got %v", wantTopic, keys(client.messages))
	}
	var doc map[string]any
	if err := json.Unmarshal(body, &doc); err != nil {
		t.Fatalf("invalid JSON: %v\nbody=%s", err, body)
	}
	if doc["unique_id"] != "teslasync_5yj3e1ea_battery_level" {
		t.Fatalf("bad unique_id: %v", doc["unique_id"])
	}
	if doc["state_topic"] != "teslasync/5yj3e1ea1jf000001/battery_level" {
		t.Fatalf("bad state_topic: %v", doc["state_topic"])
	}
	if doc["unit_of_measurement"] != "%" {
		t.Fatalf("missing unit: %v", doc)
	}
	device, _ := doc["device"].(map[string]any)
	if device == nil || device["manufacturer"] != "Tesla" {
		t.Fatalf("missing device block: %v", doc)
	}
}

func TestPublisher_EmptyVINRejected(t *testing.T) {
	t.Parallel()
	p := NewPublisher(&fakeClient{}, "", "teslasync")
	if err := p.PublishVehicle(context.Background(), Vehicle{}, DefaultEntities()); err == nil {
		t.Fatal("expected error for empty VIN")
	}
}

func TestPublisher_PartialPublishFailureReportsButContinues(t *testing.T) {
	t.Parallel()
	client := &fakeClient{failOn: "battery_level"}
	p := NewPublisher(client, "", "teslasync")
	v := Vehicle{VIN: "5YJ3E1EA1JF000002"}
	entities := []Entity{
		{Component: ComponentSensor, ObjectID: "battery_level", Name: "Battery", StateTopicSuffix: "battery_level"},
		{Component: ComponentSensor, ObjectID: "outside_temp", Name: "Temp", StateTopicSuffix: "outside_temp"},
	}
	err := p.PublishVehicle(context.Background(), v, entities)
	if err == nil {
		t.Fatal("expected first error to surface")
	}
	if len(client.messages) != 2 {
		t.Fatalf("expected both publishes attempted, got %d", len(client.messages))
	}
}

func TestUnpublishVehicle_EmitsEmptyPayloads(t *testing.T) {
	t.Parallel()
	client := &fakeClient{}
	p := NewPublisher(client, "", "teslasync")
	v := Vehicle{VIN: "5YJ3E1EA1JF000003"}
	entities := []Entity{
		{Component: ComponentSensor, ObjectID: "battery_level", Name: "Battery", StateTopicSuffix: "battery_level"},
	}
	if err := p.UnpublishVehicle(context.Background(), v, entities); err != nil {
		t.Fatalf("unpublish failed: %v", err)
	}
	for topic, body := range client.messages {
		if len(body) != 0 {
			t.Fatalf("expected empty payload for retract topic %s, got %d bytes", topic, len(body))
		}
	}
}

func TestDefaultEntities_CoverCoreSensors(t *testing.T) {
	t.Parallel()
	e := DefaultEntities()
	required := []string{"battery_level", "charging_state", "inside_temp", "locked", "location", "odometer"}
	have := map[string]bool{}
	for _, x := range e {
		have[x.ObjectID] = true
	}
	for _, r := range required {
		if !have[r] {
			t.Fatalf("default catalog missing required entity %q", r)
		}
	}
}

func keys(m map[string][]byte) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
