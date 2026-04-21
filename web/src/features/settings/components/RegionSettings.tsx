import { useTranslation } from 'react-i18next'
import { useTeslaUserRegion, useRefreshTeslaRegion } from '@/api/hooks/useUser'
import { GlassPanel, Button, IconBox } from '@/components/ui'
import { EmptyState } from '@/components/feedback'
import { FadeIn } from '@/components/motion'
import { useToast } from '@/components/feedback/Toast'
import { cn } from '@/lib/cn'
import { formatDateTime } from '@/lib/dateFormat'
import { Globe, RefreshCw, Info } from 'lucide-react'

export function RegionSettings() {
  const { t } = useTranslation('settings')
  const toast = useToast()
  const { data: regionConfig } = useTeslaUserRegion()
  const regionRefresh = useRefreshTeslaRegion()

  return (
    <FadeIn delay={0.04}>
      <GlassPanel className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <IconBox color="green">
              <Globe className="h-5 w-5" />
            </IconBox>
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">{t('region.title', 'Region & API')}</h2>
              <p className="text-xs text-[var(--text-muted)]">{t('region.subtitle', 'Tesla account region and Fleet API endpoint')}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {regionConfig?.fetched_at && (
              <span className="text-[11px] text-[var(--text-muted)]">
                {t('region.lastSynced', 'Synced')} {formatDateTime(regionConfig.fetched_at)}
              </span>
            )}
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw className={cn('h-3.5 w-3.5', regionRefresh.isPending && 'animate-spin')} />}
              onClick={() => regionRefresh.mutate(undefined, {
                onSuccess: () => toast.success(t('toast.regionRefreshed', 'Region info refreshed')),
                onError: (err: Error) => toast.error(t('toast.regionFailed', 'Failed to refresh region'), err.message),
              })}
              disabled={regionRefresh.isPending}
            >
              {t('region.refresh', 'Refresh')}
            </Button>
          </div>
        </div>

        {regionConfig?.data?.region ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-lg bg-white/[0.02] border border-white/5 p-4">
              <p className="text-xs text-[var(--text-muted)] mb-1 uppercase tracking-wider">{t('region.regionCode', 'Region')}</p>
              <p className="text-lg font-semibold text-[var(--text-primary)]">{regionConfig.data.region}</p>
            </div>
            <div className="rounded-lg bg-white/[0.02] border border-white/5 p-4">
              <p className="text-xs text-[var(--text-muted)] mb-1 uppercase tracking-wider">{t('region.fleetApiUrl', 'Fleet API Base URL')}</p>
              <p className="text-sm font-mono text-[var(--text-primary)] break-all">{regionConfig.data.fleet_api_base_url ?? '—'}</p>
            </div>
          </div>
        ) : (
          <EmptyState icon={<Info className="h-10 w-10" />} message={t('region.noData', 'No region data yet. Click Refresh to fetch from Tesla.')} />
        )}
      </GlassPanel>
    </FadeIn>
  )
}
