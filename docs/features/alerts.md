# Alerts & Notifications

TeslaSync includes a powerful alert system combining legacy threshold rules with a **CEP (Complex Event Processing) Rule Engine** and multi-channel notification delivery.

## CEP Rule Engine

The CEP Rule Engine (`internal/api/rule_engine.go`) evaluates recursive condition trees against live vehicle telemetry signals. It supports complex logic, temporal conditions, and transition detection — all configurable through the visual **Alert Studio** UI.

### Condition Tree Structure

Rules use a recursive condition tree with AND/OR/NOT grouping:

```json
{
  "operator": "AND",
  "children": [
    { "signal": "BatteryLevel", "op": "<", "value": 20 },
    { "signal": "ChargeState", "op": "!=", "value": "Charging" }
  ]
}
```

### Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `==` | Equals | `BatteryLevel == 100` |
| `!=` | Not equals | `ChargeState != "Charging"` |
| `>` | Greater than | `VehicleSpeed > 120` |
| `<` | Less than | `BatteryLevel < 20` |
| `>=` | Greater or equal | `InsideTemp >= 40` |
| `<=` | Less or equal | `OutsideTemp <= -10` |
| `contains` | String contains | `SoftwareUpdate contains "2026"` |
| `changed_to` | Transition detection | `Gear changed_to "P"` |
| `changed_from` | Transition detection | `ChargeState changed_from "Charging"` |
| `is_true` | Boolean true check | `SentryMode is_true` |
| `is_false` | Boolean false check | `Locked is_false` |

### Temporal Conditions

Add `for_seconds` to require a condition to sustain before firing:

```json
{
  "signal": "VehicleSpeed",
  "op": ">",
  "value": 130,
  "for_seconds": 30
}
```

This fires only if speed exceeds 130 for 30 continuous seconds — prevents false alerts from brief spikes.

### Cooldown & Deduplication

Each rule has a configurable `cooldown_min` (default 15 minutes). After firing, the rule won't fire again for the same vehicle until the cooldown expires. Tracked both in-memory (fast) and in the database (`last_fired_at` column for pod restart recovery).

### Message Templates

Templates support signal interpolation with `{{SignalName}}` syntax:

```
🔋 Battery at {{BatteryLevel}}% — Vehicle speed: {{VehicleSpeed}} km/h
```

Available signals: any of the 230 Fleet Telemetry signals from the Signal Catalog. Templates are rendered with real-time values when alerts fire and when test notifications are sent.

## Alert Studio

The **Alert Studio** page (`/alert-studio`) provides a visual rule editor:

### Features
- **50+ pre-built templates** across 12 categories (Battery, Charging, Climate, Driving, Security, Geofence, Maintenance, Software, Efficiency, Fleet, Safety, Custom)
- **Visual RuleBuilder** — condition tree editor with signal picker, category grouping, and context-aware operators
- **Signal Catalog** — browse all 230 signals with metadata (name, category, type, unit, description)
- **Test notifications** — fire a test alert with real signal values interpolated into templates
- **Channel selection** — choose which notification channels receive alerts per rule
- **Severity & cooldown** — configure per-rule severity (info/warning/critical) and cooldown period
- **Enable/disable** — toggle rules on/off without deleting them
- **Fire count tracking** — see how many times each rule has fired and when it last fired

### Alert Studio API

```bash
# List all CEP rules
curl http://localhost:8080/api/v1/alerts/rules

# Create a CEP rule
curl -X POST http://localhost:8080/api/v1/alerts/rules \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Low Battery Warning",
    "type": "custom",
    "enabled": true,
    "severity": "warning",
    "cooldown_min": 30,
    "msg_template": "🔋 Battery at {{BatteryLevel}}% on {{VehicleName}}",
    "conditions": {
      "operator": "AND",
      "children": [
        { "signal": "BatteryLevel", "op": "<", "value": 20 },
        { "signal": "ChargeState", "op": "!=", "value": "Charging" }
      ]
    },
    "notify_channels": [1, 3]
  }'

# Toggle a rule on/off
curl -X POST http://localhost:8080/api/v1/alerts/rules/1/toggle \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}'

# Fire a test notification
curl -X POST http://localhost:8080/api/v1/alerts/test \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Rule",
    "severity": "info",
    "msg_template": "Battery is at {{BatteryLevel}}%",
    "notify_channels": [1]
  }'

# Delete a rule
curl -X DELETE http://localhost:8080/api/v1/alerts/rules/1
```

## Quiet Hours

Server-side quiet hours suppress **non-critical** alerts during configured hours (e.g., 11 PM – 7 AM). Critical alerts always fire regardless.

Configuration is stored in the `settings` table (`quiet_hours_start`, `quiet_hours_end`, `quiet_hours_enabled`) and checked in `fireAlert()` before dispatching notifications.

```bash
# Configure quiet hours
curl -X PUT http://localhost:8080/api/v1/settings \
  -H "Content-Type: application/json" \
  -d '{
    "quiet_hours_enabled": true,
    "quiet_hours_start": "23:00",
    "quiet_hours_end": "07:00"
  }'
```

## Legacy Alert System

Alerts are triggered automatically based on rules you configure. Each alert has a type, severity, and message.

### Alert Types

| Type | Description | Example |
|------|-------------|---------|
| `battery_low` | Battery drops below threshold | "Battery below 20%" |
| `geofence` | Vehicle enters or exits a geofence | "Model 3 left Home zone" |
| `sentry` | Sentry mode event detected | "Sentry mode triggered" |
| `speed` | Vehicle exceeds speed threshold | "Speed exceeded 120 km/h" |
| `maintenance` | Maintenance reminder triggered | "Tire rotation due at 20,000 km" |
| `software` | New software update available | "Update 2024.8.7 available" |
| `custom` | User-defined custom alert | Configurable message |

### Alert Severity

| Severity | Color | Description |
|----------|-------|-------------|
| `info` | Blue | Informational — no action needed |
| `warning` | Amber | Attention needed — review soon |
| `critical` | Red | Urgent — immediate action required |

### Viewing Alerts

The **Alerts** page (`/alerts`) shows all alerts with:

- Sortable table with type, severity, vehicle, message, and timestamp
- Filter by type, severity, or vehicle
- Mark individual alerts as read
- Bulk mark as read
- Unread count badge in the sidebar navigation

### Alert API

```bash
# List all alerts
curl http://localhost:8080/api/v1/alerts

# Mark an alert as read
curl -X POST http://localhost:8080/api/v1/alerts/42/read
```

**Response format:**

```json
[
  {
    "id": 42,
    "vehicle_id": 123,
    "type": "battery_low",
    "severity": "warning",
    "title": "Battery Level Low",
    "message": "My Model 3 battery is at 18%, below the 20% threshold",
    "is_read": false,
    "created_at": "2024-01-20T14:30:00Z"
  }
]
```

## Legacy Alert Rules

Legacy alert rules use simple threshold-based conditions. These are still supported alongside CEP rules for backward compatibility.

### Managing Legacy Rules

```bash
# List all alert rules
curl http://localhost:8080/api/v1/alerts/rules

# Update a rule (e.g., change battery threshold)
curl -X PUT http://localhost:8080/api/v1/alerts/rules/1 \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Low Battery",
    "type": "battery_low",
    "enabled": true,
    "threshold": 15,
    "vehicle_id": null
  }'
```

**Rule properties:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | int | Unique rule ID |
| `name` | string | Human-readable rule name |
| `type` | string | Alert type (see above) |
| `enabled` | bool | Whether the rule is active |
| `threshold` | float | Threshold value (e.g., battery percentage, speed limit) |
| `vehicle_id` | int/null | Specific vehicle, or `null` for all vehicles |

### Default Rules

TeslaSync comes with these default alert rules:

| Rule | Type | Threshold | Scope |
|------|------|-----------|-------|
| Low Battery | `battery_low` | 20% | All vehicles |
| Speed Alert | `speed` | 130 km/h | All vehicles |
| Sentry Event | `sentry` | — | All vehicles |
| Software Update | `software` | — | All vehicles |

## Geofences

Geofences let you define geographic boundaries and receive alerts when vehicles enter or exit them.

### Creating Geofences

```bash
# Create a geofence
curl -X POST http://localhost:8080/api/v1/geofences \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Home",
    "latitude": 37.7749,
    "longitude": -122.4194,
    "radius": 100,
    "cost_per_kwh": 0.12
  }'
```

The **Geofences** page (`/geofences`) provides a visual editor:

- Click on the map to set the center point
- Drag to adjust the radius
- Set a name and optional electricity cost per kWh
- View all geofences on the map with their boundaries

### Geofence Properties

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Geofence name (e.g., "Home", "Work", "Supercharger") |
| `latitude` | float | Center latitude |
| `longitude` | float | Center longitude |
| `radius` | int | Radius in meters |
| `cost_per_kwh` | float | Electricity cost for charging at this location |

### Geofence Alerts

When a vehicle crosses a geofence boundary, an alert is generated:

- **Enter:** "Model 3 arrived at Home"
- **Exit:** "Model 3 left Home"

The `cost_per_kwh` field is used to calculate charging costs when a vehicle charges within that geofence.

## Notification Channels

Alerts can be delivered through multiple notification channels. TeslaSync supports 7 channel types:

| Channel | Description |
|---------|-------------|
| **Discord** | Send alerts to a Discord channel via webhook |
| **Email** | Send alerts via SMTP email |
| **Slack** | Send alerts to a Slack channel via webhook |
| **Telegram** | Send alerts to a Telegram chat via bot |
| **Webhook** | Send alerts to any HTTP endpoint |
| **Ntfy** | Send alerts to [ntfy.sh](https://ntfy.sh) topics |
| **Pushover** | Send alerts via [Pushover](https://pushover.net) |

### Managing Channels

```bash
# List all notification channels
curl http://localhost:8080/api/v1/notifications

# Create a Discord webhook channel
curl -X POST http://localhost:8080/api/v1/notifications \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Discord Alerts",
    "type": "discord",
    "config": {
      "webhook_url": "https://discord.com/api/webhooks/..."
    },
    "enabled": true
  }'

# Create a Telegram channel
curl -X POST http://localhost:8080/api/v1/notifications \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Telegram Bot",
    "type": "telegram",
    "config": {
      "bot_token": "123456:ABC-DEF...",
      "chat_id": "-100123456789"
    },
    "enabled": true
  }'

# Test a channel (sends a test notification)
curl -X POST http://localhost:8080/api/v1/notifications/1/test

# Toggle a channel on/off
curl -X POST http://localhost:8080/api/v1/notifications/1/toggle

# Delete a channel
curl -X DELETE http://localhost:8080/api/v1/notifications/1
```

### Notification Logs

View the delivery history for all notifications:

```bash
# Get recent notification logs
curl http://localhost:8080/api/v1/notifications/logs

# Get notification statistics
curl http://localhost:8080/api/v1/notifications/stats
```

**Log entry example:**

```json
{
  "id": 1,
  "channel_id": 1,
  "alert_id": 42,
  "status": "delivered",
  "sent_at": "2024-01-20T14:30:05Z",
  "error": null
}
```

### Notifications UI

The **Notifications** page (`/notifications`) lets you:

- View all configured channels with their status (enabled/disabled)
- Create new channels with a guided form
- Edit existing channel configurations
- Test channels with a single click
- View delivery logs with success/failure status
- See notification statistics (delivered, failed, pending)

## Best Practices

### Alert Fatigue

- Start with conservative thresholds and adjust as needed
- Use severity levels appropriately — save `critical` for truly urgent events
- Disable rules you don't need to reduce noise
- Use geofence enter/exit alerts sparingly for frequently visited locations

### Notification Reliability

- Configure at least two notification channels for redundancy
- Use the test button after creating a channel to verify it works
- Monitor the notification logs for delivery failures
- Webhook channels should respond with 2xx status codes within 10 seconds

## CEP Prometheus Metrics

The CEP Rule Engine exposes 7 Prometheus metrics for monitoring:

| Metric | Type | Description |
|--------|------|-------------|
| `teslasync_cep_active_rules` | Gauge | Number of enabled CEP rules |
| `teslasync_cep_rules_evaluated_total` | Counter | Total rule evaluations |
| `teslasync_cep_rules_cooldown_skipped_total` | Counter | Evaluations skipped due to cooldown |
| `teslasync_cep_eval_duration_seconds` | Histogram | Rule evaluation latency |
| `teslasync_alerts_fired_total` | Counter | Total alerts fired (by severity, rule) |
| `teslasync_alerts_suppressed_quiet_hours_total` | Counter | Alerts suppressed by quiet hours |
| `teslasync_cep_condition_errors_total` | Counter | Condition evaluation errors |

A pre-built **CEP Rule Engine** Grafana dashboard (12 panels) is included for monitoring all these metrics.
