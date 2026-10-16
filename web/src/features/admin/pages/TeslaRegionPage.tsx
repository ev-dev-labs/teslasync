import { IconButton } from '@/components/ui/IconButton';
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
import { PageLayout } from '@/components/layout'
import { Icon } from '@/components/ui'
import { FadeIn } from '@/components/motion'
import { OperationalWriteNotice } from '@/components/feedback'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useOperationalMode } from '@/hooks/useOperationalMode'
import { deriveDataState } from '@/api/dataState'
import { useTeslaUserRegion, useRefreshTeslaRegion } from '@/api/hooks/useUser'
import {
  RegionAboutPanel,
  parseEndpoint,
  REGION_ZONE_FALLBACK,
} from '../components/tesla-region'
import { RegionOperationalBrief } from '../components/statstrip-tesla-account-privacy/RegionOperationalBrief'
import { RegionEndpointDetails } from '../components/continuation-admin-2/RegionEndpointDetails'

export default function TeslaRegionPage() {
  const { t } = useTranslation('settings')
  const title = t('region.title', 'Region & API')
  usePageTitle(title)

  const regionQuery = useTeslaUserRegion()
  const regionRefresh = useRefreshTeslaRegion()
  const { canWrite, writeBlockReason } = useOperationalMode()

  // The hook already emits success/error toasts — call mutate() bare so a
  // refresh surfaces exactly one toast rather than two.
  const refresh = () => {
    if (regionRefresh.isPending || !canWrite) return
    regionRefresh.mutate()
  }

  const envelope = regionQuery.data
  const region = envelope?.data?.region ?? null
  const baseUrl = envelope?.data?.fleet_api_base_url ?? null
  const fetchedAt = envelope?.fetched_at ?? null
  const { host, scheme, regionKey } = parseEndpoint(baseUrl)
  const configured = Boolean(region || baseUrl)
  const source = deriveDataState(regionQuery, {
    unavailable: !configured,
    partial: configured && (!region || !baseUrl || !host || !scheme),
  })

  const regionLabel =
    regionKey === 'na'
      ? t('region.zones.na', REGION_ZONE_FALLBACK.na)
      : regionKey === 'eu'
        ? t('region.zones.eu', REGION_ZONE_FALLBACK.eu)
        : regionKey === 'cn'
          ? t('region.zones.cn', REGION_ZONE_FALLBACK.cn)
          : null

  const actions = (
    <IconButton icon={<Icon icon={RefreshCw} size="sm" />} label={t('region.refresh', 'Refresh')} onClick={refresh} busy={regionRefresh.isPending} disabled={regionRefresh.isPending || !canWrite} />
  )

  return (
    <PageLayout
      title={title}
      subtitle={t('region.subtitle', 'Tesla account region and Fleet API endpoint')}
      secondaryActions={actions}
      query={regionQuery}
      dataSources={[{ id: 'tesla-region', label: title, query: regionQuery }]}
    >
      <OperationalWriteNotice />
      <FadeIn>
        <section aria-label={t('region.kpi.section', 'Region overview')}>
          <RegionOperationalBrief
            known={source.hasData}
            sourceStatus={source.status}
            regionKey={regionKey}
            regionLabel={regionLabel}
            scheme={scheme}
            fetchedAt={fetchedAt}
            configured={configured}
            isLoading={source.status === 'initial'}
            isPaused={source.isRefreshBlocked && !source.hasData}
          />
        </section>
      </FadeIn>

      <FadeIn delay={0.1}>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5">
          <section className="xl:col-span-2" aria-label={t('region.endpoint.title', 'Fleet API endpoint')}>
            <RegionEndpointDetails
              region={region}
              baseUrl={baseUrl}
              host={host}
              scheme={scheme}
              regionKey={regionKey}
              regionLabel={regionLabel}
              fetchedAt={fetchedAt}
              isLoading={regionQuery.isLoading && !source.hasData}
              isInitial={source.status === 'initial'}
              isPaused={source.isRefreshBlocked && !source.hasData}
              isError={Boolean(source.fatalError)}
              error={source.fatalError}
              onRetry={() => regionQuery.refetch()}
              onRefresh={refresh}
              isRefreshing={regionRefresh.isPending}
              refreshDisabled={!canWrite}
              refreshBlockReason={writeBlockReason}
            />
          </section>
          <section className="xl:col-span-1" aria-label={t('region.about.title', 'About your region')}>
            <RegionAboutPanel />
          </section>
        </div>
      </FadeIn>
    </PageLayout>
  )
}
