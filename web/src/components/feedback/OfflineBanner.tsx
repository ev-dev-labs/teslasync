import { useTranslation } from 'react-i18next'
import { WifiOff } from 'lucide-react'
import { AlertBanner } from './AlertBanner'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'

/**
 * OfflineBanner — small, non-blocking warning shown in the bottom-right
 * corner whenever the browser is offline (PWA installed or otherwise).
 *
 * Complementary to the top-of-page `<ServiceStatusBanner>`: this one is
 * smaller, less intrusive, and uses the shared `<AlertBanner>` component
 * with proper i18n. It exists so that even pages mounted without the full
 * layout (e.g. modals, error fallbacks) can advertise the offline state.
 *
 * Cached data continues to render via the service worker's runtime cache
 * and TanStack Query's `networkMode: 'offlineFirst'` (see `main.tsx`); the
 * banner just tells the user why what they are looking at may be stale.
 *
 * Hides automatically when the browser comes back online — no manual
 * dismiss needed.
 */
export function OfflineBanner() {
  const { t } = useTranslation()
  const online = useOnlineStatus()

  if (online) return null

  return (
    <div
      data-testid="offline-banner"
      className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] right-4 z-[9997] max-w-sm lg:bottom-[calc(1rem+env(safe-area-inset-bottom,0px))]"
    >
      <AlertBanner
        variant="warning"
        title={t('pwa.offline.title', "You're offline")}
        icon={<WifiOff className="h-4 w-4" aria-hidden />}
        role="status"
        aria-live="polite"
      >
        {t('pwa.offline.banner', 'Showing cached data. New requests will retry when you reconnect.')}
      </AlertBanner>
    </div>
  )
}
