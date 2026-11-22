import { useTranslation } from 'react-i18next'
import type { PersonalScope } from '@/api/hooks/usePersonalIdentity'
import { PanelTitle, Text } from '@/components/ui'
import { useDateFormat } from '@/hooks/useDateFormat'
import { useCommuteRouteEnergyDisplay } from '@/lib/smartCommuteDisplay'
import type { SmartCommuteTrafficDecision } from '@/types/smartCommute'
import { SmartCommuteNavigation } from './SmartCommuteNavigation'

interface Props {
  decisions: SmartCommuteTrafficDecision[]
  requestedOccurrence: string | null
  scope: PersonalScope
  navigationAvailable: boolean
  navigationDisabled: boolean
}

export function SmartCommuteTrafficComparison({ decisions, requestedOccurrence, scope, navigationAvailable, navigationDisabled }: Props) {
  const { t } = useTranslation()
  const { formatDateTime } = useDateFormat()
  const displayEnergy = useCommuteRouteEnergyDisplay()
  const available = decisions.filter((decision) =>
    (requestedOccurrence == null || decision.occurrence_id === requestedOccurrence) &&
    Date.parse(decision.expires_at) > Date.now() &&
    (!decision.route_energy_only || displayEnergy(decision.route_energy) != null),
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
      {available.map((decision) => {
        const energy = displayEnergy(decision.route_energy)
        return (
        <article className="space-y-2 rounded-lg border border-[var(--border-subtle)] p-4" key={decision.occurrence_id}>
          <Text as="p" weight="semibold">{t('smartCommute.traffic.forVehicle', '{{routine}} · {{vehicle}}', {
            routine: decision.routine_name, vehicle: decision.vehicle_name,
          })}</Text>
          {!decision.route_energy_only && (
            <>
              <Text as="p" variant="bodySm">{t('smartCommute.traffic.usualEta', 'Usual route: {{minutes}} min', {
                minutes: Math.round(decision.usual_s / 60),
              })}
                {decision.usual_route_label && <> {t('smartCommute.traffic.viaRoute', 'via {{route}}', { route: decision.usual_route_label })}</>}
              </Text>
              <Text as="p" variant="bodySm">{decision.alternative_s < decision.usual_s
                ? t('smartCommute.traffic.alternativeEta', 'Faster alternative: {{minutes}} min', { minutes: Math.round(decision.alternative_s / 60) })
                : t('smartCommute.traffic.deadline.alternativeEta', 'Alternative route: {{minutes}} min', { minutes: Math.round(decision.alternative_s / 60) })}
                {decision.alternative_route_label && <> {t('smartCommute.traffic.viaRoute', 'via {{route}}', { route: decision.alternative_route_label })}</>}
              </Text>
              {decision.alternative_s < decision.usual_s && (
                <Text as="p" variant="bodySm">{t('smartCommute.traffic.saving', 'Estimated saving: {{minutes}} min', {
                  minutes: Math.round((decision.usual_s - decision.alternative_s) / 60),
                })}</Text>
              )}
            </>
          )}
          {energy && (
            <div className="space-y-2">
              <Text as="p" weight="semibold">{energy.title}</Text>
              <Text as="p" variant="bodySm">{energy.fastest}</Text>
              <Text as="p" variant="bodySm">{energy.saving}</Text>
              <Text as="p" variant="bodySm">{energy.conditions} {energy.limits}</Text>
            </div>
          )}
          {decision.arrival_deadline_at && decision.latest_departure_at && (
            <>
              <Text as="p" weight="semibold">{t('smartCommute.traffic.deadline.recommendation', 'Estimated latest departure: {{latest}}. Your arrival deadline: {{deadline}}.', {
                latest: formatDateTime(decision.latest_departure_at, { tz: decision.time_zone }),
                deadline: formatDateTime(decision.arrival_deadline_at, { tz: decision.time_zone }),
              })}</Text>
              <Text as="p" variant="bodySm">{t('smartCommute.traffic.deadline.limitations', 'TeslaSync works backward from the fastest qualifying estimate and adds a three-minute buffer. Traffic at an earlier departure may differ.')}</Text>
            </>
          )}
          <Text as="p" variant="bodySm">{t('smartCommute.traffic.evidence', 'HERE traffic observed {{observed}} for departure at {{departure}}.', {
            observed: formatDateTime(decision.observed_at), departure: formatDateTime(decision.departure_at),
          })}</Text>
          <Text as="p" variant="bodySm">{t('smartCommute.traffic.teslaRoute', 'These are estimates, not measured trip times. Tesla calculates its own route.')}</Text>
          {scope.mode === 'forward_auth' && !decision.route_energy_only && !decision.arrival_deadline_at &&
            ((navigationAvailable && !decision.navigation_paused) || decision.navigation_outcome) && (
              <SmartCommuteNavigation decision={decision} scope={scope}
                available={navigationAvailable && !decision.navigation_paused} disabled={navigationDisabled} />
            )}
        </article>
        )
      })}
    </section>
  )
}
