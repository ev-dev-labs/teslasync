import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveConnection } from '@/hooks/useLiveConnection'
import { DataStateNotice } from './DataStateNotice'

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
 * pipeline has been unavailable (`reconnecting` or `disconnected`) for longer
 * than two minutes. Drop one near the top of any page whose content depends
 * on live telemetry — the sidebar `<LiveIndicator>` always shows the wire
 * health, this banner is for users staring at a single page who would
 * otherwise miss it.
 */
export function LiveStaleDataBanner({ className }: LiveStaleDataBannerProps) {
  const { status } = useLiveConnection()
  const { t } = useTranslation()

  // Treat both `reconnecting` and `disconnected` as one continuous outage.
  // During a sustained outage `useLiveConnection` legitimately oscillates
  // between the two: every failed reconnect attempt momentarily flips the
  // status back to `reconnecting` before it decays to `disconnected` again.
  // Keying the timer off the raw `status` therefore reset the 2-minute clock
  // on each backoff attempt — and because the SSE backoff caps at 60s (below
  // the 2-minute threshold) the banner never surfaced during a real, prolonged
  // outage. Collapsing both states into a single flag keeps the clock running
  // across those flips; it is cleared only once the pipe is genuinely healthy
  // (`connected`) or still in the indeterminate startup state (`unknown`).
  const outageActive = status === 'disconnected' || status === 'reconnecting'

  const outageSinceRef = useRef<number | null>(null)
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (outageActive) {
      if (outageSinceRef.current == null) {
        outageSinceRef.current = Date.now()
      }
      const elapsed = Date.now() - outageSinceRef.current
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
    // A healthy (`connected`) or not-yet-known (`unknown`) pipe clears the
    // outage clock and hides the banner.
    outageSinceRef.current = null
    setShow(false)
  }, [outageActive])

  if (!show) return null

  return (
    <DataStateNotice
      state="stale"
      title={t('live.staleBanner.title', 'Live data unavailable')}
      className={className}
      data-testid="live-stale-banner"
      role="status"
      aria-live="polite"
    >
      {t(
        'live.staleBanner.message',
        'The live data connection has been offline for more than 2 minutes. Values on this page may be stale until the connection is restored.',
      )}
    </DataStateNotice>
  )
}
