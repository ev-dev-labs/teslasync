package mqtt

import (
	"encoding/json"
	"fmt"
	"time"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/rs/zerolog/log"
	"github.com/teslasync/teslasync/internal/config"
	"github.com/teslasync/teslasync/internal/models"
	"github.com/teslasync/teslasync/internal/tesla"
)

// Client wraps MQTT publishing.
type Client struct {
	client pahomqtt.Client
	prefix string
}

// NewClient creates a new MQTT client.
func NewClient(cfg config.MQTTConfig) (*Client, error) {
	opts := pahomqtt.NewClientOptions().
		AddBroker(cfg.BrokerURL()).
		SetClientID(cfg.ClientID).
		SetAutoReconnect(true).
		SetMaxReconnectInterval(60 * time.Second).
		SetKeepAlive(30 * time.Second).
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
		client: client,
		prefix: cfg.Prefix,
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

// Disconnect disconnects the MQTT client.
func (c *Client) Disconnect() {
	c.client.Disconnect(1000)
}

// PublishHADiscovery publishes Home Assistant auto-discovery configuration
// messages for all supported entities of a vehicle.
func (c *Client) PublishHADiscovery(vehicle *models.Vehicle) {
	if c == nil || c.client == nil {
		return
	}

	vin := vehicle.VIN
	name := vehicle.DisplayName
	if name == "" {
		name = vin
	}

	// Device info shared across all entities
	device := fmt.Sprintf(`"device":{"identifiers":["%s"],"name":"%s","manufacturer":"Tesla","model":"%s","sw_version":"TeslaSync"}`, vin, name, vehicle.Model)

	// Battery level sensor
	c.publishHA("sensor", vin, "battery_level", fmt.Sprintf(`{
		"name":"%s Battery",
		"unique_id":"teslasync_%s_battery",
		"state_topic":"teslasync/vehicles/%s/battery_level",
		"unit_of_measurement":"%%",
		"device_class":"battery",
		"icon":"mdi:car-battery",
		%s
	}`, name, vin, vin, device))

	// Range sensor
	c.publishHA("sensor", vin, "range", fmt.Sprintf(`{
		"name":"%s Range",
		"unique_id":"teslasync_%s_range",
		"state_topic":"teslasync/vehicles/%s/rated_range",
		"unit_of_measurement":"km",
		"icon":"mdi:map-marker-distance",
		%s
	}`, name, vin, vin, device))

	// Speed sensor
	c.publishHA("sensor", vin, "speed", fmt.Sprintf(`{
		"name":"%s Speed",
		"unique_id":"teslasync_%s_speed",
		"state_topic":"teslasync/vehicles/%s/speed",
		"unit_of_measurement":"km/h",
		"icon":"mdi:speedometer",
		%s
	}`, name, vin, vin, device))

	// Inside temperature
	c.publishHA("sensor", vin, "inside_temp", fmt.Sprintf(`{
		"name":"%s Inside Temp",
		"unique_id":"teslasync_%s_inside_temp",
		"state_topic":"teslasync/vehicles/%s/inside_temp",
		"unit_of_measurement":"°C",
		"device_class":"temperature",
		%s
	}`, name, vin, vin, device))

	// Outside temperature
	c.publishHA("sensor", vin, "outside_temp", fmt.Sprintf(`{
		"name":"%s Outside Temp",
		"unique_id":"teslasync_%s_outside_temp",
		"state_topic":"teslasync/vehicles/%s/outside_temp",
		"unit_of_measurement":"°C",
		"device_class":"temperature",
		%s
	}`, name, vin, vin, device))

	// Charging binary sensor
	c.publishHA("binary_sensor", vin, "charging", fmt.Sprintf(`{
		"name":"%s Charging",
		"unique_id":"teslasync_%s_charging",
		"state_topic":"teslasync/vehicles/%s/is_charging",
		"payload_on":"true",
		"payload_off":"false",
		"device_class":"battery_charging",
		%s
	}`, name, vin, vin, device))

	// Locked binary sensor
	c.publishHA("binary_sensor", vin, "locked", fmt.Sprintf(`{
		"name":"%s Locked",
		"unique_id":"teslasync_%s_locked",
		"state_topic":"teslasync/vehicles/%s/is_locked",
		"payload_on":"true",
		"payload_off":"false",
		"device_class":"lock",
		%s
	}`, name, vin, vin, device))

	// Sentry mode binary sensor
	c.publishHA("binary_sensor", vin, "sentry", fmt.Sprintf(`{
		"name":"%s Sentry Mode",
		"unique_id":"teslasync_%s_sentry",
		"state_topic":"teslasync/vehicles/%s/sentry_mode",
		"payload_on":"true",
		"payload_off":"false",
		"icon":"mdi:shield-car",
		%s
	}`, name, vin, vin, device))

	// GPS device tracker
	c.publishHA("device_tracker", vin, "location", fmt.Sprintf(`{
		"name":"%s Location",
		"unique_id":"teslasync_%s_location",
		"json_attributes_topic":"teslasync/vehicles/%s/vehicle_data",
		"source_type":"gps",
		%s
	}`, name, vin, vin, device))

	log.Info().Str("vin", vin).Msg("published Home Assistant auto-discovery")
}

func (c *Client) publishHA(component, vin, entity, payload string) {
	topic := fmt.Sprintf("homeassistant/%s/teslasync_%s_%s/config", component, vin, entity)
	c.Publish(topic, payload)
}
