---
description: "Add Tesla energy live status endpoint: fetch real-time power flow from Powerwall/Solar, persist to DB"
---

# Feature: Tesla Energy Live Status (`/energy_sites/{id}/live_status`)

## Overview

Fetch `GET /api/1/energy_sites/{energy_site_id}/live_status` from Tesla Fleet API to get
real-time power flow data — solar production, battery charge/discharge, grid import/export,
and home consumption. Persist snapshots to DB for historical charting and serve latest to frontend.

## Tesla Fleet API

```
GET /api/1/energy_sites/{energy_site_id}/live_status
```

**Response** (example):
```json
{
  "response": {
    "solar_power": 4520,
    "energy_left": 10500.0,
    "total_pack_energy": 13500,
    "percentage_charged": 77.8,
    "battery_power": -1200,
    "load_power": 3320,
    "grid_power": 0,
    "grid_services_power": 0,
    "generator_power": 0,
    "grid_services_active": false,
    "grid_status": "Active",
    "backup_capable": true,
    "storm_mode_active": false,
    "timestamp": "2026-04-18T10:30:00-07:00",
    "wall_connectors": [
      {
        "din": "1234567-02-A--T12345",
        "wall_connector_state": 4,
        "wall_connector_power": 0,
        "wall_connector_fault_state": 2
      }
    ]
  }
}
```

Power values in **watts**. `battery_power` negative = charging, positive = discharging.

## Step 1 — Database Migration

Create `migrations/000103_add_tesla_energy_live_status.up.sql`:

```sql
CREATE TABLE IF NOT EXISTS tesla_energy_live_status (
    id                  BIGSERIAL PRIMARY KEY,
    energy_site_id      BIGINT NOT NULL,
    solar_power         DOUBLE PRECISION,
    battery_power       DOUBLE PRECISION,
    load_power          DOUBLE PRECISION,
    grid_power          DOUBLE PRECISION,
    grid_services_power DOUBLE PRECISION,
    energy_left         DOUBLE PRECISION,
    total_pack_energy   DOUBLE PRECISION,
    percentage_charged  DOUBLE PRECISION,
    grid_status         TEXT,
    backup_capable      BOOLEAN,
    storm_mode_active   BOOLEAN,
    raw_json            JSONB NOT NULL DEFAULT '{}',
    timestamp           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fetched_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_energy_live_status_site ON tesla_energy_live_status (energy_site_id, timestamp DESC);
```

And matching `.down.sql`:
```sql
DROP TABLE IF EXISTS tesla_energy_live_status;
```

> **Note:** Unlike other tables, this stores **every snapshot** for historical charting
> (power flow over time). Consider adding a retention policy or partitioning for large datasets.

## Step 2 — Backend: Add model

In `internal/models/models.go`:

```go
// TeslaEnergyLiveStatus represents a point-in-time power flow snapshot.
type TeslaEnergyLiveStatus struct {
    ID                int64    `json:"id" db:"id"`
    EnergySiteID      int64    `json:"energy_site_id" db:"energy_site_id"`
    SolarPower        *float64 `json:"solar_power" db:"solar_power"`
    BatteryPower      *float64 `json:"battery_power" db:"battery_power"`
    LoadPower         *float64 `json:"load_power" db:"load_power"`
    GridPower         *float64 `json:"grid_power" db:"grid_power"`
    GridServicesPower *float64 `json:"grid_services_power" db:"grid_services_power"`
    EnergyLeft        *float64 `json:"energy_left" db:"energy_left"`
    TotalPackEnergy   *float64 `json:"total_pack_energy" db:"total_pack_energy"`
    PercentageCharged *float64 `json:"percentage_charged" db:"percentage_charged"`
    GridStatus        *string  `json:"grid_status" db:"grid_status"`
    BackupCapable     *bool    `json:"backup_capable" db:"backup_capable"`
    StormModeActive   *bool    `json:"storm_mode_active" db:"storm_mode_active"`
    RawJSON           string   `json:"raw_json,omitempty" db:"raw_json"`
    Timestamp         time.Time `json:"timestamp" db:"timestamp"`
    FetchedAt         time.Time `json:"fetched_at" db:"fetched_at"`
}
```

## Step 3 — Backend: Add Tesla client method

```go
// GetEnergySiteLiveStatus calls GET /api/1/energy_sites/{id}/live_status.
func (c *Client) GetEnergySiteLiveStatus(ctx context.Context, energySiteID int64) ([]byte, int, error) {
    path := fmt.Sprintf("/api/1/energy_sites/%d/live_status", energySiteID)
    return c.doRequest(ctx, http.MethodGet, path, nil)
}
```

## Step 4 — Backend: Add repository

Create `internal/database/tesla_energy_live_status_repo.go`:
- `GetLatest(ctx, energySiteID)` — return most recent snapshot
- `GetHistory(ctx, energySiteID, since, until, limit)` — return snapshots for charting
- `Create(ctx, status)` — insert new snapshot

## Step 5 — Backend: Add handler

- `LiveStatus(w, r)` — returns latest from DB
- `LiveStatusHistory(w, r)` — returns historical snapshots with `?since=&until=&limit=` params
- `RefreshLiveStatus(w, r)` — fetches from Tesla, inserts to DB, returns fresh data

## Step 6 — Backend: Wire routes

```go
r.Route("/tesla/energy-sites/{siteID}", func(r chi.Router) {
    r.Get("/live-status", energySiteHandler.LiveStatus)
    r.Get("/live-status/history", energySiteHandler.LiveStatusHistory)
    r.Post("/live-status/refresh", energySiteHandler.RefreshLiveStatus)
})
```

## Step 7 — Frontend: Add hooks

```typescript
export function useTeslaEnergyLiveStatus(siteId?: number) {
    return useQuery({
        queryKey: ['tesla-live-status', siteId],
        queryFn: () => request<TeslaEnergyLiveStatus>(`/tesla/energy-sites/${siteId}/live-status`),
        enabled: !!siteId,
        refetchInterval: 30_000,  // Refresh every 30s for near-real-time
    });
}

export function useTeslaEnergyLiveStatusHistory(siteId?: number, since?: string, until?: string) {
    return useQuery({
        queryKey: ['tesla-live-status-history', siteId, since, until],
        queryFn: () => request<TeslaEnergyLiveStatus[]>(
            `/tesla/energy-sites/${siteId}/live-status/history?since=${since}&until=${until}`
        ),
        enabled: !!siteId,
        staleTime: 60_000,
    });
}
```

## Step 8 — Frontend: Display

Create a **Power Flow Dashboard** showing:
- Animated power flow diagram (Solar → Home, Battery ↔ Home, Grid ↔ Home)
- Current values: solar production, battery %, home consumption, grid import/export
- Historical area chart: stacked solar/battery/grid power over time
- Battery state of charge over time
- Grid status badge (Active / Islanded)
- Storm mode indicator

## Verification

```bash
go build ./...
cd web && npx tsc --noEmit
ls migrations/000103_add_tesla_energy_live_status.*
grep -n "live-status" internal/api/router.go
```
