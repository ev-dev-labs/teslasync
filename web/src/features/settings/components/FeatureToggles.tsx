import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useTeslaFeatureConfig, useRefreshTeslaFeatureConfig } from '@/api/hooks/useUser'
import { GlassPanel, Button, IconBox, Badge } from '@/components/ui'
import { EmptyState } from '@/components/feedback'
import { FadeIn } from '@/components/motion'
import { useToast } from '@/components/feedback/Toast'
import { cn } from '@/lib/cn'
import { formatDateTime } from '@/lib/dateFormat'
import { Flag, RefreshCw, Info } from 'lucide-react'

export function FeatureToggles() {
  const { t } = useTranslation('settings')
  const toast = useToast()
  const { data: featureConfig } = useTeslaFeatureConfig()
  const featureConfigRefresh = useRefreshTeslaFeatureConfig()

  const featureEntries = useMemo(() => {
    const data = featureConfig?.data
    if (!data || typeof data !== 'object') return []
    return Object.entries(data).map(([key, value]) => {
      const isObj = typeof value === 'object' && value !== null
      const enabled = isObj ? (value as Record<string, unknown>).enabled : value
      const details = isObj
        ? Object.entries(value as Record<string, unknown>)
            .filter(([k]) => k !== 'enabled')
            .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
            .join(', ')
        : null
      return { key, enabled: Boolean(enabled), details }
    })
  }, [featureConfig?.data])

  return (
    <FadeIn delay={0.03}>
      <GlassPanel className="p-6 space-y-4">
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
              <span className="text-[11px] text-[var(--text-muted)]">
                {t('featureConfig.lastSynced', 'Synced')} {formatDateTime(featureConfig.fetched_at)}
              </span>
            )}
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw className={cn('h-3.5 w-3.5', featureConfigRefresh.isPending && 'animate-spin')} />}
              onClick={() => featureConfigRefresh.mutate(undefined, {
                onSuccess: () => toast.success(t('toast.featureConfigRefreshed', 'Feature config refreshed')),
                onError: (err: Error) => toast.error(t('toast.featureConfigFailed', 'Failed to refresh feature config'), err.message),
              })}
              disabled={featureConfigRefresh.isPending}
            >
              {t('featureConfig.refresh', 'Refresh')}
            </Button>
          </div>
        </div>

        {featureEntries.length > 0 ? (
          <div className="overflow-x-auto">
            <div className="grid grid-cols-[1fr_auto_2fr] gap-x-4 text-sm">
              <div className="contents border-b border-[var(--border-subtle)] text-left">
                <div className="pb-2 text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">{t('featureConfig.feature', 'Feature')}</div>
                <div className="pb-2 text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">{t('featureConfig.status', 'Status')}</div>
                <div className="pb-2 text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">{t('featureConfig.details', 'Details')}</div>
              </div>
              {featureEntries.map((entry) => (
                <div key={entry.key} className="contents">
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
          <EmptyState icon={<Info className="h-10 w-10" />} message={t('featureConfig.noData', 'No feature config data yet. Click Refresh to fetch from Tesla.')} />
        )}
      </GlassPanel>
    </FadeIn>
  )
}
