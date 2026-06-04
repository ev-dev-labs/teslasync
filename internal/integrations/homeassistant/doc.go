// Package homeassistant integrates TeslaSync with Home Assistant via
// MQTT auto-discovery.
//
// Layer: adapter
//
// Publishes per-vehicle entity discovery messages on the
// homeassistant/* topic family at server boot, then keeps state topics
// fed from the same fields that internal/mqtt's PublishVehicleData
// already exports. Operators get a turn-key dashboard surface in HA
// without writing YAML.
//
// Layered as `adapter` (external-system integration). The default
// entity catalog (catalog.go) is intentionally curated and not
// auto-derived from the proto schema — operators routinely override
// it by passing a custom []Entity to the Publisher.
//
// If you change a topic name in internal/mqtt/mqtt.go::
// PublishVehicleData, update the matching entry here in the same
// commit or HA dashboards will silently go stale.
package homeassistant
