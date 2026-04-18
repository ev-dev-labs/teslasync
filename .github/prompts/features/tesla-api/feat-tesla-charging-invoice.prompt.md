---
description: "Add Tesla charging invoice endpoint: download PDF invoice for a Supercharger charging session"
---

# Feature: Tesla Charging Invoice (`/dx/charging/invoice/{id}`)

## Overview

Add support for downloading Supercharger/DC charging invoice PDFs via
`GET /api/1/dx/charging/invoice/{id}`. The `contentId` comes from the charging history
response's `invoices` array. This is a proxy-through endpoint — no DB persistence needed
(PDFs are large and rarely re-accessed).

## Tesla Fleet API

```
GET /api/1/dx/charging/invoice/{contentId}
```

**Response:** PDF binary data (`Content-Type: application/pdf`)

> **Note:** The `contentId` is obtained from the `invoices[].contentId` field in the
> charging history response (see `feat-tesla-charging-history`).

## Step 1 — Backend: Add Tesla client method

In `internal/tesla/client.go`:

```go
// GetChargingInvoice calls GET /api/1/dx/charging/invoice/{contentId} and returns the PDF bytes.
func (c *Client) GetChargingInvoice(ctx context.Context, contentID string) ([]byte, int, error) {
    path := fmt.Sprintf("/api/1/dx/charging/invoice/%s", contentID)
    return c.doRequest(ctx, http.MethodGet, path, nil)
}
```

## Step 2 — Backend: Add handler

In `internal/api/tesla_charging_history_handler.go`, add:

```go
// Invoice proxies the PDF invoice download from Tesla.
func (h *TeslaChargingHistoryHandler) Invoice(w http.ResponseWriter, r *http.Request) {
    contentID := chi.URLParam(r, "contentID")
    if contentID == "" {
        writeError(w, http.StatusBadRequest, "content_id is required")
        return
    }

    if !h.teslaClient.HasValidToken() {
        writeError(w, http.StatusUnauthorized, "not authenticated with Tesla")
        return
    }

    body, status, err := h.teslaClient.GetChargingInvoice(r.Context(), contentID)
    if err != nil {
        writeError(w, http.StatusBadGateway, "failed to fetch invoice from Tesla")
        return
    }
    if status != http.StatusOK {
        writeError(w, status, "Tesla API error")
        return
    }

    w.Header().Set("Content-Type", "application/pdf")
    w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=tesla-invoice-%s.pdf", contentID))
    w.WriteHeader(http.StatusOK)
    w.Write(body)
}
```

## Step 3 — Backend: Wire route

```go
r.Get("/tesla/charging/invoice/{contentID}", teslaChargingHistoryHandler.Invoice)
```

## Step 4 — Frontend: Add download helper

In `web/src/api/hooks/useCharging.ts`:

```typescript
// Direct download — opens in new tab or triggers browser download
export function getTeslaChargingInvoiceURL(contentId: string): string {
    return `/api/v1/tesla/charging/invoice/${contentId}`;
}
```

## Step 5 — Frontend: Wire into Charging History table

On the `TeslaChargingHistoryPage`, add an invoice download button/link for rows that
have `has_invoice === true`:

```tsx
{entry.has_invoice && entry.invoice_content_id && (
    <a
        href={getTeslaChargingInvoiceURL(entry.invoice_content_id)}
        target="_blank"
        rel="noopener noreferrer"
        className="text-neon-cyan hover:text-neon-cyan/80 text-xs"
    >
        <Download className="h-3.5 w-3.5 inline mr-1" />
        {t('charging.invoice', 'Invoice')}
    </a>
)}
```

> **Note:** For the download URL, we use the full path `/api/v1/...` since this is an
> `<a href>` tag, not a `request()` call. The browser navigates directly.

## Verification

```bash
go build ./...
cd web && npx tsc --noEmit
grep -n "tesla/charging/invoice" internal/api/router.go
grep -n "GetChargingInvoice" internal/tesla/client.go
```
