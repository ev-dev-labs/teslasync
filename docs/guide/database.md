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

<div id="diagram-container" style="position: relative; width: 100%; height: 80vh; border: 1px solid var(--vp-c-divider); border-radius: 12px; overflow: hidden; margin-top: 16px;">
  <iframe
    id="diagram-iframe"
    src="/teslasync/database-diagram.html"
    style="width: 100%; height: 100%; border: none;"
    title="TeslaSync Database Diagram"
    loading="lazy"
    allowfullscreen
  ></iframe>
  <button
    id="fullscreen-btn"
    onclick="(function(){var c=document.getElementById('diagram-container');if(!c._fsInit){c._fsInit=true;document.addEventListener('fullscreenchange',function(){var fs=!!document.fullscreenElement;c.style.height=fs?'100vh':'80vh';c.style.borderRadius=fs?'0':'12px';document.getElementById('fs-label').textContent=fs?'Exit Fullscreen':'Fullscreen';document.getElementById('fs-icon-expand').style.display=fs?'none':'block';document.getElementById('fs-icon-shrink').style.display=fs?'block':'none'})}if(document.fullscreenElement){document.exitFullscreen()}else{c.requestFullscreen()}})()"
    style="position: absolute; top: 10px; right: 10px; z-index: 10; background: rgba(15,16,32,0.85); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; padding: 6px 14px; cursor: pointer; font-size: 14px; backdrop-filter: blur(8px); display: flex; align-items: center; gap: 6px; transition: all 0.2s;"
    onmouseover="this.style.background='rgba(99,102,241,0.8)'"
    onmouseout="this.style.background='rgba(15,16,32,0.85)'"
    title="Toggle fullscreen"
  >
    <svg id="fs-icon-expand" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/></svg>
    <svg id="fs-icon-shrink" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none"><path d="M4 14h6v6m10-10h-6V4m0 6l7-7M3 21l7-7"/></svg>
    <span id="fs-label">Fullscreen</span>
  </button>
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

## Migrations

TeslaSync uses `golang-migrate` for schema versioning. All 39 migrations run automatically on startup.

### Recent Migrations (030–039)

These migrations were added for the CEP Rule Engine, signal coverage, and state machine features:

| Migration | Description |
|-----------|-------------|
| **030** | Add vehicle state + config columns to `vehicle_live_state` |
| **031** | Add `decimal_precision` setting |
| **032** | Seed `software_updates` from `vehicle_config_snapshots` |
| **033** | Create enriched views (`v_drives`, `v_charging_sessions`) with NULLIF for zero-value protection |
| **034** | Add state machine persistence columns (`last_gear`, `last_speed_time`) to `vehicle_live_state` |
| **035** | Add 158 columns to `vehicle_live_state` for 100% signal coverage (229/230 signals) |
| **036** | CEP Rule Engine: add `conditions` (JSONB), `cooldown_min`, `severity`, `msg_template`, `notify_channels`, `tags`, `fire_count`, `last_fired_at` to `alert_rules` |
| **037** | Fix column types: boolean → varchar for enum signals (e.g., `HvacAutoModeState`) |
| **038** | Fix `vehicle_config` column types: boolean → varchar |
| **039** | Add `quiet_hours_start`, `quiet_hours_end`, `quiet_hours_enabled`, `alert_digest_mode` to `settings` |

### vehicle_live_state

The `vehicle_live_state` table stores the **always-complete vehicle state** — one row per vehicle, UPSERT'd every 5 seconds from the in-memory SignalStore. It has **236 columns** (77 original + 158 added in migration 035) covering all Tesla Fleet Telemetry signal categories.

This table enables:
- **Pod restart recovery** — `LoadFromDB()` restores the SignalStore from the last flush
- **Historical snapshots** — state at the time of the last telemetry flush
- **CEP evaluation** — rules can reference any persisted signal
