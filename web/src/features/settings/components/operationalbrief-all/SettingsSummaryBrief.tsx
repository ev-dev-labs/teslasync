import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { OperationalBrief, type StatMetric } from '@/components/data-display'
import { Text } from '@/components/ui'
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics'

interface Props {
  title: string
  description: string
  source: string
  scope: string
  metrics: readonly StatMetric[]
  loading?: boolean
  unavailable?: boolean
  retained?: boolean
  testId?: string
  freshness?: ReactNode
}

export function SettingsSummaryBrief({
  title, description, source, scope, metrics, loading = false,
  unavailable = false, retained = false, testId, freshness,
}: Props) {
  const { t } = useTranslation('settings')
  const bridged = useOperationalMetrics(metrics.map(metric => ({
    ...metric,
    description: metric.description ?? description,
  })))
  const statusLabel = loading
    ? t('summaryBrief.loading', 'Loading source')
    : retained
      ? t('summaryBrief.retained', 'Retained source')
      : unavailable
        ? t('summaryBrief.unavailable', 'Source unavailable')
        : t('summaryBrief.available', 'Source available')

  return (
    <OperationalBrief compact title={title} description={description}
      eyebrow={source} statusLabel={statusLabel}
      statusTone={retained || unavailable ? 'warning' : 'neutral'}
      metrics={bridged} loading={loading} testId={testId}
      scope={<Text as="span" variant="caption">{scope}</Text>}
      freshness={freshness} provenance={source} />
  )
}
