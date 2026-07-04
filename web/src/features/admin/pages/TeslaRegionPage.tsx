/**
 * TeslaRegionPage — Tesla account Region & Fleet API endpoint surface.
 *
 * Modern-UI full-width redesign: a KPI band over a responsive bento
 * (endpoint detail hero + always-visible reference panel). Reads the
 * account region from the Fleet API via `useTeslaUserRegion` and lets the
 * user re-resolve it from Tesla with a single refresh action. Every data
 * section owns its loading / empty / error state and null-safes every field.
 */

import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'
import { PageContainer } from '@/components/layout'
import { Button } from '@/components/ui'
import { FadeIn } from '@/components/motion'
import { usePageTitle } from '@/hooks/usePageTitle'
import { cn } from '@/lib/cn'
import { useTeslaUserRegion, useRefreshTeslaRegion } from '@/api/hooks/useUser'
import {
  RegionKpiBand,
  RegionEndpointPanel,
  RegionAboutPanel,
  parseEndpoint,
  REGION_ZONE_FALLBACK,
} from '../components/tesla-region'

export default function TeslaRegionPage() {
  const { t } = useTranslation('settings')
  const title = t('region.title', 'Region & API')
  usePageTitle(title)

  const regionQuery = useTeslaUserRegion()
  const regionRefresh = useRefreshTeslaRegion()

  // The hook already emits success/error toasts — call mutate() bare so a
  // refresh surfaces exactly one toast rather than two.
  const refresh = () => regionRefresh.mutate()

  const envelope = regionQuery.data
  const region = envelope?.data?.region ?? null
  const baseUrl = envelope?.data?.fleet_api_base_url ?? null
  const fetchedAt = envelope?.fetched_at ?? null
  const { host, scheme, regionKey } = parseEndpoint(baseUrl)
  const configured = Boolean(region || baseUrl)

  const regionLabel =
    regionKey === 'na'
      ? t('region.zones.na', REGION_ZONE_FALLBACK.na)
      : regionKey === 'eu'
        ? t('region.zones.eu', REGION_ZONE_FALLBACK.eu)
        : regionKey === 'cn'
          ? t('region.zones.cn', REGION_ZONE_FALLBACK.cn)
          : null

  const actions = (
    <Button
      variant="secondary"
      size="sm"
      icon={
        <RefreshCw
          className={cn('h-3.5 w-3.5', regionRefresh.isPending && 'animate-spin')}
          aria-hidden="true"
        />
      }
      onClick={refresh}
      disabled={regionRefresh.isPending}
      aria-busy={regionRefresh.isPending || undefined}
    >
      {t('region.refresh', 'Refresh')}
    </Button>
  )

  return (
    <PageContainer
      title={title}
      subtitle={t('region.subtitle', 'Tesla account region and Fleet API endpoint')}
      actions={actions}
      query={regionQuery}
    >
      <FadeIn>
        <section aria-label={t('region.kpi.section', 'Region overview')}>
          <RegionKpiBand
            regionKey={regionKey}
            regionLabel={regionLabel}
            scheme={scheme}
            fetchedAt={fetchedAt}
            configured={configured}
            isLoading={regionQuery.isLoading}
          />
        </section>
      </FadeIn>

      <FadeIn delay={0.1}>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5">
          <section className="xl:col-span-2" aria-label={t('region.endpoint.title', 'Fleet API endpoint')}>
            <RegionEndpointPanel
              region={region}
              baseUrl={baseUrl}
              host={host}
              scheme={scheme}
              regionKey={regionKey}
              regionLabel={regionLabel}
              fetchedAt={fetchedAt}
              isLoading={regionQuery.isLoading}
              isError={regionQuery.isError}
              error={regionQuery.error}
              onRetry={() => regionQuery.refetch()}
              onRefresh={refresh}
            />
          </section>
          <section className="xl:col-span-1" aria-label={t('region.about.title', 'About your region')}>
            <RegionAboutPanel />
          </section>
        </div>
      </FadeIn>
    </PageContainer>
  )
}
