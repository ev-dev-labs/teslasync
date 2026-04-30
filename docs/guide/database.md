# Database Schema

TeslaSync stores relational and time-series data in PostgreSQL/TimescaleDB. The interactive diagram below is preserved for schema exploration; verify exact table counts against your checked-out migrations because the schema changes frequently.

## Features

- 🎨 **Color-coded** by domain — Core, Drives, Charging, Snapshots, Alerts, Geofences, Commands, Fleet, Audit, Export, Efficiency
- 🔑 **PK / FK indicators** on every column with type and nullability
- ➡️ **Relationship lines** showing foreign key connections
- 🔍 **Search** tables or columns by name
- 🖱️ **Interactive** drag, zoom, pan, and rearrange
- ✨ **Hover highlighting** for relationship focus
- 🗺️ **Minimap** for navigation

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
- **Zoom**: Scroll wheel or the diagram controls
- **Pan**: Click and drag the background
- **Move tables**: Drag table headers
- **Search**: Use the search box to filter tables/columns
- **Highlight**: Hover a table to focus its relationships
:::

## Storage domains

| Domain | Tables and data |
|---|---|
| Core | vehicles, settings, tokens, addresses, API keys |
| Live state | `vehicle_live_state`, Redis signal cache, SignalStore warm-start from Redis/signal history |
| Time-series | positions, signal logs, telemetry snapshots, continuous aggregates |
| Drives | drives, drive telemetry, trip grouping, route replay |
| Charging | charging sessions, charging telemetry, Tesla charging invoices/sessions |
| Analytics | daily/hourly aggregates, cost, efficiency, battery, route metrics |
| Operations | API logs, audit logs, exports, backup history, repair jobs |
| Alerts | rules, alerts, notifications, automations, webhooks |

## Migrations

Migrations live in the root `migrations/` directory and run automatically on API startup. The current root sequence is squashed around a typed baseline and continues through recent function, continuous aggregate, API log, and charging-spec migrations.

Use these checks before writing schema-dependent docs or SQL:

```bash
Get-ChildItem migrations -Filter '*.up.sql' | Sort-Object Name | Select-Object -Last 10
```

```sql
SELECT version, dirty FROM schema_migrations;
SELECT extname FROM pg_extension WHERE extname IN ('timescaledb', 'vector', 'pg_stat_statements');
```

## TimescaleDB and pgvector

The default Compose stack uses `timescale/timescaledb-ha:pg17`. TimescaleDB supports hypertables/continuous aggregates for telemetry analytics, and pgvector supports embedded search/chatbot capabilities.

## Current-state rule

For current vehicle state, prefer `vehicle_live_state` and the `/vehicles/{id}/state` API. Historical snapshot tables and signal logs are for charts, diagnostics, and audits; they should not be treated as the freshest source for live UI decisions.
