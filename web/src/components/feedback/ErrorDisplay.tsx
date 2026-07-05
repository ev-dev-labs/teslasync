import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, FileQuestion, Lock, Server, WifiOff } from 'lucide-react'
import { Button } from '../ui/Button'
import { isApiError } from '@/api/client'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { ErrorState } from './_ErrorState'

interface ErrorDisplayProps {
  /**
   * The error to display. Accepts `unknown` so callers can pass raw
   * mutation errors without casting; branches on `ApiError.status` when
   * present.
   */
  error: unknown
  onRetry?: () => void
  /** Tighter padding for inline mutation errors (e.g. inside a panel). */
  compact?: boolean
  className?: string
  /** Singular human-readable name of the resource (used in 404 titles). */
  resourceName?: string
  /** Path to the corresponding list view (renders Back-to-list CTA on 404). */
  listHref?: string
}

/**
 * Status-aware error banner used for non-query errors (mutation failures,
 * imperative fetches). Mirrors {@link QueryError}'s 404 / 401 / 5xx /
 * network branching but supports a `compact` variant for inline contexts
 * where a full-bleed banner would dominate the panel.
 */
export function ErrorDisplay({
  error,
  onRetry,
  compact,
  className,
  resourceName,
  listHref,
}: ErrorDisplayProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const online = useOnlineStatus()
  const status = isApiError(error) ? error.status : undefined

  useEffect(() => {
    // Keep the offline branch's "we'll retry automatically when your
    // connection returns" promise. Only the status-less network branch
    // auto-retries: 4xx/5xx are permanent and shouldn't be re-fired on an
    // `online` event, and a status-0 offline ApiError leaves retry manual.
    // Mirrors QueryError so both error banners recover identically.
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

  // 404 — record was deleted or URL is wrong.
  if (status === 404) {
    const thing = resourceName ?? t('error.notFound.thingDefault', 'Resource')
    return (
      <ErrorState
        Icon={FileQuestion}
        compact={compact}
        className={className}
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
        compact={compact}
        className={className}
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
        compact={compact}
        className={className}
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
  const isOffline = !online || status === 0
  return (
    <ErrorState
      Icon={isOffline ? WifiOff : AlertCircle}
      compact={compact}
      className={className}
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

