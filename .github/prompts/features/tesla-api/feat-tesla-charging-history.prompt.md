---
description: "Add Tesla charging history endpoint: fetch paginated Supercharger/third-party charging history, persist to DB"
---

# Feature: Tesla Charging History (`/dx/charging/history`)

## Overview

Fetch `GET /api/1/dx/charging/history` from Tesla Fleet API to get the user's complete
Supercharger and third-party DC fast charging history — location, energy delivered, cost,
duration, and timestamps. Persist to DB and display on a new **Charging History** page.

This is different from our existing vehicle charging sessions (home/AC charging tracked by
TeslaSync polling). This endpoint returns Tesla's own billing records for pay-per-use charging.

## Tesla Fleet API

```
GET /api/1/dx/charging/history?vin={vin}&startTime={iso8601}&endTime={iso8601}&pageNo={n}&pageSize={n}&sortBy={field}&sortOrder={ASC|DESC}&countryCode={CC}
```

**Parameters:**
- `vin` — (optional) filter by vehicle VIN
- `startTime` / `endTime` — ISO 8601 datetime range
- `pageNo` / `pageSize` — pagination (default page 1, size 25)
- `sortBy` — sort field (e.g., `charged_at`)
- `sortOrder` — `ASC` or `DESC`
- `countryCode` — (optional) 2-letter country code

**Response** (example):
```json
{
  "response": {
    "data": [
      {
        "sessionId": 123456789,
        "vin": "5YJ3E1EA1PF000001",
        "siteLocationName": "Tesla Supercharger - Mountain View",
        "chargeStartDateTime": "2026-04-15T08:30:00Z",
        "chargeStopDateTime": "2026-04-15T09:05:00Z",
        "unlatchDateTime": "2026-04-15T09:06:00Z",
        "country": "US",
        "state": "CA",
        "county": "Santa Clara",
        "postalCode": "94043",
        "fees": [
          {
            "feeType": "CHARGING",
            "currencyCode": "USD",
            "pricingType": "kWh",
            "rateBase": 0.42,
            "rateTier1": null,
            "rateTier2": null,
            "usageBase": 35.2,
            "usageTier1": 0,
            "usageTier2": 0,
            "totalBase": 14.78,
            "totalTier1": 0,
            "totalTier2": 0,
            "totalDue": 14.78
          }
        ],
        "billingType": "PAYMENT_CARD",
        "invoices": [
          { "fileName": "invoice_123.pdf", "contentId": "abc123", "invoiceType": "CHARGING" }
        ],
        "vehicleMakeType": "Tesla"
      }
    ],
    "totalResults": 42,
    "hasMoreData": true
  }
}
```

## Step 1 — Database Migration

Create `migrations/000105_add_tesla_charging_history.up.sql`:

```sql
CREATE TABLE IF NOT EXISTS tesla_charging_history (
    id                      BIGSERIAL PRIMARY KEY,
    session_id              BIGINT NOT NULL UNIQUE,
    vin                     TEXT NOT NULL,
    site_location_name      TEXT NOT NULL DEFAULT '',
    charge_start_datetime   TIMESTAMPTZ NOT NULL,
    charge_stop_datetime    TIMESTAMPTZ,
    country                 TEXT,
    state                   TEXT,
    county                  TEXT,
    postal_code             TEXT,
    billing_type            TEXT,
    fee_type                TEXT,
    currency_code           TEXT,
    pricing_type            TEXT,
    rate_base               DOUBLE PRECISION,
    usage_kwh               DOUBLE PRECISION,
    total_due               DOUBLE PRECISION,
    has_invoice             BOOLEAN NOT NULL DEFAULT false,
    invoice_content_id      TEXT,
    raw_json                JSONB NOT NULL DEFAULT '{}',
    fetched_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tesla_charging_history_vin ON tesla_charging_history (vin, charge_start_datetime DESC);
CREATE INDEX IF NOT EXISTS idx_tesla_charging_history_session ON tesla_charging_history (session_id);
```

And matching `.down.sql`:
```sql
DROP TABLE IF EXISTS tesla_charging_history;
```

## Step 2 — Backend: Add model

In `internal/models/models.go`:

```go
// TeslaChargingHistoryEntry represents a Supercharger/DC charging session from Tesla billing.
type TeslaChargingHistoryEntry struct {
    ID                    int64      `json:"id" db:"id"`
    SessionID             int64      `json:"session_id" db:"session_id"`
    VIN                   string     `json:"vin" db:"vin"`
    SiteLocationName      string     `json:"site_location_name" db:"site_location_name"`
    ChargeStartDatetime   time.Time  `json:"charge_start_datetime" db:"charge_start_datetime"`
    ChargeStopDatetime    *time.Time `json:"charge_stop_datetime" db:"charge_stop_datetime"`
    Country               *string    `json:"country" db:"country"`
    State                 *string    `json:"state" db:"state"`
    County                *string    `json:"county" db:"county"`
    PostalCode            *string    `json:"postal_code" db:"postal_code"`
    BillingType           *string    `json:"billing_type" db:"billing_type"`
    FeeType               *string    `json:"fee_type" db:"fee_type"`
    CurrencyCode          *string    `json:"currency_code" db:"currency_code"`
    PricingType           *string    `json:"pricing_type" db:"pricing_type"`
    RateBase              *float64   `json:"rate_base" db:"rate_base"`
    UsageKWh              *float64   `json:"usage_kwh" db:"usage_kwh"`
    TotalDue              *float64   `json:"total_due" db:"total_due"`
    HasInvoice            bool       `json:"has_invoice" db:"has_invoice"`
    InvoiceContentID      *string    `json:"invoice_content_id" db:"invoice_content_id"`
    RawJSON               string     `json:"raw_json,omitempty" db:"raw_json"`
    FetchedAt             time.Time  `json:"fetched_at" db:"fetched_at"`
    CreatedAt             time.Time  `json:"created_at" db:"created_at"`
}
```

## Step 3 — Backend: Add Tesla client methods

In `internal/tesla/client.go`:

```go
// GetChargingHistory calls GET /api/1/dx/charging/history with pagination.
func (c *Client) GetChargingHistory(ctx context.Context, vin string, startTime, endTime string, pageNo, pageSize int) ([]byte, int, error) {
    params := url.Values{}
    if vin != "" { params.Set("vin", vin) }
    if startTime != "" { params.Set("startTime", startTime) }
    if endTime != "" { params.Set("endTime", endTime) }
    params.Set("pageNo", strconv.Itoa(pageNo))
    params.Set("pageSize", strconv.Itoa(pageSize))
    params.Set("sortBy", "chargeStartDateTime")
    params.Set("sortOrder", "DESC")
    path := "/api/1/dx/charging/history?" + params.Encode()
    return c.doRequest(ctx, http.MethodGet, path, nil)
}
```

## Step 4 — Backend: Add repository

Create `internal/database/tesla_charging_history_repo.go`:
- `GetAll(ctx, vin, limit, offset)` — paginated list from DB
- `GetBySessionID(ctx, sessionID)` — single entry lookup
- `UpsertBatch(ctx, entries)` — insert or update by session_id (ON CONFLICT)

The upsert pattern ensures re-fetching the same date range doesn't create duplicates.

## Step 5 — Backend: Add handler

Create `internal/api/tesla_charging_history_handler.go`:

```go
type TeslaChargingHistoryHandler struct {
    teslaClient *tesla.Client
    repo        *database.TeslaChargingHistoryRepo
}

// List returns stored charging history from DB with pagination.
func (h *TeslaChargingHistoryHandler) List(w http.ResponseWriter, r *http.Request) {
    vin := r.URL.Query().Get("vin")
    limit, offset := parsePagination(r)  // default 50, 0
    items, err := h.repo.GetAll(r.Context(), vin, limit, offset)
    // ...
}

// Refresh fetches from Tesla API (paginated), upserts to DB, returns fresh data.
func (h *TeslaChargingHistoryHandler) Refresh(w http.ResponseWriter, r *http.Request) {
    vin := r.URL.Query().Get("vin")
    startTime := r.URL.Query().Get("start_time")
    endTime := r.URL.Query().Get("end_time")
    // Fetch all pages from Tesla, parse each entry, flatten fees, upsert to DB
    // Return the full list
}
```

## Step 6 — Backend: Wire routes

```go
teslaChargingHistoryHandler := NewTeslaChargingHistoryHandler(teslaClient, db)

r.Get("/tesla/charging/history", teslaChargingHistoryHandler.List)
r.Post("/tesla/charging/history/refresh", teslaChargingHistoryHandler.Refresh)
```

## Step 7 — Frontend: Add hooks

In `web/src/api/hooks/useCharging.ts`:

```typescript
export interface TeslaChargingHistoryEntry {
    id: number;
    session_id: number;
    vin: string;
    site_location_name: string;
    charge_start_datetime: string;
    charge_stop_datetime: string | null;
    country: string | null;
    state: string | null;
    currency_code: string | null;
    pricing_type: string | null;
    rate_base: number | null;
    usage_kwh: number | null;
    total_due: number | null;
    has_invoice: boolean;
    fetched_at: string;
}

export function useTeslaChargingHistory(vin?: string) {
    return useQuery({
        queryKey: ['tesla-charging-history', vin],
        queryFn: () => request<TeslaChargingHistoryEntry[]>(
            `/tesla/charging/history${vin ? `?vin=${vin}` : ''}`
        ),
        staleTime: 5 * 60_000,
    });
}

export function useRefreshTeslaChargingHistory() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (params?: { vin?: string; start_time?: string; end_time?: string }) =>
            request<TeslaChargingHistoryEntry[]>(
                `/tesla/charging/history/refresh${params ? `?vin=${params.vin ?? ''}&start_time=${params.start_time ?? ''}&end_time=${params.end_time ?? ''}` : ''}`,
                { method: 'POST' }
            ),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['tesla-charging-history'] }),
    });
}
```

## Step 8 — Frontend: Display

Create `web/src/features/charging/pages/TeslaChargingHistoryPage.tsx`:

- **Summary stats** — total sessions, total kWh, total spend, avg cost/kWh
- **DataTable** with columns: Date, Location, Duration, Energy (kWh), Cost, Rate, Invoice
- Vehicle filter dropdown (if multiple vehicles)
- Date range picker
- "Refresh from Tesla" button with last synced timestamp
- Invoice download link (wired to invoice endpoint — see next prompt)
- **Monthly spending chart** — bar chart of total cost per month

Wire route in `App.tsx`:
```typescript
const TeslaChargingHistoryPage = lazy(() => import('./features/charging/pages/TeslaChargingHistoryPage'));
<Route path="/tesla-charging-history" element={<TeslaChargingHistoryPage />} />
```

## Verification

```bash
go build ./...
cd web && npx tsc --noEmit
ls migrations/000105_add_tesla_charging_history.*
grep -n "tesla/charging/history" internal/api/router.go
grep -n "useTeslaChargingHistory" web/src/api/hooks/useCharging.ts
```
