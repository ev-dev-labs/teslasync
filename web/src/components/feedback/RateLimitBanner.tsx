import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Clock, X } from 'lucide-react'
import { Button } from '../ui/Button'

/**
 * Rate-limit / upstream-breaker UX banner.
 *
 * Listens for two document-level CustomEvents emitted by `resilientFetch`:
 *   • teslasync:rate-limited  — fired on a 429 response. The detail
 *     carries the path scope (e.g. "/vehicles") and the Retry-After
 *     window in seconds. The banner shows a countdown so the user
 *     understands why their data isn't refreshing right now.
 *   • teslasync:upstream-down — fired on a 503 with code
 *     UPSTREAM_BREAKER_OPEN. The detail carries the upstream name
 *     (e.g. "tesla") and the suggested backoff window. Same UI shape
 *     as the rate-limit case, with different copy.
 *
 * When the countdown reaches zero the "Retry now" button enables —
 * clicking it invalidates every TanStack Query so pages refetch from
 * scratch. The user can also dismiss the banner manually, which clears
 * the local visibility state but does NOT clear the in-process
 * short-circuit cache in `resilientFetch`. That cache expires on its
 * own when the Retry-After window elapses; until then, queued queries
 * are calmly fast-failed instead of hammering the upstream.
 *
 * Mounting note — placed in <Layout> alongside the other status
 * banners (NewVersionBanner, OfflineBanner, TeslaReauthBanner). Stack
 * order from top to bottom is: rate-limit (most transient) → tesla-
 * reauth (user action required) → reload-prompt (version update). Each
 * banner is ≤ 48 px tall so the stack stays under 144 px even when all
 * three fire simultaneously.
 *
 * Out of scope:
 *   • Per-resource rate-limit policies (banner is global per scope).
 *   • Persisting the cooldown across page reload — fresh load
 *     optimistically retries; if upstream is still limited it
 *     immediately re-fires the banner.
 *   • Adaptive client-side throttling that pre-emptively slows down.
 */

interface State {
  kind: 'rate-limited' | 'upstream-down'
  scope?: string
  upstream?: string
  expiresAt: number
}

export function RateLimitBanner() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [state, setState] = useState<State | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const onLimited = (e: Event) => {
      const ce = e as CustomEvent<{ scope: string; retryAfterSec: number }>
      const detail = ce.detail
      if (!detail || typeof detail.retryAfterSec !== 'number') return
      setState({
        kind: 'rate-limited',
        scope: detail.scope,
        expiresAt: Date.now() + Math.max(0, detail.retryAfterSec) * 1000,
      })
      setNow(Date.now())
    }
    const onUpstream = (e: Event) => {
      const ce = e as CustomEvent<{ upstream: string; retryAfterSec: number }>
      const detail = ce.detail
      if (!detail || typeof detail.retryAfterSec !== 'number') return
      setState({
        kind: 'upstream-down',
        upstream: detail.upstream,
        expiresAt: Date.now() + Math.max(0, detail.retryAfterSec) * 1000,
      })
      setNow(Date.now())
    }
    document.addEventListener('teslasync:rate-limited', onLimited)
    document.addEventListener('teslasync:upstream-down', onUpstream)
    return () => {
      document.removeEventListener('teslasync:rate-limited', onLimited)
      document.removeEventListener('teslasync:upstream-down', onUpstream)
    }
  }, [])

  // Tick once per second only while the banner is visible — no reason
  // to re-render the rest of the app every second when no countdown
  // is in flight.
  useEffect(() => {
    if (!state) return
    tickRef.current = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      if (tickRef.current) {
        clearInterval(tickRef.current)
        tickRef.current = null
      }
    }
  }, [state])

  if (!state) return null

  const remaining = Math.max(0, Math.ceil((state.expiresAt - now) / 1000))
  const isRateLimit = state.kind === 'rate-limited'
  const Icon = isRateLimit ? Clock : AlertCircle

  const handleRetry = () => {
    setState(null)
    void qc.invalidateQueries()
  }

  const handleDismiss = () => {
    setState(null)
  }

  return (
    <div
      role="alert"
      aria-live="polite"
      data-testid="rate-limit-banner"
      data-kind={state.kind}
      className="sticky top-0 z-50 flex items-center gap-3 border-b border-amber-300/30 bg-amber-300/[0.08] px-4 py-2.5 backdrop-blur-md"
    >
      <div className="rounded-lg bg-amber-300/15 p-1.5 shrink-0">
        <Icon className="h-4 w-4 text-amber-300" aria-hidden />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--text-primary)]">
          {isRateLimit
            ? t('ratelimit.banner', 'Too many requests — pausing for {{n}}s', { n: remaining })
            : t('upstream.banner', 'Tesla upstream unavailable — retry in {{n}}s', { n: remaining })}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          onClick={handleRetry}
          disabled={remaining > 0}
          aria-disabled={remaining > 0 || undefined}
          data-testid="rate-limit-banner-retry"
        >
          {t('ratelimit.retry', 'Retry now')}
        </Button>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label={t('common.dismiss', 'Dismiss')}
          data-testid="rate-limit-banner-dismiss"
          className="rounded-lg p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-white/[0.06] hover:text-[var(--text-primary)]"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  )
}

export default RateLimitBanner
