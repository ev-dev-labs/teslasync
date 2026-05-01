import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { WifiOff } from 'lucide-react'
import { useLiveConnection } from '@/hooks/useLiveConnection'
import { AlertBanner } from './AlertBanner'

/**
 * Show the banner once the live pipe has been disconnected for at least
 * this long. Pages that rely on live data only show the warning after a
 * sustained outage to avoid flapping during transient reconnects.
 */
const STALE_BANNER_THRESHOLD_MS = 2 * 60_000

interface LiveStaleDataBannerProps {
  className?: string
}

/**
 * `<LiveStaleDataBanner>` — page-level companion to `<LiveIndicator>`.
 *
 * Shows an in-flow `<AlertBanner variant="warning">` when the live data
 * pipeline has been `disconnected` for longer than two minutes. Drop one
 * near the top of any page whose content depends on live telemetry — the
 * sidebar `<LiveIndicator>` always shows the wire health, this banner is
 * for users staring at a single page who would otherwise miss it.
 */
export function LiveStaleDataBanner({ className }: LiveStaleDataBannerProps) {
  const { status } = useLiveConnection()
  const { t } = useTranslation()

  const disconnectedSinceRef = useRef<number | null>(null)
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (status === 'disconnected') {
      if (disconnectedSinceRef.current == null) {
        disconnectedSinceRef.current = Date.now()
      }
      const elapsed = Date.now() - disconnectedSinceRef.current
      if (elapsed >= STALE_BANNER_THRESHOLD_MS) {
        setShow(true)
        return
      }
      const timer = window.setTimeout(
        () => setShow(true),
        STALE_BANNER_THRESHOLD_MS - elapsed + 50,
      )
      return () => window.clearTimeout(timer)
    }
    // Any non-disconnected status clears the timer and hides the banner.
    disconnectedSinceRef.current = null
    setShow(false)
  }, [status])

  if (!show) return null

  return (
    <AlertBanner
      variant="warning"
      icon={<WifiOff className="h-5 w-5" />}
      title={t('live.staleBanner.title', 'Live data unavailable')}
      className={className}
    >
      {t(
        'live.staleBanner.message',
        'The live data connection has been offline for more than 2 minutes. Values on this page may be stale until the connection is restored.',
      )}
    </AlertBanner>
  )
}
