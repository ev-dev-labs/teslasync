---
description: "Automation trigger: MQTT topic — fires when a message is published to a specific MQTT topic"
---

# Trigger: MQTT Topic

## Overview

Fires when a message is published to a specific MQTT topic. Enables custom integrations
with Home Assistant, Node-RED, or any MQTT publisher.

## Trigger Config Schema

```json
{
  "trigger_type": "mqtt",
  "trigger_config": {
    "topic": "homeassistant/binary_sensor/front_door/state",
    "payload_match": "on",       // optional: only fire if payload matches (string equality)
    "payload_json_path": null,   // optional: JSON path to extract value (e.g., "$.state")
    "payload_operator": "eq",    // "eq", "neq", "contains", "gt", "lt" (for numeric)
    "payload_value": null        // value to compare against json_path result
  }
}
```

## Implementation

Create `internal/automation/trigger/mqtt.go`:

```go
type MQTTTrigger struct {
    repo       *database.AutomationRepo
    engine     AutomationEngine
    mqttClient *mqtt.Client
    subs       sync.Map  // topic → []automationID
}

// Start subscribes to all MQTT topics used by enabled automations.
func (t *MQTTTrigger) Start(ctx context.Context) error

// OnMessage handles incoming MQTT messages and evaluates automations.
func (t *MQTTTrigger) OnMessage(topic string, payload []byte)

// Reload re-reads automations and updates subscriptions.
func (t *MQTTTrigger) Reload(ctx context.Context) error
```

**Logic:**
1. On start, query all `trigger_type = "mqtt"` automations
2. Subscribe to each unique topic
3. On message, check payload matching rules
4. If match → fire evaluation

## Trigger Snapshot

```json
{"topic": "homeassistant/binary_sensor/front_door/state", "payload": "on", "matched": true}
```

## Tests

- Test simple payload match
- Test JSON path extraction
- Test numeric comparison (gt/lt)
- Test wildcard topic subscription
- Test subscribe/unsubscribe lifecycle

## Verification

```bash
go build ./...
go test ./internal/automation/trigger/... -v -run MQTT
```
