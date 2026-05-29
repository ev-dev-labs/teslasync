import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Wrench, X } from 'lucide-react'
import { useSystemHealth } from '@/api/hooks/useAdmin'

/**
 * Maintenance / degraded-mode banner.
 *
 * Polls /api/v1/system/health (via {@link useSystemHealth}) on the
 * standard interval and renders a sticky top-of-app banner when the
 * resolved service mode is "degraded" or "maintenance". The banner
 * includes a live countdown to `maintenance_until` so users know when
 * the window is expected to end.
 *
 * Dismissal is per-snapshot, keyed on `maintenance_updated_at` (or a
 * deterministic fingerprint of mode/message/until when updated_at is
 * absent). This means:
 *   • A user who dismisses once stays dismissed for THAT specific
 *     banner state.
 *   • An operator who pushes a NEW banner (different message, different
 *     end-time, or even the same mode after a clear → re-set cycle)
 *     re-surfaces the banner — the dismissal does not silently swallow
 *     a fresh announcement.
 *
 * sessionStorage is used (not localStorage) so a closed-and-reopened
 * tab starts fresh; the operator-driven cadence here is roughly hours
 * not days, and a stale tab is the case where re-surfacing matters
 * most.
 *
 * Mounted in <Layout> ABOVE RateLimitBanner / NewVersionBanner so the
 * highest-impact operational message shows first when multiple
 * banners stack.
 */

const SESSION_DISMISS_KEY = 'teslasync:maintenance-dismissed-for'

/** Returns the dismissal-fingerprint for the supplied snapshot. */
function fingerprint(mode: string, message: string, until: string, updatedAt: string): string {
  if (updatedAt) return `u:${updatedAt}`
  return `s:${mode}|${message}|${until}`
}

function readDismissedKey(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage.getItem(SESSION_DISMISS_KEY)
  } catch {
    return null
  }
}

function writeDismissedKey(key: string) {
  try {
    window.sessionStorage.setItem(SESSION_DISMISS_KEY, key)
  } catch {
    /* private mode / quota — fall through, in-memory dismissal still works */
  }
}

/** Renders "Hh Mm Ss" (zero-padded short form). */
function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m`
  }
  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`
  }
  return `${seconds}s`
}

export function MaintenanceBanner() {
  const { t } = useTranslation()
  const { data } = useSystemHealth()
  const [dismissedKey, setDismissedKey] = useState<string | null>(() => readDismissedKey())
  const [now, setNow] = useState(() => Date.now())
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const mode = data?.mode ?? 'ok'
  const message = data?.maintenance_message ?? ''
  const until = data?.maintenance_until ?? ''
  const updatedAt = data?.maintenance_updated_at ?? ''

  const currentKey = useMemo(
    () => fingerprint(mode, message, until, updatedAt),
    [mode, message, until, updatedAt],
  )

  const untilMs = useMemo(() => {
    if (!until) return null
    const t = Date.parse(until)
    return Number.isFinite(t) ? t : null
  }, [until])

  // Reset stale dismissal whenever the upstream snapshot changes —
  // keeps the operator's "I just pushed a new banner" workflow honest.
  useEffect(() => {
    if (dismissedKey && dismissedKey !== currentKey) {
      setDismissedKey(null)
    }
  }, [currentKey, dismissedKey])

  // Tick every second only while the countdown is mounted; otherwise
  // we'd churn the whole subtree once per second on every page load.
  useEffect(() => {
    if (mode === 'ok' || untilMs === null) return
    tickRef.current = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      if (tickRef.current) {
        clearInterval(tickRef.current)
        tickRef.current = null
      }
    }
  }, [mode, untilMs])

  if (!data || mode === 'ok') return null
  if (dismissedKey === currentKey) return null

  const isMaintenance = mode === 'maintenance'
  const Icon = isMaintenance ? Wrench : AlertTriangle
  const tone = isMaintenance ? 'amber' : 'sky'

  const title = isMaintenance
    ? t('serviceMode.banner.maintenanceTitle', 'Scheduled maintenance')
    : t('serviceMode.banner.degradedTitle', 'Service is degraded')

  const body = message.trim() || (isMaintenance
    ? t('serviceMode.banner.defaultMaintenance', 'Maintenance is in progress. Live data may be paused.')
    : t('serviceMode.banner.defaultDegraded', 'Some features may be slow or unavailable while we work on it.'))

  let countdown: string | null = null
  if (untilMs !== null) {
    const remaining = untilMs - now
    if (remaining > 1000) {
      countdown = t('serviceMode.banner.endsIn', 'Ends in {{time}}', { time: formatRemaining(remaining) })
    } else if (remaining > -1000) {
      countdown = t('serviceMode.banner.endingNow', 'Ending now')
    } else {
      countdown = t('serviceMode.banner.ended', 'Window has ended; refresh to confirm.')
    }
  }

  const handleDismiss = () => {
    writeDismissedKey(currentKey)
    setDismissedKey(currentKey)
  }

  // Tone colors are kept inline-ish via Tailwind class strings rather
  // than a clsx call so the bundle stays free of the ternary helper.
  const toneClasses = tone === 'amber'
    ? 'border-amber-300/30 bg-amber-300/[0.08]'
    : 'border-sky-300/30 bg-sky-300/[0.08]'
  const iconBg = tone === 'amber' ? 'bg-amber-300/15 text-amber-300' : 'bg-sky-300/15 text-sky-300'

  return (
    <div
      role={isMaintenance ? 'alert' : 'status'}
      aria-live="polite"
      data-testid="maintenance-banner"
      data-mode={mode}
      className={`sticky top-0 z-[60] flex items-start gap-3 border-b px-4 py-2.5 backdrop-blur-md ${toneClasses}`}
    >
      <div className={`rounded-lg p-1.5 shrink-0 ${iconBg}`}>
        <Icon className="h-4 w-4" aria-hidden />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[var(--text-primary)]">{title}</p>
        <p className="text-sm text-[var(--text-secondary)]">{body}</p>
        {countdown && (
          <p className="text-xs text-[var(--text-muted)] mt-0.5" data-testid="maintenance-banner-countdown">
            {countdown}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label={t('common.dismiss', 'Dismiss')}
        data-testid="maintenance-banner-dismiss"
        className="rounded-lg p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-white/[0.06] hover:text-[var(--text-primary)] shrink-0"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  )
}

export default MaintenanceBanner
