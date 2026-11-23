import { useTranslation } from 'react-i18next'
import type { SharedTripInvitation } from '@/api/hooks/useSharedTripPlanning'
import { Button, Text } from '@/components/ui'
import { useDateFormat } from '@/hooks/useDateFormat'
import { useSharedTripExpiry } from './useSharedTripExpiry'

interface Props {
  entry: SharedTripInvitation
  disabled: boolean
  onConfirm: () => void
  onWithdraw: () => void
  onCompare: () => void
}

export function SharedTripInvitationRow({ entry, disabled, onConfirm, onWithdraw, onCompare }: Props) {
  const { t } = useTranslation()
  const { formatDateTime } = useDateFormat()
  const accepted = useSharedTripExpiry(entry.consent_expires_at)
  const upcoming = useSharedTripExpiry(entry.departure_at)
  return (
    <li className="space-y-2 border-b border-[var(--border-subtle)] pb-3 last:border-b-0">
      <Text as="p" variant="bodySm">
        {t('smartCharging.sharedTrip.invitationDeparture', 'Trip {{tripId}} · Vehicle {{vehicleId}} · {{departure}}', {
          tripId: entry.trip_id, vehicleId: entry.vehicle_id, departure: formatDateTime(entry.departure_at),
        })}
      </Text>
      <Text as="p" variant="helper">
        {!upcoming
          ? t('smartCharging.sharedTrip.departurePassed', 'This shared departure has passed.')
          : accepted
            ? t('smartCharging.sharedTrip.confirmedUntil', 'Your confirmation is valid until {{time}}.', { time: formatDateTime(entry.consent_expires_at) })
            : entry.consent_expires_at
              ? t('smartCharging.sharedTrip.confirmationExpired', 'Your confirmation has expired. Confirm again to participate.')
              : t('smartCharging.sharedTrip.awaitingConsent', 'Awaiting your confirmation.')}
      </Text>
      {upcoming && (
        <div className="flex flex-wrap gap-2">
          {accepted && <Button size="sm" onClick={onCompare}>{t('smartCharging.sharedTrip.openComparison', 'Compare vehicles')}</Button>}
          <Button size="sm" variant="secondary" disabled={disabled} onClick={onConfirm}>
            {accepted
              ? t('smartCharging.sharedTrip.reviewConfirmation', 'Update confirmation')
              : t('smartCharging.sharedTrip.openConfirmation', 'Review and confirm')}
          </Button>
          <Button size="sm" variant="secondary" disabled={disabled} onClick={onWithdraw}>
            {t('smartCharging.sharedTrip.withdraw', 'Withdraw vehicle')}
          </Button>
        </div>
      )}
    </li>
  )
}
