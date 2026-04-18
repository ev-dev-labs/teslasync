---
description: "Add vehicle driver management and share invitation endpoints: list drivers, remove access, create/revoke invites"
---

# Feature: Vehicle Drivers & Share Invitations

## Overview

Add driver management and share invitation endpoints for fleet access control:
1. **List drivers** — see who has access to each vehicle
2. **Remove driver** — revoke a driver's access
3. **List invitations** — see pending share invites
4. **Create invitation** — generate a single-use invite link
5. **Revoke invitation** — cancel a pending invite
6. **Redeem invitation** — accept an invite (used by the invited user)

## Tesla Fleet API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/vehicles/{vin}/drivers` | List all allowed drivers (owner only) |
| `DELETE` | `/vehicles/{vin}/drivers` | Remove driver access (body: `{ "share_user_id": N }`) |
| `GET` | `/vehicles/{vin}/invitations` | List active share invites (paginated, max 25) |
| `POST` | `/vehicles/{vin}/invitations` | Create share invite (returns single-use link, expires 24h) |
| `POST` | `/vehicles/{vin}/invitations/{id}/revoke` | Revoke a pending invite |
| `POST` | `/invitations/redeem` | Redeem an invite (body: `{ "code": "..." }`) |

## Step 1 — Database Migration

Create `migrations/000108_add_tesla_vehicle_drivers.up.sql`:

```sql
-- Vehicle drivers (who has access)
CREATE TABLE IF NOT EXISTS tesla_vehicle_drivers (
    id              BIGSERIAL PRIMARY KEY,
    vehicle_id      BIGINT NOT NULL,
    vin             TEXT NOT NULL,
    share_user_id   BIGINT,
    driver_email    TEXT,
    driver_name     TEXT,
    role            TEXT,
    raw_json        JSONB NOT NULL DEFAULT '{}',
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_drivers_vid ON tesla_vehicle_drivers (vehicle_id);

-- Share invitations
CREATE TABLE IF NOT EXISTS tesla_vehicle_invitations (
    id                  BIGSERIAL PRIMARY KEY,
    vehicle_id          BIGINT NOT NULL,
    vin                 TEXT NOT NULL,
    invitation_id       TEXT NOT NULL,
    invite_url          TEXT,
    status              TEXT NOT NULL DEFAULT 'pending',
    expires_at          TIMESTAMPTZ,
    created_by          TEXT,
    raw_json            JSONB NOT NULL DEFAULT '{}',
    fetched_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_invitations_vid ON tesla_vehicle_invitations (vehicle_id);
```

And matching `.down.sql`.

## Step 2 — Backend: Add Tesla client methods

```go
// GetVehicleDrivers calls GET /api/1/vehicles/{vin}/drivers.
func (c *Client) GetVehicleDrivers(ctx context.Context, vin string) ([]byte, int, error) {
    path := fmt.Sprintf("/api/1/vehicles/%s/drivers", vin)
    return c.doRequest(ctx, http.MethodGet, path, nil)
}

// RemoveVehicleDriver calls DELETE /api/1/vehicles/{vin}/drivers.
func (c *Client) RemoveVehicleDriver(ctx context.Context, vin string, shareUserID int64) ([]byte, int, error) {
    path := fmt.Sprintf("/api/1/vehicles/%s/drivers", vin)
    body := fmt.Sprintf(`{"share_user_id": %d}`, shareUserID)
    return c.doRequest(ctx, http.MethodDelete, path, bytes.NewReader([]byte(body)))
}

// GetVehicleInvitations calls GET /api/1/vehicles/{vin}/invitations.
func (c *Client) GetVehicleInvitations(ctx context.Context, vin string) ([]byte, int, error) {
    path := fmt.Sprintf("/api/1/vehicles/%s/invitations", vin)
    return c.doRequest(ctx, http.MethodGet, path, nil)
}

// CreateVehicleInvitation calls POST /api/1/vehicles/{vin}/invitations.
func (c *Client) CreateVehicleInvitation(ctx context.Context, vin string) ([]byte, int, error) {
    path := fmt.Sprintf("/api/1/vehicles/%s/invitations", vin)
    return c.doRequest(ctx, http.MethodPost, path, nil)
}

// RevokeVehicleInvitation calls POST /api/1/vehicles/{vin}/invitations/{id}/revoke.
func (c *Client) RevokeVehicleInvitation(ctx context.Context, vin, invitationID string) ([]byte, int, error) {
    path := fmt.Sprintf("/api/1/vehicles/%s/invitations/%s/revoke", vin, invitationID)
    return c.doRequest(ctx, http.MethodPost, path, nil)
}
```

## Step 3 — Backend: Add handler

Create `internal/api/vehicle_access_handler.go`:
- `ListDrivers(w, r)` — read from DB
- `RefreshDrivers(w, r)` — fetch from Tesla, replace in DB
- `RemoveDriver(w, r)` — call Tesla API, then refresh DB
- `ListInvitations(w, r)` — read from DB
- `RefreshInvitations(w, r)` — fetch from Tesla, replace in DB
- `CreateInvitation(w, r)` — call Tesla API, save to DB, return link
- `RevokeInvitation(w, r)` — call Tesla API, update DB status

## Step 4 — Backend: Wire routes

```go
r.Route("/vehicles/{vehicleID}/drivers", func(r chi.Router) {
    r.Get("/", accessHandler.ListDrivers)
    r.Post("/refresh", accessHandler.RefreshDrivers)
    r.Delete("/", accessHandler.RemoveDriver)
})
r.Route("/vehicles/{vehicleID}/invitations", func(r chi.Router) {
    r.Get("/", accessHandler.ListInvitations)
    r.Post("/", accessHandler.CreateInvitation)
    r.Post("/refresh", accessHandler.RefreshInvitations)
    r.Post("/{invitationID}/revoke", accessHandler.RevokeInvitation)
})
```

## Step 5 — Frontend: Add hooks

In `web/src/api/hooks/useVehicles.ts`:

```typescript
export function useVehicleDrivers(vehicleId?: string) {
    return useQuery({
        queryKey: ['vehicle-drivers', vehicleId],
        queryFn: () => request<VehicleDriver[]>(`/vehicles/${vehicleId}/drivers`),
        enabled: !!vehicleId,
        staleTime: 60_000,
    });
}

export function useVehicleInvitations(vehicleId?: string) {
    return useQuery({
        queryKey: ['vehicle-invitations', vehicleId],
        queryFn: () => request<VehicleInvitation[]>(`/vehicles/${vehicleId}/invitations`),
        enabled: !!vehicleId,
        staleTime: 60_000,
    });
}

// Mutations for create invite, revoke, remove driver
```

## Step 6 — Frontend: Display

Create a **"Vehicle Access"** page or section:
- **Drivers list** — table showing name, email, role with "Remove" button
- **Invitations list** — table showing status, expiry, link with "Revoke" button
- **"Invite Driver"** button that creates a new invitation and shows the link
- Refresh buttons for both sections

## Verification

```bash
go build ./...
cd web && npx tsc --noEmit
ls migrations/000108_add_tesla_vehicle_drivers.*
grep -n "drivers\|invitations" internal/api/router.go
```
