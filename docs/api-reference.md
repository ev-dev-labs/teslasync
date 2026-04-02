# TeslaSync API Reference — Drive & Charging Enhancements

## Drive Endpoints

### GET /api/v1/drives/{driveID}/telemetry

Returns continuous telemetry readings recorded during a drive session.

**Response**: Array of `DriveTelemetryReading` objects with fields:

| Category | Fields |
|---|---|
| Position | `latitude`, `longitude`, `elevation`, `heading`, `odometer` |
| Motion | `speed`, `power` |
| Battery | `battery_level`, `soc`, `usable_soc` |
| Range | `rated_range`, `ideal_range`, `est_range` |
| Temperature | `inside_temp`, `outside_temp`, `driver_temp`, `passenger_temp` |
| Climate | `fan_status`, `is_climate_on` |
| Tires | `tire_pressure_fl`, `tire_pressure_fr`, `tire_pressure_rl`, `tire_pressure_rr` |
| Battery Heater | `battery_heater_on` |
| Timestamp | `created_at` |

**Example Request:**

```
GET /api/v1/drives/42/telemetry
```

**Example Response:**

```json
[
  {
    "latitude": 37.7749,
    "longitude": -122.4194,
    "elevation": 16.0,
    "heading": 45.2,
    "odometer": 12345.6,
    "speed": 35.5,
    "power": 15.2,
    "battery_level": 72.0,
    "soc": 72.0,
    "usable_soc": 71.5,
    "rated_range": 210.5,
    "ideal_range": 225.0,
    "est_range": 198.3,
    "inside_temp": 22.0,
    "outside_temp": 18.5,
    "driver_temp": 22.0,
    "passenger_temp": 21.5,
    "fan_status": 3,
    "is_climate_on": true,
    "tire_pressure_fl": 2.9,
    "tire_pressure_fr": 2.9,
    "tire_pressure_rl": 3.0,
    "tire_pressure_rr": 3.0,
    "battery_heater_on": false,
    "created_at": "2025-07-18T10:30:00Z"
  }
]
```

---

### Enhanced Drive Object

Drives now include these additional fields beyond the base drive record:

| Category | Fields | Description |
|---|---|---|
| Odometer | `start_odometer`, `end_odometer` | Odometer readings at drive start/end |
| Speed Stats | `speed_avg`, `speed_min` | Average and minimum speed (`speed_max` was existing) |
| Rated Range | `start_rated_range`, `end_rated_range`, `rated_range_avg`, `rated_range_max`, `rated_range_min` | Rated range statistics |
| Ideal Range | `start_ideal_range`, `end_ideal_range`, `ideal_range_avg`, `ideal_range_max`, `ideal_range_min` | Ideal range statistics |
| Est. Range | `start_est_range`, `end_est_range`, `est_range_avg`, `est_range_max`, `est_range_min` | Estimated range statistics |
| SOC | `soc_start`, `soc_end`, `soc_avg`, `soc_max`, `soc_min` | State of charge statistics |
| Usable SOC | `usable_soc_start`, `usable_soc_end`, `usable_soc_avg`, `usable_soc_max`, `usable_soc_min` | Usable SOC statistics |
| Elevation | `elevation_start`, `elevation_end`, `elevation_gain`, `elevation_loss` | Elevation tracking |
| Temperature | `driver_temp_avg`, `passenger_temp_avg` | Driver/passenger temp averages (`inside_temp_avg`, `outside_temp_avg` were existing) |
| Battery Heater | `battery_heater_on` | Battery heater status during drive |
| Address | `start_address`, `end_address` | Reverse geocoded via Nominatim |
| Coordinates | `start_latitude`, `start_longitude`, `end_latitude`, `end_longitude` | Start/end coordinates |

---

## Charging Endpoints

### GET /api/v1/charging/{sessionID}/telemetry

Returns continuous telemetry readings recorded during a charging session.

**Response**: Array of `ChargeTelemetryReading` objects with fields:

| Category | Fields |
|---|---|
| Battery | `battery_level`, `soc` |
| Power | `power_kw`, `voltage`, `current_amps`, `phases` |
| Energy | `energy_added` |
| Range | `rated_range`, `ideal_range`, `est_range` |
| Temperature | `inside_temp`, `outside_temp`, `battery_temp` |
| Location | `latitude`, `longitude` |
| Charge Rate | `charge_rate` |
| Timestamp | `created_at` |

**Example Request:**

```
GET /api/v1/charging/15/telemetry
```

**Example Response:**

```json
[
  {
    "battery_level": 45.0,
    "soc": 45.0,
    "power_kw": 48.5,
    "voltage": 400,
    "current_amps": 121.25,
    "phases": 3,
    "energy_added": 12.5,
    "rated_range": 135.0,
    "ideal_range": 142.0,
    "est_range": 128.0,
    "inside_temp": 20.0,
    "outside_temp": 15.5,
    "battery_temp": 28.0,
    "latitude": 37.7749,
    "longitude": -122.4194,
    "charge_rate": 48.5,
    "created_at": "2025-07-18T14:00:00Z"
  }
]
```

---

### Enhanced ChargingSession Object

Charging sessions now include these additional fields:

| Field | Description |
|---|---|
| `latitude` | Charging location latitude |
| `longitude` | Charging location longitude |
| `location_name` | Reverse geocoded location name |
| `inside_temp_avg` | Average inside temperature during charge |
| `outside_temp_avg` | Average outside temperature during charge |

---

## Database Migration 21

Migration 21 adds the following schema changes:

### New Tables

| Table | Description |
|---|---|
| `drive_telemetry_readings` | Continuous telemetry data recorded during drives (position, speed, power, battery, temperature, tire pressure, etc.) |
| `charge_telemetry_readings` | Continuous telemetry data recorded during charging sessions (power, voltage, SOC, temperature, location) |
| `fleet_telemetry_subscriptions` | Audit trail for fleet telemetry subscription configurations |

### New Indexes

| Index | Table | Columns | Purpose |
|---|---|---|---|
| `idx_geofences_coords` | `geofences` | `latitude`, `longitude` | Spatial lookup optimization for `FindByCoordinates` |

### New Columns on Existing Tables

Drive and charging session tables have been extended with the additional fields documented above. All new columns are nullable to preserve backward compatibility with existing data.
