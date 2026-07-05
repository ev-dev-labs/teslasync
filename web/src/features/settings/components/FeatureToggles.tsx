import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useTeslaFeatureConfig, useRefreshTeslaFeatureConfig } from '@/api/hooks/useUser'
import { GlassPanel, Button, IconBox, Badge } from '@/components/ui'
import { EmptyState, Skeleton } from '@/components/feedback'
import { FadeIn } from '@/components/motion'
import { cn } from '@/lib/cn'
import { formatDateTime } from '@/lib/dateFormat'
import { Flag, RefreshCw, Info, AlertTriangle } from 'lucide-react'

export function FeatureToggles() {
  const { t } = useTranslation('settings')
  const { data: featureConfig, isLoading, isError, refetch } = useTeslaFeatureConfig()
  const featureConfigRefresh = useRefreshTeslaFeatureConfig()

  const featureEntries = useMemo(() => {
    const data = featureConfig?.data
    if (!data || typeof data !== 'object') return []
    return Object.entries(data).map(([key, value]) => {
      const isObj = typeof value === 'object' && value !== null
      const enabled = isObj ? (value as Record<string, unknown>).enabled : value
      const detailPairs = isObj
        ? Object.entries(value as Record<string, unknown>)
            .filter(([k]) => k !== 'enabled')
            .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
        : []
      // An object carrying only `enabled` produces no detail pairs — fall back
      // to null so the cell renders the "—" placeholder instead of an empty
      // string (which the `?? '—'` guard in the render would not catch).
      return { key, enabled: Boolean(enabled), details: detailPairs.length > 0 ? detailPairs.join(', ') : null }
    })
  }, [featureConfig?.data])

  const handleRefresh = useCallback(() => {
    // The shared refresh hook already owns the success/error toast via
    // useMutationToast; passing mutate() callbacks here fired a *second*,
    // identical toast on every refresh. Rely on the hook as the single source.
    featureConfigRefresh.mutate(undefined)
  }, [featureConfigRefresh])

  const handleRetry = useCallback(() => {
    void refetch()
  }, [refetch])

  const isRefreshing = featureConfigRefresh.isPending
  const hasEntries = featureEntries.length > 0
  // Separate the first in-flight load (skeleton) and a hard fetch failure
  // (retryable error) from a genuinely empty result, so the panel is never a
  // blank or misleading placeholder.
  const showLoading = isLoading && !hasEntries
  const showError = isError && !hasEntries

  return (
    <FadeIn delay={0.03}>
      <GlassPanel className="p-6 space-y-4" data-testid="feature-toggles">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <IconBox color="purple">
              <Flag className="h-5 w-5" />
            </IconBox>
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">{t('featureConfig.title', 'Feature Flags')}</h2>
              <p className="text-xs text-[var(--text-muted)]">{t('featureConfig.subtitle', 'Tesla account feature configuration')}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {featureConfig?.fetched_at && (
              <span className="text-xs text-[var(--text-muted)]">
                {t('featureConfig.lastSynced', 'Synced')} {formatDateTime(featureConfig.fetched_at)}
              </span>
            )}
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} />}
              onClick={handleRefresh}
              disabled={isRefreshing}
              data-testid="feature-toggles-refresh"
            >
              {t('featureConfig.refresh', 'Refresh')}
            </Button>
          </div>
        </div>

        {showError ? (
          <EmptyState
            icon={<AlertTriangle className="h-10 w-10" />}
            title={t('featureConfig.errorTitle', 'Couldn’t load feature config')}
            message={t('featureConfig.errorMessage', 'Something went wrong fetching your Tesla feature configuration. Check your connection and try again.')}
            action={{ label: t('featureConfig.retry', 'Retry'), onClick: handleRetry }}
          />
        ) : showLoading ? (
          <div className="space-y-2" data-testid="feature-toggles-loading">
            <Skeleton height={32} />
            <Skeleton height={32} />
            <Skeleton height={32} />
          </div>
        ) : hasEntries ? (
          <div className="overflow-x-auto">
            <div className="grid grid-cols-[1fr_auto_2fr] gap-x-4 text-sm">
              <div className="contents border-b border-[var(--border-subtle)] text-left">
                <div className="pb-2 text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">{t('featureConfig.feature', 'Feature')}</div>
                <div className="pb-2 text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">{t('featureConfig.status', 'Status')}</div>
                <div className="pb-2 text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">{t('featureConfig.details', 'Details')}</div>
              </div>
              {featureEntries.map((entry) => (
                <div key={entry.key} className="contents" data-testid={`feature-toggles-row-${entry.key}`}>
                  <div className="py-2.5 border-b border-white/[0.03] font-medium text-[var(--text-primary)]">{entry.key}</div>
                  <div className="py-2.5 border-b border-white/[0.03]">
                    <Badge variant={entry.enabled ? 'success' : 'neutral'}>
                      {entry.enabled ? t('featureConfig.enabled', 'Enabled') : t('featureConfig.disabled', 'Disabled')}
                    </Badge>
                  </div>
                  <div className="py-2.5 border-b border-white/[0.03] text-xs text-[var(--text-muted)] max-w-xs truncate">{entry.details ?? '—'}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; the Refresh action already lives in the panel header */ icon={<Info className="h-10 w-10" />} message={t('featureConfig.noData', 'No feature config data yet. Click Refresh to fetch from Tesla.')} />
        )}
      </GlassPanel>
    </FadeIn>
  )
}
