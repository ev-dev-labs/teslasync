# TeslaSync v0.25.0 Upgrade Notes

## What's New

### Comprehensive Drive Session Tracking

- All telemetry data (speed, power, temperature, tire pressure, SOC, elevation) is now tracked continuously throughout drives
- Drive distance computed from odometer readings (no longer shows 0)
- Start/end addresses automatically resolved via OpenStreetMap Nominatim
- Full drive statistics: speed mean/max/min, range stats, SOC stats, elevation gain/loss

### Enhanced Charging Sessions

- Continuous power, voltage, temperature, and SOC tracking during charges
- Automatic cost calculation based on geofence electricity rates
- Energy estimation from battery % diff when direct signals unavailable
- Location tracking and reverse geocoding for charge locations

### Telemetry Pipeline Improvements

- Graceful shutdown: all background goroutines properly cancelled on SIGTERM
- toFloat ok-pattern: correctly handles actual 0% battery level (no more false negatives)
- Stale session cleanup: drives/charges left open due to disconnects are auto-closed
- Fleet telemetry subscription persistence for audit trail

### UI Enhancements

- Redesigned tire pressure visualization (realistic Model Y SVG)
- Enhanced analytics page (speed distribution, efficiency trends, charging costs)
- Mileage over time graph
- Charging curve with real telemetry data
- Elevation profile with speed overlay
- All unit strings now respect user preferences (no more hardcoded km/mi)

### Security & Performance

- Rate limits on all sensitive endpoints
- N+1 queries consolidated
- LIMIT guards on all GetAll queries
- Geofence spatial index

## Database Migration

Migration 21 adds new columns and tables. The migration runs automatically on startup.

No manual intervention required — existing data is preserved, new columns are nullable.

### New Tables

| Table | Purpose |
|---|---|
| `drive_telemetry_readings` | Continuous drive telemetry (position, speed, power, battery, temps, tires) |
| `charge_telemetry_readings` | Continuous charge telemetry (power, voltage, SOC, temps, location) |
| `fleet_telemetry_subscriptions` | Subscription audit trail |

### New Indexes

| Index | Purpose |
|---|---|
| `idx_geofences_coords` | Spatial lookup optimization |

## New API Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/v1/drives/{driveID}/telemetry` | Continuous telemetry readings for a drive |
| `GET /api/v1/charging/{sessionID}/telemetry` | Continuous telemetry readings for a charge session |

See [API Reference](api-reference.md) for full details.

## Breaking Changes

None. All changes are additive.

## Configuration

No new environment variables or configuration changes required. All features are enabled by default.

### Optional: Nominatim

Address resolution uses the public OpenStreetMap Nominatim API by default. For high-volume deployments, consider self-hosting Nominatim to avoid rate limits. Set `NOMINATIM_URL` environment variable to point to your instance.

## Upgrade Steps

1. Pull the latest image or build from source
2. Start the application — migration 21 runs automatically
3. New drives and charges will immediately benefit from enhanced tracking
4. Existing historical data is preserved; new fields will populate on future sessions
