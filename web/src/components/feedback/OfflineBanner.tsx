import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { WifiOff } from 'lucide-react'
import { AlertBanner } from './AlertBanner'
import { VisuallyHidden } from '@/components/a11y'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import {
  getPresentationMode,
  subscribePresentationMode,
} from '@/hooks/usePresentationMode'

/**
 * OfflineBanner — THE single owner of the browser-offline announcement.
 *
 * ## Ownership is global, not positional
 *
 * This component used to be mounted by `<Layout>` and only in `standard`
 * presentation mode. That made the offline announcement positional: every
 * route that never mounts `<Layout>` (`/quick-stats`, `/glance`,
 * `/year-review/:year`, `/s/:token`, `/watch`, `/onboarding`) and every
 * report/kiosk view announced the offline transition **zero times**. A user
 * on a shared trip link who drove into a tunnel got no signal at all — not
 * visually, not audibly.
 *
 * It is now mounted exactly once from `<ReloadPrompt>`, the application-root
 * PWA host that `main.tsx` renders for every route and every presentation
 * mode, alongside the update prompt and the cached-data disclosure. `<Layout>`
 * no longer mounts it, so there is exactly one instance and therefore exactly
 * one live region — no duplicate chatter on standard routes.
 *
 * ## Presentation-aware VISUALS, unconditional ANNOUNCEMENT
 *
 * Report and kiosk views deliberately suppress floating chrome (they are
 * printed or projected). Suppressing the *component* there is what created
 * the silent hole, so instead only the visual treatment changes:
 *
 *   - `standard` → the same fixed bottom-right `<AlertBanner>` as before,
 *     with identical copy, classes, `data-testid` and `role="status"` /
 *     `aria-live="polite"` semantics. Standard routes are visually unchanged.
 *   - `report` / `kiosk` → a visually-hidden polite live region. No chrome in
 *     the print/projection surface, but the transition is still announced.
 *
 * ## Router independence
 *
 * The mode is read from the module-level `getPresentationMode()` /
 * `subscribePresentationMode()` pair rather than the Router-bound
 * `usePresentationMode()` hook, so this component works — and can be
 * unit-tested — outside a `<Router>`. That matters because it is now mounted
 * above the route tree and must never be able to crash the shell.
 *
 * Cached data continues to render via the service worker's runtime cache and
 * TanStack Query's `networkMode: 'offlineFirst'`; the banner just tells the
 * user why what they are looking at may be stale. `<CachedDataNotice>` (also
 * mounted by `<ReloadPrompt>`) adds the exact capture time as a NON-live
 * `role="note"`, so this remains the only region that speaks.
 *
 * Hides automatically when the browser comes back online — no manual dismiss.
 */

/** How the offline state is presented. Announcement happens either way. */
export type OfflineBannerPresentation = 'banner' | 'screen-reader-only'

export interface OfflineBannerProps {
  /**
   * Override the presentation. Defaults to `banner` in `standard`
   * presentation mode and `screen-reader-only` in report/kiosk.
   */
  presentation?: OfflineBannerPresentation
}

function subscribeMode(onStoreChange: () => void): () => void {
  return subscribePresentationMode(onStoreChange)
}

function serverMode(): string {
  return 'standard'
}

export function OfflineBanner({ presentation }: OfflineBannerProps = {}) {
  const { t } = useTranslation()
  const online = useOnlineStatus()
  const mode = useSyncExternalStore(subscribeMode, getPresentationMode, serverMode)

  const resolved: OfflineBannerPresentation =
    presentation ?? (mode === 'standard' ? 'banner' : 'screen-reader-only')

  if (online) return null

  const title = t('pwa.offline.title', "You're offline")
  const body = t(
    'pwa.offline.banner',
    'Showing cached data. New requests will retry when you reconnect.',
  )

  if (resolved === 'screen-reader-only') {
    return (
      <VisuallyHidden
        as="div"
        liveRegion
        data-testid="offline-announcement"
        data-presentation-mode={mode}
      >
        {`${title}. ${body}`}
      </VisuallyHidden>
    )
  }

  return (
    <div
      data-testid="offline-banner"
      data-presentation-mode={mode}
      className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] right-4 z-[9997] max-w-sm lg:bottom-[calc(1rem+env(safe-area-inset-bottom,0px))]"
    >
      <AlertBanner
        variant="warning"
        title={title}
        icon={<WifiOff className="h-4 w-4" aria-hidden />}
        role="status"
        aria-live="polite"
      >
        {body}
      </AlertBanner>
    </div>
  )
}
