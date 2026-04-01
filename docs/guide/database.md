# Database Schema

Interactive visual diagram of the complete TeslaSync database — **47 tables**, **778 columns**, and **37 foreign key relationships**.

## Features

- 🎨 **Color-coded** by domain — Core, Drives, Charging, Snapshots, Alerts, Geofences, Commands, Fleet, Audit, Export, Efficiency
- 🔑 **PK / FK indicators** on every column with type and nullability
- ➡️ **Relationship lines** — bezier curves showing all foreign key connections
- 🔍 **Search** — filter tables or columns by name
- 🖱️ **Interactive** — drag tables to rearrange, scroll to zoom, drag background to pan
- ✨ **Hover highlighting** — hover a table to see only its relationships (dims unrelated tables)
- 🗺️ **Minimap** — bottom-right corner for quick navigation

## Interactive Diagram

<div style="position: relative; width: 100%; height: 80vh; border: 1px solid var(--vp-c-divider); border-radius: 12px; overflow: hidden; margin-top: 16px;">
  <iframe
    src="/teslasync/database-diagram.html"
    style="width: 100%; height: 100%; border: none;"
    title="TeslaSync Database Diagram"
    loading="lazy"
  ></iframe>
</div>

::: tip Navigation
- **Zoom**: Scroll wheel or use the + / − buttons in the toolbar
- **Pan**: Click and drag on the background
- **Move tables**: Click and drag any table header
- **Search**: Use the search box in the toolbar to filter by table or column name
- **Highlight**: Hover over any table to see its foreign key relationships
:::

## Domain Groups

| Group | Color | Description |
|-------|-------|-------------|
| **Core** | 🔵 Blue | Vehicles, tokens, settings, addresses, API keys |
| **Drives** | 🟢 Green | Drives, positions, telemetry readings, trips, mileage |
| **Charging** | 🟡 Amber | Charging sessions, charge telemetry, charging data |
| **Snapshots** | 🟣 Purple | Battery, tire pressure, climate, vehicle state, motor, media, location, safety |
| **Alerts** | 🔴 Red | Alert rules, alerts, notification channels & logs |
| **Geofences** | 🩵 Cyan | Geofences and geofence events |
| **Commands** | 🟠 Orange | Command queue and command logs |
| **Fleet** | 🩷 Pink | Fleet telemetry subscriptions |
| **Audit** | ⚫ Gray | Audit logs, API call logs |
| **Export** | 🟩 Lime | Export jobs |
| **Efficiency** | 🩵 Teal | Efficiency factors |

## Key Relationships

The central table is **`vehicles`** — nearly every other table references it via `vehicle_id`.

**Core chains:**
- `vehicles` → `drives` → `drive_telemetry_readings`
- `vehicles` → `charging_sessions` → `charge_telemetry_readings`
- `vehicles` → `positions` (partitioned by month)
- `vehicles` → all snapshot tables (battery, tire pressure, climate, etc.)
- `drives` → `addresses` (start/end location)
- `trips` → `trip_drives` → `drives`
- `geofences` → `geofence_events` → `vehicles`
