// Package homeassistant — default entity catalog. The catalog is a
// curated list of HA entities that map onto fields TeslaSync already
// publishes via internal/mqtt/mqtt.go::PublishVehicleData. Operators
// can override the catalog by passing a custom []Entity to the
// Publisher; the defaults below are tuned for the most common dashboard
// use-cases.
//
// State topic suffixes match TeslaSync's existing vehicle topic family
// — see internal/mqtt/mqtt.go::PublishVehicleData. If you change a
// topic name there, update the matching entry here in the same commit
// or HA dashboards will silently go stale.
package homeassistant

// DefaultEntities is the curated baseline entity set per vehicle.
// 14 entities covering charge, climate, security, location, drive.
func DefaultEntities() []Entity {
	return []Entity{
		// Battery / charge
		{
			Component:         ComponentSensor,
			ObjectID:          "battery_level",
			Name:              "Battery Level",
			StateTopicSuffix:  "battery_level",
			DeviceClass:       "battery",
			StateClass:        "measurement",
			UnitOfMeasurement: "%",
		},
		{
			Component:         ComponentSensor,
			ObjectID:          "battery_range_km",
			Name:              "Battery Range",
			StateTopicSuffix:  "battery_range",
			UnitOfMeasurement: "km",
			Icon:              "mdi:map-marker-distance",
		},
		{
			Component:        ComponentSensor,
			ObjectID:         "charging_state",
			Name:             "Charging State",
			StateTopicSuffix: "charging_state",
			Icon:             "mdi:ev-station",
		},
		{
			Component:         ComponentSensor,
			ObjectID:          "charger_power",
			Name:              "Charger Power",
			StateTopicSuffix:  "charger_power",
			UnitOfMeasurement: "kW",
			StateClass:        "measurement",
			DeviceClass:       "power",
		},
		{
			Component:         ComponentSensor,
			ObjectID:          "charge_limit",
			Name:              "Charge Limit",
			StateTopicSuffix:  "charge_limit_soc",
			UnitOfMeasurement: "%",
		},

		// Climate
		{
			Component:         ComponentSensor,
			ObjectID:          "inside_temp",
			Name:              "Inside Temperature",
			StateTopicSuffix:  "inside_temp",
			DeviceClass:       "temperature",
			StateClass:        "measurement",
			UnitOfMeasurement: "°C",
		},
		{
			Component:         ComponentSensor,
			ObjectID:          "outside_temp",
			Name:              "Outside Temperature",
			StateTopicSuffix:  "outside_temp",
			DeviceClass:       "temperature",
			StateClass:        "measurement",
			UnitOfMeasurement: "°C",
		},
		{
			Component:        ComponentBinarySensor,
			ObjectID:         "climate_on",
			Name:             "Climate",
			StateTopicSuffix: "climate_on",
			DeviceClass:      "power",
		},

		// Security / state
		{
			Component:        ComponentBinarySensor,
			ObjectID:         "locked",
			Name:             "Doors Locked",
			StateTopicSuffix: "locked",
			DeviceClass:      "lock",
		},
		{
			Component:        ComponentBinarySensor,
			ObjectID:         "sentry_mode",
			Name:             "Sentry Mode",
			StateTopicSuffix: "sentry_mode",
			Icon:             "mdi:cctv",
		},
		{
			Component:        ComponentSensor,
			ObjectID:         "shift_state",
			Name:             "Shift State",
			StateTopicSuffix: "shift_state",
			Icon:             "mdi:car-shift-pattern",
		},

		// Location
		{
			Component:        ComponentDeviceTracker,
			ObjectID:         "location",
			Name:             "Location",
			StateTopicSuffix: "location",
			Icon:             "mdi:car",
		},

		// Drive
		{
			Component:         ComponentSensor,
			ObjectID:          "speed",
			Name:              "Speed",
			StateTopicSuffix:  "speed",
			UnitOfMeasurement: "km/h",
			StateClass:        "measurement",
			DeviceClass:       "speed",
		},
		{
			Component:         ComponentSensor,
			ObjectID:          "odometer",
			Name:              "Odometer",
			StateTopicSuffix:  "odometer",
			UnitOfMeasurement: "km",
			StateClass:        "total_increasing",
			DeviceClass:       "distance",
		},
	}
}
