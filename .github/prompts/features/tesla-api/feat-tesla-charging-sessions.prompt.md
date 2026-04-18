---
description: "Add Tesla charging sessions endpoint: fetch fleet charging session data for business accounts, persist to DB"
---

# Feature: Tesla Charging Sessions (`/dx/charging/sessions`)

## Overview

Fetch `GET /api/1/dx/charging/sessions` from Tesla Fleet API to get detailed charging
session information including pricing and energy data. **This endpoint is only available
for business accounts that own a fleet of vehicles.**

Persist to DB and display on a fleet charging analytics page.

> **Note:** This endpoint may return 403 for personal accounts. The handler should
> gracefully handle this and show a "Business accounts only" message in the UI.

## Tesla Fleet API

```
GET /api/1/dx/charging/sessions?vin={vin}&date_from={iso8601}&date_to={iso8601}&limit={n}&offset={n}
```

**Parameters:**
- `vin` — (optional) filter by vehicle VIN
- `date_from` / `date_to` — ISO 8601 date range
- `limit` / `offset` — pagination

**Response** (example):
```json
{
  "response": {
    "data": [
      {
        "sessionId": 987654321,
        "vin": "5YJ3E1EA1PF000001",
        "chargerId": "SC-MV-01",
        "siteLocationName": "Tesla Supercharger - Mountain View",
        "chargeStartDateTime": "2026-04-15T08:30:00Z",
        "chargeStopDateTime": "2026-04-15T09:05:00Z",
        "energyAdded_kWh": 35.2,
        "peakPower_kW": 150,
        "maxChargeRate_kW": 148,
        "chargeDuration_s": 2100,
        "chargerType": "SUPERCHARGER",
        "cost": {
          "currencyCode": "USD",
          "totalCost": 14.78,
          "perKwhRate": 0.42,
          "idleFee": 0,
          "congestionFee": 0
        },
        "location": {
          "latitude": 37.3861,
          "longitude": -122.0839
        }
      }
    ],
    "totalResults": 150
  }
}
```

## Step 1 — Database Migration

Create `migrations/000106_add_tesla_charging_sessions.up.sql`:

```sql
CREATE TABLE IF NOT EXISTS tesla_charging_sessions (
    id                      BIGSERIAL PRIMARY KEY,
    session_id              BIGINT NOT NULL UNIQUE,
    vin                     TEXT NOT NULL,
    charger_id              TEXT,
    site_location_name      TEXT NOT NULL DEFAULT '',
    charge_start_datetime   TIMESTAMPTZ NOT NULL,
    charge_stop_datetime    TIMESTAMPTZ,
    energy_added_kwh        DOUBLE PRECISION,
    peak_power_kw           DOUBLE PRECISION,
    max_charge_rate_kw      DOUBLE PRECISION,
    charge_duration_s       INTEGER,
    charger_type            TEXT,
    currency_code           TEXT,
    total_cost              DOUBLE PRECISION,
    per_kwh_rate            DOUBLE PRECISION,
    idle_fee                DOUBLE PRECISION,
    congestion_fee          DOUBLE PRECISION,
    latitude                DOUBLE PRECISION,
    longitude               DOUBLE PRECISION,
    raw_json                JSONB NOT NULL DEFAULT '{}',
    fetched_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tesla_charging_sessions_vin ON tesla_charging_sessions (vin, charge_start_datetime DESC);
CREATE INDEX IF NOT EXISTS idx_tesla_charging_sessions_session ON tesla_charging_sessions (session_id);
```

And matching `.down.sql`:
```sql
DROP TABLE IF EXISTS tesla_charging_sessions;
```

## Step 2 — Backend: Add model

In `internal/models/models.go`:

```go
// TeslaChargingSession represents a fleet charging session from Tesla billing (business accounts).
type TeslaChargingSession struct {
    ID                    int64      `json:"id" db:"id"`
    SessionID             int64      `json:"session_id" db:"session_id"`
    VIN                   string     `json:"vin" db:"vin"`
    ChargerID             *string    `json:"charger_id" db:"charger_id"`
    SiteLocationName      string     `json:"site_location_name" db:"site_location_name"`
    ChargeStartDatetime   time.Time  `json:"charge_start_datetime" db:"charge_start_datetime"`
    ChargeStopDatetime    *time.Time `json:"charge_stop_datetime" db:"charge_stop_datetime"`
    EnergyAddedKWh        *float64   `json:"energy_added_kwh" db:"energy_added_kwh"`
    PeakPowerKW           *float64   `json:"peak_power_kw" db:"peak_power_kw"`
    MaxChargeRateKW       *float64   `json:"max_charge_rate_kw" db:"max_charge_rate_kw"`
    ChargeDurationS       *int       `json:"charge_duration_s" db:"charge_duration_s"`
    ChargerType           *string    `json:"charger_type" db:"charger_type"`
    CurrencyCode          *string    `json:"currency_code" db:"currency_code"`
    TotalCost             *float64   `json:"total_cost" db:"total_cost"`
    PerKWhRate            *float64   `json:"per_kwh_rate" db:"per_kwh_rate"`
    IdleFee               *float64   `json:"idle_fee" db:"idle_fee"`
    CongestionFee         *float64   `json:"congestion_fee" db:"congestion_fee"`
    Latitude              *float64   `json:"latitude" db:"latitude"`
    Longitude             *float64   `json:"longitude" db:"longitude"`
    RawJSON               string     `json:"raw_json,omitempty" db:"raw_json"`
    FetchedAt             time.Time  `json:"fetched_at" db:"fetched_at"`
    CreatedAt             time.Time  `json:"created_at" db:"created_at"`
}
```

## Step 3 — Backend: Add Tesla client method

```go
// GetChargingSessions calls GET /api/1/dx/charging/sessions (business accounts only).
func (c *Client) GetChargingSessions(ctx context.Context, vin, dateFrom, dateTo string, limit, offset int) ([]byte, int, error) {
    params := url.Values{}
    if vin != "" { params.Set("vin", vin) }
    if dateFrom != "" { params.Set("date_from", dateFrom) }
    if dateTo != "" { params.Set("date_to", dateTo) }
    params.Set("limit", strconv.Itoa(limit))
    params.Set("offset", strconv.Itoa(offset))
    path := "/api/1/dx/charging/sessions?" + params.Encode()
    return c.doRequest(ctx, http.MethodGet, path, nil)
}
```

## Step 4 — Backend: Add repository

Create `internal/database/tesla_charging_session_repo.go`:
- `GetAll(ctx, vin, limit, offset)` — paginated list
- `UpsertBatch(ctx, sessions)` — insert or update by session_id

## Step 5 — Backend: Add handler

```go
type TeslaChargingSessionHandler struct {
    teslaClient *tesla.Client
    repo        *database.TeslaChargingSessionRepo
}

// List returns stored sessions from DB.
func (h *TeslaChargingSessionHandler) List(w http.ResponseWriter, r *http.Request) {
    // Parse vin, limit, offset from query params
    // Return from DB
}

// Refresh fetches from Tesla, upserts to DB.
// Returns 403 gracefully for non-business accounts.
func (h *TeslaChargingSessionHandler) Refresh(w http.ResponseWriter, r *http.Request) {
    // Fetch from Tesla — if 403, return friendly error
    // Parse sessions, upsert to DB
}
```

## Step 6 — Backend: Wire routes

```go
teslaChargingSessionHandler := NewTeslaChargingSessionHandler(teslaClient, db)

r.Get("/tesla/charging/sessions", teslaChargingSessionHandler.List)
r.Post("/tesla/charging/sessions/refresh", teslaChargingSessionHandler.Refresh)
```

## Step 7 — Frontend: Add hooks

In `web/src/api/hooks/useCharging.ts`:

```typescript
export interface TeslaChargingSession {
    id: number;
    session_id: number;
    vin: string;
    charger_id: string | null;
    site_location_name: string;
    charge_start_datetime: string;
    charge_stop_datetime: string | null;
    energy_added_kwh: number | null;
    peak_power_kw: number | null;
    charge_duration_s: number | null;
    charger_type: string | null;
    total_cost: number | null;
    per_kwh_rate: number | null;
    latitude: number | null;
    longitude: number | null;
    fetched_at: string;
}

export function useTeslaChargingSessions(vin?: string) {
    return useQuery({
        queryKey: ['tesla-charging-sessions', vin],
        queryFn: () => request<TeslaChargingSession[]>(
            `/tesla/charging/sessions${vin ? `?vin=${vin}` : ''}`
        ),
        staleTime: 5 * 60_000,
    });
}

export function useRefreshTeslaChargingSessions() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (params?: { vin?: string; date_from?: string; date_to?: string }) =>
            request<TeslaChargingSession[]>(
                `/tesla/charging/sessions/refresh${params ? `?vin=${params.vin ?? ''}&date_from=${params.date_from ?? ''}&date_to=${params.date_to ?? ''}` : ''}`,
                { method: 'POST' }
            ),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['tesla-charging-sessions'] }),
    });
}
```

## Step 8 — Frontend: Display

Create `web/src/features/charging/pages/TeslaChargingSessionsPage.tsx`:

- **Info banner** — "Fleet charging data (business accounts only)"
- **Summary stats** — total sessions, total kWh, total cost, avg cost/kWh, peak power
- **DataTable** — date, location, VIN, energy (kWh), peak power, duration, cost, rate, type
- **Map** — charging session locations plotted on a map (use lat/lon)
- **Monthly cost chart** — bar chart of total cost per month
- Vehicle filter + date range picker
- "Refresh from Tesla" button
- Graceful 403 handling: show `EmptyState` with "Business accounts only" message

Wire route:
```typescript
const TeslaChargingSessionsPage = lazy(() => import('./features/charging/pages/TeslaChargingSessionsPage'));
<Route path="/tesla-charging-sessions" element={<TeslaChargingSessionsPage />} />
```

## Verification

```bash
go build ./...
cd web && npx tsc --noEmit
ls migrations/000106_add_tesla_charging_sessions.*
grep -n "tesla/charging/sessions" internal/api/router.go
grep -n "useTeslaChargingSessions" web/src/api/hooks/useCharging.ts
```
