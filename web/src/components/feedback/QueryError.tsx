import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, WifiOff } from 'lucide-react'
import { Button } from '../ui/Button'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'

interface QueryErrorProps {
  error: Error | null
  onRetry?: () => void
}

/**
 * Inline error banner for failed API queries.
 *
 * Shows a friendly message + Retry button. When the browser is offline,
 * swaps the copy + icon to make it clear the failure is a network issue
 * (not a server bug) and auto-invokes `onRetry` once the browser comes
 * back online so users don't have to click manually.
 */
export function QueryError({ error, onRetry }: QueryErrorProps) {
  const { t } = useTranslation()
  const online = useOnlineStatus()

  useEffect(() => {
    if (!error || online || !onRetry) return
    let fired = false
    const handler = () => {
      if (fired) return
      fired = true
      onRetry()
    }
    window.addEventListener('online', handler, { once: true })
    return () => window.removeEventListener('online', handler)
  }, [error, online, onRetry])

  if (!error) return null

  const isOffline = !online
  const Icon = isOffline ? WifiOff : AlertCircle
  const title = isOffline
    ? t('queryError.offlineTitle', "You're offline")
    : t('queryError.title', 'Failed to load data')
  const detail = isOffline
    ? t('queryError.offlineDetail', "We'll retry automatically when your connection returns.")
    : error.message
  const retryLabel = isOffline
    ? t('queryError.retryWhenOnline', 'Retry when online')
    : t('queryError.retry', 'Retry')

  return (
    <div
      role={isOffline ? 'status' : 'alert'}
      aria-live={isOffline ? 'polite' : 'assertive'}
      className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4 mb-6 backdrop-blur-sm"
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0 mt-0.5 rounded-lg bg-rose-500/10 p-2">
          <Icon className="h-4 w-4 text-rose-300" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-rose-300">{title}</p>
          <p className="text-xs text-rose-300/70 mt-0.5 truncate">{detail}</p>
        </div>
        {onRetry && (
          <Button
            type="button"
            onClick={onRetry}
            variant="ghost"
            size="sm"
            disabled={isOffline}
            aria-disabled={isOffline || undefined}
            className="shrink-0 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
          >
            {retryLabel}
          </Button>
        )}
      </div>
    </div>
  )
}

