# Contributor API Reference

This page explains how contributors should connect frontend code to backend APIs.

## Source of truth

| Layer | File/path |
|---|---|
| Backend routes | `internal/api/router.go` |
| Backend models | `internal/models` |
| Frontend API client | `web/src/api/client.ts` |
| Frontend hooks | `web/src/api/hooks/*` |
| Frontend types | `web/src/api/types.ts` and `web/src/types/*` |

## Hook pattern

```ts
import { useQuery } from '@tanstack/react-query'
import { request } from '@/api/client'

export function useVehicles() {
  return useQuery({
    queryKey: ['vehicles'],
    queryFn: () => request('/vehicles'),
  })
}
```

Rules:

- Use `request('/path')`, not `fetch('/api/v1/path')`.
- Keep hook files domain-based.
- Use stable query keys.
- Invalidate queries after mutations.
- Surface loading/error/empty states in the page.

## Type alignment

Go models use snake_case JSON tags. Frontend types should match those fields unless a transform is explicitly documented.

```go
type Vehicle struct {
    DisplayName string `json:"display_name"`
}
```

```ts
interface Vehicle {
  display_name: string
}
```

## Auth behavior

ForwardAuth protects `/api/v1/*` when configured. Frontend code should not manually attach private proxy headers. Same-origin cookies and reverse proxy auth handle browser sessions.

## Public token routes

Public share and automation webhook routes use URL tokens and rate limits. Treat those tokens like secrets.

## API review checklist

- Route exists in `router.go`.
- Frontend hook URL matches route without `/api/v1`.
- Query params are snake_case.
- Types match Go JSON tags.
- Mutations invalidate relevant queries.
- Errors are displayed through shared feedback components.