# Vehicle Tracking & Live Map

TeslaSync provides comprehensive vehicle tracking with real-time GPS positioning, drive history, and an interactive map.

## Live Map

The **Live Map** page (`/live`) displays all your vehicles on an interactive [Leaflet](https://leafletjs.com/) map with real-time position updates.

### Features

- **Real-time GPS markers** — Vehicle positions update via SSE every 15 seconds
- **Vehicle info popups** — Click a marker to see battery, speed, range, and state
- **Drive route replay** — View historical drive routes overlaid on the map
- **Heatmap layer** — Toggle a heatmap showing frequently visited locations (using `leaflet.heat`)
- **Multiple tile layers** — Switch between standard, satellite, and dark map styles
- **Auto-center** — Map automatically centers on your fleet's bounding box

### Map Controls

| Control | Action |
|---------|--------|
| **Zoom** | Mouse wheel or +/- buttons |
| **Pan** | Click and drag |
| **Center on vehicle** | Click the vehicle marker |
| **Toggle heatmap** | Button in the map toolbar |
| **Toggle route** | Select a drive to overlay its route |
| **Full screen** | Button in the top-right corner |

### Vehicle Markers

Each vehicle is shown as a marker on the map with visual indicators:

| Marker State | Color | Description |
|-------------|-------|-------------|
| **Online/Parked** | Green | Vehicle is awake and stationary |
| **Driving** | Blue (animated) | Vehicle is moving, marker pulses |
| **Charging** | Amber | Vehicle is plugged in and charging |
| **Asleep** | Gray | Vehicle is in sleep mode |
| **Offline** | Red | Vehicle is unreachable |

## Vehicle Detail Page

The **Vehicle Detail** page (`/vehicles/:id`) provides a deep dive into a single vehicle:

### Vehicle Overview

- **Display name**, model, VIN, exterior color, wheel type
- **Current state** — Online, asleep, driving, charging
- **Battery level** with visual gauge
- **Rated and ideal range** in configured units (km/miles)
- **Odometer** reading
- **Software version** with update status

### Vehicle Visualization

The `TeslaCarViz` component renders a visual representation of the vehicle showing:

- Door lock status (locked/unlocked icons)
- Climate on/off indicator
- Sentry mode status
- Frunk/trunk open status
- Tire pressure indicators (if available)
- Charging port status

### Current State Snapshot

Live telemetry data displayed in a grid:

| Metric | Source |
|--------|--------|
| Battery Level | `battery_level` (0–100%) |
| Rated Range | `rated_range` (km) |
| Speed | `speed` (km/h) |
| Power | `power` (kW, negative = regen) |
| Inside Temp | `inside_temp` (°C) |
| Outside Temp | `outside_temp` (°C) |
| Climate | `is_climate_on` (on/off) |
| Locked | `is_locked` (yes/no) |
| Sentry Mode | `sentry_mode` (on/off) |
| Charging | `is_charging` (yes/no) |
| GPS | `latitude`, `longitude` |

### GPS Position History

View historical positions for a vehicle within a date range:

```
GET /api/v1/vehicles/{vehicleID}/positions?start=2024-01-01&end=2024-01-31
```

The response includes timestamped positions that can be plotted on the map for route visualization.

## Drives

The **Drives** page (`/drives`) shows a complete history of all drives across your fleet.

### Drive List

A sortable, filterable table showing:

| Column | Description |
|--------|-------------|
| **Vehicle** | Display name |
| **Date** | Start date and time |
| **Duration** | Drive duration in minutes |
| **Distance** | Distance traveled (km/mi) |
| **Start → End** | Start and end addresses |
| **Battery** | Start and end battery levels |
| **Range** | Start and end rated range |
| **Max Speed** | Maximum speed during the drive |
| **Efficiency** | Wh/km or Wh/mi |

### Drive Detail

Click any drive to see the **Drive Detail** page (`/drives/:id`) with:

- **Route map** — The drive path plotted on a Leaflet map
- **Speed chart** — Speed over time (Recharts line chart)
- **Power chart** — Power consumption over time (positive = consumption, negative = regen)
- **Elevation chart** — Elevation profile of the route
- **Temperature** — Inside/outside temperature during the drive
- **Battery drain** — Battery level from start to end

### Drive Detection

The backend worker automatically detects drives by monitoring:

1. **Start condition:** Vehicle speed > 0 for consecutive polls
2. **End condition:** Vehicle speed = 0 for consecutive polls
3. A drive record is created with start/end positions, addresses, and telemetry

## Remote Commands

From the **Commands** page (`/commands`) or the vehicle detail page, you can send remote commands:

| Command | Description |
|---------|-------------|
| **Lock** | Lock all doors |
| **Unlock** | Unlock all doors |
| **Climate On** | Start climate control |
| **Climate Off** | Stop climate control |
| **Start Charge** | Begin charging |
| **Stop Charge** | Stop charging |
| **Open Frunk** | Open the front trunk |
| **Open Trunk** | Open the rear trunk |
| **Sentry On** | Enable sentry mode |
| **Sentry Off** | Disable sentry mode |
| **Horn** | Honk the horn |
| **Flash** | Flash the headlights |
| **Set Speed Limit** | Set valet speed limit |
| **Wake** | Wake the vehicle from sleep |

Commands are sent via:

```
POST /api/v1/vehicles/{vehicleID}/command
Content-Type: application/json

{ "command": "lock" }
```

## MQTT Integration

All vehicle telemetry is published to MQTT for integration with home automation systems like Home Assistant:

```
Topic: teslasync/vehicles/{VIN}/{metric}

Examples:
  teslasync/vehicles/5YJ3E1EA5KF123456/battery_level → 85
  teslasync/vehicles/5YJ3E1EA5KF123456/latitude → 37.7749
  teslasync/vehicles/5YJ3E1EA5KF123456/speed → 0
  teslasync/vehicles/5YJ3E1EA5KF123456/is_locked → true
```

Subscribe with any MQTT client:

```bash
mosquitto_sub -h localhost -p 1883 -t "teslasync/vehicles/#" -v
```

## Vehicle State Timeline

The **Timeline** page (`/timeline`) shows state transitions over time:

- When the vehicle went online, asleep, or offline
- Driving and charging sessions overlaid
- Color-coded blocks for easy visualization

API endpoints:

```
GET /api/v1/states/timeline?vehicle_id=123&start=2024-01-01&end=2024-01-31
GET /api/v1/states/summary?vehicle_id=123
GET /api/v1/states/daily?vehicle_id=123
```
