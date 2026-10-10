import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useTeslaFeatureConfig, useRefreshTeslaFeatureConfig } from '@/api/hooks/useUser'
import { GlassPanel, Button, IconBox, Badge, DataTable, Text, type Column } from '@/components/ui'
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
      const filterEnabled = typeof enabled === 'boolean' || typeof enabled === 'string' || typeof enabled === 'number'
        ? enabled
        : null
      return { key, enabled: Boolean(enabled), filterEnabled, details: detailPairs.length > 0 ? detailPairs.join(', ') : null }
    })
  }, [featureConfig?.data])

  const columns: Column<(typeof featureEntries)[number]>[] = [
    {
      key: 'key',
      header: t('featureConfig.feature', 'Feature'),
      filterValue: (entry) => entry.key,
      render: (entry) => <Text data-testid={`feature-toggles-row-${entry.key}`}>{entry.key}</Text>,
    },
    {
      key: 'enabled',
      header: t('featureConfig.status', 'Status'),
      filterValue: (entry) => entry.filterEnabled,
      filterValueLabel: (value, entry) => value == null ? '—' : entry.enabled ? t('featureConfig.enabled', 'Enabled') : t('featureConfig.disabled', 'Disabled'),
      render: (entry) => (
        <Badge variant={entry.enabled ? 'success' : 'neutral'}>
          {entry.enabled ? t('featureConfig.enabled', 'Enabled') : t('featureConfig.disabled', 'Disabled')}
        </Badge>
      ),
    },
    {
      key: 'details',
      header: t('featureConfig.details', 'Details'),
      render: (entry) => <Text size="xs" color="muted" className="block max-w-xs truncate">{entry.details ?? '—'}</Text>,
    },
  ]

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
      <GlassPanel className="min-w-0 p-6 space-y-4" data-testid="feature-toggles">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <IconBox color="purple">
              <Flag className="h-5 w-5" />
            </IconBox>
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">{t('featureConfig.title', 'Feature flags')}</h2>
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
          <DataTable
            tableId="settings:feature-toggles"
            columns={columns}
            data={featureEntries}
            keyExtractor={(entry) => entry.key}
            enableValueFilters
            pagination
            emptyMessage={t('featureConfig.noMatch', 'No features match your filters.')}
          />
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; the Refresh action already lives in the panel header */ icon={<Info className="h-10 w-10" />} message={t('featureConfig.noData', 'No feature config data yet. Click Refresh to fetch from Tesla.')} />
        )}
      </GlassPanel>
    </FadeIn>
  )
}
