---
description: "Add Tesla user orders endpoint: fetch from Tesla, persist to DB, display active orders on Tesla Account page"
---

# Feature: Tesla User Orders (`/users/orders`)

## Overview

Fetch the Tesla Fleet API `GET /api/1/users/orders` endpoint, persist active orders to our
database, and serve from DB to the frontend. A "Refresh" action re-fetches from Tesla.
Shows vehicle purchase/delivery tracking.

## Tesla Fleet API

```
GET /api/1/users/orders
```

**Response** (example):
```json
{
  "response": [
    {
      "order_id": "RN12345678",
      "referral_code": "...",
      "model": "Model Y",
      "status": "DELIVERY_SCHEDULED",
      "delivery_date": "2026-05-01",
      "vin": "5YJ3E1...",
      "is_upgradable": false
    }
  ]
}
```

> **Note:** Returns empty array if no active orders. Requires user OAuth token.

## Step 1 — Database Migration

Create `migrations/000100_add_tesla_user_orders.up.sql`:

```sql
CREATE TABLE IF NOT EXISTS tesla_user_orders (
    id              BIGSERIAL PRIMARY KEY,
    order_id        TEXT NOT NULL UNIQUE,
    model           TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT '',
    delivery_date   DATE,
    vin             TEXT,
    referral_code   TEXT,
    is_upgradable   BOOLEAN NOT NULL DEFAULT false,
    raw_json        JSONB NOT NULL DEFAULT '{}',
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tesla_user_orders_order_id ON tesla_user_orders (order_id);
```

And `migrations/000100_add_tesla_user_orders.down.sql`:
```sql
DROP TABLE IF EXISTS tesla_user_orders;
```

## Step 2 — Backend: Add model

In `internal/models/models.go`:

```go
// TeslaUserOrder represents an active Tesla vehicle order.
type TeslaUserOrder struct {
    ID            int64      `json:"id" db:"id"`
    OrderID       string     `json:"order_id" db:"order_id"`
    Model         string     `json:"model" db:"model"`
    Status        string     `json:"status" db:"status"`
    DeliveryDate  *time.Time `json:"delivery_date" db:"delivery_date"`
    VIN           *string    `json:"vin" db:"vin"`
    ReferralCode  *string    `json:"referral_code" db:"referral_code"`
    IsUpgradable  bool       `json:"is_upgradable" db:"is_upgradable"`
    RawJSON       string     `json:"raw_json,omitempty" db:"raw_json"`
    FetchedAt     time.Time  `json:"fetched_at" db:"fetched_at"`
    CreatedAt     time.Time  `json:"created_at" db:"created_at"`
    UpdatedAt     time.Time  `json:"updated_at" db:"updated_at"`
}
```

## Step 3 — Backend: Add Tesla client method

In `internal/tesla/client.go`:

```go
// GetUserOrders calls GET /api/1/users/orders to fetch active Tesla orders.
func (c *Client) GetUserOrders(ctx context.Context) ([]byte, int, error) {
    return c.doRequest(ctx, http.MethodGet, "/api/1/users/orders", nil)
}
```

## Step 4 — Backend: Add repository

Create `internal/database/tesla_user_order_repo.go`:

```go
type TeslaUserOrderRepo struct { db *DB }

func NewTeslaUserOrderRepo(db *DB) *TeslaUserOrderRepo {
    return &TeslaUserOrderRepo{db: db}
}

// GetAll returns all stored Tesla orders.
func (r *TeslaUserOrderRepo) GetAll(ctx context.Context) ([]*models.TeslaUserOrder, error) {
    query := `SELECT id, order_id, model, status, delivery_date, vin, referral_code,
        is_upgradable, raw_json, fetched_at, created_at, updated_at
        FROM tesla_user_orders ORDER BY updated_at DESC`
    rows, err := r.db.Pool.Query(ctx, query)
    if err != nil { return nil, err }
    defer rows.Close()
    var results []*models.TeslaUserOrder
    for rows.Next() {
        o := &models.TeslaUserOrder{}
        if err := rows.Scan(&o.ID, &o.OrderID, &o.Model, &o.Status, &o.DeliveryDate,
            &o.VIN, &o.ReferralCode, &o.IsUpgradable, &o.RawJSON,
            &o.FetchedAt, &o.CreatedAt, &o.UpdatedAt); err != nil {
            return nil, err
        }
        results = append(results, o)
    }
    return results, rows.Err()
}

// ReplaceAll deletes all existing orders and inserts the new set (full sync).
func (r *TeslaUserOrderRepo) ReplaceAll(ctx context.Context, orders []*models.TeslaUserOrder) error {
    tx, err := r.db.Pool.Begin(ctx)
    if err != nil { return err }
    defer tx.Rollback(ctx)

    _, err = tx.Exec(ctx, `DELETE FROM tesla_user_orders`)
    if err != nil { return err }

    now := time.Now().UTC()
    for _, o := range orders {
        _, err = tx.Exec(ctx, `INSERT INTO tesla_user_orders
            (order_id, model, status, delivery_date, vin, referral_code, is_upgradable, raw_json, fetched_at, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $9)`,
            o.OrderID, o.Model, o.Status, o.DeliveryDate, o.VIN,
            o.ReferralCode, o.IsUpgradable, o.RawJSON, now)
        if err != nil { return err }
    }
    return tx.Commit(ctx)
}
```

## Step 5 — Backend: Add handler methods

In `internal/api/tesla_user_handler.go`, add `orderRepo` field and methods:

```go
// Orders returns stored orders from DB.
func (h *TeslaUserHandler) Orders(w http.ResponseWriter, r *http.Request) {
    orders, err := h.orderRepo.GetAll(r.Context())
    if err != nil {
        writeError(w, http.StatusInternalServerError, "failed to fetch orders")
        return
    }
    if orders == nil { orders = []*models.TeslaUserOrder{} }
    writeJSON(w, http.StatusOK, orders)
}

// RefreshOrders fetches from Tesla API and replaces DB rows.
func (h *TeslaUserHandler) RefreshOrders(w http.ResponseWriter, r *http.Request) {
    if !h.teslaClient.HasValidToken() {
        writeError(w, http.StatusUnauthorized, "not authenticated with Tesla")
        return
    }
    body, status, err := h.teslaClient.GetUserOrders(r.Context())
    if err != nil || status != http.StatusOK {
        writeError(w, http.StatusBadGateway, "failed to fetch from Tesla")
        return
    }

    // Parse Tesla envelope → array of orders
    var envelope struct {
        Response []json.RawMessage `json:"response"`
    }
    if err := json.Unmarshal(body, &envelope); err != nil {
        writeError(w, http.StatusInternalServerError, "failed to parse Tesla response")
        return
    }

    var orders []*models.TeslaUserOrder
    for _, raw := range envelope.Response {
        var o struct {
            OrderID      string  `json:"order_id"`
            Model        string  `json:"model"`
            Status       string  `json:"status"`
            DeliveryDate *string `json:"delivery_date"`
            VIN          *string `json:"vin"`
            ReferralCode *string `json:"referral_code"`
            IsUpgradable bool    `json:"is_upgradable"`
        }
        json.Unmarshal(raw, &o)
        order := &models.TeslaUserOrder{
            OrderID:      o.OrderID,
            Model:        o.Model,
            Status:       o.Status,
            VIN:          o.VIN,
            ReferralCode: o.ReferralCode,
            IsUpgradable: o.IsUpgradable,
            RawJSON:      string(raw),
        }
        // Parse delivery date if present
        if o.DeliveryDate != nil {
            if t, err := time.Parse("2006-01-02", *o.DeliveryDate); err == nil {
                order.DeliveryDate = &t
            }
        }
        orders = append(orders, order)
    }

    if err := h.orderRepo.ReplaceAll(r.Context(), orders); err != nil {
        writeError(w, http.StatusInternalServerError, "failed to save orders")
        return
    }
    writeJSON(w, http.StatusOK, orders)
}
```

## Step 6 — Backend: Wire routes

```go
r.Get("/tesla/user/orders", teslaUserHandler.Orders)
r.Post("/tesla/user/orders/refresh", teslaUserHandler.RefreshOrders)
```

## Step 7 — Frontend: Add hook

In `web/src/api/hooks/useUser.ts`:

```typescript
export interface TeslaOrder {
    id: number;
    order_id: string;
    model: string;
    status: string;
    delivery_date: string | null;
    vin: string | null;
    is_upgradable: boolean;
    fetched_at: string;
}

export function useTeslaUserOrders() {
    return useQuery({
        queryKey: ['tesla-user-orders'],
        queryFn: () => request<TeslaOrder[]>('/tesla/user/orders'),
        staleTime: 5 * 60_000,
    });
}

export function useRefreshTeslaOrders() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: () => request<TeslaOrder[]>('/tesla/user/orders/refresh', { method: 'POST' }),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['tesla-user-orders'] }),
    });
}
```

## Step 8 — Frontend: Display on Tesla Account page

Add an "Active Orders" section with order cards showing model, status badge,
delivery date, VIN, and a "Refresh from Tesla" button. Show "Last synced: X ago"
from `fetched_at`.

## Verification

```bash
go build ./...
cd web && npx tsc --noEmit

ls migrations/000100_add_tesla_user_orders.*
grep -n "tesla/user/orders" internal/api/router.go
grep -n "useTeslaUserOrders" web/src/api/hooks/useUser.ts
```
