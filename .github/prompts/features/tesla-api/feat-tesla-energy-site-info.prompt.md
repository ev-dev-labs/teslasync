---
description: "Add Tesla energy site info endpoint: fetch site configuration, assets, and settings from Tesla, persist to DB"
---

# Feature: Tesla Energy Site Info (`/energy_sites/{id}/site_info`)

## Overview

Fetch `GET /api/1/energy_sites/{energy_site_id}/site_info` from Tesla Fleet API to get
detailed site configuration — installed components, backup reserve settings, operation mode,
firmware version, and grid services status. Persist to DB and display on the energy site
detail page.

## Tesla Fleet API

```
GET /api/1/energy_sites/{energy_site_id}/site_info
```

**Response** includes:
- `site_name`, `time_zone_offset`, `installation_time_zone`
- `backup_reserve_percent` — battery reserve for outages (0–100)
- `default_real_mode` — `"autonomous"` (time-based) or `"self_consumption"` (self-powered)
- `components` — what's installed (solar, battery, grid, load_meter, etc.)
- `version` — firmware version
- `battery_count` — number of Powerwall units
- `nameplate_power`, `nameplate_energy` — rated capacity

> **Requires:** `energy_site_id` from the `/products` endpoint (see `feat-tesla-energy-products`).

## Step 1 — Database: Store in `tesla_user_config`

Reuse the `tesla_user_config` table (from migration 000101) with
`config_type = 'site_info:{energy_site_id}'`. This stores the full JSON per site.

No new migration needed.

## Step 2 — Backend: Add Tesla client method

In `internal/tesla/client.go`:

```go
// GetEnergySiteInfo calls GET /api/1/energy_sites/{id}/site_info.
func (c *Client) GetEnergySiteInfo(ctx context.Context, energySiteID int64) ([]byte, int, error) {
    path := fmt.Sprintf("/api/1/energy_sites/%d/site_info", energySiteID)
    return c.doRequest(ctx, http.MethodGet, path, nil)
}
```

## Step 3 — Backend: Add handler methods

In the energy site handler:

```go
// SiteInfo returns stored site info from DB.
func (h *EnergySiteHandler) SiteInfo(w http.ResponseWriter, r *http.Request) {
    siteID, err := urlParamInt64(r, "siteID")
    if err != nil { writeError(w, http.StatusBadRequest, "invalid site ID"); return }

    key := fmt.Sprintf("site_info:%d", siteID)
    cfg, err := h.configRepo.GetByType(r.Context(), key)
    if err != nil { writeError(w, http.StatusInternalServerError, "failed to fetch"); return }
    if cfg == nil { writeJSON(w, http.StatusOK, map[string]interface{}{}); return }

    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(http.StatusOK)
    w.Write([]byte(cfg.Data))
}

// RefreshSiteInfo fetches from Tesla and saves to DB.
func (h *EnergySiteHandler) RefreshSiteInfo(w http.ResponseWriter, r *http.Request) {
    siteID, err := urlParamInt64(r, "siteID")
    // ... fetch from Tesla, unwrap envelope, upsert with key "site_info:{siteID}"
}
```

## Step 4 — Backend: Wire routes

```go
r.Route("/tesla/energy-sites/{siteID}", func(r chi.Router) {
    r.Get("/site-info", energySiteHandler.SiteInfo)
    r.Post("/site-info/refresh", energySiteHandler.RefreshSiteInfo)
})
```

## Step 5 — Frontend: Add hook

In `web/src/api/hooks/useEnergy.ts`:

```typescript
export function useTeslaEnergySiteInfo(siteId?: number) {
    return useQuery({
        queryKey: ['tesla-site-info', siteId],
        queryFn: () => request<Record<string, unknown>>(`/tesla/energy-sites/${siteId}/site-info`),
        enabled: !!siteId,
        staleTime: 5 * 60_000,
    });
}

export function useRefreshTeslaEnergySiteInfo(siteId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: () => request<Record<string, unknown>>(`/tesla/energy-sites/${siteId}/site-info/refresh`, { method: 'POST' }),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['tesla-site-info', siteId] }),
    });
}
```

## Step 6 — Frontend: Display

Show on the energy site detail page:
- Operation mode (Self-Powered / Time-Based Control)
- Backup reserve % (with visual gauge)
- Battery count and rated capacity
- Installed components badges (Solar, Battery, Grid, Load Meter)
- Firmware version
- Storm Mode capability badge

## Verification

```bash
go build ./...
cd web && npx tsc --noEmit
grep -n "site-info" internal/api/router.go
grep -n "GetEnergySiteInfo" internal/tesla/client.go
```
