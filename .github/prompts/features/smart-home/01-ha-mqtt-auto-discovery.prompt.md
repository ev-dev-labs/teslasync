---
description: "MQTT Auto-Discovery: publish HA discovery configs so Tesla entities appear automatically"
---

# Home Assistant MQTT Auto-Discovery

## Problem

TeslaSync publishes vehicle telemetry to MQTT (`teslasync/{VIN}/BatteryLevel`, etc.)
but Home Assistant users must manually configure YAML sensors for each signal. This is
tedious (50+ sensors per vehicle) and error-prone. HA's MQTT Auto-Discovery protocol
lets devices publish their own config — HA creates entities automatically.

## Current State

```
internal/mqtt/mqtt.go              — Client with Publish(), PublishJSON(), PublishVehicleData()
internal/mqtt/mqtt.go:57           — prefix from config (default: "teslasync")
internal/config/config.go:212      — MQTT_PREFIX env var
```

### Current MQTT Topics Published
```
teslasync/{VIN}/state              → "online", "asleep", etc.
teslasync/{VIN}/battery_level      → "72"
teslasync/{VIN}/battery_range      → "189.5"
teslasync/{VIN}/charging_state     → "Disconnected"
teslasync/{VIN}/{SignalName}       → signal value (from Fleet Telemetry)
```

HA Auto-Discovery requires publishing config to `homeassistant/{component}/{nodeId}/{objectId}/config`.

## Task

### Step 1: Create Discovery Publisher

Create `internal/mqtt/ha_discovery.go`:

```go
package mqtt

// HADiscoveryPublisher publishes Home Assistant MQTT Auto-Discovery config
// messages so HA automatically creates entities for each Tesla vehicle.
type HADiscoveryPublisher struct {
    client          *Client
    discoveryPrefix string  // default: "homeassistant"
    enabled         bool
}

// HADevice represents a vehicle as an HA device for entity grouping.
type HADevice struct {
    Identifiers  []string `json:"identifiers"`
    Name         string   `json:"name"`
    Manufacturer string   `json:"manufacturer"`
    Model        string   `json:"model"`
    SwVersion    string   `json:"sw_version,omitempty"`
}

// HAEntityConfig is the base config for any HA entity.
type HAEntityConfig struct {
    Name                string   `json:"name"`
    UniqueID            string   `json:"unique_id"`
    StateTopic          string   `json:"state_topic"`
    Device              HADevice `json:"device"`
    AvailabilityTopic   string   `json:"availability_topic,omitempty"`
    PayloadAvailable    string   `json:"payload_available,omitempty"`
    PayloadNotAvailable string   `json:"payload_not_available,omitempty"`
    Icon                string   `json:"icon,omitempty"`
}
```

### Step 2: Define Entity Registry

Create a registry of all Tesla signals → HA entity mappings:

```go
type HAEntityDef struct {
    Signal         string   // Tesla signal name
    Component      string   // HA component: "sensor", "binary_sensor", "lock", "climate", etc.
    Name           string   // Human-readable name: "Battery Level"
    DeviceClass    string   // HA device_class: "battery", "temperature", "power", etc.
    Unit           string   // unit_of_measurement: "%", "°C", "mi", "kW", etc.
    Icon           string   // mdi icon: "mdi:battery", "mdi:thermometer", etc.
    StateClass     string   // HA state_class: "measurement", "total_increasing", etc.
    ValueTemplate  string   // optional Jinja template for value transformation
    EntityCategory string   // "diagnostic", "config", or "" (default)
}

var HAEntities = []HAEntityDef{
    // ── Battery & Range ──
    {Signal: "BatteryLevel", Component: "sensor", Name: "Battery Level", DeviceClass: "battery", Unit: "%", Icon: "mdi:battery", StateClass: "measurement"},
    {Signal: "Soc", Component: "sensor", Name: "State of Charge", DeviceClass: "battery", Unit: "%", StateClass: "measurement"},
    {Signal: "RatedRange", Component: "sensor", Name: "Rated Range", DeviceClass: "distance", Unit: "mi", Icon: "mdi:map-marker-distance", StateClass: "measurement"},
    {Signal: "IdealBatteryRange", Component: "sensor", Name: "Ideal Range", DeviceClass: "distance", Unit: "mi", StateClass: "measurement"},
    {Signal: "EstBatteryRange", Component: "sensor", Name: "Est. Range", DeviceClass: "distance", Unit: "mi", StateClass: "measurement"},
    {Signal: "EnergyRemaining", Component: "sensor", Name: "Energy Remaining", DeviceClass: "energy", Unit: "kWh", StateClass: "measurement"},

    // ── Charging ──
    {Signal: "ChargeState", Component: "sensor", Name: "Charge State", Icon: "mdi:ev-station"},
    {Signal: "ChargerVoltage", Component: "sensor", Name: "Charger Voltage", DeviceClass: "voltage", Unit: "V", StateClass: "measurement"},
    {Signal: "ChargeAmps", Component: "sensor", Name: "Charge Current", DeviceClass: "current", Unit: "A", StateClass: "measurement"},
    {Signal: "ACChargingPower", Component: "sensor", Name: "AC Charging Power", DeviceClass: "power", Unit: "kW", StateClass: "measurement"},
    {Signal: "DCChargingPower", Component: "sensor", Name: "DC Charging Power", DeviceClass: "power", Unit: "kW", StateClass: "measurement"},
    {Signal: "ChargeLimitSoc", Component: "sensor", Name: "Charge Limit", Unit: "%", Icon: "mdi:battery-charging-high"},
    {Signal: "TimeToFullCharge", Component: "sensor", Name: "Time to Full Charge", DeviceClass: "duration", Unit: "h", Icon: "mdi:clock-outline"},
    {Signal: "ChargePortDoorOpen", Component: "binary_sensor", Name: "Charge Port", DeviceClass: "door", Icon: "mdi:ev-plug-type2"},

    // ── Temperature ──
    {Signal: "InsideTemp", Component: "sensor", Name: "Inside Temperature", DeviceClass: "temperature", Unit: "°C", StateClass: "measurement"},
    {Signal: "OutsideTemp", Component: "sensor", Name: "Outside Temperature", DeviceClass: "temperature", Unit: "°C", StateClass: "measurement"},

    // ── Driving ──
    {Signal: "VehicleSpeed", Component: "sensor", Name: "Speed", DeviceClass: "speed", Unit: "mph", Icon: "mdi:speedometer", StateClass: "measurement"},
    {Signal: "Odometer", Component: "sensor", Name: "Odometer", DeviceClass: "distance", Unit: "mi", Icon: "mdi:counter", StateClass: "total_increasing"},
    {Signal: "Gear", Component: "sensor", Name: "Gear", Icon: "mdi:car-shift-pattern"},

    // ── Security ──
    {Signal: "Locked", Component: "binary_sensor", Name: "Locked", DeviceClass: "lock", Icon: "mdi:lock"},
    {Signal: "SentryMode", Component: "binary_sensor", Name: "Sentry Mode", Icon: "mdi:shield-car"},
    {Signal: "DriverSeatOccupied", Component: "binary_sensor", Name: "Driver Seat", DeviceClass: "occupancy"},
    {Signal: "DriverSeatBelt", Component: "binary_sensor", Name: "Driver Seatbelt", Icon: "mdi:seatbelt"},

    // ── Climate ──
    {Signal: "HvacPower", Component: "binary_sensor", Name: "Climate", Icon: "mdi:air-conditioner"},
    {Signal: "HvacFanSpeed", Component: "sensor", Name: "Fan Speed", Icon: "mdi:fan", StateClass: "measurement"},

    // ── Location ──
    // Location uses device_tracker component (lat/lon split)

    // ── Tire Pressure ──
    {Signal: "TpmsPressureFl", Component: "sensor", Name: "Tire Pressure FL", DeviceClass: "pressure", Unit: "bar", StateClass: "measurement"},
    {Signal: "TpmsPressureFr", Component: "sensor", Name: "Tire Pressure FR", DeviceClass: "pressure", Unit: "bar", StateClass: "measurement"},
    {Signal: "TpmsPressureRl", Component: "sensor", Name: "Tire Pressure RL", DeviceClass: "pressure", Unit: "bar", StateClass: "measurement"},
    {Signal: "TpmsPressureRr", Component: "sensor", Name: "Tire Pressure RR", DeviceClass: "pressure", Unit: "bar", StateClass: "measurement"},

    // ── Software ──
    {Signal: "Version", Component: "sensor", Name: "Software Version", Icon: "mdi:cellphone-arrow-down", EntityCategory: "diagnostic"},
    {Signal: "SoftwareUpdateDownloadPercentComplete", Component: "sensor", Name: "Update Download", Unit: "%", Icon: "mdi:download", EntityCategory: "diagnostic"},
    {Signal: "SoftwareUpdateInstallationPercentComplete", Component: "sensor", Name: "Update Install", Unit: "%", Icon: "mdi:progress-wrench", EntityCategory: "diagnostic"},

    // ── Media ──
    {Signal: "MediaNowPlayingTitle", Component: "sensor", Name: "Now Playing", Icon: "mdi:music"},
    {Signal: "MediaNowPlayingArtist", Component: "sensor", Name: "Artist", Icon: "mdi:account-music"},
    {Signal: "MediaAudioVolume", Component: "sensor", Name: "Volume", Icon: "mdi:volume-high", StateClass: "measurement"},
}
```

**This is not exhaustive** — include the ~50 most useful signals. Users can still
use manual YAML for signals not in the auto-discovery list.

### Step 3: Publish Discovery on Startup

When the MQTT client connects and we know the vehicle list:

```go
func (p *HADiscoveryPublisher) PublishVehicleDiscovery(vin, displayName, model, version string) {
    device := HADevice{
        Identifiers:  []string{"teslasync_" + vin},
        Name:         displayName,
        Manufacturer: "Tesla",
        Model:        model,
        SwVersion:    version,
    }

    mqttPrefix := p.client.Prefix()

    for _, entity := range HAEntities {
        config := map[string]interface{}{
            "name":               entity.Name,
            "unique_id":          fmt.Sprintf("teslasync_%s_%s", vin, entity.Signal),
            "state_topic":        fmt.Sprintf("%s/%s/%s", mqttPrefix, vin, entity.Signal),
            "device":             device,
            "availability_topic": fmt.Sprintf("%s/%s/availability", mqttPrefix, vin),
        }

        if entity.DeviceClass != "" { config["device_class"] = entity.DeviceClass }
        if entity.Unit != "" { config["unit_of_measurement"] = entity.Unit }
        if entity.Icon != "" { config["icon"] = entity.Icon }
        if entity.StateClass != "" { config["state_class"] = entity.StateClass }
        if entity.EntityCategory != "" { config["entity_category"] = entity.EntityCategory }

        topic := fmt.Sprintf("%s/%s/teslasync_%s/%s/config",
            p.discoveryPrefix, entity.Component, vin, entity.Signal)

        p.client.PublishJSON(topic, config)
    }

    // Publish availability = online
    p.client.Publish(vin+"/availability", "online")
}
```

### Step 4: Device Tracker for Location

HA device_tracker uses a special JSON payload format:

```go
// Publish location as device_tracker
func (p *HADiscoveryPublisher) PublishLocation(vin string, lat, lon float64) {
    p.client.PublishJSON(vin+"/location", map[string]interface{}{
        "latitude":  lat,
        "longitude": lon,
        "gps_accuracy": 10,
    })
}

// Discovery config for device_tracker:
config := map[string]interface{}{
    "name":           "Location",
    "unique_id":      "teslasync_" + vin + "_location",
    "json_attributes_topic": fmt.Sprintf("%s/%s/location", mqttPrefix, vin),
    "device":         device,
    "source_type":    "gps",
}
topic := fmt.Sprintf("%s/device_tracker/teslasync_%s/location/config", discoveryPrefix, vin)
```

### Step 5: Configuration

Add to `config.go`:
```go
type MQTTConfig struct {
    // ... existing ...
    HADiscoveryEnabled bool   // MQTT_HA_DISCOVERY_ENABLED (default: false)
    HADiscoveryPrefix  string // MQTT_HA_DISCOVERY_PREFIX (default: "homeassistant")
}
```

### Step 6: Publish on Reconnect

When MQTT reconnects (connection lost handler), re-publish all discovery configs.
HA expects discovery messages to be **retained** so they survive HA restarts.

Ensure all discovery publishes use `retained: true`.

### Step 7: Availability Tracking

Publish availability so HA shows entities as unavailable when TeslaSync stops:

```go
// On connect:
client.Publish(vin+"/availability", "online")  // retained

// On graceful shutdown:
client.Publish(vin+"/availability", "offline")  // retained

// Configure Last Will and Testament (LWT) for unexpected disconnects:
opts.SetWill(prefix+"/"+vin+"/availability", "offline", 0, true)
```

### Step 8: Configuration Sync

Update all deployment targets:
1. **docker-compose.yml** — add `MQTT_HA_DISCOVERY_ENABLED: "false"`
2. **helm/teslasync/templates/configmap.yaml** — add the env var
3. **helm/teslasync/values.yaml** — add `mqtt.haDiscoveryEnabled: false`

## Verification

```bash
# Build
CGO_ENABLED=0 go build ./cmd/teslasync

# Unit tests
go test -count=1 ./internal/mqtt/...

# Manual verification with mosquitto_sub:
# 1. Enable HA discovery: MQTT_HA_DISCOVERY_ENABLED=true
# 2. Start TeslaSync
# 3. Check discovery messages:
mosquitto_sub -h localhost -t "homeassistant/#" -v | head -20
# Should see: homeassistant/sensor/teslasync_VIN/BatteryLevel/config {JSON}

# 4. In HA: Settings → Devices → search "Tesla" → verify entities created
```

## Commit

```bash
git add -A
git commit -m "feat(mqtt): add Home Assistant MQTT Auto-Discovery for Tesla vehicles

- Create HADiscoveryPublisher with 40+ entity definitions
- Publish discovery configs on startup and reconnect (retained)
- Support sensor, binary_sensor, and device_tracker components
- Group all entities under a Tesla device in HA
- Add availability tracking with LWT for offline detection
- Configurable via MQTT_HA_DISCOVERY_ENABLED (default: false)"
```
