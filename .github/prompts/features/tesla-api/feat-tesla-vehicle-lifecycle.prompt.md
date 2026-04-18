---
description: "Add vehicle subscriptions, upgrades, and warranty endpoints: eligibility checks and warranty details"
---

# Feature: Vehicle Subscriptions, Upgrades & Warranty

## Overview

Add three DX endpoints for vehicle subscriptions eligibility, upgrade eligibility,
and warranty details. These provide commercial/lifecycle data about the vehicle.

## Tesla Fleet API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/dx/vehicles/subscriptions/eligibility?vin={vin}` | Eligible vehicle subscriptions (FSD, Premium Connectivity, etc.) |
| `GET` | `/dx/vehicles/upgrades/eligibility?vin={vin}` | Eligible vehicle upgrades (performance boost, acceleration, etc.) |
| `GET` | `/dx/warranty/details` | Warranty information for vehicles |

## Step 1 — Backend: Add Tesla client methods

In `internal/tesla/client.go`:

```go
// GetSubscriptionEligibility calls GET /api/1/dx/vehicles/subscriptions/eligibility?vin={vin}.
func (c *Client) GetSubscriptionEligibility(ctx context.Context, vin string) ([]byte, int, error) {
    path := fmt.Sprintf("/api/1/dx/vehicles/subscriptions/eligibility?vin=%s", vin)
    return c.doRequest(ctx, http.MethodGet, path, nil)
}

// GetUpgradeEligibility calls GET /api/1/dx/vehicles/upgrades/eligibility?vin={vin}.
func (c *Client) GetUpgradeEligibility(ctx context.Context, vin string) ([]byte, int, error) {
    path := fmt.Sprintf("/api/1/dx/vehicles/upgrades/eligibility?vin=%s", vin)
    return c.doRequest(ctx, http.MethodGet, path, nil)
}

// GetWarrantyDetails calls GET /api/1/dx/warranty/details.
func (c *Client) GetWarrantyDetails(ctx context.Context) ([]byte, int, error) {
    return c.doRequest(ctx, http.MethodGet, "/api/1/dx/warranty/details", nil)
}
```

## Step 2 — Database: Store in `tesla_user_config`

Reuse the `tesla_user_config` table with keys:
- `subscriptions:{vehicleID}` → eligibility JSON
- `upgrades:{vehicleID}` → eligibility JSON
- `warranty` → warranty details JSON

No new migration needed.

## Step 3 — Backend: Add handler methods

Add to the vehicle info handler or create a new handler:

```go
// SubscriptionEligibility returns stored data from DB.
func (h *VehicleInfoHandler) SubscriptionEligibility(w, r) { /* read from config */ }
func (h *VehicleInfoHandler) RefreshSubscriptionEligibility(w, r) { /* fetch + save */ }

// UpgradeEligibility returns stored data from DB.
func (h *VehicleInfoHandler) UpgradeEligibility(w, r) { /* read from config */ }
func (h *VehicleInfoHandler) RefreshUpgradeEligibility(w, r) { /* fetch + save */ }

// WarrantyDetails returns stored warranty data from DB.
func (h *VehicleInfoHandler) WarrantyDetails(w, r) { /* read from config */ }
func (h *VehicleInfoHandler) RefreshWarrantyDetails(w, r) { /* fetch + save */ }
```

## Step 4 — Backend: Wire routes

```go
r.Route("/vehicles/{vehicleID}", func(r chi.Router) {
    r.Get("/subscriptions", vehicleInfoHandler.SubscriptionEligibility)
    r.Post("/subscriptions/refresh", vehicleInfoHandler.RefreshSubscriptionEligibility)
    r.Get("/upgrades", vehicleInfoHandler.UpgradeEligibility)
    r.Post("/upgrades/refresh", vehicleInfoHandler.RefreshUpgradeEligibility)
})
r.Get("/tesla/warranty", vehicleInfoHandler.WarrantyDetails)
r.Post("/tesla/warranty/refresh", vehicleInfoHandler.RefreshWarrantyDetails)
```

## Step 5 — Frontend: Add hooks

In `web/src/api/hooks/useVehicles.ts`:

```typescript
export function useVehicleSubscriptions(vehicleId?: string) {
    return useQuery({
        queryKey: ['vehicle-subscriptions', vehicleId],
        queryFn: () => request<Record<string, unknown>>(`/vehicles/${vehicleId}/subscriptions`),
        enabled: !!vehicleId,
        staleTime: 60 * 60_000,  // 1 hour — rarely changes
    });
}

export function useVehicleUpgrades(vehicleId?: string) {
    return useQuery({
        queryKey: ['vehicle-upgrades', vehicleId],
        queryFn: () => request<Record<string, unknown>>(`/vehicles/${vehicleId}/upgrades`),
        enabled: !!vehicleId,
        staleTime: 60 * 60_000,
    });
}

export function useWarrantyDetails() {
    return useQuery({
        queryKey: ['warranty-details'],
        queryFn: () => request<Record<string, unknown>>('/tesla/warranty'),
        staleTime: 24 * 60 * 60_000,  // 1 day
    });
}
```

## Step 6 — Frontend: Display

Add to vehicle detail page or a new **"Vehicle Lifecycle"** section:

- **Subscriptions** — cards showing eligible subscriptions (FSD monthly, Premium Connectivity)
  with pricing, status (active/eligible/not eligible), and action button
- **Upgrades** — cards showing eligible upgrades (acceleration boost, etc.)
  with pricing and eligibility status
- **Warranty** — timeline or table showing warranty coverage periods,
  mileage limits, and expiration dates

Each section has a "Refresh from Tesla" button with last synced timestamp.

## Verification

```bash
go build ./...
cd web && npx tsc --noEmit
grep -n "subscriptions\|upgrades\|warranty" internal/api/router.go
grep -n "GetSubscriptionEligibility\|GetUpgradeEligibility\|GetWarrantyDetails" internal/tesla/client.go
```
