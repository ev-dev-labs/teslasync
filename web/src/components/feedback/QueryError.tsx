import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, Clock, FileQuestion, Lock, Server, WifiOff } from 'lucide-react'
import { Button } from '../ui/Button'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { isApiError } from '@/api/client'
import { isTransientWaiting } from '@/lib/errorClassification'
import { ErrorState } from './_ErrorState'

interface QueryErrorProps {
  /**
   * The error from a failed query. Accepts `unknown` so callers can pass
   * raw TanStack Query `error` values without casting; the component
   * branches on `ApiError.status` when present and falls back to the
   * generic network message otherwise.
   */
  error: unknown
  onRetry?: () => void
  /**
   * Singular human-readable name of the resource being loaded
   * (e.g. "Drive", "Charging session"). Surfaced in the 404 title so the
   * user knows what wasn't found.
   */
  resourceName?: string
  /**
   * Path to the corresponding list view. When provided on a 404, the
   * component renders a "Back to list" CTA that navigates there. Detail
   * pages should pass this so users have an obvious recovery path when
   * the record was deleted or the URL is stale.
   */
  listHref?: string
}

/**
 * Inline error banner for failed API queries.
 *
 * Branches by `ApiError.status` so users get actionable recovery copy
 * per failure mode rather than a generic "something went wrong":
 *
 *   - **404** — "Resource not found" with optional Back-to-list CTA
 *   - **401 / 403** — "Sign in required" with Sign-in CTA
 *   - **5xx** — "Server error" with manual Retry CTA
 *   - **network / unknown** — "Can't reach server" with Retry CTA;
 *     when the browser is offline, swaps copy to "You're offline" and
 *     auto-invokes `onRetry` once the connection returns so the user
 *     doesn't have to click manually.
 */
export function QueryError({ error, onRetry, resourceName, listHref }: QueryErrorProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const online = useOnlineStatus()
  const status = isApiError(error) ? error.status : undefined

  useEffect(() => {
    // Auto-retry only on the offline branch — 4xx/5xx don't recover from
    // a network event, so we don't want to spam the API on `online` for
    // permanent failures.
    if (!error || online || !onRetry || status !== undefined) return
    let fired = false
    const handler = () => {
      if (fired) return
      fired = true
      onRetry()
    }
    window.addEventListener('online', handler, { once: true })
    return () => window.removeEventListener('online', handler)
  }, [error, online, onRetry, status])

  if (!error) return null

  // Phase-45 / Prompt 33 — transient waiting (rate-limited, upstream
  // breaker open). The global <RateLimitBanner> already shows a
  // countdown so we render a calm "waiting" placeholder here instead
  // of a loud "request failed" panel — the two would otherwise compete
  // for the user's attention. No CTA: the banner owns Retry.
  if (isTransientWaiting(error)) {
    return (
      <ErrorState
        Icon={Clock}
        role="status"
        ariaLive="polite"
        title={t('error.waiting.title', 'Waiting for upstream')}
        message={t(
          'error.waiting.message',
          "We're pausing requests briefly. Data will refresh automatically.",
        )}
      />
    )
  }

  // 404 — record was deleted or URL is wrong.
  if (status === 404) {
    const thing = resourceName ?? t('error.notFound.thingDefault', 'Resource')
    return (
      <ErrorState
        Icon={FileQuestion}
        title={t('error.notFound.title', '{{thing}} not found', { thing })}
        message={t('error.notFound.message', 'It may have been deleted or the link is wrong.')}
        action={
          listHref ? (
            <Button
              type="button"
              onClick={() => navigate(listHref)}
              variant="ghost"
              size="sm"
              className="bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
            >
              {t('error.notFound.cta', 'Back to list')}
            </Button>
          ) : undefined
        }
      />
    )
  }

  // 401 / 403 — session expired or RBAC mismatch.
  if (status === 401 || status === 403) {
    return (
      <ErrorState
        Icon={Lock}
        title={t('error.unauthorized.title', 'Sign in required')}
        message={t('error.unauthorized.message', 'Your session has expired. Please sign in again.')}
        action={
          <Button
            type="button"
            onClick={() => {
              window.location.href = '/login'
            }}
            variant="ghost"
            size="sm"
            className="bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
          >
            {t('error.unauthorized.cta', 'Sign in')}
          </Button>
        }
      />
    )
  }

  // 5xx — backend failure.
  if (status !== undefined && status >= 500) {
    return (
      <ErrorState
        Icon={Server}
        title={t('error.serverError.title', 'Server error')}
        message={t('error.serverError.message', 'Something went wrong on our end. Please try again.')}
        action={
          onRetry ? (
            <Button
              type="button"
              onClick={onRetry}
              variant="ghost"
              size="sm"
              className="bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
            >
              {t('error.retry', 'Retry')}
            </Button>
          ) : undefined
        }
      />
    )
  }

  // Network / offline / unknown.
  // status === 0 is what `_doFetch` throws when navigator.onLine is false.
  const isOffline = !online || status === 0
  return (
    <ErrorState
      Icon={isOffline ? WifiOff : AlertCircle}
      role={isOffline ? 'status' : 'alert'}
      ariaLive={isOffline ? 'polite' : 'assertive'}
      title={
        isOffline
          ? t('error.network.offlineTitle', "You're offline")
          : t('error.network.title', "Can't reach server")
      }
      message={
        isOffline
          ? t('error.network.offlineDetail', "We'll retry automatically when your connection returns.")
          : t('error.network.message', 'Check your internet connection and try again.')
      }
      action={
        onRetry ? (
          <Button
            type="button"
            onClick={onRetry}
            variant="ghost"
            size="sm"
            disabled={isOffline}
            aria-disabled={isOffline || undefined}
            className="bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
          >
            {isOffline
              ? t('error.network.retryWhenOnline', 'Retry when online')
              : t('error.retry', 'Retry')}
          </Button>
        ) : undefined
      }
    />
  )
}

