package mqtt

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

// Client wraps MQTT publishing.
type Client struct {
	client    pahomqtt.Client
	prefix    string
	brokerURL string
}

// NewClient creates a new MQTT client.
func NewClient(cfg config.MQTTConfig) (*Client, error) {
	// Append random suffix to client ID to avoid collisions during rolling updates
	clientID := cfg.ClientID + "-" + randomSuffix(4)
	opts := pahomqtt.NewClientOptions().
		AddBroker(cfg.BrokerURL()).
		SetClientID(clientID).
		SetAutoReconnect(true).
		SetMaxReconnectInterval(config.MQTTReconnectMax).
		SetKeepAlive(config.MQTTKeepAlive).
		SetCleanSession(true).
		SetConnectionLostHandler(func(_ pahomqtt.Client, err error) {
			log.Warn().Err(err).Msg("MQTT connection lost")
		}).
		SetOnConnectHandler(func(_ pahomqtt.Client) {
			log.Info().Msg("MQTT connected")
		})

	if cfg.Username != "" {
		opts.SetUsername(cfg.Username)
		opts.SetPassword(cfg.Password)
	}

	client := pahomqtt.NewClient(opts)
	token := client.Connect()
	if !token.WaitTimeout(10 * time.Second) {
		return nil, fmt.Errorf("MQTT connection timeout")
	}
	if err := token.Error(); err != nil {
		return nil, fmt.Errorf("MQTT connect: %w", err)
	}

	return &Client{
		client:    client,
		prefix:    cfg.Prefix,
		brokerURL: cfg.BrokerURL(),
	}, nil
}

// Publish publishes a string message to a topic.
func (c *Client) Publish(topic, payload string) {
	fullTopic := c.prefix + "/" + topic
	token := c.client.Publish(fullTopic, 0, true, payload)
	if !token.WaitTimeout(5 * time.Second) {
		log.Warn().Str("topic", fullTopic).Msg("MQTT publish timeout")
	}
}

// PublishJSON publishes a JSON-encoded message.
func (c *Client) PublishJSON(topic string, payload interface{}) {
	data, err := json.Marshal(payload)
	if err != nil {
		log.Error().Err(err).Str("topic", topic).Msg("failed to marshal MQTT payload")
		return
	}
	c.Publish(topic, string(data))
}

// PublishVehicleData publishes vehicle telemetry to multiple MQTT topics.
func (c *Client) PublishVehicleData(vin string, data *tesla.VehicleDataResponse) {
	base := vin

	// State
	c.Publish(base+"/state", data.State)

	// Battery
	c.Publish(base+"/battery_level", fmt.Sprintf("%d", data.ChargeState.BatteryLevel))
	c.Publish(base+"/battery_range", fmt.Sprintf("%.1f", data.ChargeState.BatteryRange))
	c.Publish(base+"/ideal_battery_range", fmt.Sprintf("%.1f", data.ChargeState.IdealBatteryRange))
	c.Publish(base+"/charge_limit_soc", fmt.Sprintf("%d", data.ChargeState.ChargeLimitSoc))
	c.Publish(base+"/charging_state", data.ChargeState.ChargingState)
	c.Publish(base+"/charger_power", fmt.Sprintf("%.1f", data.ChargeState.ChargerPower))
	c.Publish(base+"/charge_energy_added", fmt.Sprintf("%.2f", data.ChargeState.ChargeEnergyAdded))
	c.Publish(base+"/time_to_full_charge", fmt.Sprintf("%.2f", data.ChargeState.TimeToFullCharge))

	// Location
	c.Publish(base+"/latitude", fmt.Sprintf("%f", data.DriveState.Latitude))
	c.Publish(base+"/longitude", fmt.Sprintf("%f", data.DriveState.Longitude))
	c.Publish(base+"/heading", fmt.Sprintf("%d", data.DriveState.Heading))
	if data.DriveState.Speed != nil {
		c.Publish(base+"/speed", fmt.Sprintf("%d", *data.DriveState.Speed))
	}
	c.Publish(base+"/power", fmt.Sprintf("%d", data.DriveState.Power))

	// Climate
	c.Publish(base+"/inside_temp", fmt.Sprintf("%.1f", data.ClimateState.InsideTemp))
	c.Publish(base+"/outside_temp", fmt.Sprintf("%.1f", data.ClimateState.OutsideTemp))
	c.Publish(base+"/is_climate_on", fmt.Sprintf("%t", data.ClimateState.IsClimateOn))

	// Vehicle
	c.Publish(base+"/odometer", fmt.Sprintf("%.1f", data.VehicleState.Odometer))
	c.Publish(base+"/locked", fmt.Sprintf("%t", data.VehicleState.Locked))
	c.Publish(base+"/sentry_mode", fmt.Sprintf("%t", data.VehicleState.SentryMode))
	c.Publish(base+"/software_update/version", data.VehicleState.SoftwareUpdate.Version)
	c.Publish(base+"/software_update/status", data.VehicleState.SoftwareUpdate.Status)

	// Full JSON
	c.PublishJSON(base+"/vehicle_data", data)
}

// IsConnected returns whether the MQTT client is currently connected to the broker.
func (c *Client) IsConnected() bool {
	return c.client.IsConnected()
}

// BrokerURL returns the broker URL this client is connected to.
func (c *Client) BrokerURL() string {
	return c.brokerURL
}

// Prefix returns the topic prefix used for publishing.
func (c *Client) Prefix() string {
	return c.prefix
}

// Underlying returns the raw Paho MQTT client for advanced usage
// such as subscribing to internal topics.
func (c *Client) Underlying() pahomqtt.Client {
	return c.client
}

// Disconnect disconnects the MQTT client.
func (c *Client) Disconnect() {
	c.client.Disconnect(1000)
}

func randomSuffix(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return hex.EncodeToString(b)
}
