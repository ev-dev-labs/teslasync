---
description: "Add mobile access check, vehicle specs, and options endpoints: persist to DB"
---

# Feature: Vehicle Info Endpoints (mobile_enabled, specs, options)

## Overview

Add three vehicle info endpoints that provide static/semi-static vehicle data:
1. **Mobile enabled** — whether remote access is enabled on the vehicle
2. **Options** — vehicle option codes and descriptions (paint, wheels, interior, etc.)
3. **Specs** — vehicle specifications as recorded at time of sale

## Tesla Fleet API Endpoints

### 1. Mobile Enabled
```
GET /api/1/vehicles/{vin}/mobile_enabled
```
Returns `{ "response": true }` or `{ "response": false }`.

### 2. Vehicle Options
```
GET /api/1/dx/vehicles/options?vin={vin}
```
Returns option codes with descriptions (paint color, wheel type, interior, autopilot, etc.)

### 3. Vehicle Specs
```
GET /api/1/vehicles/{vin}/specs
```
Returns specifications recorded at time of sale (range, battery, motor config, etc.)

> **Note:** Specs endpoint costs $0.10 per call and requires a partner token.
> Use sparingly and cache aggressively.

## Step 1 — Backend: Add Tesla client methods

In `internal/tesla/client.go`:

```go
// GetMobileEnabled calls GET /api/1/vehicles/{vin}/mobile_enabled.
func (c *Client) GetMobileEnabled(ctx context.Context, vin string) ([]byte, int, error) {
    path := fmt.Sprintf("/api/1/vehicles/%s/mobile_enabled", vin)
    return c.doRequest(ctx, http.MethodGet, path, nil)
}

// GetVehicleOptions calls GET /api/1/dx/vehicles/options?vin={vin}.
func (c *Client) GetVehicleOptions(ctx context.Context, vin string) ([]byte, int, error) {
    path := fmt.Sprintf("/api/1/dx/vehicles/options?vin=%s", vin)
    return c.doRequest(ctx, http.MethodGet, path, nil)
}

// GetVehicleSpecs calls GET /api/1/vehicles/{vin}/specs using a partner token.
// NOTE: This endpoint costs $0.10 per successful call.
func (c *Client) GetVehicleSpecs(ctx context.Context, vin string) ([]byte, int, error) {
    partnerToken, err := c.GetPartnerToken(ctx)
    if err != nil {
        return nil, 0, fmt.Errorf("get partner token: %w", err)
    }
    path := fmt.Sprintf("/api/1/vehicles/%s/specs", vin)
    return c.doRequestWithToken(ctx, http.MethodGet, path, nil, partnerToken)
}
```

## Step 2 — Database: Store in `tesla_user_config`

Reuse the `tesla_user_config` table with keys:
- `mobile_enabled:{vehicleID}` → `{"enabled": true}`
- `vehicle_options:{vehicleID}` → full options JSON
- `vehicle_specs:{vehicleID}` → full specs JSON

No new migration needed.

## Step 3 — Backend: Add handler methods

Add to an existing vehicle-related handler or create `internal/api/vehicle_info_handler.go`:

```go
// MobileEnabled returns stored mobile_enabled status from DB.
func (h *VehicleInfoHandler) MobileEnabled(w, r) { /* read from config table */ }
func (h *VehicleInfoHandler) RefreshMobileEnabled(w, r) { /* fetch from Tesla, save */ }

// VehicleOptions returns stored options from DB.
func (h *VehicleInfoHandler) VehicleOptions(w, r) { /* read from config table */ }
func (h *VehicleInfoHandler) RefreshVehicleOptions(w, r) { /* fetch from Tesla, save */ }

// VehicleSpecs returns stored specs from DB.
func (h *VehicleInfoHandler) VehicleSpecs(w, r) { /* read from config table */ }
func (h *VehicleInfoHandler) RefreshVehicleSpecs(w, r) {
    // IMPORTANT: Log and warn — this costs $0.10 per call
    // fetch from Tesla with partner token, save
}
```

## Step 4 — Backend: Wire routes

```go
r.Route("/vehicles/{vehicleID}", func(r chi.Router) {
    r.Get("/mobile-enabled", vehicleInfoHandler.MobileEnabled)
    r.Post("/mobile-enabled/refresh", vehicleInfoHandler.RefreshMobileEnabled)
    r.Get("/options", vehicleInfoHandler.VehicleOptions)
    r.Post("/options/refresh", vehicleInfoHandler.RefreshVehicleOptions)
    r.Get("/specs", vehicleInfoHandler.VehicleSpecs)
    r.Post("/specs/refresh", vehicleInfoHandler.RefreshVehicleSpecs)
})
```

## Step 5 — Frontend: Add hooks

In `web/src/api/hooks/useVehicles.ts`:

```typescript
export function useVehicleMobileEnabled(vehicleId?: string) {
    return useQuery({
        queryKey: ['vehicle-mobile-enabled', vehicleId],
        queryFn: () => request<{ enabled: boolean }>(`/vehicles/${vehicleId}/mobile-enabled`),
        enabled: !!vehicleId,
        staleTime: 5 * 60_000,
    });
}

export function useVehicleOptions(vehicleId?: string) {
    return useQuery({
        queryKey: ['vehicle-options', vehicleId],
        queryFn: () => request<Record<string, unknown>>(`/vehicles/${vehicleId}/options`),
        enabled: !!vehicleId,
        staleTime: Infinity,  // Options never change
    });
}

export function useVehicleSpecs(vehicleId?: string) {
    return useQuery({
        queryKey: ['vehicle-specs', vehicleId],
        queryFn: () => request<Record<string, unknown>>(`/vehicles/${vehicleId}/specs`),
        enabled: !!vehicleId,
        staleTime: Infinity,  // Specs never change
    });
}
```

## Step 6 — Frontend: Display

Add to vehicle detail page or a new "Vehicle Info" tab:
- **Mobile Access** — badge showing Enabled/Disabled
- **Options** — table of option codes with descriptions
- **Specs** — key-value list of specifications (range, battery, motor, etc.)
- Specs section should show a warning: "Fetching specs costs $0.10 per request"
  with a confirm dialog before the refresh button executes

## Verification

```bash
go build ./...
cd web && npx tsc --noEmit
grep -n "mobile-enabled\|/options\|/specs" internal/api/router.go
```
