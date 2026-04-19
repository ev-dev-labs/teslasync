---
description: "Add Tesla energy calendar history endpoints: backup events, energy measurements, and wall connector charging history"
---

# Feature: Tesla Energy Calendar & Telemetry History

## Overview

Fetch three historical data endpoints from Tesla Fleet API, persist to DB, and display
as charts on the energy site detail page:

1. **Backup History** — off-grid event durations
2. **Energy History** — solar/battery/grid energy measurements over time
3. **Charging History** — wall connector charging sessions (watt hours)

## Tesla Fleet API Endpoints

### 1. Backup History
```
GET /api/1/energy_sites/{id}/calendar_history?kind=backup&start_date={}&end_date={}&period={}&time_zone={}
```
Returns off-grid (backup) event durations in seconds.

### 2. Energy History
```
GET /api/1/energy_sites/{id}/calendar_history?kind=energy&start_date={}&end_date={}&period={}&time_zone={}
```
Returns energy measurements (solar, battery, grid) aggregated by period (day/week/month).
Values in **watt hours**.

### 3. Wall Connector Charging History
```
GET /api/1/energy_sites/{id}/telemetry_history?kind=charge&start_date={}&end_date={}&time_zone={}
```
Returns wall connector charging session telemetry. Values in **watt hours**.

### Common Parameters
- `start_date` / `end_date`: ISO 8601 date (e.g., `2026-01-01`)
- `period`: `day`, `week`, `month`, `year` (calendar_history only)
- `time_zone`: IANA timezone (e.g., `America/Los_Angeles`)

## Step 1 — Database Migration

Create `migrations/000104_add_tesla_energy_history.up.sql`:

```sql
-- Energy history (daily/weekly/monthly aggregates)
CREATE TABLE IF NOT EXISTS tesla_energy_history (
    id                  BIGSERIAL PRIMARY KEY,
    energy_site_id      BIGINT NOT NULL,
    period              TEXT NOT NULL,
    timestamp           TIMESTAMPTZ NOT NULL,
    solar_energy        DOUBLE PRECISION,
    battery_energy_in   DOUBLE PRECISION,
    battery_energy_out  DOUBLE PRECISION,
    grid_energy_in      DOUBLE PRECISION,
    grid_energy_out     DOUBLE PRECISION,
    consumer_energy     DOUBLE PRECISION,
    raw_json            JSONB NOT NULL DEFAULT '{}',
    fetched_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_energy_history_site ON tesla_energy_history (energy_site_id, period, timestamp DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_energy_history_unique ON tesla_energy_history (energy_site_id, period, timestamp);

-- Backup events
CREATE TABLE IF NOT EXISTS tesla_energy_backup_events (
    id                  BIGSERIAL PRIMARY KEY,
    energy_site_id      BIGINT NOT NULL,
    timestamp           TIMESTAMPTZ NOT NULL,
    duration_seconds    INTEGER NOT NULL DEFAULT 0,
    raw_json            JSONB NOT NULL DEFAULT '{}',
    fetched_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_energy_backup_site ON tesla_energy_backup_events (energy_site_id, timestamp DESC);

-- Wall connector charging history
CREATE TABLE IF NOT EXISTS tesla_energy_charging_history (
    id                  BIGSERIAL PRIMARY KEY,
    energy_site_id      BIGINT NOT NULL,
    din                 TEXT,
    timestamp           TIMESTAMPTZ NOT NULL,
    energy_wh           DOUBLE PRECISION,
    raw_json            JSONB NOT NULL DEFAULT '{}',
    fetched_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_energy_charging_site ON tesla_energy_charging_history (energy_site_id, timestamp DESC);
```

And matching `.down.sql`:
```sql
DROP TABLE IF EXISTS tesla_energy_charging_history;
DROP TABLE IF EXISTS tesla_energy_backup_events;
DROP TABLE IF EXISTS tesla_energy_history;
```

## Step 2 — Backend: Add Tesla client methods

In `internal/tesla/client.go`:

```go
// GetEnergySiteCalendarHistory calls GET /api/1/energy_sites/{id}/calendar_history.
// kind: "backup" or "energy". period: "day", "week", "month", "year".
func (c *Client) GetEnergySiteCalendarHistory(ctx context.Context, energySiteID int64, kind, startDate, endDate, period, timeZone string) ([]byte, int, error) {
    path := fmt.Sprintf("/api/1/energy_sites/%d/calendar_history?kind=%s&start_date=%s&end_date=%s&period=%s&time_zone=%s",
        energySiteID, kind, startDate, endDate, period, url.QueryEscape(timeZone))
    return c.doRequest(ctx, http.MethodGet, path, nil)
}

// GetEnergySiteTelemetryHistory calls GET /api/1/energy_sites/{id}/telemetry_history.
func (c *Client) GetEnergySiteTelemetryHistory(ctx context.Context, energySiteID int64, kind, startDate, endDate, timeZone string) ([]byte, int, error) {
    path := fmt.Sprintf("/api/1/energy_sites/%d/telemetry_history?kind=%s&start_date=%s&end_date=%s&time_zone=%s",
        energySiteID, kind, startDate, endDate, url.QueryEscape(timeZone))
    return c.doRequest(ctx, http.MethodGet, path, nil)
}
```

## Step 3 — Backend: Add repositories

Create repos for each table:
- `TeslaEnergyHistoryRepo` — upsert by (site_id, period, timestamp)
- `TeslaEnergyBackupEventRepo` — insert new events
- `TeslaEnergyChargingHistoryRepo` — insert new entries

## Step 4 — Backend: Add handler methods

- `EnergyHistory(w, r)` — query params: `period`, `since`, `until`
- `RefreshEnergyHistory(w, r)` — fetch from Tesla with date range, upsert to DB
- `BackupHistory(w, r)` / `RefreshBackupHistory(w, r)` — same pattern
- `ChargingHistory(w, r)` / `RefreshChargingHistory(w, r)` — same pattern

## Step 5 — Backend: Wire routes

```go
r.Route("/tesla/energy-sites/{siteID}", func(r chi.Router) {
    r.Get("/energy-history", handler.EnergyHistory)
    r.Post("/energy-history/refresh", handler.RefreshEnergyHistory)
    r.Get("/backup-history", handler.BackupHistory)
    r.Post("/backup-history/refresh", handler.RefreshBackupHistory)
    r.Get("/charging-history", handler.ChargingHistory)
    r.Post("/charging-history/refresh", handler.RefreshChargingHistory)
})
```

## Step 6 — Frontend: Add hooks

```typescript
export function useTeslaEnergyHistory(siteId?: number, period = 'day', since?: string, until?: string) {
    return useQuery({
        queryKey: ['tesla-energy-history', siteId, period, since, until],
        queryFn: () => request<TeslaEnergyHistoryEntry[]>(
            `/tesla/energy-sites/${siteId}/energy-history?period=${period}&since=${since}&until=${until}`
        ),
        enabled: !!siteId,
        staleTime: 5 * 60_000,
    });
}

export function useTeslaBackupHistory(siteId?: number, since?: string, until?: string) {
    return useQuery({
        queryKey: ['tesla-backup-history', siteId, since, until],
        queryFn: () => request<TeslaBackupEvent[]>(
            `/tesla/energy-sites/${siteId}/backup-history?since=${since}&until=${until}`
        ),
        enabled: !!siteId,
        staleTime: 5 * 60_000,
    });
}

export function useTeslaChargingHistory(siteId?: number, since?: string, until?: string) {
    return useQuery({
        queryKey: ['tesla-charging-history', siteId, since, until],
        queryFn: () => request<TeslaChargingHistoryEntry[]>(
            `/tesla/energy-sites/${siteId}/charging-history?since=${since}&until=${until}`
        ),
        enabled: !!siteId,
        staleTime: 5 * 60_000,
    });
}
```

## Step 7 — Frontend: Display

Add to the energy site detail page:
- **Energy History Chart** — stacked area chart: solar (yellow), battery in/out (green/red), grid in/out (blue/orange), consumption (white). Period selector (day/week/month).
- **Backup Events Timeline** — timeline component showing off-grid events with duration
- **Wall Connector Charging** — bar chart showing daily charging energy (kWh)
- Date range picker for all three sections

## Verification

```bash
go build ./...
cd web && npx tsc --noEmit
ls migrations/000104_add_tesla_energy_history.*
grep -n "energy-history\|backup-history\|charging-history" internal/api/router.go
```
