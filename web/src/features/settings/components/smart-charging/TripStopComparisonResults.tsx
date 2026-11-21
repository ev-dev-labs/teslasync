import { useTranslation } from 'react-i18next'
import { Text } from '@/components/ui'
import { useDateFormat } from '@/hooks/useDateFormat'
import { useNumberFormatting } from '@/hooks/useNumberFormatting'
import { useUnits } from '@/hooks/useUnits'
import { convertDurationFromSI } from '@/lib/unitConversion'
import type { TripStopResult } from '@/types/smartTripStops'

interface Props {
  result: TripStopResult
  capacityWh: number
}

export function TripStopComparisonResults({ result, capacityWh }: Props) {
  const { t } = useTranslation()
  const { formatDateTime } = useDateFormat('user')
  const { fmtNumber } = useNumberFormatting()
  const { formatDistance } = useUnits()
  const minutes = (seconds: number) => fmtNumber(Math.ceil(convertDurationFromSI(seconds, 'min')))

  return (
    <div className="space-y-3">
      <Text as="p" variant="bodySm">
        {t('smartCharging.stopComparison.comparedAt', 'Estimates checked {{when}} and valid until {{expires}}.', {
          when: formatDateTime(result.compared_at), expires: formatDateTime(result.expires_at),
        })}
      </Text>
      <Text as="p" variant="bodySm">
        {t('smartCharging.stopComparison.why', 'Ranked by extra road time, recorded median wait and estimated charge time. Arrival uses your higher consumption and entered battery capacity, with a charging time buffer. These estimates do not verify traffic, open stalls or the return trip.')}
      </Text>
      <ol className="space-y-3">
        {(result.stops ?? []).map((stop) => (
          <li key={stop.place_id} className="min-w-0 space-y-1 border-t border-[var(--border-subtle)] pt-3">
            <Text as="p" variant="body" weight="semibold" className="break-words">{stop.place_name}</Text>
            <Text as="p" variant="bodySm">
              {t('smartCharging.stopComparison.times', 'Extra road distance: {{distance}}. Extra driving: {{drive}} min. Historical wait: {{wait}} min. Estimated charge: {{charge}} min.', {
                distance: formatDistance(stop.detour_m), drive: minutes(stop.detour_s),
                wait: minutes(stop.expected_wait_s), charge: minutes(stop.estimated_charge_s),
              })}
            </Text>
            <Text as="p" variant="bodySm">
              {t('smartCharging.stopComparison.reserve', 'Estimated stop arrival at {{when}} with {{stopCharge}}%. The comparison budgets enough charging to reach your destination at the {{destinationReserve}}% reserve.', {
                when: formatDateTime(stop.arrive_at), stopCharge: fmtNumber(stop.station_arrival_wh * 100 / capacityWh),
                destinationReserve: fmtNumber(stop.destination_charge_wh * 100 / capacityWh),
              })}
            </Text>
            <Text as="p" variant="bodySm">
              {t('smartCharging.stopComparison.samples', 'Evidence: {{waits}} recorded wait days and {{charges}} comparable measured charging sessions at this place.', {
                waits: fmtNumber(stop.wait_sample_count), charges: fmtNumber(stop.charge_sample_count),
              })}
            </Text>
          </li>
        ))}
      </ol>
    </div>
  )
}
