// Package mqtt provides a thin publishing layer over the Paho MQTT client
// for broadcasting real-time vehicle state to external consumers.
//
// [Client] connects to the configured broker with auto-reconnect and
// publishes vehicle telemetry to hierarchical topics under a configurable
// prefix (e.g. {prefix}/{vin}/battery_level). [PublishVehicleData]
// fans out a single Tesla API response into per-metric topics plus a
// full JSON payload, enabling fine-grained subscription by home
// automation systems, dashboards, or other MQTT subscribers.
package mqtt
