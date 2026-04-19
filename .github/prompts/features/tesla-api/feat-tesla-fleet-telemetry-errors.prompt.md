---
description: "Add Tesla fleet telemetry error endpoints: error VINs list and detailed error logs for all vehicles"
---

# Feature: Tesla Fleet Telemetry Errors (Partner-Level)

## Overview

Add two partner-level fleet telemetry error endpoints that report errors across ALL vehicles
(unlike the existing per-vehicle endpoint). These are critical for monitoring fleet telemetry
health — which vehicles are having config issues and what the specific errors are.

Persist to DB for historical tracking and alerting.

## Tesla Fleet API Endpoints

### 1. Error VINs
```
GET /api/1/partner_accounts/fleet_telemetry_error_vins
```
Returns a list of VINs that have fleet telemetry errors after receiving the config.

**Requires:** Partner authentication token.

**Response** (example):
```json
{
  "response": {
    "vins": [
      "5YJ3E1EA1PF000001",
      "5YJ3E1EA1PF000002"
    ],
    "updated_at": "2026-04-18T10:00:00Z"
  }
}
```

### 2. Error Details
```
GET /api/1/partner_accounts/fleet_telemetry_errors
```
Returns recent fleet telemetry errors reported by vehicles after receiving the config.

**Requires:** Partner authentication token.

**Response** (example):
```json
{
  "response": {
    "errors": [
      {
        "vin": "5YJ3E1EA1PF000001",
        "error_code": "CONN_REFUSED",
        "error_message": "connection refused to telemetry server",
        "reported_at": "2026-04-18T09:45:00Z"
      }
    ],
    "updated_at": "2026-04-18T10:00:00Z"
  }
}
```

> **Note:** We already have `GET /api/1/vehicles/{vin}/fleet_telemetry_errors` (per-vehicle)
> via `DevToolsHandler.FleetTelemetryErrors`. These new endpoints are partner-level and
> cover ALL vehicles in one call.

## Step 1 — Database Migration

Create `migrations/000107_add_tesla_fleet_telemetry_errors.up.sql`:

```sql
CREATE TABLE IF NOT EXISTS tesla_fleet_telemetry_errors (
    id              BIGSERIAL PRIMARY KEY,
    vin             TEXT NOT NULL,
    error_code      TEXT,
    error_message   TEXT,
    reported_at     TIMESTAMPTZ,
    raw_json        JSONB NOT NULL DEFAULT '{}',
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fleet_telemetry_errors_vin ON tesla_fleet_telemetry_errors (vin, fetched_at DESC);

-- Track which VINs currently have errors (latest snapshot)
CREATE TABLE IF NOT EXISTS tesla_fleet_telemetry_error_vins (
    id              BIGSERIAL PRIMARY KEY,
    vin             TEXT NOT NULL UNIQUE,
    first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

And matching `.down.sql`:
```sql
DROP TABLE IF EXISTS tesla_fleet_telemetry_error_vins;
DROP TABLE IF EXISTS tesla_fleet_telemetry_errors;
```

## Step 2 — Backend: Add Tesla client methods

In `internal/tesla/client.go`:

```go
// GetFleetTelemetryErrorVINs calls GET /api/1/partner_accounts/fleet_telemetry_error_vins
// using a partner token. Returns VINs with telemetry errors across the entire fleet.
func (c *Client) GetFleetTelemetryErrorVINs(ctx context.Context) ([]byte, int, error) {
    partnerToken, err := c.GetPartnerToken(ctx)
    if err != nil {
        return nil, 0, fmt.Errorf("get partner token: %w", err)
    }
    return c.doRequestWithToken(ctx, http.MethodGet, "/api/1/partner_accounts/fleet_telemetry_error_vins", nil, partnerToken)
}

// GetPartnerFleetTelemetryErrors calls GET /api/1/partner_accounts/fleet_telemetry_errors
// using a partner token. Returns detailed error logs across the entire fleet.
func (c *Client) GetPartnerFleetTelemetryErrors(ctx context.Context) ([]byte, int, error) {
    partnerToken, err := c.GetPartnerToken(ctx)
    if err != nil {
        return nil, 0, fmt.Errorf("get partner token: %w", err)
    }
    return c.doRequestWithToken(ctx, http.MethodGet, "/api/1/partner_accounts/fleet_telemetry_errors", nil, partnerToken)
}
```

## Step 3 — Backend: Add models

In `internal/models/models.go`:

```go
// TeslaFleetTelemetryError represents a fleet telemetry error from the partner endpoint.
type TeslaFleetTelemetryError struct {
    ID           int64      `json:"id" db:"id"`
    VIN          string     `json:"vin" db:"vin"`
    ErrorCode    *string    `json:"error_code" db:"error_code"`
    ErrorMessage *string    `json:"error_message" db:"error_message"`
    ReportedAt   *time.Time `json:"reported_at" db:"reported_at"`
    RawJSON      string     `json:"raw_json,omitempty" db:"raw_json"`
    FetchedAt    time.Time  `json:"fetched_at" db:"fetched_at"`
}

// TeslaFleetTelemetryErrorVIN tracks a VIN with active telemetry errors.
type TeslaFleetTelemetryErrorVIN struct {
    ID          int64     `json:"id" db:"id"`
    VIN         string    `json:"vin" db:"vin"`
    FirstSeenAt time.Time `json:"first_seen_at" db:"first_seen_at"`
    LastSeenAt  time.Time `json:"last_seen_at" db:"last_seen_at"`
}
```

## Step 4 — Backend: Add repository

Create `internal/database/tesla_fleet_telemetry_error_repo.go`:

- `GetErrorVINs(ctx)` — return all VINs with active errors
- `ReplaceErrorVINs(ctx, vins)` — upsert VIN list (update last_seen, insert new, optionally remove stale)
- `GetErrors(ctx, vin, limit)` — return error logs (optionally filtered by VIN)
- `InsertErrors(ctx, errors)` — append new error entries

## Step 5 — Backend: Add handler

Create `internal/api/fleet_telemetry_error_handler.go`:

```go
type FleetTelemetryErrorHandler struct {
    teslaClient *tesla.Client
    repo        *database.TeslaFleetTelemetryErrorRepo
}

// ErrorVINs returns stored error VINs from DB.
func (h *FleetTelemetryErrorHandler) ErrorVINs(w, r) { /* read from DB */ }

// RefreshErrorVINs fetches from Tesla partner API, upserts to DB.
func (h *FleetTelemetryErrorHandler) RefreshErrorVINs(w, r) { /* fetch + save */ }

// Errors returns stored error logs from DB.
func (h *FleetTelemetryErrorHandler) Errors(w, r) { /* read from DB, optional ?vin= filter */ }

// RefreshErrors fetches from Tesla partner API, inserts to DB.
func (h *FleetTelemetryErrorHandler) RefreshErrors(w, r) { /* fetch + save */ }
```

## Step 6 — Backend: Wire routes

```go
ftErrorHandler := NewFleetTelemetryErrorHandler(teslaClient, db)

r.Get("/tesla/fleet-telemetry/error-vins", ftErrorHandler.ErrorVINs)
r.Post("/tesla/fleet-telemetry/error-vins/refresh", ftErrorHandler.RefreshErrorVINs)
r.Get("/tesla/fleet-telemetry/errors", ftErrorHandler.Errors)
r.Post("/tesla/fleet-telemetry/errors/refresh", ftErrorHandler.RefreshErrors)
```

## Step 7 — Frontend: Add hooks

In `web/src/api/hooks/useTelemetry.ts`:

```typescript
export interface FleetTelemetryErrorVIN {
    vin: string;
    first_seen_at: string;
    last_seen_at: string;
}

export interface FleetTelemetryError {
    id: number;
    vin: string;
    error_code: string | null;
    error_message: string | null;
    reported_at: string | null;
    fetched_at: string;
}

export function useFleetTelemetryErrorVINs() {
    return useQuery({
        queryKey: ['fleet-telemetry-error-vins'],
        queryFn: () => request<FleetTelemetryErrorVIN[]>('/tesla/fleet-telemetry/error-vins'),
        staleTime: 60_000,
    });
}

export function useFleetTelemetryErrors(vin?: string) {
    return useQuery({
        queryKey: ['fleet-telemetry-errors', vin],
        queryFn: () => request<FleetTelemetryError[]>(
            `/tesla/fleet-telemetry/errors${vin ? `?vin=${vin}` : ''}`
        ),
        staleTime: 60_000,
    });
}

export function useRefreshFleetTelemetryErrorVINs() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: () => request('/tesla/fleet-telemetry/error-vins/refresh', { method: 'POST' }),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['fleet-telemetry-error-vins'] }),
    });
}

export function useRefreshFleetTelemetryErrors() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: () => request('/tesla/fleet-telemetry/errors/refresh', { method: 'POST' }),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['fleet-telemetry-errors'] }),
    });
}
```

## Step 8 — Frontend: Display

Add a **"Fleet Telemetry Health"** section on the DevTools or Fleet API page:

- **Error VINs summary** — badge count of affected vehicles, list of VINs with
  first/last seen timestamps. Click a VIN to filter errors.
- **Error log table** — DataTable with columns: VIN, Error Code, Message, Reported At
- Filter by VIN dropdown
- "Refresh from Tesla" buttons for both endpoints
- Color-coded severity: red for recent errors, amber for stale
- Link each VIN to the vehicle's detail page

## Verification

```bash
go build ./...
cd web && npx tsc --noEmit
ls migrations/000107_add_tesla_fleet_telemetry_errors.*
grep -n "fleet-telemetry/error" internal/api/router.go
grep -n "GetFleetTelemetryErrorVINs\|GetPartnerFleetTelemetryErrors" internal/tesla/client.go
```
