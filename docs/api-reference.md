# API Reference

The HTTP API has two flavours of reference depending on who you are.

## If you're using TeslaSync

→ Go to [Guide → API Endpoints](/guide/api-endpoints).

That page lists every endpoint the platform exposes, grouped by resource, with examples. It's the document you want if you're integrating something else against the TeslaSync API or troubleshooting a request the frontend made.

## If you're building TeslaSync

→ Go to [Contributing → API Reference](/contributing/api-reference).

That page covers the conventions every endpoint follows, the layering rules, the Helix AI route-wrapping contract, the per-endpoint review checklist, and the end-to-end pattern for adding a new resource. It's the document you want if you're writing code that adds, changes, or refactors API routes.

## Quick fact sheet

| Thing                          | Value                                                      |
| ------------------------------ | ---------------------------------------------------------- |
| Base path                      | `/api/v1`                                                  |
| Default port                   | `8080`                                                     |
| Auth model                     | Forward-auth header (`FORWARD_AUTH_HEADER`, default `X-Forwarded-User`) |
| Time format                    | RFC3339 (`time.RFC3339Nano` from Go)                       |
| Numeric units                  | SI everywhere (meters, m/s, °C, Pa, kWh stored as Joules)  |
| Path / query param case        | snake_case                                                 |
| List response shape            | `{ "<resource>": [ … ] }`                                  |
| Error response shape           | `{ "error": "...", "code": "..." }`                        |
| Tesla command endpoints        | 65 unique across 17 categories — see [Remote Commands](/guide/remote-commands) |
| Helix AI endpoints             | 54 user-facing features, wrapped with off-by-default — see [Helix AI](/guide/helix-ai) |
| Live updates                   | SSE at `/api/v1/events` with adaptive polling fallback     |
| Health / readiness             | `/healthz`, `/readyz` (no auth)                            |

## Where else to look

- [Architecture](/guide/architecture) for the runtime view of how requests flow through the stack
- [Configuration](/guide/configuration) for every environment variable that affects the API
- [Caching](/caching) for the L1 / L2 / TanStack / service-worker layering that wraps the API
- [Troubleshooting](/guide/troubleshooting) for what to do when a request misbehaves
