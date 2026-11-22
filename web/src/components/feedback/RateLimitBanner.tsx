import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Clock, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { Text } from '../ui/Typography'
import { isSafeRead } from '@/lib/rateLimit'
import { isRateLimitError, isUpstreamUnavailableError } from '@/lib/resilience'
import { useRateLimitNotices } from './useRateLimitNotices'

export function RateLimitBanner() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { current: state, remaining, dismiss } = useRateLimitNotices()

  if (!state) return null

  const isRateLimit = state.kind === 'rate-limited'
  const writeOnly = state.methods !== '*' && !isSafeRead(state.methods)
  const Icon = isRateLimit ? Clock : AlertCircle
  const title = !isRateLimit ? t('upstream.title')
    : state.source === 'teslasync' ? t('ratelimit.appTitle')
    : state.source === 'tesla' ? t('ratelimit.teslaTitle')
    : t('ratelimit.unknownTitle')

  const handleRetry = () => {
    if (remaining > 0 || writeOnly) return
    let selected = 0
    void qc.refetchQueries({
      type: 'active',
      predicate: (query) => {
        const error = query.state.error
        if (!isRateLimitError(error) && !isUpstreamUnavailableError(error)) return false
        const affected = isRateLimit
          ? isRateLimitError(error) && error.bucket === state.bucket
          : isUpstreamUnavailableError(error) && error.scope === state.scope
        if (!affected || !isSafeRead(error.requestMethod) || error.expiresAt > Date.now() || selected >= 64) return false
        selected++
        return true
      },
    }, { cancelRefetch: false })
    dismiss()
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="false"
      data-testid="rate-limit-banner"
      data-app-part="feedback"
      data-app-feedback-kind="notice"
      data-app-tone="warning"
      data-kind={state.kind}
      className="sticky top-0 z-50 grid min-w-0 shrink-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 border-b border-[var(--semantic-warning-border)] bg-[var(--surface-1)] md:grid-cols-[auto_minmax(0,1fr)_auto]"
    >
      <div data-app-part="feedback-icon" className="row-span-2 grid w-8 place-items-center border-e border-[var(--semantic-warning-border)] bg-[var(--semantic-warning-bg)] text-[var(--semantic-warning)] md:row-span-1 md:w-10">
        <Icon className="h-4 w-4" aria-hidden />
      </div>
      <div data-app-part="feedback-content" className="min-w-0 pe-3 pt-2 [overflow-wrap:anywhere] md:self-center md:py-2">
        <Text as="p" variant="subhead" data-app-part="feedback-title">{title}</Text>
        <Text data-app-part="feedback-message" as="p" variant="bodySm">
          {writeOnly
            ? t('ratelimit.actionsPaused')
            : t('ratelimit.readsPaused')}
        </Text>
        <Text variant="caption" aria-live="off">
          {remaining > 0 ? t('ratelimit.countdown', { n: remaining })
            : t('ratelimit.ready')}
        </Text>
      </div>
      <div data-app-part="feedback-actions" className="col-start-2 flex min-w-0 flex-wrap items-center gap-2 py-2 pe-3 md:col-start-3">
        {!writeOnly && <Button
          type="button"
          size="sm"
          variant="primary"
          wrapLabel
          className="max-w-full max-md:min-h-11"
          onClick={handleRetry}
          disabled={remaining > 0}
          data-testid="rate-limit-banner-retry"
        >
          {t('ratelimit.retryReads')}
        </Button>}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={dismiss}
          aria-label={t('common.dismiss')}
          data-testid="rate-limit-banner-dismiss"
          className="p-1.5 max-md:min-h-11 max-md:min-w-11"
        >
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </div>
  )
}

export default RateLimitBanner
