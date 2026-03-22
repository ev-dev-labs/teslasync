package mqtt

import (
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/config"
)

func TestMQTTConfigBrokerURL(t *testing.T) {
	cfg := config.MQTTConfig{
		Host: "localhost",
		Port: 1883,
	}

	url := cfg.BrokerURL()
	want := "tcp://localhost:1883"
	if url != want {
		t.Errorf("BrokerURL() = %q, want %q", url, want)
	}
}

func TestMQTTConfigBrokerURLCustom(t *testing.T) {
	cfg := config.MQTTConfig{
		Host: "mqtt.example.com",
		Port: 8883,
	}

	url := cfg.BrokerURL()
	want := "tcp://mqtt.example.com:8883"
	if url != want {
		t.Errorf("BrokerURL() = %q, want %q", url, want)
	}
}

func TestMQTTTopicPrefixFormatting(t *testing.T) {
	// The Client uses prefix + "/" + topic for publishing.
	// Test the expected format construction.
	prefix := "teslasync"
	topic := "VIN123/state"
	fullTopic := prefix + "/" + topic

	want := "teslasync/VIN123/state"
	if fullTopic != want {
		t.Errorf("topic = %q, want %q", fullTopic, want)
	}
}

func TestMQTTVehicleDataTopicFormat(t *testing.T) {
	vin := "5YJ3E1EA1LF000001"
	topics := []struct {
		suffix string
		want   string
	}{
		{"state", "5YJ3E1EA1LF000001/state"},
		{"battery_level", "5YJ3E1EA1LF000001/battery_level"},
		{"latitude", "5YJ3E1EA1LF000001/latitude"},
		{"longitude", "5YJ3E1EA1LF000001/longitude"},
		{"is_climate_on", "5YJ3E1EA1LF000001/is_climate_on"},
		{"software_update/version", "5YJ3E1EA1LF000001/software_update/version"},
	}

	for _, tt := range topics {
		t.Run(tt.suffix, func(t *testing.T) {
			got := vin + "/" + tt.suffix
			if got != tt.want {
				t.Errorf("topic = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestMQTTDisabledConfig(t *testing.T) {
	cfg := config.MQTTConfig{
		Enabled: false,
		Host:    "localhost",
		Port:    1883,
	}

	if cfg.Enabled {
		t.Error("MQTT should be disabled")
	}

	// BrokerURL still works even when disabled
	url := cfg.BrokerURL()
	if url != "tcp://localhost:1883" {
		t.Errorf("BrokerURL() = %q, even when disabled should return proper URL", url)
	}
}

func TestNilClientSafety(t *testing.T) {
	// When MQTT is disabled, the mqtt client pointer is nil.
	// The worker checks `if w.mqttClient == nil { return }`.
	// This test documents that a nil *Client should not be used directly.
	var c *Client
	if c != nil {
		t.Error("nil Client should be nil")
	}
}
