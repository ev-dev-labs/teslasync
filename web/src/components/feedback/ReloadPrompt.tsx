import { useEffect } from 'react'

import { usePwaUpdate } from '@/hooks/usePwaUpdate'
import { useAppLifecycle } from '@/hooks/useAppLifecycle'
import { useServiceWorkerBridge } from '@/hooks/useServiceWorkerBridge'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { subscribe } from '@/lib/broadcast'
import { purgeServiceWorkerApiCache } from '@/sw/purgeApiCache'
import { UpdatePrompt } from './UpdatePrompt'
import { CachedDataNotice } from './CachedDataNotice'
import { OfflineBanner } from './OfflineBanner'

/**
 * Application-root PWA host.
 *
 * Mounted once from `main.tsx`. It owns every piece of device/PWA lifecycle
 * that must exist regardless of which route is open, and deliberately owns
 * them in ONE place so none of them can be double-registered:
 *
 *  - {@link useServiceWorkerBridge} mirrors the device notification policy and
 *    the low-bandwidth flag into the service worker, and re-sends them
 *    whenever an update swaps the controlling worker (PWA-05 / PWA-07).
 *  - {@link usePwaUpdate} detects, explains and applies new builds without
 *    ever reloading behind the user's back (PWA-03 / PWA-04).
 *  - {@link useAppLifecycle} recovers after the OS backgrounds, freezes or
 *    bfcache-restores the app: it re-invalidates the visible queries, resets
 *    a zombie SSE pipe, and runs an out-of-band update check (PWA-08).
 *  - the `auth.logout` broadcast funnel, below.
 *  - {@link OfflineBanner} is THE global owner of the browser-offline
 *    announcement. It used to be mounted by `<Layout>` in standard
 *    presentation mode only, which meant the six routes that never mount
 *    `<Layout>` — and every report/kiosk view — announced the transition zero
 *    times. Mounting it here makes ownership global and singular.
 *  - {@link CachedDataNotice} discloses, while offline, exactly when the data
 *    on screen was captured (PWA-02). It is deliberately NON-live
 *    (`role="note"`) because the banner above owns the announcement.
 *
 * The file keeps its historical name because `main.tsx` imports it by path;
 * the countdown-and-auto-reload banner it used to be now lives in
 * `UpdatePrompt.tsx` — without the countdown, which discarded unsaved work
 * for anyone who looked away for three seconds.
 */
export default function ReloadPrompt() {
  const online = useOnlineStatus()

  useServiceWorkerBridge()
  const update = usePwaUpdate()
  useAppLifecycle({ onCheckForUpdate: update.checkForUpdate })

  // Identity-transition purge, broadcast funnel.
  //
  // `lib/resilience.ts::navigateToReauth()` purges synchronously in the tab
  // that is signing out and then broadcasts `auth.logout`. This listener is
  // the receiving half: a sibling tab that was NOT the one navigating must
  // also drop the previous identity's cached API reads, because it may be
  // uncontrolled (so the first tab's worker-side purge could have been a
  // no-op) and because it will keep rendering until the user returns to it.
  //
  // Cache Storage is shared per-origin, so a second purge is idempotent and
  // cheap; correctness here matters more than avoiding a redundant delete.
  useEffect(() => {
    return subscribe((message) => {
      if (message.type !== 'auth.logout') return
      purgeServiceWorkerApiCache()
    })
  }, [])

  return (
    <>
      {/* Global, singular owner of the offline announcement — every route and
          every presentation mode. Renders the visible chip in standard mode
          and a screen-reader-only live region in report/kiosk. */}
      <OfflineBanner />
      {!online && (
        // Positioning wrapper only — no role and no aria-label. An aria-label
        // on a roleless <div> is ignored by assistive technology, and giving
        // this element a role would create a second announcement competing
        // with <OfflineBanner> above. The notice inside owns its own
        // semantics as a NON-live note and states the offline condition in
        // its visible text.
        <div
          data-testid="pwa-offline-disclosure"
          className="fixed inset-x-3 top-[calc(0.75rem+env(safe-area-inset-top,0px))] z-[9990] mx-auto max-w-md lg:inset-x-auto lg:right-4 lg:w-[28rem]"
        >
          <CachedDataNotice announce={false} />
        </div>
      )}
      <UpdatePrompt state={update} />
    </>
  )
}
