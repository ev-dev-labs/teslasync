# API Reference

::: tip OpenAPI Specification
A complete, machine-readable OpenAPI 3.0 specification is available at [`openapi.yaml`](/teslasync/openapi.yaml). You can import it into tools like [Swagger Editor](https://editor.swagger.io), Postman, or Insomnia for interactive exploration.
:::

TeslaSync exposes a RESTful JSON API on port **8080**. All endpoints are prefixed with `/api/v1/` unless noted otherwise. Responses use standard HTTP status codes and return JSON bodies.

> **Base URL:** `http://localhost:8080`

---

## System & Health

### GET `/healthz`

Liveness probe — returns `200 OK` when the server is running.

**curl:**
```bash
curl http://localhost:8080/healthz
```

**Response:**
```json
{ "status": "ok" }
```

### GET `/readyz`

Readiness probe — checks database connectivity and Tesla auth status.

**curl:**
```bash
curl http://localhost:8080/readyz
```

**Response:**
```json
{
  "database": "ok",
  "tesla_auth": "ok"
}
```

### GET `/api/v1/system/status`

Comprehensive system health with per-component details.

**curl:**
```bash
curl http://localhost:8080/api/v1/system/status
```

**Response:**
```json
{
  "overall": "healthy",
  "database": { "status": "healthy", "latency_ms": 2 },
  "tesla_api": { "status": "healthy", "circuit_breaker": "closed" },
  "mqtt": { "status": "healthy", "connected": true },
  "worker": { "status": "healthy", "goroutines": 3 }
}
```

### GET `/metrics`

Prometheus-format metrics for scraping (request counts, latencies, pool stats).

**curl:**
```bash
curl http://localhost:8080/metrics
```

**Response:** Prometheus text format (`text/plain`).

---

## Authentication

### GET `/api/v1/auth/login`

Returns the Tesla OAuth2 authorization URL the client should redirect to.

**curl:**
```bash
curl http://localhost:8080/api/v1/auth/login
```

**Response:**
```json
{
  "auth_url": "https://auth.tesla.com/oauth2/v3/authorize?client_id=...&redirect_uri=...&state=...",
  "state": "random-csrf-token"
}
```

### GET `/api/v1/auth/callback`

OAuth2 callback — Tesla redirects here after user consent. Exchanges the authorization code for tokens and stores them.

**curl:**
```bash
curl "http://localhost:8080/api/v1/auth/callback?code=AUTHORIZATION_CODE"
```

| Query Param | Description |
|-------------|-------------|
| `code` | Authorization code from Tesla |

**Response:** Redirects to `/?auth=success`

### POST `/api/v1/auth/refresh`

Force-refresh the Tesla access token using the stored refresh token.

**curl:**
```bash
curl -X POST http://localhost:8080/api/v1/auth/refresh
```

**Response:**
```json
{ "status": "refreshed" }
```

### GET `/api/v1/auth/status`

Check whether valid Tesla credentials are stored.

**curl:**
```bash
curl http://localhost:8080/api/v1/auth/status
```

**Response:**
```json
{
  "authenticated": true,
  "expires_at": "2026-03-21T00:00:00Z",
  "expired": false
}
```

---

### POST `/api/v1/auth/disconnect`

Disconnect the Tesla account — clears the stored OAuth tokens from the database and resets the in-memory client state.

**curl:**
```bash
curl -X POST http://localhost:8080/api/v1/auth/disconnect
```

**Response:**
```json
{ "status": "disconnected" }
```

---

### GET `/api/v1/vehicles/`

List all tracked vehicles.

**curl:**
```bash
curl http://localhost:8080/api/v1/vehicles/
```

**Response:**
```json
[
  {
    "id": 1,
    "vehicle_id": 1234567890,
    "vin": "5YJ3E1EA1NF000001",
    "display_name": "My Model 3",
    "model": "Model 3",
    "trim_badging": "Long Range",
    "exterior_color": "Pearl White",
    "wheel_type": "Aero",
    "state": "online",
    "healthy": true,
    "created_at": "2025-01-15T10:30:00Z",
    "updated_at": "2025-06-01T08:00:00Z"
  }
]
```

### POST `/api/v1/vehicles/sync`

Fetch vehicles from the Tesla Fleet API and sync to the local database.

**curl:**
```bash
curl -X POST http://localhost:8080/api/v1/vehicles/sync
```

**Response:**
```json
{
  "synced": 2,
  "vehicles": [ /* Vehicle objects */ ]
}
```

### GET `/api/v1/vehicles/{vehicleID}`

Get a single vehicle by internal ID.

**curl:**
```bash
curl http://localhost:8080/api/v1/vehicles/1
```

**Response:** Single `Vehicle` object (same shape as list items).

### DELETE `/api/v1/vehicles/{vehicleID}`

Remove a vehicle and all associated data. Returns **204 No Content**.

**curl:**
```bash
curl -X DELETE http://localhost:8080/api/v1/vehicles/1
```

### GET `/api/v1/vehicles/{vehicleID}/positions`

Retrieve GPS position history for a vehicle.

**curl:**
```bash
curl "http://localhost:8080/api/v1/vehicles/1/positions?limit=50&offset=0"
```

| Query Param | Default | Description |
|-------------|---------|-------------|
| `limit` | `100` | Max rows to return |
| `offset` | `0` | Pagination offset |

**Response:**
```json
[
  {
    "id": 9001,
    "vehicle_id": 1,
    "latitude": 37.7749,
    "longitude": -122.4194,
    "speed": 45.2,
    "power": -12.5,
    "heading": 270,
    "elevation": 16.0,
    "odometer": 42150.3,
    "ideal_range": 350.0,
    "rated_range": 320.5,
    "battery_level": 72,
    "inside_temp": 21.5,
    "outside_temp": 18.2,
    "fan_status": 0,
    "is_climate_on": false,
    "created_at": "2025-06-01T14:30:00Z"
  }
]
```

### GET `/api/v1/vehicles/{vehicleID}/state`

Get the current live state of a vehicle (combines latest position with online status).

**curl:**
```bash
curl http://localhost:8080/api/v1/vehicles/1/state
```

**Response:**
```json
{
  "state": "driving",
  "live": true,
  "position": { /* latest Position object */ }
}
```

### POST `/api/v1/vehicles/{vehicleID}/wake`

Send a wake-up command to a sleeping vehicle.

**curl:**
```bash
curl -X POST http://localhost:8080/api/v1/vehicles/1/wake
```

**Response:**
```json
{ "status": "waking" }
```

### POST `/api/v1/vehicles/{vehicleID}/command`

Send a command to the vehicle via the Tesla Fleet API.

**curl:**
```bash
curl -X POST http://localhost:8080/api/v1/vehicles/1/command \
  -H "Content-Type: application/json" \
  -d '{"command": "flash_lights", "params": {}}'
```

**Request Body:**
```json
{
  "command": "flash_lights",
  "params": {}
}
```

**Response:**
```json
{
  "success": true,
  "result": "command sent"
}
```

---

## Drives

### GET `/api/v1/drives/`

List drives for a vehicle with optional date filtering.

**curl:**
```bash
curl "http://localhost:8080/api/v1/drives/?vehicle_id=1&limit=10"
```

| Query Param | Required | Description |
|-------------|----------|-------------|
| `vehicle_id` | ✅ | Vehicle internal ID |
| `limit` | | Max rows (default 50) |
| `offset` | | Pagination offset |
| `start_date` | | ISO 8601 start filter |
| `end_date` | | ISO 8601 end filter |

**Response:**
```json
[
  {
    "id": 42,
    "vehicle_id": 1,
    "start_date": "2025-06-01T09:00:00Z",
    "end_date": "2025-06-01T09:35:00Z",
    "distance": 28.5,
    "duration_min": 35.0,
    "start_range_km": 310.0,
    "end_range_km": 285.0,
    "speed_max": 110.0,
    "power_max": 120.0,
    "power_min": -50.0,
    "start_battery_level": 80,
    "end_battery_level": 72,
    "inside_temp_avg": 22.0,
    "outside_temp_avg": 19.5,
    "start_address_id": 5,
    "end_address_id": 12
  }
]
```

### GET `/api/v1/drives/{driveID}`

Get a single drive by ID.

**curl:**
```bash
curl http://localhost:8080/api/v1/drives/42
```

**Response:** Single `Drive` object (same shape as list items).

---

## Charging

### GET `/api/v1/charging/`

List charging sessions for a vehicle.

**curl:**
```bash
curl "http://localhost:8080/api/v1/charging/?vehicle_id=1&limit=10"
```

| Query Param | Required | Description |
|-------------|----------|-------------|
| `vehicle_id` | ✅ | Vehicle internal ID |
| `limit` | | Max rows (default 50) |
| `offset` | | Pagination offset |
| `start_date` | | ISO 8601 start filter |
| `end_date` | | ISO 8601 end filter |

**Response:**
```json
[
  {
    "id": 15,
    "vehicle_id": 1,
    "start_date": "2025-06-01T22:00:00Z",
    "end_date": "2025-06-02T06:00:00Z",
    "address_id": 1,
    "charge_energy_added": 52.3,
    "charge_energy_used": 55.1,
    "start_battery_level": 20,
    "end_battery_level": 90,
    "start_range_km": 64.0,
    "end_range_km": 288.0,
    "charger_phases": 3,
    "charger_voltage": 240,
    "charger_actual_current": 32,
    "charger_power": 7.7,
    "fast_charger_type": null,
    "fast_charger_brand": null,
    "conn_charge_cable": "SAE",
    "cost": 6.28,
    "duration_min": 480.0
  }
]
```

### GET `/api/v1/charging/{sessionID}`

Get a single charging session by ID.

**curl:**
```bash
curl http://localhost:8080/api/v1/charging/15
```

**Response:** Single `ChargingSession` object (same shape as list items).

---

## Energy & Battery

### GET `/api/v1/vehicles/{vehicleID}/energy`

Energy consumption statistics over a time period.

| Query Param | Default | Description |
|-------------|---------|-------------|
| `start` | 30 days ago | ISO 8601 start date |
| `days` | `30` | Alternative: number of days |

**Response:**
```json
{
  "vehicle_id": 1,
  "period_days": 30,
  "total_kwh": 412.5,
  "total_cost": 49.50,
  "daily_breakdown": [
    {
      "date": "2025-06-01",
      "energy_kwh": 15.2,
      "cost": 1.82,
      "drive_count": 3
    }
  ]
}
```

### GET `/api/v1/vehicles/{vehicleID}/battery`

Battery health report with degradation tracking.

| Query Param | Default | Description |
|-------------|---------|-------------|
| `days` | `365` | Trend period in days |

**Response:**
```json
{
  "vehicle_id": 1,
  "health_score": 94.5,
  "capacity_kwh": 72.1,
  "degradation_pct": 5.5,
  "est_range_km": 498.0,
  "cycle_count": 320,
  "avg_cell_temp_c": 28.3,
  "monthly_trend": [
    { "month": "2025-01", "health_score": 95.2 },
    { "month": "2025-06", "health_score": 94.5 }
  ]
}
```

---

## Analytics

### GET `/api/v1/analytics/fleet`

Fleet-wide analytics aggregating all vehicles.

| Query Param | Default | Description |
|-------------|---------|-------------|
| `start` | 30 days ago | ISO 8601 start date |
| `days` | `30` | Alternative: number of days |

**Response:**
```json
{
  "period_days": 30,
  "drives": {
    "total_count": 124,
    "total_distance_km": 3200.5,
    "total_duration_min": 4800.0,
    "avg_speed_kmh": 40.0,
    "max_speed_kmh": 135.0
  },
  "charging": {
    "total_sessions": 28,
    "total_energy_kwh": 820.0,
    "total_cost": 98.40,
    "avg_session_kwh": 29.3
  },
  "battery": {
    "avg_health_score": 94.5,
    "avg_degradation_pct": 5.5
  }
}
```

---

## Alerts

### GET `/api/v1/alerts/`

List triggered alerts (newest first).

**curl:**
```bash
curl "http://localhost:8080/api/v1/alerts/?limit=10&offset=0"
```

| Query Param | Default | Description |
|-------------|---------|-------------|
| `limit` | `50` | Max rows |
| `offset` | `0` | Pagination offset |

**Response:**
```json
[
  {
    "id": 7,
    "vehicle_id": 1,
    "type": "battery_low",
    "severity": "warning",
    "title": "Low Battery Alert",
    "message": "Battery level dropped to 15%",
    "is_read": false,
    "created_at": "2025-06-01T18:45:00Z"
  }
]
```

### POST `/api/v1/alerts/{alertID}/read`

Mark an alert as read.

**curl:**
```bash
curl -X POST http://localhost:8080/api/v1/alerts/7/read
```

**Response:**
```json
{ "status": "ok" }
```

### GET `/api/v1/alerts/rules`

List all alert rules and their configurations.

**curl:**
```bash
curl http://localhost:8080/api/v1/alerts/rules
```

**Response:**
```json
[
  {
    "id": 1,
    "name": "Low Battery Alert",
    "type": "battery_low",
    "enabled": true,
    "threshold": 20.0,
    "vehicle_id": null,
    "created_at": "2025-01-01T00:00:00Z"
  }
]
```

### PUT `/api/v1/alerts/rules/{ruleID}`

Update an alert rule's enabled status or threshold.

**curl:**
```bash
curl -X PUT http://localhost:8080/api/v1/alerts/rules/1 \
  -H "Content-Type: application/json" \
  -d '{"enabled": true, "threshold": 15.0}'
```

**Request Body:**
```json
{
  "enabled": true,
  "threshold": 15.0
}
```

**Response:** Updated `AlertRule` object.

---

## Geofences

### GET `/api/v1/geofences/`

List all geofences.

**curl:**
```bash
curl http://localhost:8080/api/v1/geofences/
```

**Response:**
```json
[
  {
    "id": 1,
    "name": "Home",
    "latitude": 37.7749,
    "longitude": -122.4194,
    "radius": 100,
    "cost_per_kwh": 0.12,
    "created_at": "2025-01-15T00:00:00Z"
  }
]
```

### POST `/api/v1/geofences/`

Create a new geofence.

**curl:**
```bash
curl -X POST http://localhost:8080/api/v1/geofences/ \
  -H "Content-Type: application/json" \
  -d '{"name": "Office", "latitude": 37.3861, "longitude": -122.0839, "radius": 200, "cost_per_kwh": 0.0}'
```

**Request Body:**
```json
{
  "name": "Office",
  "latitude": 37.3861,
  "longitude": -122.0839,
  "radius": 200,
  "cost_per_kwh": 0.0
}
```

**Response:** `201 Created` with the new `Geofence` object.

### GET `/api/v1/geofences/{geofenceID}`

Get a single geofence by ID.

**curl:**
```bash
curl http://localhost:8080/api/v1/geofences/1
```

**Response:** Single `Geofence` object (same shape as list items).

### PUT `/api/v1/geofences/{geofenceID}`

Update an existing geofence.

**curl:**
```bash
curl -X PUT http://localhost:8080/api/v1/geofences/1 \
  -H "Content-Type: application/json" \
  -d '{"name": "Home", "latitude": 37.7749, "longitude": -122.4194, "radius": 150, "cost_per_kwh": 0.12}'
```

**Request Body:** Full `Geofence` object (same shape as create).

**Response:** Updated `Geofence` object.

### DELETE `/api/v1/geofences/{geofenceID}`

Delete a geofence. Returns **204 No Content**.

**curl:**
```bash
curl -X DELETE http://localhost:8080/api/v1/geofences/1
```

---

## Notifications

### GET `/api/v1/notifications/`

List all notification channels.

**Response:**
```json
[
  {
    "id": 1,
    "name": "My Discord",
    "type": "discord",
    "config": { "webhook_url": "https://discord.com/api/webhooks/..." },
    "enabled": true,
    "created_at": "2025-01-15T00:00:00Z"
  }
]
```

### POST `/api/v1/notifications/`

Create a notification channel.

**Request Body:**
```json
{
  "name": "Slack Alerts",
  "type": "slack",
  "config": { "webhook_url": "https://hooks.slack.com/services/..." },
  "enabled": true
}
```

Supported types: `discord`, `email`, `slack`, `telegram`, `webhook`, `ntfy`, `pushover`

**Response:** `201 Created` with the new `NotificationChannel` object.

### GET `/api/v1/notifications/{channelID}`

Get a single notification channel.

### PUT `/api/v1/notifications/{channelID}`

Update a notification channel.

**Request Body:** Same shape as create.

**Response:** Updated `NotificationChannel` object.

### DELETE `/api/v1/notifications/{channelID}`

Delete a notification channel.

**Response:**
```json
{ "status": "deleted" }
```

### POST `/api/v1/notifications/{channelID}/toggle`

Enable or disable a channel.

**Request Body:**
```json
{ "enabled": false }
```

**Response:**
```json
{ "id": 1, "enabled": false }
```

### POST `/api/v1/notifications/{channelID}/test`

Send a test notification through a channel.

**Response:**
```json
{
  "success": true,
  "message": "Test notification sent successfully"
}
```

### GET `/api/v1/notifications/logs`

Delivery history for all notifications.

| Query Param | Default | Description |
|-------------|---------|-------------|
| `limit` | `50` | Max rows |
| `offset` | `0` | Pagination offset |

**Response:**
```json
[
  {
    "id": 1,
    "channel_id": 1,
    "alert_id": 7,
    "title": "Low Battery Alert",
    "message": "Battery level dropped to 15%",
    "status": "sent",
    "error": null,
    "created_at": "2025-06-01T18:45:00Z",
    "sent_at": "2025-06-01T18:45:01Z"
  }
]
```

### GET `/api/v1/notifications/stats`

Notification delivery statistics.

**Response:**
```json
{
  "total_sent": 142,
  "total_failed": 3,
  "total_pending": 0,
  "channels": 4
}
```

---

## Timeline & Vehicle States

### GET `/api/v1/states/timeline`

Vehicle state changes over time (online, asleep, driving, charging, etc.).

| Query Param | Required | Description |
|-------------|----------|-------------|
| `vehicle_id` | ✅ | Vehicle internal ID |
| `limit` | | Max rows (default 100) |

**Response:**
```json
[
  {
    "id": 201,
    "vehicle_id": 1,
    "state": "driving",
    "start_date": "2025-06-01T09:00:00Z",
    "end_date": "2025-06-01T09:35:00Z",
    "duration_min": 35.0
  }
]
```

### GET `/api/v1/states/summary`

Aggregated time-in-state breakdown.

| Query Param | Default | Description |
|-------------|---------|-------------|
| `vehicle_id` | ✅ required | Vehicle internal ID |
| `start` | 7 days ago | ISO 8601 start date |
| `days` | `7` | Alternative: number of days |

**Response:**
```json
{
  "vehicle_id": 1,
  "period_days": 7,
  "states": {
    "online": 120.5,
    "asleep": 8400.0,
    "driving": 210.0,
    "charging": 480.0
  }
}
```

### GET `/api/v1/states/daily`

Daily state breakdown with minutes per state per day.

| Query Param | Default | Description |
|-------------|---------|-------------|
| `vehicle_id` | ✅ required | Vehicle internal ID |
| `start` | 7 days ago | ISO 8601 start date |
| `days` | `7` | Alternative: number of days |

**Response:**
```json
[
  {
    "date": "2025-06-01",
    "online_min": 18.5,
    "asleep_min": 1200.0,
    "driving_min": 35.0,
    "charging_min": 120.0
  }
]
```

---

## Mileage

### GET `/api/v1/mileage/daily`

Daily mileage records.

| Query Param | Required | Description |
|-------------|----------|-------------|
| `vehicle_id` | ✅ | Vehicle internal ID |
| `limit` | | Max rows (default 30) |

**Response:**
```json
[
  {
    "id": 100,
    "vehicle_id": 1,
    "date": "2025-06-01",
    "distance_km": 45.2,
    "odometer_start": 42100.0,
    "odometer_end": 42145.2,
    "drive_count": 3,
    "energy_used_kwh": 8.5
  }
]
```

### GET `/api/v1/mileage/monthly`

Monthly mileage aggregation.

| Query Param | Required | Description |
|-------------|----------|-------------|
| `vehicle_id` | ✅ | Vehicle internal ID |

**Response:**
```json
[
  {
    "month": "2025-06",
    "distance_km": 1250.0,
    "drive_count": 62,
    "energy_used_kwh": 235.0
  }
]
```

### GET `/api/v1/mileage/stats`

Overall mileage statistics.

| Query Param | Required | Description |
|-------------|----------|-------------|
| `vehicle_id` | ✅ | Vehicle internal ID |

**Response:**
```json
{
  "vehicle_id": 1,
  "total_distance_km": 42150.3,
  "avg_daily_km": 38.5,
  "max_daily_km": 320.0,
  "total_drives": 1850,
  "total_energy_kwh": 7200.0
}
```

---

## Trips

### GET `/api/v1/trips`

List multi-drive trips.

| Query Param | Required | Description |
|-------------|----------|-------------|
| `vehicle_id` | | Filter by vehicle |
| `limit` | | Max rows (default 50) |
| `start_date` | | ISO 8601 start filter |
| `end_date` | | ISO 8601 end filter |

**Response:**
```json
[
  {
    "id": 5,
    "vehicle_id": 1,
    "name": "Road trip to Yosemite",
    "start_date": "2025-05-20T08:00:00Z",
    "end_date": "2025-05-22T18:00:00Z",
    "total_distance_km": 620.0,
    "total_energy_kwh": 105.0,
    "total_cost": 12.60,
    "drive_count": 6,
    "charge_count": 2
  }
]
```

---

## Tire Pressure

### GET `/api/v1/tire-pressure/`

Tire pressure history.

| Query Param | Required | Description |
|-------------|----------|-------------|
| `vehicle_id` | ✅ | Vehicle internal ID |
| `limit` | | Max rows (default 100) |

**Response:**
```json
[
  {
    "id": 50,
    "vehicle_id": 1,
    "front_left": 2.9,
    "front_right": 2.9,
    "rear_left": 3.0,
    "rear_right": 3.0,
    "created_at": "2025-06-01T12:00:00Z"
  }
]
```

### GET `/api/v1/tire-pressure/latest`

Latest tire pressure reading.

| Query Param | Required | Description |
|-------------|----------|-------------|
| `vehicle_id` | ✅ | Vehicle internal ID |

**Response:** Single `TirePressureSnapshot` object.

---

## Motor / Powertrain

### GET `/api/v1/motor?vehicle_id={id}&limit={n}`

Returns motor/powertrain telemetry snapshots for a vehicle.

| Query Param | Required | Description |
|-------------|----------|-------------|
| `vehicle_id` | ✅ | Vehicle database ID |
| `limit` | | Maximum records to return (default 100) |

**Response:** Array of motor snapshots with fields: `di_state`, `di_torque` (Nm), `di_axle_speed` (RPM), `di_stator_temp` (°C), `pedal_position` (%), `brake_pedal`, `lateral_accel` (g), `longitudinal_accel` (g), `vehicle_speed` (km/h), `gear`

### GET `/api/v1/motor/latest?vehicle_id={id}`

Returns the most recent motor snapshot for a vehicle.

| Query Param | Required | Description |
|-------------|----------|-------------|
| `vehicle_id` | ✅ | Vehicle database ID |

**Response:** Single motor snapshot object.

---

## Climate / HVAC

### GET `/api/v1/climate?vehicle_id={id}&limit={n}`

Returns climate/HVAC telemetry snapshots for a vehicle.

| Query Param | Required | Description |
|-------------|----------|-------------|
| `vehicle_id` | ✅ | Vehicle database ID |
| `limit` | | Maximum records to return (default 100) |

**Response:** Array of climate snapshots with fields: `inside_temp` (°C), `outside_temp` (°C), `hvac_power` (kW), `hvac_fan_speed` (0-6), `hvac_left_temp_request` (°C), `hvac_right_temp_request` (°C), `cabin_overheat_mode`, `defrost_mode`, `battery_heater_on`

### GET `/api/v1/climate/latest?vehicle_id={id}`

Returns the most recent climate snapshot for a vehicle.

| Query Param | Required | Description |
|-------------|----------|-------------|
| `vehicle_id` | ✅ | Vehicle database ID |

**Response:** Single climate snapshot object.

---

## Security / Access

### GET `/api/v1/security?vehicle_id={id}&limit={n}`

Returns security/access telemetry events for a vehicle.

| Query Param | Required | Description |
|-------------|----------|-------------|
| `vehicle_id` | ✅ | Vehicle database ID |
| `limit` | | Maximum records to return (default 100) |

**Response:** Array of security events with fields: `locked`, `sentry_mode`, `door_state`, `fd_window`, `fp_window`, `rd_window`, `rp_window`, `homelink_nearby`, `guest_mode`

### GET `/api/v1/security/latest?vehicle_id={id}`

Returns the most recent security event for a vehicle.

| Query Param | Required | Description |
|-------------|----------|-------------|
| `vehicle_id` | ✅ | Vehicle database ID |

**Response:** Single security event object.

---

## Charging Telemetry

### GET `/api/v1/charging-telemetry?vehicle_id={id}&limit={n}`

Returns charging telemetry snapshots with detailed pack, cell, and BMS data.

**curl:**
```bash
curl "http://localhost:8080/api/v1/charging-telemetry?vehicle_id=1&limit=10"
```

| Query Param | Required | Description |
|-------------|----------|-------------|
| `vehicle_id` | ✅ | Vehicle database ID |
| `limit` | | Maximum records to return (default 100) |

**Response:** Array of charging telemetry objects with fields including: `pack_voltage`, `pack_current`, `cell_voltages`, `module_temps`, `bms_state`, `charging_power`, `supercharger_state`, `powershare_status`, and more (55 columns total).

### GET `/api/v1/charging-telemetry/latest?vehicle_id={id}`

Returns the most recent charging telemetry snapshot for a vehicle.

**curl:**
```bash
curl "http://localhost:8080/api/v1/charging-telemetry/latest?vehicle_id=1"
```

| Query Param | Required | Description |
|-------------|----------|-------------|
| `vehicle_id` | ✅ | Vehicle database ID |

**Response:** Single charging telemetry object.

---

## Media

### GET `/api/v1/media?vehicle_id={id}&limit={n}`

Returns media/entertainment snapshots.

| Query Param | Required | Description |
|-------------|----------|-------------|
| `vehicle_id` | ✅ | Vehicle database ID |
| `limit` | | Maximum records to return (default 100) |

**Response:** Array of media snapshot objects with fields: `playback_status`, `volume`, `source`, `artist`, `title`, `album`.

### GET `/api/v1/media/latest?vehicle_id={id}`

Returns the most recent media snapshot for a vehicle.

| Query Param | Required | Description |
|-------------|----------|-------------|
| `vehicle_id` | ✅ | Vehicle database ID |

**Response:** Single media snapshot object.

---

## Vehicle Config

### GET `/api/v1/vehicle-config?vehicle_id={id}&limit={n}`

Returns vehicle configuration snapshots (trim, color, software version).

| Query Param | Required | Description |
|-------------|----------|-------------|
| `vehicle_id` | ✅ | Vehicle database ID |
| `limit` | | Maximum records to return (default 100) |

**Response:** Array of vehicle config snapshot objects.

### GET `/api/v1/vehicle-config/latest?vehicle_id={id}`

Returns the most recent vehicle config snapshot for a vehicle.

| Query Param | Required | Description |
|-------------|----------|-------------|
| `vehicle_id` | ✅ | Vehicle database ID |

**Response:** Single vehicle config snapshot object.

---

## Location Snapshots

### GET `/api/v1/location-snapshots?vehicle_id={id}&limit={n}`

Returns location/navigation snapshots with destination, route, and home/work/favorite indicators.

| Query Param | Required | Description |
|-------------|----------|-------------|
| `vehicle_id` | ✅ | Vehicle database ID |
| `limit` | | Maximum records to return (default 100) |

**Response:** Array of location snapshot objects with fields: `destination_location`, `route_last_updated`, `home_nearby`, `work_nearby`, `favorite_nearby`.

### GET `/api/v1/location-snapshots/latest?vehicle_id={id}`

Returns the most recent location snapshot for a vehicle.

| Query Param | Required | Description |
|-------------|----------|-------------|
| `vehicle_id` | ✅ | Vehicle database ID |

**Response:** Single location snapshot object.

---

## Safety / ADAS

### GET `/api/v1/safety?vehicle_id={id}&limit={n}`

Returns safety and ADAS configuration snapshots.

| Query Param | Required | Description |
|-------------|----------|-------------|
| `vehicle_id` | ✅ | Vehicle database ID |
| `limit` | | Maximum records to return (default 100) |

**Response:** Array of safety snapshot objects with fields: `forward_collision_warning`, `lane_departure_avoidance`, `emergency_lane_departure`, `auto_steer`, `fsd_miles_since_reset`.

### GET `/api/v1/safety/latest?vehicle_id={id}`

Returns the most recent safety snapshot for a vehicle.

| Query Param | Required | Description |
|-------------|----------|-------------|
| `vehicle_id` | ✅ | Vehicle database ID |

**Response:** Single safety snapshot object.

---

## User Preferences

### GET `/api/v1/user-preferences?vehicle_id={id}&limit={n}`

Returns user preference snapshots (units, time format).

| Query Param | Required | Description |
|-------------|----------|-------------|
| `vehicle_id` | ✅ | Vehicle database ID |
| `limit` | | Maximum records to return (default 100) |

**Response:** Array of user preference objects with fields: `distance_unit`, `temperature_unit`, `24_hour_clock`, `charge_current_request`.

### GET `/api/v1/user-preferences/latest?vehicle_id={id}`

Returns the most recent user preferences for a vehicle.

| Query Param | Required | Description |
|-------------|----------|-------------|
| `vehicle_id` | ✅ | Vehicle database ID |

**Response:** Single user preference object.

---

## Drive Positions

### GET `/api/v1/drives/{driveID}/positions`

Returns GPS positions within a drive's time window. Server-side filtered by the drive's start and end timestamps.

**curl:**
```bash
curl http://localhost:8080/api/v1/drives/42/positions
```

**Response:** Array of position objects with latitude, longitude, speed, heading, battery_level, temperatures, etc.

---

## Vampire Drain

### GET `/api/v1/vampire-drain/`

List vampire drain events (energy lost while parked).

| Query Param | Required | Description |
|-------------|----------|-------------|
| `vehicle_id` | ✅ | Vehicle internal ID |
| `limit` | | Max rows |
| `start_date` | | ISO 8601 start filter |
| `end_date` | | ISO 8601 end filter |

**Response:**
```json
[
  {
    "id": 8,
    "vehicle_id": 1,
    "start_date": "2025-06-01T00:00:00Z",
    "end_date": "2025-06-01T08:00:00Z",
    "start_battery": 80,
    "end_battery": 78,
    "battery_lost": 2,
    "range_lost_km": 6.4,
    "duration_hours": 8.0,
    "drain_rate_pct_per_hour": 0.25,
    "outside_temp_avg": 12.0,
    "sentry_mode": true
  }
]
```

### GET `/api/v1/vampire-drain/stats`

Vampire drain statistics.

| Query Param | Required | Description |
|-------------|----------|-------------|
| `vehicle_id` | ✅ | Vehicle internal ID |

**Response:**
```json
{
  "vehicle_id": 1,
  "total_events": 45,
  "avg_drain_rate_pct_per_hour": 0.3,
  "avg_duration_hours": 10.2,
  "total_range_lost_km": 210.0
}
```

---

## Visited Locations

### GET `/api/v1/locations`

Frequently visited locations aggregated from drive data.

| Query Param | Required | Description |
|-------------|----------|-------------|
| `vehicle_id` | | Filter by vehicle |
| `limit` | | Max rows (default 50) |

**Response:**
```json
[
  {
    "id": 1,
    "vehicle_id": 1,
    "address_id": 5,
    "visit_count": 120,
    "total_duration_min": 48000.0,
    "last_visited": "2025-06-01T18:00:00Z"
  }
]
```

---

## Software Updates

### GET `/api/v1/software-updates`

List software update records.

| Query Param | Required | Description |
|-------------|----------|-------------|
| `vehicle_id` | | Filter by vehicle |
| `limit` | | Max rows (default 50) |

**Response:**
```json
[
  {
    "id": 3,
    "vehicle_id": 1,
    "version": "2025.14.6",
    "status": "installed",
    "scheduled_at": "2025-05-28T02:00:00Z",
    "installed_at": "2025-05-28T02:45:00Z",
    "created_at": "2025-05-27T18:00:00Z"
  }
]
```

---

## Chatbot

### POST `/api/v1/chatbot/`

Send a message to the AI chatbot for natural-language queries about your vehicle data.

**Request Body:**
```json
{
  "message": "How much did I spend on charging last month?",
  "session_id": "abc-123"
}
```

**Response:**
```json
{
  "response": "Last month you spent $48.20 across 12 charging sessions, adding a total of 402 kWh.",
  "session_id": "abc-123"
}
```

### GET `/api/v1/chatbot/history`

Get conversation history for a session.

| Query Param | Required | Description |
|-------------|----------|-------------|
| `session_id` | ✅ | Chat session ID |

**Response:**
```json
[
  { "role": "user", "content": "How far did I drive today?", "created_at": "2025-06-01T12:00:00Z" },
  { "role": "assistant", "content": "You drove 42.5 km across 2 trips today.", "created_at": "2025-06-01T12:00:01Z" }
]
```

### GET `/api/v1/chatbot/sessions`

List all chat session IDs.

**Response:**
```json
["abc-123", "def-456", "ghi-789"]
```

---

## Settings

### GET `/api/v1/settings`

Get global application settings.

**curl:**
```bash
curl http://localhost:8080/api/v1/settings
```

**Response:**
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

Update global settings.

**curl:**
```bash
curl -X PUT http://localhost:8080/api/v1/settings \
  -H "Content-Type: application/json" \
  -d '{"unit_of_length": "mi", "unit_of_temp": "F", "preferred_range": "ideal", "language": "en", "base_cost_per_kwh": 0.15}'
```

**Request Body:**
```json
{
  "unit_of_length": "mi",
  "unit_of_temp": "F",
  "preferred_range": "ideal",
  "language": "en",
  "base_cost_per_kwh": 0.15
}
```

**Response:** Updated `Settings` object.

---

## Export

### GET `/api/v1/export/{type}`

Export data as CSV or JSON (synchronous — direct download).

**curl:**
```bash
curl -O "http://localhost:8080/api/v1/export/drives?format=csv&start_date=2025-01-01"
```

| URL Param | Description |
|-----------|-------------|
| `type` | `drives` or `charging` |

| Query Param | Default | Description |
|-------------|---------|-------------|
| `format` | `csv` | `csv` or `json` |
| `start_date` | | ISO 8601 start filter |
| `end_date` | | ISO 8601 end filter |

**Example:** `GET /api/v1/export/drives?format=csv&start_date=2025-01-01`

Returns a downloadable file with `Content-Disposition: attachment` header.

### POST `/api/v1/export/jobs`

Submit an async export job. Processing is handled by the export worker via MQTT.

**curl:**
```bash
curl -X POST http://localhost:8080/api/v1/export/jobs \
  -H "Content-Type: application/json" \
  -d '{"type": "drives", "format": "csv", "start": "2025-01-01", "end": "2025-01-31"}'
```

**Request Body:**
```json
{
  "type": "drives",       // Required: drives, charging, backup, analytics, import_drives, import_charging
  "format": "csv",        // Optional: csv (default) or json
  "vehicle_id": 123,      // Optional: filter to specific vehicle
  "start": "2025-01-01",  // Optional: ISO 8601 date
  "end": "2025-01-31"     // Optional: ISO 8601 date
}
```

**Response (202 Accepted):**
```json
{
  "id": "exp-1234567890",
  "type": "drives",
  "format": "csv",
  "status": "queued",
  "message": "Export job submitted successfully."
}
```

### GET `/api/v1/export/jobs`

List all export jobs (most recent first). Supports `limit` and `offset` query params.

**curl:**
```bash
curl http://localhost:8080/api/v1/export/jobs
```

### GET `/api/v1/export/jobs/{jobID}`

Get the status of a specific export job. Status progresses: `queued` → `processing` → `ready` / `failed`.

**curl:**
```bash
curl http://localhost:8080/api/v1/export/jobs/exp-1234567890
```

**Response:**
```json
{
  "id": "exp-1234567890",
  "type": "drives",
  "format": "csv",
  "status": "ready",
  "file_name": "teslasync-drives.csv",
  "file_size": 45231,
  "record_count": 342,
  "created_at": "2025-01-15T10:00:00Z",
  "completed_at": "2025-01-15T10:00:05Z"
}
```

### GET `/api/v1/export/jobs/{jobID}/download`

Download the completed export file. Returns 404 if the job is not in `ready` status.

**curl:**
```bash
curl -O http://localhost:8080/api/v1/export/jobs/exp-1234567890/download
```

### POST `/api/v1/export/jobs/import`

Submit an async CSV import job. Accepts multipart form with a CSV file.

**curl:**
```bash
curl -X POST http://localhost:8080/api/v1/export/jobs/import \
  -F "type=import_drives" \
  -F "file=@drives.csv"
```

**Form Fields:**
- `type` — `import_drives` or `import_charging`
- `file` — CSV file (max 10 MB)

**Response (202 Accepted):**
```json
{
  "id": "imp-1234567890",
  "type": "import_drives",
  "status": "queued",
  "message": "Import job submitted."
}
```

---

## Backup & Restore

### GET `/api/v1/backup/configs`

List all backup configurations.

**curl:**
```bash
curl http://localhost:8080/api/v1/backup/configs
```

**Response:**
```json
[
  {
    "id": 1,
    "name": "Daily Full Backup",
    "schedule": "0 2 * * *",
    "type": "full",
    "destination": "local",
    "retention_days": 30,
    "enabled": true,
    "created_at": "2025-01-15T00:00:00Z",
    "updated_at": "2025-06-01T00:00:00Z"
  }
]
```

### POST `/api/v1/backup/configs`

Create a new backup configuration.

**curl:**
```bash
curl -X POST http://localhost:8080/api/v1/backup/configs \
  -H "Content-Type: application/json" \
  -d '{"name": "Weekly S3 Backup", "schedule": "0 3 * * 0", "type": "full", "destination": "s3", "retention_days": 90, "enabled": true}'
```

**Request Body:**
```json
{
  "name": "Weekly S3 Backup",
  "schedule": "0 3 * * 0",
  "type": "full",
  "destination": "s3",
  "retention_days": 90,
  "enabled": true
}
```

**Response:** `201 Created` with the new `BackupConfig` object.

### GET `/api/v1/backup/configs/{configID}`

Get a single backup configuration.

**curl:**
```bash
curl http://localhost:8080/api/v1/backup/configs/1
```

**Response:** Single `BackupConfig` object (same shape as list items).

### PUT `/api/v1/backup/configs/{configID}`

Update an existing backup configuration.

**curl:**
```bash
curl -X PUT http://localhost:8080/api/v1/backup/configs/1 \
  -H "Content-Type: application/json" \
  -d '{"name": "Daily Full Backup", "schedule": "0 3 * * *", "type": "full", "destination": "local", "retention_days": 60, "enabled": true}'
```

**Request Body:** Full `BackupConfig` object (same shape as create).

**Response:** Updated `BackupConfig` object.

### DELETE `/api/v1/backup/configs/{configID}`

Delete a backup configuration. Returns **204 No Content**.

**curl:**
```bash
curl -X DELETE http://localhost:8080/api/v1/backup/configs/1
```

### POST `/api/v1/backup/trigger`

Trigger a backup run for an existing configuration.

**curl:**
```bash
curl -X POST http://localhost:8080/api/v1/backup/trigger \
  -H "Content-Type: application/json" \
  -d '{"config_id": 1}'
```

**Request Body:**
```json
{
  "config_id": 1
}
```

**Response:**
```json
{
  "run_id": "bkp-20250601-030000",
  "config_id": 1,
  "status": "running",
  "message": "Backup triggered successfully"
}
```

### POST `/api/v1/backup/quick`

Run a quick one-off backup without a saved configuration.

**curl:**
```bash
curl -X POST http://localhost:8080/api/v1/backup/quick \
  -H "Content-Type: application/json" \
  -d '{"type": "full", "destination": "local"}'
```

**Request Body:**
```json
{
  "type": "full",
  "destination": "local"
}
```

**Response:**
```json
{
  "run_id": "bkp-quick-20250601-143000",
  "status": "running",
  "message": "Quick backup started"
}
```

### GET `/api/v1/backup/runs`

List backup run history.

**curl:**
```bash
curl "http://localhost:8080/api/v1/backup/runs?limit=10&offset=0"
```

| Query Param | Default | Description |
|-------------|---------|-------------|
| `limit` | `50` | Max rows |
| `offset` | `0` | Pagination offset |
| `config_id` | | Filter by config ID |

**Response:**
```json
[
  {
    "id": "bkp-20250601-030000",
    "config_id": 1,
    "type": "full",
    "destination": "local",
    "status": "completed",
    "file_name": "teslasync-backup-20250601.tar.gz",
    "file_size": 15728640,
    "duration_sec": 12,
    "tables_backed_up": 18,
    "total_rows": 125430,
    "started_at": "2025-06-01T03:00:00Z",
    "completed_at": "2025-06-01T03:00:12Z"
  }
]
```

### GET `/api/v1/backup/runs/{runID}/download`

Download a completed backup file.

**curl:**
```bash
curl -O http://localhost:8080/api/v1/backup/runs/bkp-20250601-030000/download
```

**Response:** Binary file download with `Content-Disposition: attachment` header. Returns `404` if the run is not in `completed` status.

### POST `/api/v1/backup/runs/{runID}/verify`

Verify the integrity of a completed backup.

**curl:**
```bash
curl -X POST http://localhost:8080/api/v1/backup/runs/bkp-20250601-030000/verify
```

**Response:**
```json
{
  "run_id": "bkp-20250601-030000",
  "valid": true,
  "checksum": "sha256:a1b2c3d4e5f6...",
  "file_size": 15728640,
  "tables_verified": 18,
  "rows_verified": 125430
}
```

### POST `/api/v1/backup/restore/preview`

Preview what a restore operation would do without applying changes.

**curl:**
```bash
curl -X POST http://localhost:8080/api/v1/backup/restore/preview \
  -H "Content-Type: application/json" \
  -d '{"run_id": "bkp-20250601-030000"}'
```

**Request Body:**
```json
{
  "run_id": "bkp-20250601-030000"
}
```

**Response:**
```json
{
  "run_id": "bkp-20250601-030000",
  "tables": [
    { "name": "vehicles", "backup_rows": 2, "current_rows": 2 },
    { "name": "drives", "backup_rows": 1850, "current_rows": 1900 },
    { "name": "charging_sessions", "backup_rows": 420, "current_rows": 435 }
  ],
  "warnings": [
    "Current database has 65 rows not present in backup (drives, charging_sessions)"
  ]
}
```

### POST `/api/v1/backup/restore`

Restore data from a completed backup run.

**curl:**
```bash
curl -X POST http://localhost:8080/api/v1/backup/restore \
  -H "Content-Type: application/json" \
  -d '{"run_id": "bkp-20250601-030000", "confirm": true}'
```

**Request Body:**
```json
{
  "run_id": "bkp-20250601-030000",
  "confirm": true
}
```

**Response:**
```json
{
  "run_id": "bkp-20250601-030000",
  "status": "restored",
  "tables_restored": 18,
  "rows_restored": 125430,
  "duration_sec": 8
}
```

---

## API Keys

### GET `/api/v1/api-keys`

List all API keys (secrets are masked).

**curl:**
```bash
curl http://localhost:8080/api/v1/api-keys
```

**Response:**
```json
[
  {
    "id": 1,
    "name": "Grafana Dashboard",
    "key_prefix": "tsk_a1b2c3",
    "permissions": ["read:vehicles", "read:drives", "read:charging"],
    "last_used_at": "2025-06-01T12:00:00Z",
    "expires_at": "2026-01-15T00:00:00Z",
    "created_at": "2025-01-15T10:00:00Z"
  }
]
```

### POST `/api/v1/api-keys`

Create a new API key. The full key is only returned once at creation time.

**curl:**
```bash
curl -X POST http://localhost:8080/api/v1/api-keys \
  -H "Content-Type: application/json" \
  -d '{"name": "Home Assistant", "permissions": ["read:vehicles", "read:drives"], "expires_in_days": 365}'
```

**Request Body:**
```json
{
  "name": "Home Assistant",
  "permissions": ["read:vehicles", "read:drives"],
  "expires_in_days": 365
}
```

**Response:**
```json
{
  "id": 2,
  "name": "Home Assistant",
  "key": "tsk_d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9",
  "key_prefix": "tsk_d4e5f6",
  "permissions": ["read:vehicles", "read:drives"],
  "expires_at": "2026-06-01T00:00:00Z",
  "created_at": "2025-06-01T00:00:00Z"
}
```

> ⚠️ **Important:** The `key` field is only returned on creation. Store it securely — it cannot be retrieved again.

### DELETE `/api/v1/api-keys/{keyID}`

Revoke an API key. Returns **204 No Content**.

**curl:**
```bash
curl -X DELETE http://localhost:8080/api/v1/api-keys/2
```

---

## SSE (Server-Sent Events)

### GET `/api/v1/events`

Real-time event stream. Connect with `EventSource` in the browser.

```javascript
const es = new EventSource('/api/v1/events');

es.addEventListener('vehicle_update', (e) => {
  const data = JSON.parse(e.data);
  console.log('Vehicle updated:', data);
});

es.addEventListener('alert', (e) => {
  const data = JSON.parse(e.data);
  console.log('Alert:', data);
});

es.addEventListener('charging_update', (e) => {
  const data = JSON.parse(e.data);
  console.log('Charging:', data);
});
```

**Events emitted:**

| Event | Description |
|-------|-------------|
| `connected` | Sent on initial connection |
| `heartbeat` | Keep-alive every 30 s |
| `vehicle_update` | Vehicle data polled |
| `alert` | Alert rule triggered |
| `charging_update` | Charging session started/stopped/updated |
| `export_status` | Export job status changed (queued/processing/ready/failed) |

---

## Error Responses

All API errors return a consistent JSON structure:

```json
{
  "error": "human-readable error message",
  "code": "MACHINE_READABLE_CODE",
  "category": "error_category"
}
```

| Status | Meaning |
|--------|---------|
| `400` | Bad request / invalid parameters |
| `401` | Authentication required or invalid |
| `403` | Insufficient permissions |
| `404` | Resource not found |
| `409` | Conflict (duplicate resource) |
| `422` | Validation failed |
| `429` | Rate limit exceeded (100 req/min/IP) |
| `500` | Internal server error |
| `502` | Tesla API unavailable |
| `503` | Service temporarily unavailable |

### Error Categories

| Category | Description |
|----------|-------------|
| `authentication` | Auth failures, expired tokens, invalid API keys |
| `vehicle` | Vehicle not found, offline, busy |
| `validation` | Invalid input, missing fields, out of range |
| `database` | DB connection, query, transaction failures |
| `tesla_api` | Tesla API unavailable, rate limited, timeout |
| `backup` | Backup/restore operation failures |
| `rate_limit` | Too many requests |
| `internal` | Internal server errors |

### Common Error Codes

| Code | Category | Status | Description |
|------|----------|--------|-------------|
| `AUTH_TOKEN_EXPIRED` | `authentication` | 401 | Tesla OAuth token has expired, re-authenticate |
| `AUTH_NOT_CONFIGURED` | `authentication` | 401 | No Tesla credentials stored |
| `API_KEY_INVALID` | `authentication` | 401 | API key not found or revoked |
| `API_KEY_EXPIRED` | `authentication` | 401 | API key has passed its expiration date |
| `PERMISSION_DENIED` | `authentication` | 403 | API key lacks required permission |
| `VEHICLE_NOT_FOUND` | `vehicle` | 404 | Vehicle ID does not exist |
| `VEHICLE_OFFLINE` | `vehicle` | 409 | Vehicle is asleep or unreachable |
| `VEHICLE_BUSY` | `vehicle` | 409 | Another command is in progress |
| `VALIDATION_FAILED` | `validation` | 422 | Request body failed validation |
| `MISSING_FIELD` | `validation` | 400 | Required field is missing |
| `INVALID_DATE_RANGE` | `validation` | 400 | Start date is after end date |
| `DB_CONNECTION_FAILED` | `database` | 500 | Could not connect to database |
| `TESLA_API_UNAVAILABLE` | `tesla_api` | 502 | Tesla Fleet API is unreachable |
| `TESLA_API_RATE_LIMITED` | `tesla_api` | 429 | Tesla API rate limit hit |
| `TESLA_API_TIMEOUT` | `tesla_api` | 502 | Tesla API request timed out |
| `BACKUP_NOT_FOUND` | `backup` | 404 | Backup run ID does not exist |
| `BACKUP_IN_PROGRESS` | `backup` | 409 | Another backup is already running |
| `RESTORE_FAILED` | `backup` | 500 | Restore operation encountered an error |
| `RATE_LIMIT_EXCEEDED` | `rate_limit` | 429 | Too many requests from this IP |
| `INTERNAL_ERROR` | `internal` | 500 | Unexpected server error |

### Example Error Responses

**Authentication error:**
```json
{
  "error": "Tesla OAuth token has expired, please re-authenticate",
  "code": "AUTH_TOKEN_EXPIRED",
  "category": "authentication"
}
```

**Validation error:**
```json
{
  "error": "field 'name' is required",
  "code": "MISSING_FIELD",
  "category": "validation"
}
```

**Vehicle error:**
```json
{
  "error": "vehicle is currently asleep, send a wake command first",
  "code": "VEHICLE_OFFLINE",
  "category": "vehicle"
}
```

**Rate limit error:**
```json
{
  "error": "rate limit exceeded, retry after 45 seconds",
  "code": "RATE_LIMIT_EXCEEDED",
  "category": "rate_limit"
}
```

---

## Developer Tools

Built-in utilities for Tesla Fleet API setup and system diagnostics.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/dev-tools/fleet-api-info` | Current Fleet API configuration (base URL, client ID, auth status, regions) |
| GET | `/api/v1/dev-tools/detect-region` | Detect Tesla account region via `/api/1/users/region` |
| POST | `/api/v1/dev-tools/register-partner` | Register partner account in configured region. Body: `{"domain": "your-domain.com"}` |
| GET | `/api/v1/dev-tools/test-api` | Test Tesla Fleet API connectivity and latency |
| GET | `/api/v1/dev-tools/token-info` | Token validity, expiry time, time remaining (no secrets exposed) |
| GET | `/api/v1/dev-tools/db-stats` | Database table row counts and total size |
| GET | `/api/v1/dev-tools/migration-status` | Current database migration version and dirty flag |
| POST | `/api/v1/dev-tools/mqtt-test` | Test MQTT broker connectivity and publish test message |
| GET | `/api/v1/dev-tools/env-check` | Check which required environment variables are set/unset |
| GET | `/api/v1/dev-tools/runtime-info` | Go runtime statistics (goroutines, memory, CPU, uptime) |
| GET | `/api/v1/dev-tools/nearby-charging` | Nearby Superchargers and charging sites via Tesla Fleet API |
| GET | `/api/v1/dev-tools/release-notes` | Firmware update release notes via Tesla Fleet API |
| GET | `/api/v1/dev-tools/recent-alerts` | Vehicle alerts from Tesla (recalls, service reminders) |
| GET | `/api/v1/dev-tools/service-data` | Service history and status via Tesla Fleet API |

### Partner Registration Flow

The partner registration endpoint automates the Tesla Fleet API setup:

1. Obtains a partner token via `client_credentials` grant
2. Calls `POST /api/1/partner_accounts` on the configured Fleet API region
3. Returns the raw Tesla API response

**Prerequisites:**
- Valid `TESLA_CLIENT_ID` and `TESLA_CLIENT_SECRET`
- Public key hosted at `https://YOUR_DOMAIN/.well-known/appspecific/com.tesla.3p.public-key.pem`
- Domain matches `allowed_origin` in Tesla Developer app

### Environment Check Response

The env check endpoint returns the status of 15 environment variables without exposing values:

```json
{
  "variables": {
    "TESLA_CLIENT_ID": "set",
    "TESLA_CLIENT_SECRET": "set",
    "DATABASE_HOST": "set",
    "FLEET_TELEMETRY_ENABLED": "unset",
    ...
  }
}
```
