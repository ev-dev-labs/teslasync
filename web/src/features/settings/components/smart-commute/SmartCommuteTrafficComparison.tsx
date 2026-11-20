import { useTranslation } from 'react-i18next'
import { PanelTitle, Text } from '@/components/ui'
import { useDateFormat } from '@/hooks/useDateFormat'
import type { SmartCommuteTrafficDecision } from '@/types/smartCommute'

interface Props {
  decisions: SmartCommuteTrafficDecision[]
  requestedOccurrence: string | null
}

export function SmartCommuteTrafficComparison({ decisions, requestedOccurrence }: Props) {
  const { t } = useTranslation()
  const { formatDateTime } = useDateFormat()
  const available = decisions.filter((decision) =>
    (requestedOccurrence == null || decision.occurrence_id === requestedOccurrence) &&
    Date.parse(decision.expires_at) > Date.now(),
  )

  if (requestedOccurrence == null && available.length === 0) return null

  return (
    <section className="space-y-3" aria-label={t('smartCommute.traffic.comparison', 'Compare routes')}>
      <PanelTitle>{t('smartCommute.traffic.comparison', 'Compare routes')}</PanelTitle>
      {available.length === 0 && (
        <Text as="p" variant="bodySm">
          {t('smartCommute.traffic.expired', 'This comparison is no longer available. You may have left or the traffic evidence may have expired.')}
        </Text>
      )}
      {available.map((decision) => (
        <article className="space-y-2 rounded-lg border border-[var(--border-subtle)] p-4" key={decision.occurrence_id}>
          <Text as="p" weight="semibold">{t('smartCommute.traffic.forVehicle', '{{routine}} · {{vehicle}}', {
            routine: decision.routine_name, vehicle: decision.vehicle_name,
          })}</Text>
          <Text as="p" variant="bodySm">{t('smartCommute.traffic.usualEta', 'Usual route: {{minutes}} min', {
            minutes: Math.round(decision.usual_s / 60),
          })}</Text>
          <Text as="p" variant="bodySm">{t('smartCommute.traffic.alternativeEta', 'Faster alternative: {{minutes}} min', {
            minutes: Math.round(decision.alternative_s / 60),
          })}</Text>
          <Text as="p" variant="bodySm">{t('smartCommute.traffic.saving', 'Estimated saving: {{minutes}} min', {
            minutes: Math.round((decision.usual_s - decision.alternative_s) / 60),
          })}</Text>
          <Text as="p" variant="bodySm">{t('smartCommute.traffic.evidence', 'HERE traffic observed {{observed}} for departure at {{departure}}.', {
            observed: formatDateTime(decision.observed_at), departure: formatDateTime(decision.departure_at),
          })}</Text>
          <Text as="p" variant="bodySm">{t('smartCommute.traffic.teslaRoute', 'These are estimates, not measured trip times. Tesla calculates its own route.')}</Text>
        </article>
      ))}
    </section>
  )
}
