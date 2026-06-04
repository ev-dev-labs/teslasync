# ADR-013 — Offline / cache strategy + freshness contract

**Status:** Accepted · 2026-06 · Supersedes: none

## Context

Native apps are launched offline or on flaky networks far more than a web SPA. Users
expect last-known vehicle state, recent drives/charges, and settings to render instantly,
then refresh. The backend already distinguishes live (L1/L2) vs. durable history
(`signal_log`); the apps need a client-side equivalent without lying about freshness.

## Decision

- **Local store:** the shared core uses **SQLDelight** (KMP, Android+Apple) for a typed
  offline cache; Windows uses **SQLite (Microsoft.Data.Sqlite/EF Core)** with the same schema.
- **Pattern:** repositories follow **cache-then-network** — emit cached data immediately,
  fetch fresh, reconcile, and **stamp every cached value with `fetched_at`**. The UI shows a
  freshness indicator and treats live values older than **2 minutes** as *stale* (matches the
  backend cross-pod contract) and offline-only data as clearly labeled.
- **Scope:** cache read-models (vehicle list, last state, recent drives/charges/trips,
  settings, dashboards). Do **not** cache write-intent as if applied (commands go through the
  command-proxy and reflect real backend state).
- **Eviction:** time + size bounded; PII encrypted at rest where the platform supports it.

## Consequences

- ✅ Instant cold-start UI; graceful degradation offline; honest freshness (no stale-as-live).
- ✅ One cache schema shared by Android+Apple; Windows mirrors it (golden fixtures).
- ⚠️ Cache invalidation rules per domain must be specified per parity unit (the prompt states
  staleTime, matching the web hook's TanStack `staleTime`).
- ⚠️ Encrypted SQLite differs per platform; secret material (tokens) stays in secure storage
  (ADR-008), never in the cache DB.

## Alternatives rejected

- **No cache (always-network):** poor native UX, blank cold starts.
- **Cache without freshness stamps:** risks showing stale data as live — forbidden.
