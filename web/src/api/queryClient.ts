/**
 * Phase-46 / Prompt 53 — Pause polling when document hidden.
 *
 * Centralises the QueryClient defaults shared between `main.tsx` (the
 * production bootstrap) and `queryClient.test.ts` (the behavioural
 * regression suite). Extracting the factory keeps the configuration in
 * a single source-of-truth and makes the defaults independently
 * testable without booting React.
 *
 * The defining behaviour of this prompt is `refetchIntervalInBackground:
 * false` at the `defaultOptions.queries` layer. With that flip, every
 * `refetchInterval`-driven query in the SPA automatically stops firing
 * while `document.hidden === true` (TanStack Query consults its own
 * `focusManager`, which by default mirrors `document.visibilityState`)
 * and resumes the moment the tab becomes visible again. Background
 * tabs no longer burn Tesla API quota, CPU, or battery.
 *
 * Hooks that genuinely need to keep polling while the tab is in the
 * background MUST opt in *per query* with both:
 *
 *     useQuery({
 *       refetchInterval: 30_000,
 *       // ALLOW-BG-POLLING: <reason>
 *       refetchIntervalInBackground: true,
 *     })
 *
 * The companion `audit:bg-polling` script (web/scripts/audit-background-polling.mjs)
 * fails CI if any `refetchIntervalInBackground: true` is found without
 * an `// ALLOW-BG-POLLING: <reason>` annotation on the same line or the
 * directly preceding non-blank line.
 */

import { QueryClient, type QueryClientConfig } from '@tanstack/react-query'

/**
 * Default configuration applied to every QueryClient created via
 * `createQueryClient`. Exported so the audit + tests can introspect it
 * without instantiating a client.
 *
 * Mirrors the previous inline `main.tsx` configuration verbatim except
 * for the new `refetchIntervalInBackground: false` line. Existing
 * networkMode / retry / staleTime semantics are preserved so this
 * prompt is a strictly additive change for callers.
 */
export const DEFAULT_QUERY_CLIENT_CONFIG: QueryClientConfig = {
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: 1,
      retryDelay: (attempt) => Math.min(2000 * 2 ** attempt, 30_000),
      refetchOnWindowFocus: false,
      // PWA: serve cached data when the device is offline instead of
      // throwing immediately. TanStack Query keeps the query in 'paused'
      // state until `navigator.onLine` flips back to true, then automatically
      // refetches. Combined with `<OfflineBanner>` this gives Tesla owners a
      // usable app inside tunnels / dead-zones without a hard error wall.
      networkMode: 'offlineFirst',
      // Phase-46 / Prompt 53: pause `refetchInterval`-driven polling
      // while the document is hidden. Saves Tesla API quota + CPU +
      // battery for users who leave TeslaSync open in a background
      // tab. Hooks that must keep polling in the background MUST
      // override this per-query and add an `// ALLOW-BG-POLLING:
      // <reason>` annotation; the `audit:bg-polling` script enforces
      // the annotation requirement.
      refetchIntervalInBackground: false,
    },
    mutations: {
      retry: 1,
      // PWA: queue mutations triggered while offline (instead of erroring) and
      // replay them automatically when the connection returns. Long-term
      // durability across full page reloads requires a persister — see the
      // out-of-scope note in phase-40 prompt 36.
      networkMode: 'offlineFirst',
    },
  },
}

/**
 * Construct a fresh QueryClient using the shared defaults. Tests
 * should always use this factory (never `new QueryClient()`) so that
 * regressions in the defaults — particularly the pause-when-hidden
 * contract — are caught by the queryClient test suite.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient(DEFAULT_QUERY_CLIENT_CONFIG)
}
