# Caching and Freshness

TeslaSync uses several caching layers. Each layer has a different owner and invalidation rule, so avoid treating Redis, TanStack Query, and PWA caches as the same thing.

## Runtime cache layers

| Layer | Used by | Purpose | Freshness rule |
|---|---|---|---|
| Redis | Go API | Cross-process live signal cache, restart recovery, and SSE fanout support | Mirrored from telemetry writes and refreshed by active streams |
| SignalStore | Go process memory | Per-process last-known-good signal map for FSM, CEP, session tracking, and local reads | Updated in the telemetry path; warmed from Redis first, then signal history |
| TanStack Query | React SPA | Browser data cache for API hooks | Query-specific `staleTime`, invalidated after mutations |
| Workbox/PWA | Browser service worker | Static assets, Google Fonts, map tiles, app shell fallback | Versioned build assets; API/SSE routes are denied from navigate fallback |
| Grafana/Postgres | Grafana dashboards | Historical analytics over SQL views/continuous aggregates | Database refresh policies and query windows |

## What is not cached by the service worker

The PWA is intentionally conservative with live data. The generated service worker denies navigation fallback for:

```text
/api
/ws
/healthz
/readyz
```

API responses and SSE streams should come from the network. Static bundles, fonts, icons, and map tiles can be cached.

## Redis guidance

Redis is the cross-process live signal cache and restart-recovery layer. It does not eliminate the per-process SignalStore: Fleet Telemetry updates both the in-memory map and Redis. Durable history/current-state tables still matter for recovery and analytics, so Redis loss should degrade to database/in-memory behavior after fresh telemetry arrives rather than silently claiming fresh live telemetry.

## Frontend invalidation guidance

- Use the hook domain key factories in `web/src/api/hooks/`.
- Invalidate the smallest practical query group after mutations.
- Keep live screens on short refresh intervals only when SSE is disconnected.
- Avoid custom `fetch()` calls inside components; use API hooks so caching and error handling stay consistent.

## PWA update guidance

The app uses prompt-based service worker updates. When a new build is available, the reload prompt should let the user opt into activating it. Development service workers are disabled unless `VITE_PWA_DEV=true`.
