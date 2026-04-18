---
description: "Add Tesla energy products endpoint: fetch user's energy products (Powerwall, Solar) from Tesla, persist to DB"
---

# Feature: Tesla Energy Products (`/products`)

## Overview

Fetch `GET /api/1/products` from Tesla Fleet API to discover the user's energy products
(Powerwalls, Solar Roof, Wall Connectors). Persist to DB and display on a new
**Energy Products** page. This is the foundational endpoint — all other energy endpoints
need a `energy_site_id` which comes from this response.

## Tesla Fleet API

```
GET /api/1/products
```

**Response** (example):
```json
{
  "response": [
    {
      "energy_site_id": 12345678,
      "resource_type": "battery",
      "site_name": "Home Powerwall",
      "id": "STE20220101-00001",
      "gateway_id": "1234567-00-A--TG12345678",
      "asset_site_id": "abcdef-1234",
      "energy_left": 10500.0,
      "total_pack_energy": 13500,
      "percentage_charged": 77.8,
      "battery_type": "ac_powerwall",
      "backup_capable": true,
      "battery_power": -340,
      "storm_mode_enabled": true,
      "powerwall_onboarding_settings_set": true,
      "components": {
        "solar": true,
        "solar_type": "pv_panel",
        "battery": true,
        "grid": true,
        "backup": true,
        "gateway": "teg",
        "load_meter": true,
        "tou_capable": true,
        "storm_mode_capable": true
      }
    }
  ],
  "count": 1
}
```

> **Note:** This endpoint returns BOTH vehicles and energy products. Filter by
> `resource_type` — energy products have `"battery"` or `"solar"`. Vehicles have `"vehicle"`.

## Step 1 — Database Migration

Create `migrations/000102_add_tesla_energy_sites.up.sql`:

```sql
CREATE TABLE IF NOT EXISTS tesla_energy_sites (
    id                  BIGSERIAL PRIMARY KEY,
    energy_site_id      BIGINT NOT NULL UNIQUE,
    resource_type       TEXT NOT NULL DEFAULT '',
    site_name           TEXT NOT NULL DEFAULT '',
    gateway_id          TEXT,
    total_pack_energy   DOUBLE PRECISION,
    percentage_charged  DOUBLE PRECISION,
    battery_type        TEXT,
    backup_capable      BOOLEAN NOT NULL DEFAULT false,
    storm_mode_enabled  BOOLEAN NOT NULL DEFAULT false,
    has_solar           BOOLEAN NOT NULL DEFAULT false,
    has_battery         BOOLEAN NOT NULL DEFAULT false,
    has_grid            BOOLEAN NOT NULL DEFAULT false,
    has_load_meter      BOOLEAN NOT NULL DEFAULT false,
    tou_capable         BOOLEAN NOT NULL DEFAULT false,
    storm_mode_capable  BOOLEAN NOT NULL DEFAULT false,
    raw_json            JSONB NOT NULL DEFAULT '{}',
    fetched_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tesla_energy_sites_site_id ON tesla_energy_sites (energy_site_id);
```

And matching `.down.sql`:
```sql
DROP TABLE IF EXISTS tesla_energy_sites;
```

## Step 2 — Backend: Add model

In `internal/models/models.go`:

```go
// TeslaEnergySite represents a Tesla energy product (Powerwall, Solar).
type TeslaEnergySite struct {
    ID                 int64    `json:"id" db:"id"`
    EnergySiteID       int64    `json:"energy_site_id" db:"energy_site_id"`
    ResourceType       string   `json:"resource_type" db:"resource_type"`
    SiteName           string   `json:"site_name" db:"site_name"`
    GatewayID          *string  `json:"gateway_id" db:"gateway_id"`
    TotalPackEnergy    *float64 `json:"total_pack_energy" db:"total_pack_energy"`
    PercentageCharged  *float64 `json:"percentage_charged" db:"percentage_charged"`
    BatteryType        *string  `json:"battery_type" db:"battery_type"`
    BackupCapable      bool     `json:"backup_capable" db:"backup_capable"`
    StormModeEnabled   bool     `json:"storm_mode_enabled" db:"storm_mode_enabled"`
    HasSolar           bool     `json:"has_solar" db:"has_solar"`
    HasBattery         bool     `json:"has_battery" db:"has_battery"`
    HasGrid            bool     `json:"has_grid" db:"has_grid"`
    HasLoadMeter       bool     `json:"has_load_meter" db:"has_load_meter"`
    TOUCapable         bool     `json:"tou_capable" db:"tou_capable"`
    StormModeCapable   bool     `json:"storm_mode_capable" db:"storm_mode_capable"`
    RawJSON            string   `json:"raw_json,omitempty" db:"raw_json"`
    FetchedAt          time.Time `json:"fetched_at" db:"fetched_at"`
    CreatedAt          time.Time `json:"created_at" db:"created_at"`
    UpdatedAt          time.Time `json:"updated_at" db:"updated_at"`
}
```

## Step 3 — Backend: Add Tesla client method

In `internal/tesla/client.go`:

```go
// GetProducts calls GET /api/1/products to fetch the user's vehicles and energy products.
func (c *Client) GetProducts(ctx context.Context) ([]byte, int, error) {
    return c.doRequest(ctx, http.MethodGet, "/api/1/products", nil)
}
```

## Step 4 — Backend: Add repository

Create `internal/database/tesla_energy_site_repo.go` with:
- `GetAll(ctx)` — return all stored energy sites
- `ReplaceAll(ctx, sites)` — delete all + insert batch in transaction

## Step 5 — Backend: Add handler

Create `internal/api/energy_site_handler.go`:
- `List(w, r)` — reads from DB
- `Refresh(w, r)` — fetches from Tesla, filters `resource_type != "vehicle"`, saves to DB

## Step 6 — Backend: Wire routes

```go
r.Get("/tesla/energy-sites", energySiteHandler.List)
r.Post("/tesla/energy-sites/refresh", energySiteHandler.Refresh)
```

## Step 7 — Frontend: Add hook

In `web/src/api/hooks/useEnergy.ts`:

```typescript
export interface TeslaEnergySite {
    id: number;
    energy_site_id: number;
    resource_type: string;
    site_name: string;
    total_pack_energy: number | null;
    percentage_charged: number | null;
    battery_type: string | null;
    backup_capable: boolean;
    storm_mode_enabled: boolean;
    has_solar: boolean;
    has_battery: boolean;
    fetched_at: string;
}

export function useTeslaEnergySites() {
    return useQuery({
        queryKey: ['tesla-energy-sites'],
        queryFn: () => request<TeslaEnergySite[]>('/tesla/energy-sites'),
        staleTime: 60_000,
    });
}

export function useRefreshTeslaEnergySites() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: () => request<TeslaEnergySite[]>('/tesla/energy-sites/refresh', { method: 'POST' }),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['tesla-energy-sites'] }),
    });
}
```

## Step 8 — Frontend: Display

Create `web/src/features/energy/pages/EnergyProductsPage.tsx` showing product cards
with site name, battery %, solar/battery/grid badges, and a "Refresh from Tesla" button.

Wire in `App.tsx`:
```typescript
const EnergyProductsPage = lazy(() => import('./features/energy/pages/EnergyProductsPage'));
<Route path="/energy-products" element={<EnergyProductsPage />} />
```

## Verification

```bash
go build ./...
cd web && npx tsc --noEmit
ls migrations/000102_add_tesla_energy_sites.*
grep -n "tesla/energy-sites" internal/api/router.go
```
