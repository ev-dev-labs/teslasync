# API Reference

Complete reference for the TeslaSync REST API. All endpoints are prefixed with `/api/v1` unless noted otherwise.

## Base URL

```
http://localhost:8080/api/v1
```

## Common Response Format

**Success:**

```json
{
  "id": 1,
  "field": "value"
}
```

**Error:**

```json
{
  "error": "description of the error"
}
```

## Authentication

### GET `/api/v1/auth/login`

Returns the Tesla OAuth2 authorization URL. Redirect the user to this URL to begin authentication.

**Response:** `200 OK`

```json
{
  "url": "https://auth.tesla.com/oauth2/v3/authorize?client_id=...&redirect_uri=...&response_type=code&scope=openid+vehicle_device_data+vehicle_cmds"
}
```

### GET `/api/v1/auth/callback`

OAuth2 callback endpoint. Tesla redirects here after the user authorizes. Exchanges the authorization code for access and refresh tokens, then redirects to the frontend.

**Query Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `code` | string | Authorization code from Tesla |
| `state` | string | CSRF state parameter |

### POST `/api/v1/auth/refresh`

Refresh the Tesla API access token using the stored refresh token.

**Response:** `200 OK`

```json
{
  "message": "token refreshed successfully",
  "expires_at": "2024-01-21T14:00:00Z"
}
```

### GET `/api/v1/auth/status`

Check the current authentication status.

**Response:** `200 OK`

```json
{
  "authenticated": true,
  "expires_at": "2024-01-21T14:00:00Z"
}
```

---

## Health & System

### GET `/healthz`

Liveness probe. Returns 200 if the service is running and the database is reachable.

**Response:** `200 OK`

```json
{ "status": "ok" }
```

### GET `/readyz`

Readiness probe. Checks database connectivity and Tesla API availability.

**Response:** `200 OK` or `503 Service Unavailable`

```json
{ "status": "ready", "database": "ok", "tesla_api": "ok" }
```

### GET `/metrics`

Prometheus-format metrics endpoint. Returns standard Go runtime metrics plus application-specific counters.

### GET `/api/v1/system/status`

Detailed component health status.

**Response:** `200 OK`

```json
{
  "status": "healthy",
  "components": {
    "database": { "status": "healthy", "latency_ms": 2 },
    "mqtt": { "status": "healthy", "connected": true },
    "tesla_api": { "status": "healthy", "circuit_breaker": "closed" },
    "worker": { "status": "healthy", "last_poll": "2024-01-20T14:22:00Z" }
  },
  "uptime": "72h15m30s",
  "version": "1.0.0"
}
```

---

## Vehicles

### GET `/api/v1/vehicles`

List all tracked vehicles.

**Response:** `200 OK`

```json
[
  {
    "id": 1,
    "vehicle_id": 987654321,
    "vin": "5YJ3E1EA5KF123456",
    "display_name": "My Model 3",
    "model": "Model 3",
    "trim_badging": "Long Range",
    "exterior_color": "Pearl White",
    "wheel_type": "Überturbine",
    "state": "online",
    "healthy": true,
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2024-01-20T14:22:00Z"
  }
]
```

### POST `/api/v1/vehicles/sync`

Sync vehicles from the Tesla Fleet API. Fetches the vehicle list from Tesla and upserts into the database.

**Response:** `200 OK`

```json
{
  "synced": 2,
  "vehicles": [...]
}
```

### GET `/api/v1/vehicles/{vehicleID}`

Get details of a specific vehicle.

**Path Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `vehicleID` | int | Vehicle database ID |

### DELETE `/api/v1/vehicles/{vehicleID}`

Remove a vehicle from tracking. Does **not** affect the vehicle itself — only removes it from TeslaSync.

**Response:** `204 No Content`

### GET `/api/v1/vehicles/{vehicleID}/positions`

Get GPS position history for a vehicle.

**Query Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `start` | date | Start date (ISO 8601) |
| `end` | date | End date (ISO 8601) |
| `limit` | int | Max results (default: 1000) |

**Response:** `200 OK`

```json
[
  {
    "id": 456,
    "latitude": 37.7749,
    "longitude": -122.4194,
    "speed": 45.5,
    "power": -12.3,
    "battery_level": 85,
    "created_at": "2024-01-20T14:22:00Z"
  }
]
```

### GET `/api/v1/vehicles/{vehicleID}/state`

Get the current live state snapshot of a vehicle.

### POST `/api/v1/vehicles/{vehicleID}/wake`

Wake a sleeping vehicle.

**Response:** `200 OK`

```json
{ "message": "wake command sent" }
```

### POST `/api/v1/vehicles/{vehicleID}/command`

Send a remote command to a vehicle.

**Request Body:**

```json
{
  "command": "lock"
}
```

**Available commands:** `lock`, `unlock`, `climate_on`, `climate_off`, `charge_start`, `charge_stop`, `frunk_open`, `trunk_open`, `sentry_on`, `sentry_off`, `horn`, `flash`, `speed_limit`, `wake`

**Response:** `200 OK`

```json
{
  "result": true,
  "message": "command executed successfully"
}
```

### GET `/api/v1/vehicles/{vehicleID}/energy`

Get energy consumption statistics for a vehicle.

### GET `/api/v1/vehicles/{vehicleID}/battery`

Get battery health report for a vehicle.

---

## Drives

### GET `/api/v1/drives`

List drive records.

**Query Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `vehicle_id` | int | Filter by vehicle |
| `start` | date | Start date |
| `end` | date | End date |
| `limit` | int | Max results |
| `offset` | int | Pagination offset |

**Response:** `200 OK`

```json
[
  {
    "id": 789,
    "vehicle_id": 1,
    "start_date": "2024-01-20T08:00:00Z",
    "end_date": "2024-01-20T08:45:00Z",
    "distance": 28.5,
    "duration_min": 45,
    "start_battery_level": 95,
    "end_battery_level": 82,
    "speed_max": 120,
    "power_max": 50,
    "power_min": -15
  }
]
```

### GET `/api/v1/drives/{driveID}`

Get details of a specific drive, including start/end addresses.

---

## Charging

### GET `/api/v1/charging`

List charging sessions.

**Query Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `vehicle_id` | int | Filter by vehicle |
| `start` | date | Start date |
| `end` | date | End date |

**Response:** `200 OK`

```json
[
  {
    "id": 111,
    "vehicle_id": 1,
    "start_date": "2024-01-20T18:00:00Z",
    "end_date": "2024-01-20T20:30:00Z",
    "charge_energy_added": 45.2,
    "start_battery_level": 20,
    "end_battery_level": 95,
    "charger_power": 11.5,
    "fast_charger_type": "Supercharger",
    "cost": 8.50,
    "duration_min": 150
  }
]
```

### GET `/api/v1/charging/{sessionID}`

Get details of a specific charging session.

---

## Geofences

### GET `/api/v1/geofences`

List all geofences.

### POST `/api/v1/geofences`

Create a new geofence.

**Request Body:**

```json
{
  "name": "Home",
  "latitude": 37.7749,
  "longitude": -122.4194,
  "radius": 100,
  "cost_per_kwh": 0.12
}
```

### GET `/api/v1/geofences/{geofenceID}`

Get a specific geofence.

### PUT `/api/v1/geofences/{geofenceID}`

Update a geofence.

### DELETE `/api/v1/geofences/{geofenceID}`

Delete a geofence. **Response:** `204 No Content`

---

## Alerts

### GET `/api/v1/alerts`

List all alerts. Returns newest first.

### POST `/api/v1/alerts/{alertID}/read`

Mark an alert as read.

### GET `/api/v1/alerts/rules`

List all alert rules.

### PUT `/api/v1/alerts/rules/{ruleID}`

Update an alert rule.

**Request Body:**

```json
{
  "name": "Low Battery",
  "type": "battery_low",
  "enabled": true,
  "threshold": 15,
  "vehicle_id": null
}
```

---

## Notifications

### GET `/api/v1/notifications`

List all notification channels.

### POST `/api/v1/notifications`

Create a notification channel.

**Request Body:**

```json
{
  "name": "Discord Alerts",
  "type": "discord",
  "config": { "webhook_url": "https://discord.com/api/webhooks/..." },
  "enabled": true
}
```

**Supported types:** `discord`, `email`, `slack`, `telegram`, `webhook`, `ntfy`, `pushover`

### GET `/api/v1/notifications/{channelID}`

Get a notification channel.

### PUT `/api/v1/notifications/{channelID}`

Update a notification channel.

### DELETE `/api/v1/notifications/{channelID}`

Delete a notification channel.

### POST `/api/v1/notifications/{channelID}/toggle`

Toggle a notification channel on/off.

### POST `/api/v1/notifications/{channelID}/test`

Send a test notification through the channel.

### GET `/api/v1/notifications/logs`

Get notification delivery logs.

### GET `/api/v1/notifications/stats`

Get notification delivery statistics.

---

## Analytics & Data

### GET `/api/v1/analytics/fleet`

Fleet-wide analytics summary.

### GET `/api/v1/mileage/daily`

Daily mileage breakdown. **Query:** `vehicle_id`, `start`, `end`

### GET `/api/v1/mileage/monthly`

Monthly mileage totals. **Query:** `vehicle_id`

### GET `/api/v1/mileage/stats`

Mileage statistics. **Query:** `vehicle_id`

### GET `/api/v1/tire-pressure`

Tire pressure history. **Query:** `vehicle_id`

### GET `/api/v1/tire-pressure/latest`

Latest tire pressure readings. **Query:** `vehicle_id`

### GET `/api/v1/software-updates`

Software update history. **Query:** `vehicle_id`

### GET `/api/v1/vampire-drain`

Vampire drain events. **Query:** `vehicle_id`

### GET `/api/v1/vampire-drain/stats`

Vampire drain statistics. **Query:** `vehicle_id`

### GET `/api/v1/locations`

Visited locations with frequency. **Query:** `vehicle_id`

### GET `/api/v1/states/timeline`

Vehicle state transitions over time. **Query:** `vehicle_id`, `start`, `end`

### GET `/api/v1/states/summary`

Vehicle state summary. **Query:** `vehicle_id`

### GET `/api/v1/states/daily`

Daily state breakdown. **Query:** `vehicle_id`

### GET `/api/v1/trips`

Multi-drive trips. **Query:** `vehicle_id`

---

## Settings

### GET `/api/v1/settings`

Get user settings.

**Response:** `200 OK`

```json
{
  "id": 1,
  "unit_of_length": "km",
  "unit_of_temp": "C",
  "preferred_range": "rated",
  "language": "en",
  "base_cost_per_kwh": 0.12
}
```

### PUT `/api/v1/settings`

Update user settings.

---

## Real-Time Events

### GET `/api/v1/events`

Server-Sent Events (SSE) stream. Opens a long-lived connection that pushes events in real time.

**Event format:**

```
event: vehicle_update
data: {"vehicle_id":1,"battery_level":85,"speed":0,"latitude":37.7749}

event: alert
data: {"id":42,"type":"battery_low","severity":"warning","message":"Battery below 20%"}
```

**Event types:** `vehicle_update`, `alert`, `charging_update`, `drive_update`

---

## Data Export

### GET `/api/v1/export/{type}`

Export data in CSV or JSON format.

**Path Parameters:**

| Param | Values |
|-------|--------|
| `type` | `drives`, `charging`, `positions`, `battery`, `energy`, `alerts`, `mileage`, `vampire-drain` |

**Query Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `format` | string | `csv` (default) or `json` |
| `start` | date | Start date filter |
| `end` | date | End date filter |
| `vehicle_id` | int | Filter by vehicle |

---

## Chatbot

### POST `/api/v1/chatbot`

Send a chat message.

**Request Body:**

```json
{ "message": "How much did I spend on charging this month?" }
```

### GET `/api/v1/chatbot/history`

Get chat history.

### GET `/api/v1/chatbot/sessions`

List chat sessions.

---

## Rate Limiting

All API endpoints are rate-limited to **100 requests per minute per IP address**. When exceeded, the API returns `429 Too Many Requests` with a `Retry-After` header.

## Error Codes

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `201` | Created |
| `204` | No Content (successful deletion) |
| `400` | Bad Request (invalid parameters) |
| `401` | Unauthorized (if auth is enabled) |
| `404` | Not Found |
| `429` | Too Many Requests (rate limited) |
| `500` | Internal Server Error |
| `503` | Service Unavailable (health check failed) |
