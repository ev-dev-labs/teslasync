import { useTranslation } from 'react-i18next'
import { useSharedTripComparison, type SharedTripInvitation, type SharedTripScope } from '@/api/hooks/useSharedTripPlanning'
import { QueryError, Skeleton } from '@/components/feedback'
import { Button, Subhead, Text } from '@/components/ui'
import { useDateFormat } from '@/hooks/useDateFormat'
import { useNumberFormatting } from '@/hooks/useNumberFormatting'
import { useSharedTripExpiry } from './useSharedTripExpiry'

interface Props {
  scope: SharedTripScope
  entry: SharedTripInvitation
  paused: boolean
  onClose: () => void
}

export function SharedTripComparisonCard({ scope, entry, paused, onClose }: Props) {
  const { t } = useTranslation()
  const { formatDateTime } = useDateFormat('user')
  const { fmtPercent } = useNumberFormatting()
  const accepted = useSharedTripExpiry(entry.consent_expires_at)
  const upcoming = useSharedTripExpiry(entry.departure_at)
  const authorized = accepted && upcoming
  const query = useSharedTripComparison(scope, authorized && !paused ? entry : null)
  const comparison = query.data
  const current = useSharedTripExpiry(comparison?.expires_at)
  const options = comparison?.options ?? []
  const showResults = current && comparison?.id === entry.trip_id && comparison.revision === entry.revision && options.length >= 2
  return (
    <section className="space-y-3">
      <Subhead>{t('smartCharging.sharedTrip.comparisonTitle', 'Shared vehicle comparison')}</Subhead>
      {!authorized ? (
        <Text as="p" variant="bodySm">
          {t('smartCharging.sharedTrip.consentRequired', 'A current confirmation is required to view this comparison.')}
        </Text>
      ) : paused || query.isFetching || query.isPending ? (
        <Skeleton lines={2} />
      ) : query.isError ? (
        <QueryError error={query.error} onRetry={() => void query.refetch()} />
      ) : !showResults ? (
        <Text as="p" variant="bodySm">
          {t('smartCharging.sharedTrip.noComparison', 'A comparison needs two eligible, confirmed vehicles with current battery evidence. Refresh to check again.')}
        </Text>
      ) : (
        <>
          <Text as="p" variant="bodySm">
            {t('smartCharging.sharedTrip.why', 'Why this order? Vehicles with the largest estimated buffer above their reserve in the worst case appear first. Availability and maintenance are participant-confirmed.')}
          </Text>
          <Text as="p" variant="bodySm">
            {t('smartCharging.sharedTrip.nextStep', 'Review the estimated return ranges and check the chosen vehicle again before departure. These estimates are not a guarantee or a reservation.')}
          </Text>
          <Text as="p" variant="helper">
            {t('smartCharging.sharedTrip.evidenceUntil', 'Comparison evidence expires at {{time}}.', { time: formatDateTime(comparison.expires_at) })}
          </Text>
          <ol className="list-decimal space-y-3 ps-6">
            {options.map((option) => (
              <li key={option.vehicle_id}>
                <Text as="p" variant="bodySm">
                  {t('smartCharging.sharedTrip.optionRange', 'Vehicle {{vehicleId}}: estimated return {{low}}–{{high}}; minimum reserve {{reserve}}.', {
                    vehicleId: option.vehicle_id,
                    low: fmtPercent(Math.floor(option.return_low_pct * 10) / 10, 1),
                    high: fmtPercent(Math.ceil(option.return_high_pct * 10) / 10, 1),
                    reserve: fmtPercent(option.reserve_pct),
                  })}
                </Text>
                <Text as="p" variant="helper">
                  {t('smartCharging.sharedTrip.optionEvidence', 'Battery observed at {{observed}}; option expires at {{expires}}.', {
                    observed: formatDateTime(option.observed_at), expires: formatDateTime(option.expires_at),
                  })}
                </Text>
              </li>
            ))}
          </ol>
        </>
      )}
      <div className="flex flex-wrap gap-2">
        {authorized && (
          <Button size="sm" variant="secondary" disabled={paused || query.isFetching} onClick={() => void query.refetch()}>
            {t('smartCharging.sharedTrip.refreshComparison', 'Refresh comparison')}
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={onClose}>
          {t('smartCharging.sharedTrip.closeComparison', 'Close comparison')}
        </Button>
      </div>
    </section>
  )
}
