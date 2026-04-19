---
description: "Add Tesla energy time-of-use settings command: update utility rate plan / tariff for energy site"
---

# Feature: Tesla Energy Time-of-Use Settings (`time_of_use_settings`)

## Overview

Add support for the `POST /api/1/energy_sites/{id}/time_of_use_settings` endpoint to update
a Powerwall site's utility rate plan (tariff). This is a write command (like vehicle commands)
that configures when to charge/discharge the battery based on electricity pricing.

## Tesla Fleet API

```
POST /api/1/energy_sites/{energy_site_id}/time_of_use_settings
```

**Request body:**
```json
{
  "tou_settings": {
    "optimization_strategy": "economics",
    "tariff_content_v2": {
      "name": "PG&E EV2-A",
      "utility": "Pacific Gas & Electric",
      "daily_charges": [{ "amount": 0.32854, "name": "Charge" }],
      "demand_charges": { "ALL": { "ALL": 0 } },
      "energy_charges": {
        "Summer": {
          "ON_PEAK": [{ "rate": 0.49, "start": 16, "end": 21 }],
          "OFF_PEAK": [{ "rate": 0.35, "start": 0, "end": 16 }, { "rate": 0.35, "start": 21, "end": 24 }]
        }
      },
      "seasons": {
        "Summer": { "fromMonth": 6, "fromDay": 1, "toMonth": 9, "toDay": 30 }
      }
    }
  }
}
```

> **Note:** This is a complex configuration. The MVP should provide preset common tariffs
> and allow advanced users to upload custom JSON. Full tariff builder UI is a future iteration.

## Step 1 — Backend: Add Tesla client method

```go
// SetEnergySiteTOUSettings calls POST /api/1/energy_sites/{id}/time_of_use_settings.
func (c *Client) SetEnergySiteTOUSettings(ctx context.Context, energySiteID int64, body io.Reader) ([]byte, int, error) {
    path := fmt.Sprintf("/api/1/energy_sites/%d/time_of_use_settings", energySiteID)
    return c.doRequest(ctx, http.MethodPost, path, body)
}
```

## Step 2 — Backend: Add handler

In the energy site handler:

```go
// UpdateTOUSettings proxies the TOU settings update to Tesla.
func (h *EnergySiteHandler) UpdateTOUSettings(w http.ResponseWriter, r *http.Request) {
    siteID, err := urlParamInt64(r, "siteID")
    if err != nil { writeError(w, http.StatusBadRequest, "invalid site ID"); return }

    if !h.teslaClient.HasValidToken() {
        writeError(w, http.StatusUnauthorized, "not authenticated with Tesla")
        return
    }

    body, status, err := h.teslaClient.SetEnergySiteTOUSettings(r.Context(), siteID, r.Body)
    if err != nil {
        writeError(w, http.StatusBadGateway, "failed to update TOU settings")
        return
    }
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(status)
    w.Write(body)
}
```

## Step 3 — Backend: Wire route

```go
r.Post("/tesla/energy-sites/{siteID}/tou-settings", energySiteHandler.UpdateTOUSettings)
```

## Step 4 — Frontend: Add hook

```typescript
export function useUpdateTOUSettings(siteId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (settings: Record<string, unknown>) =>
            request(`/tesla/energy-sites/${siteId}/tou-settings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings),
            }),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['tesla-site-info', siteId] }),
    });
}
```

## Step 5 — Frontend: Display

Add a "Rate Plan" section on the energy site detail page:
- Show current tariff name and utility provider (from site_info)
- "Update Rate Plan" button opens a modal with:
  - Dropdown of preset common tariffs (PG&E EV2-A, SCE TOU-D, etc.)
  - "Custom JSON" textarea for advanced users
  - Submit button

## Verification

```bash
go build ./...
cd web && npx tsc --noEmit
grep -n "tou-settings" internal/api/router.go
grep -n "SetEnergySiteTOUSettings" internal/tesla/client.go
```
