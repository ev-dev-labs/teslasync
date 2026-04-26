# Phase 18 — Auth Unification

## Goal

Replace the scattered auth system (Authentik-specific JWT token exchange, API key query
params, frontend SSE token fetch) with a single provider-agnostic ForwardAuth header check.
One configurable env var `FORWARD_AUTH_HEADER`. No vendor lock-in to Authentik.

## Current auth landscape

- **Authentik ForwardAuth** at Traefik ingress level (validates browser sessions)
- **Go-level `AuthentikSSEAuth()`** middleware with JWT token exchange for SSE
- **Go-level `APIKeyMiddleware`** for M2M watch endpoints (KEEP)
- **Frontend `fetchSSEToken()`** + `?token=` URL for SSE connections

## Prompt ordering (7 atomic prompts)

```
── Backend ──
00 — Add FORWARD_AUTH_HEADER config + ForwardAuthMiddleware
01 — Wire ForwardAuthMiddleware to all /api/v1/* routes
02 — Remove SSE token exchange (backend) — AuthentikSSEAuth, SSETokenHandler
03 — Remove Authentik-specific config — AuthentikURL, AuthentikHMACKey

── Frontend ──
04 — Remove SSE token exchange (frontend) — fetchSSEToken, ?token=

── Helm ──
05 — Update Helm chart templates — forwardAuthHeader, deprecate Authentik config

── Gate ──
06 — Gate: build + vet + tsc + full auth regression checks
```

## Key decisions

1. **Prompt 00** — Empty `FORWARD_AUTH_HEADER` means no-op (dev mode), not a crash
2. **Prompt 01** — ForwardAuthMiddleware protects ALL `/api/v1/*` routes; health probes stay outside
3. **Prompt 02** — `/sse-token` endpoint returns empty token for backward compat (removed in 04)
4. **Prompt 03** — `authentik_middleware.go` deleted if empty after prompt 02 removals
5. **Prompt 04** — Browser sends auth cookie automatically (same domain) — no token needed
6. **Prompt 05** — Common ForwardAuth header values documented for Authentik, Authelia, oauth2-proxy, Keycloak
7. **APIKeyMiddleware** stays on `/watch` routes — it's a separate M2M auth zone, not touched
