# Alerts & Notifications

TeslaSync includes a flexible alert system with configurable rules and multi-channel notification delivery.

## Alert System

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

## Alert Rules

Alert rules define the conditions that trigger alerts. You can configure them per vehicle or globally.

### Managing Rules

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
