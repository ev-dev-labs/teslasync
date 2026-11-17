/**
 * Pause polling when the document is hidden.
 *
 * Centralises the QueryClient defaults shared between `main.tsx` (the
 * production bootstrap) and `queryClient.test.ts` (the behavioural
 * regression suite). Extracting the factory keeps the configuration in
 * a single source-of-truth and makes the defaults independently
 * testable without booting React.
 *
 * The defining behaviour is `refetchIntervalInBackground:
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

import { QueryCache, QueryClient, type QueryClientConfig } from '@tanstack/react-query'
import { isSafeRead } from '@/lib/rateLimit'
import { isApiError, isRateLimitError, isUpstreamUnavailableError } from '@/lib/resilience'
import { reportFrontendError } from '@/lib/errorReporter'

function retryRead(failureCount: number, error: unknown): boolean {
  if ((error as { name?: unknown } | null)?.name === 'AbortError' ||
      isRateLimitError(error) || isUpstreamUnavailableError(error)) return false
  if (isApiError(error) && error.status >= 400 && error.status < 500 && error.status !== 408) return false
  return failureCount < 1
}

/**
 * Default configuration applied to every QueryClient created via
 * `createQueryClient`. Exported so the audit + tests can introspect it
 * without instantiating a client.
 *
 * The query layer owns transient-read retries; quota recovery is separately
 * bounded and waits for the server deadline. Mutations never retry.
 */
export const DEFAULT_QUERY_CLIENT_CONFIG: QueryClientConfig = {
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: retryRead,
      retryDelay: (attempt) => Math.min(2000 * 2 ** attempt * (0.75 + Math.random() * 0.5), 30_000),
      refetchOnWindowFocus: false,
      // PWA: serve cached data when the device is offline instead of
      // throwing immediately. TanStack Query keeps the query in 'paused'
      // state until `navigator.onLine` flips back to true, then automatically
      // refetches. Combined with `<OfflineBanner>` this gives Tesla owners a
      // usable app inside tunnels / dead-zones without a hard error wall.
      networkMode: 'offlineFirst',
      // Pause `refetchInterval` polling while the document is hidden.
      // This saves Tesla API quota, CPU, and battery for users who leave
      // TeslaSync open in a background tab. Hooks that must keep polling
      // in the background MUST
      // override this per-query and add an `// ALLOW-BG-POLLING:
      // <reason>` annotation; the `audit:bg-polling` script enforces
      // the annotation requirement.
      refetchIntervalInBackground: false,
    },
    mutations: {
      // Mutations are never replayed after connectivity returns. Replaying an
      // operator action outside its original context can duplicate commands or
      // apply stale edits. Hooks may still decide whether a write is valid in
      // historical mode, but every mutation executes (and fails) immediately.
      retry: 0,
      networkMode: 'always',
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
  let recoveryStarted = false
  const client: QueryClient = new QueryClient({
    ...DEFAULT_QUERY_CLIENT_CONFIG,
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (recoveryStarted || !isRateLimitError(error) || !isSafeRead(error.requestMethod) || !query.isActive()) return
        recoveryStarted = true
        void import('./rateLimitRecovery')
          .then(({ installRateLimitRecovery }) => installRateLimitRecovery(client))
          .catch((failure: unknown) => {
            recoveryStarted = false
            reportFrontendError(failure, 'promise')
          })
      },
    }),
  })
  return client
}
