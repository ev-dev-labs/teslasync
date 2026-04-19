---
description: "Add Tesla partner public key verification endpoint: check registered domain public key"
---

# Feature: Tesla Partner Public Key (`/partner_accounts/public_key`)

## Overview

Add `GET /api/1/partner_accounts/public_key?domain={domain}` to verify that the partner
registration was successful and the public key is correctly associated with the domain.
This is a diagnostic endpoint useful on the Fleet API / DevTools page.

Persist the result to the `tesla_user_config` table for quick access.

## Tesla Fleet API

```
GET /api/1/partner_accounts/public_key?domain={domain}
```

**Requires:** Partner authentication token (client_credentials), NOT user OAuth token.

**Response** (example):
```json
{
  "response": {
    "public_key": "-----BEGIN PUBLIC KEY-----\nMFkwEwYH...\n-----END PUBLIC KEY-----"
  }
}
```

## Step 1 — Backend: Add Tesla client method

In `internal/tesla/client.go`:

```go
// GetPartnerPublicKey calls GET /api/1/partner_accounts/public_key?domain={domain}
// using a partner token to verify the registered public key.
func (c *Client) GetPartnerPublicKey(ctx context.Context, domain string) ([]byte, int, error) {
    partnerToken, err := c.GetPartnerToken(ctx)
    if err != nil {
        return nil, 0, fmt.Errorf("get partner token: %w", err)
    }
    path := fmt.Sprintf("/api/1/partner_accounts/public_key?domain=%s", url.QueryEscape(domain))
    return c.doRequestWithToken(ctx, http.MethodGet, path, nil, partnerToken)
}
```

## Step 2 — Backend: Add handler

In the DevTools handler or a new partner handler:

```go
// PartnerPublicKey fetches and returns the registered public key for a domain.
func (h *DevToolsHandler) PartnerPublicKey(w http.ResponseWriter, r *http.Request) {
    domain := r.URL.Query().Get("domain")
    if domain == "" {
        writeError(w, http.StatusBadRequest, "domain query parameter is required")
        return
    }

    body, status, err := h.teslaClient.GetPartnerPublicKey(r.Context(), domain)
    if err != nil {
        writeError(w, http.StatusBadGateway, "failed to fetch public key from Tesla")
        return
    }

    // Optionally persist to tesla_user_config with key "partner_public_key"
    var envelope struct { Response json.RawMessage `json:"response"` }
    if err := json.Unmarshal(body, &envelope); err == nil {
        _ = h.configRepo.Upsert(r.Context(), "partner_public_key", string(envelope.Response))
    }

    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(status)
    w.Write(body)
}
```

## Step 3 — Backend: Wire route

In `internal/api/router.go`, add to the devtools route group:

```go
r.Get("/partner-public-key", devToolsHandler.PartnerPublicKey)
```

## Step 4 — Frontend: Add hook

In `web/src/api/hooks/useAdmin.ts`:

```typescript
export function usePartnerPublicKey(domain?: string) {
    return useQuery({
        queryKey: ['partner-public-key', domain],
        queryFn: () => request<{ public_key: string }>(
            `/admin/devtools/partner-public-key?domain=${domain}`
        ),
        enabled: !!domain,
        staleTime: Infinity,
    });
}
```

## Step 5 — Frontend: Display

Add a "Public Key Verification" card on the Fleet API / DevTools page:
- Input field for domain
- "Verify" button to fetch
- Show the PEM public key in a code block with copy button
- Green checkmark if key exists, red X if not found

## Verification

```bash
go build ./...
cd web && npx tsc --noEmit
grep -n "GetPartnerPublicKey" internal/tesla/client.go
grep -n "partner-public-key" internal/api/router.go
```
