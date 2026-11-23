import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SharedTripConfirmation, SharedTripInvitation } from '@/api/hooks/useSharedTripPlanning'
import { Button, ErrorText, Input, Select, Subhead, Text } from '@/components/ui'
import { useDateFormat } from '@/hooks/useDateFormat'
import { useSharedTripExpiry } from './useSharedTripExpiry'

interface Props {
  entry: SharedTripInvitation
  disabled: boolean
  pending: boolean
  onClose: () => void
  onSave: (confirmation: SharedTripConfirmation) => Promise<void>
}

function percentage(value: string) {
  const numeric = Number(value)
  return value !== '' && Number.isFinite(numeric) && numeric >= 0 && numeric <= 100 ? numeric : null
}

export function SharedTripConfirmationForm({ entry, disabled, pending, onClose, onSave }: Props) {
  const { t } = useTranslation()
  const { formatDateTime } = useDateFormat()
  const upcoming = useSharedTripExpiry(entry.departure_at)
  const [tripUseLow, setTripUseLow] = useState('')
  const [tripUseHigh, setTripUseHigh] = useState('')
  const [reserve, setReserve] = useState('')
  const [schedule, setSchedule] = useState('')
  const [maintenance, setMaintenance] = useState('')
  const [invalid, setInvalid] = useState(false)

  return (
    <form className="space-y-3" onSubmit={(event) => {
      event.preventDefault()
      if (disabled || !upcoming) return
      const low = percentage(tripUseLow)
      const high = percentage(tripUseHigh)
      const minimum = percentage(reserve)
      if (low == null || high == null || minimum == null || low > high || !schedule || !maintenance) {
        setInvalid(true)
        return
      }
      setInvalid(false)
      void onSave({
        trip_use_low_pct: low,
        trip_use_high_pct: high,
        reserve_pct: minimum,
        schedule_clear: schedule === 'clear',
        maintenance_clear: maintenance === 'clear',
      })
    }}>
      <Subhead>
        {t('smartCharging.sharedTrip.confirmationTitle', 'Confirm vehicle {{vehicleId}} for {{departure}}', {
          vehicleId: entry.vehicle_id, departure: formatDateTime(entry.departure_at),
        })}
      </Subhead>
      <Text as="p" variant="bodySm">
        {t('smartCharging.sharedTrip.confirmationPrivacy', 'Use conservative estimates for the entire trip. Other confirmed participants only see eligible options and battery estimates, not your schedule or service details. Your confirmation expires within 24 hours or at departure, whichever comes first.')}
      </Text>
      <fieldset className="grid gap-3 sm:grid-cols-2" disabled={disabled || !upcoming}>
        <Input type="number" min={0} max={100} step="any" required value={tripUseLow}
          label={t('smartCharging.sharedTrip.lowUse', 'Estimated minimum battery use (%)')}
          onChange={(event) => setTripUseLow(event.target.value)} />
        <Input type="number" min={0} max={100} step="any" required value={tripUseHigh}
          label={t('smartCharging.sharedTrip.highUse', 'Estimated maximum battery use (%)')}
          onChange={(event) => setTripUseHigh(event.target.value)} />
        <Input type="number" min={0} max={100} step="any" required value={reserve}
          label={t('smartCharging.sharedTrip.reserve', 'Minimum battery reserve on return (%)')}
          onChange={(event) => setReserve(event.target.value)} />
        <Select required value={schedule}
          label={t('smartCharging.sharedTrip.schedule', 'Is the vehicle available for the shared departure?')}
          placeholder={t('smartCharging.sharedTrip.chooseClearance', 'Choose an answer')}
          options={[
            { value: 'clear', label: t('smartCharging.sharedTrip.scheduleClear', 'Yes, I checked availability') },
            { value: 'unverified', label: t('smartCharging.sharedTrip.scheduleNotClear', 'No, or I am not sure') },
          ]}
          onChange={(event) => setSchedule(event.target.value)} />
        <Select required value={maintenance}
          label={t('smartCharging.sharedTrip.maintenance', 'Is the vehicle clear of overdue maintenance for this departure?')}
          placeholder={t('smartCharging.sharedTrip.chooseClearance', 'Choose an answer')}
          options={[
            { value: 'clear', label: t('smartCharging.sharedTrip.maintenanceClear', 'Yes, I checked overdue maintenance') },
            { value: 'unverified', label: t('smartCharging.sharedTrip.maintenanceNotClear', 'No, or I am not sure') },
          ]}
          onChange={(event) => setMaintenance(event.target.value)} />
      </fieldset>
      {invalid && <ErrorText role="alert">
        {t('smartCharging.sharedTrip.invalidConfirmation', 'Enter a battery use range from 0 to 100 with the minimum first, a reserve, and both clearance answers.')}
      </ErrorText>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={disabled || !upcoming} loading={pending}>
          {t('smartCharging.sharedTrip.confirmParticipation', 'Confirm participation')}
        </Button>
        <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={onClose}>
          {t('smartCharging.sharedTrip.closeEditor', 'Close editor')}
        </Button>
      </div>
    </form>
  )
}
