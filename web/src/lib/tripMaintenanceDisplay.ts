import type { TFunction } from 'i18next'
import type { TripMaintenanceProjection } from '@/types/smartTripMaintenance'

export function formatTripMaintenance(
  projection: TripMaintenanceProjection,
  t: TFunction,
  formatDateTime: (value: string) => string,
  formatDistance: (value: number) => string,
) {
  return {
    title: t('smartCharging.tripMaintenance.cardTitle', 'Review maintenance before your trip'),
    summary: t('smartCharging.tripMaintenance.cardSummary', '{{service}} is due at {{due}}. The trip on {{departure}} would put the estimated odometer between {{low}} and {{high}}.', {
      service: projection.service_label, due: formatDistance(projection.due_odometer_m),
      departure: formatDateTime(projection.departure_at), low: formatDistance(projection.arrival_odometer_low_m),
      high: formatDistance(projection.arrival_odometer_high_m),
    }),
    basis: t('smartCharging.tripMaintenance.cardBasis', 'Recorded odometer: {{current}} on {{observed}}. You entered a service at {{serviced}} on {{serviceDate}}, an interval of {{interval}}, and a trip estimate of {{tripLow}} to {{tripHigh}}.', {
      current: formatDistance(projection.recorded_odometer_m), observed: formatDateTime(projection.recorded_at),
      serviced: formatDistance(projection.service_odometer_m), serviceDate: formatDateTime(projection.service_completed_at),
      interval: formatDistance(projection.interval_m), tripLow: formatDistance(projection.trip_distance_low_m),
      tripHigh: formatDistance(projection.trip_distance_high_m),
    }),
    limitation: t('smartCharging.tripMaintenance.cardLimitation', 'This compares your trip estimate with the interval you recorded. It does not assess vehicle condition or book service.'),
  }
}
