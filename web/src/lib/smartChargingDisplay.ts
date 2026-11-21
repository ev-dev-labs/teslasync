import { useTranslation } from 'react-i18next'
import { useNumberFormatting } from '@/hooks/useNumberFormatting'
import type { SmartChargingTripProjection } from '@/types/smartCharging'

export function useTripProjectionDisplay() {
  const { t } = useTranslation()
  const { fmtNumber } = useNumberFormatting()
  return (projection: SmartChargingTripProjection, reservePct: number) => {
    const parts: string[] = []
    if (projection.destination_reachability === 'unreachable') {
      parts.push(t('smartCharging.destinationUnreachable', 'With {{start}}% at departure, even the lower outbound estimate exceeds the available charge. Review a stop before the destination.', {
        start: fmtNumber(projection.starting_battery_pct),
      }))
    } else {
      parts.push(t('smartCharging.destinationEstimate', 'With {{start}}% at departure, estimated charge at the destination is {{low}}-{{high}}% against a {{reserve}}% reserve.', {
        start: fmtNumber(projection.starting_battery_pct),
        low: fmtNumber(projection.destination_low_pct), high: fmtNumber(projection.destination_high_pct),
        reserve: fmtNumber(reservePct),
      }))
      if (projection.destination_reachability === 'uncertain') {
        parts.push(t('smartCharging.destinationUncertain', 'The higher outbound estimate may leave the destination unreachable.'))
      }
      if (projection.return_reachability === 'unreachable') {
        parts.push(t('smartCharging.returnUnreachable', 'The return cannot be completed without an additional charge under these estimates.'))
      } else if (projection.return_low_pct != null && projection.return_high_pct != null) {
        parts.push(t('smartCharging.returnEstimate', 'If the destination is reached, the estimated return charge is {{low}}-{{high}}%.', {
          low: fmtNumber(projection.return_low_pct), high: fmtNumber(projection.return_high_pct),
        }))
        if (projection.return_reachability === 'uncertain') {
          parts.push(t('smartCharging.returnUncertain', 'The higher return-use estimate may require another charge.'))
        }
      }
    }
    const assumptions = [
      projection.destination_charge_pct == null
        ? t('smartCharging.noDestinationChargeAssumption', 'The return estimate assumes no destination charging.')
        : t('smartCharging.destinationChargeAssumption', 'The return estimate assumes the planned {{charge}}% destination charge; it is not confirmed or guaranteed.', {
            charge: fmtNumber(projection.destination_charge_pct),
          }),
      t('smartCharging.tripProjectionLimitation', 'These are estimates, not measurements. A 0% bound may mean a leg cannot be completed.'),
    ]
    return { summary: parts.join(' '), assumptions }
  }
}
