import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSharedChargerCard, type SharedChargerRef, type SharedChargerScope } from '@/api/hooks/useSharedChargerPlanning'
import { QueryError, Skeleton } from '@/components/feedback'
import { GlassPanel, PanelTitle, Text } from '@/components/ui'
import { useDateFormat } from '@/hooks/useDateFormat'

interface Props {
  scope: SharedChargerScope
  plan: SharedChargerRef
  confirmed: boolean
  vehicleName: (vehicleId: number) => string
}

function useExpiryRefresh(endsAt: string | undefined, reminderEndsAt: string | undefined) {
  const [, refresh] = useState(0)
  useEffect(() => {
    const now = Date.now()
    const timers = [endsAt, reminderEndsAt].flatMap((at) => {
      if (!at) return []
      const delay = Date.parse(at) - now
      return delay > 0 && delay < 2 ** 31 ? [window.setTimeout(() => refresh((count) => count + 1), delay)] : []
    })
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [endsAt, reminderEndsAt])
}

export function SharedChargerPlanCard({ scope, plan, confirmed, vehicleName }: Props) {
  const { t } = useTranslation()
  const { formatDateTime } = useDateFormat('user')
  const query = useSharedChargerCard(scope, plan)
  const result = query.data
  useExpiryRefresh(result?.card?.expires_at, result?.reminder?.expires_at)
  if (query.isError) return <QueryError error={query.error} onRetry={() => void query.refetch()} />
  if (!result) return <Skeleton lines={2} />
  const now = Date.now()
  const card = result.card && now < Date.parse(result.card.expires_at) ? result.card : null
  const reminder = card && result.reminder && now < Date.parse(result.reminder.expires_at) ? result.reminder : null
  return (
    <GlassPanel padding="md" className="space-y-3">
      <PanelTitle>{t('smartCharging.sharedCharger.orderTitle', 'Shared charging order')}</PanelTitle>
      {card ? (
        <>
          <Text as="p" variant="bodySm">
            {t('smartCharging.sharedCharger.firstSlot', 'First: {{vehicle}}, {{start}} to {{end}}', {
              vehicle: vehicleName(card.first.vehicle_id),
              start: formatDateTime(card.first.starts_at), end: formatDateTime(card.first.ends_at),
            })}
          </Text>
          <Text as="p" variant="bodySm">
            {t('smartCharging.sharedCharger.secondSlot', 'Second: {{vehicle}}, {{start}} to {{end}}', {
              vehicle: vehicleName(card.second.vehicle_id),
              start: formatDateTime(card.second.starts_at), end: formatDateTime(card.second.ends_at),
            })}
          </Text>
          <Text as="p" variant="bodySm">
            {t('smartCharging.sharedCharger.manualSwap', 'Before the first slot, verify that the first vehicle can use the charger and agree on any needed disconnect. Coordinate the manual handoff at {{time}}, allowing at least 10 minutes to unplug and reconnect.', { time: formatDateTime(card.swap_at) })}
          </Text>
          <Text as="p" variant="bodySm">
            {t('smartCharging.sharedCharger.why', 'Why this order? Both participants confirmed this revision. The estimate uses their declared charging windows, energy, power, and plug occupancy—not live charging measurements.')}
          </Text>
          <Text as="p" variant="bodySm">
            {t('smartCharging.sharedCharger.cardValidity', 'Evaluated {{evaluated}} · Advice expires {{expires}}.', {
              evaluated: formatDateTime(card.evaluated_at), expires: formatDateTime(card.expires_at),
            })}
          </Text>
        </>
      ) : <Text as="p" variant="bodySm">
        {confirmed
          ? t('smartCharging.sharedCharger.noOrder', 'No actionable order is available. The other vehicle may not have confirmed, no safe handoff may be needed or feasible, or the advice may have expired.')
          : t('smartCharging.sharedCharger.needsConfirmation', 'Confirm your vehicle to take part. An order appears only after both vehicles confirm and a handoff is needed and feasible.')}
      </Text>}
      {reminder && (
        <GlassPanel padding="md" className="space-y-2">
          <PanelTitle>{t('smartCharging.sharedCharger.reminderTitle', 'Your private swap reminder')}</PanelTitle>
          <Text as="p" variant="bodySm">
            {t('smartCharging.sharedCharger.reminderMessage', 'The handoff for {{vehicle}} was planned for {{swap}}. If both participants are ready, coordinate it manually. This reminder expires at {{expires}}.', {
              vehicle: vehicleName(reminder.vehicle_id), swap: formatDateTime(reminder.swap_at),
              expires: formatDateTime(reminder.expires_at),
            })}
          </Text>
        </GlassPanel>
      )}
    </GlassPanel>
  )
}
