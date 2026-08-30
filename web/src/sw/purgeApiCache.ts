/**
 * @module sw/purgeApiCache
 *
 * Drops every cached authenticated API read (PWA-02 / identity transitions).
 *
 * ## Why this lives here and not in `hooks/usePwaUpdate.ts`
 *
 * The purge has two callers with very different dependency graphs:
 *
 *   - the update lifecycle hook, when the API-contract handshake fails, and
 *   - `lib/resilience.ts`, on every sign-out / reauth / account transition.
 *
 * `resilience.ts` is imported (transitively) by `api/client.ts`, which is
 * imported by `useVersionWatcher`, which `usePwaUpdate` imports. Calling the
 * hook's copy from `resilience.ts` would close that loop into an import
 * cycle, so the sender lives in this leaf module instead: it depends only on
 * `buildContract` (constants) and `swProtocol` (a string map plus a type-only
 * import), and on nothing in `lib/` or `hooks/`.
 *
 * ## Why the purge is belt-and-braces
 *
 * A signed-out user's browser must not keep the previous identity's vehicle
 * list, drive list or notification counts on disk. Two independent mechanisms
 * run because each covers a case the other cannot:
 *
 *   1. **`postMessage` to the controlling worker** — dispatched
 *      *synchronously*, which matters because the caller navigates away on the
 *      very next line. The worker outlives the page, so the `caches.delete()`
 *      it performs completes even though the document is being torn down.
 *      This is the primary mechanism.
 *   2. **A direct `caches.delete()` from the page** — covers an uncontrolled
 *      page (first load after install, or a worker that was unregistered) and,
 *      unlike the worker, sweeps the API buckets of *every* build id rather
 *      than only the current one. A previous deploy's
 *      `teslasync-api-reads-<old build>` cache is exactly as identity-bearing
 *      as the current one.
 *
 * Both are best-effort and never throw: a failed purge must not be able to
 * block a sign-out.
 */

import { API_CACHE_BUCKET_PREFIX, isApiReadCacheName } from './buildContract'
import { PAGE_TO_SW } from './swProtocol'

export { API_CACHE_BUCKET_PREFIX, isApiReadCacheName }

/**
 * Structural view of `navigator.serviceWorker`.
 *
 * Written without `ServiceWorkerContainer` so this module stays compilable
 * under the WebWorker lib too — `tsconfig.sw.json` type-checks everything
 * under `src/sw/`, and `WorkerNavigator` has no `serviceWorker` property.
 */
interface ServiceWorkerContainerLike {
  controller?: { postMessage(message: unknown): void } | null
}

function serviceWorkerContainer(): ServiceWorkerContainerLike | null {
  const nav = (globalThis as {
    navigator?: { serviceWorker?: ServiceWorkerContainerLike }
  }).navigator
  return nav?.serviceWorker ?? null
}

/**
 * Synchronously ask the controlling service worker to drop its API cache.
 *
 * Returns `false` when there is no controller to ask — the caller should then
 * rely on {@link purgeApiCacheStorage}. Never throws.
 */
export function postPurgeApiCacheToServiceWorker(): boolean {
  try {
    const controller = serviceWorkerContainer()?.controller
    if (controller == null) return false
    controller.postMessage({ type: PAGE_TO_SW.purgeApiCache })
    return true
  } catch {
    // postMessage throws on a terminated worker; nothing to recover.
    return false
  }
}

/**
 * Delete every API-read cache bucket directly from the page, across all
 * build ids. Resolves with the number of buckets removed; never rejects.
 */
export async function purgeApiCacheStorage(): Promise<number> {
  const storage = (globalThis as { caches?: CacheStorage }).caches
  if (storage == null) return 0
  try {
    const names = await storage.keys()
    const targets = names.filter(isApiReadCacheName)
    const results = await Promise.all(
      targets.map((name) => storage.delete(name).catch(() => false)),
    )
    return results.filter(Boolean).length
  } catch {
    // Storage may be unavailable (private mode, disabled). The worker-side
    // purge above is the primary mechanism.
    return 0
  }
}

/**
 * Purge cached API reads on an identity transition.
 *
 * Deliberately synchronous so it can be called immediately before
 * `window.location.assign(...)` without the caller having to await anything;
 * the storage sweep is kicked off and allowed to finish in the background
 * (or in the service worker, which survives the navigation).
 */
export function purgeServiceWorkerApiCache(): void {
  postPurgeApiCacheToServiceWorker()
  void purgeApiCacheStorage()
}
