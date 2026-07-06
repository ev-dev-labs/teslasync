import { useTranslation } from 'react-i18next'
import { Globe, PlugZap, ShieldCheck, Clock } from 'lucide-react'
import { MetricCard } from '@/components/data-display'
import { StatGridSkeleton } from '@/components/feedback'
import { useDateFormat } from '@/hooks/useDateFormat'
import type { RegionZoneKey } from './helpers'

export interface RegionKpiBandProps {
  regionKey: RegionZoneKey | null
  regionLabel: string | null
  scheme: string | null
  fetchedAt: string | null
  configured: boolean
  isLoading: boolean
}

/**
 * Full-width KPI strip for the Region page. Owns its own loading state
 * (skeleton) and renders null-safe placeholders (`—`) so every card stays
 * visible even before the account region has been resolved.
 */
export function RegionKpiBand({
  regionKey,
  regionLabel,
  scheme,
  fetchedAt,
  configured,
  isLoading,
}: RegionKpiBandProps) {
  const { t } = useTranslation('settings')
  const { formatRelative } = useDateFormat()

  if (isLoading) {
    return <StatGridSkeleton cards={4} />
  }

  const regionValue = regionKey ? regionKey.toUpperCase() : '—'
  const statusValue = configured
    ? t('region.status.configured', 'Configured')
    : t('region.status.pending', 'Not configured')
  const protocolValue = scheme ? scheme.toUpperCase() : '—'
  const syncedValue = fetchedAt ? formatRelative(new Date(fetchedAt)) : '—'
  // `??` only guards null/undefined — an empty or whitespace-only label would
  // otherwise render a blank subtitle. Trim-guard it so the card keeps its
  // "Not detected" placeholder and never collapses to an empty line.
  const regionSubtitle = regionLabel?.trim()
    ? regionLabel
    : t('region.kpi.regionUnknown', 'Not detected')

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <MetricCard
        label={t('region.kpi.region', 'Region')}
        value={regionValue}
        subtitle={regionSubtitle}
        icon={<Globe className="h-5 w-5" aria-hidden="true" />}
        color="cyan"
      />
      <MetricCard
        label={t('region.kpi.status', 'Endpoint')}
        value={statusValue}
        subtitle={t('region.kpi.source', 'Tesla Fleet API')}
        icon={<PlugZap className="h-5 w-5" aria-hidden="true" />}
        color={configured ? 'green' : 'amber'}
      />
      <MetricCard
        label={t('region.kpi.protocol', 'Protocol')}
        value={protocolValue}
        subtitle={t('region.kpi.protocolHint', 'Secure transport')}
        icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
        color="blue"
      />
      <MetricCard
        label={t('region.kpi.synced', 'Last synced')}
        value={syncedValue}
        subtitle={t('region.kpi.syncedHint', 'From Tesla account')}
        icon={<Clock className="h-5 w-5" aria-hidden="true" />}
        color="purple"
      />
    </div>
  )
}
