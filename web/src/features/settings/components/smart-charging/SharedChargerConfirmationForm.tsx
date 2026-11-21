import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { SharedChargerConfirmationInput } from '@/api/hooks/useSharedChargerPlanning'
import { Button, ErrorText, Input, Select, Text, Toggle } from '@/components/ui'
import { useDateFormat } from '@/hooks/useDateFormat'
import { sharedChargerWallTime } from './sharedChargerPlanningUtils'

interface Props {
  reminderOffered: boolean
  disabled: boolean
  onConfirm: (input: SharedChargerConfirmationInput) => void
}

export function SharedChargerConfirmationForm({ reminderOffered, disabled, onConfirm }: Props) {
  const { t } = useTranslation()
  const { tz } = useDateFormat('user')
  const [draft, setDraft] = useState({ available: '', departure: '', energy: '', power: '', plugged: '', acceptReminder: false })
  const [invalid, setInvalid] = useState(false)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (disabled) return
    const available = sharedChargerWallTime(draft.available, tz)
    const departure = sharedChargerWallTime(draft.departure, tz)
    const energy = Number(draft.energy)
    const power = Number(draft.power)
    if (!available || !departure || available >= departure || departure.getTime() <= Date.now() ||
      !draft.energy.trim() || !Number.isFinite(energy) || energy < 0 ||
      !draft.power.trim() || !Number.isFinite(power) || power <= 0 ||
      (draft.plugged !== 'yes' && draft.plugged !== 'no')) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    onConfirm({
      available_at: available.toISOString(), departure_at: departure.toISOString(),
      energy_needed_wh: energy, conservative_power_w: power, already_plugged: draft.plugged === 'yes',
      accept_reminder: reminderOffered && draft.acceptReminder,
    })
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Text as="p" variant="bodySm">
        {t('smartCharging.sharedCharger.participantEvidence', 'Confirm only your vehicle’s availability, departure, estimated energy need, conservative charging power, and current connection to this charger. Only the derived order and slot times will be shared.')}
      </Text>
      <Text as="p" variant="bodySm">
        {t('smartCharging.sharedCharger.zoneHint', 'Times use {{zone}}. Repeated daylight-saving times use the first occurrence; skipped times must be changed.', { zone: tz })}
      </Text>
      <fieldset disabled={disabled} className="grid gap-3 sm:grid-cols-2">
        <Input type="datetime-local" required label={t('smartCharging.sharedCharger.availableAt', 'Available from')}
          value={draft.available} onChange={(event) => setDraft({ ...draft, available: event.target.value })} />
        <Input type="datetime-local" required label={t('smartCharging.sharedCharger.departureAt', 'Departure deadline')}
          value={draft.departure} onChange={(event) => setDraft({ ...draft, departure: event.target.value })} />
        <Input type="number" min={0} step="any" required label={t('smartCharging.sharedCharger.energy', 'Estimated energy needed (Wh)')}
          value={draft.energy} onChange={(event) => setDraft({ ...draft, energy: event.target.value })} />
        <Input type="number" step="any" required label={t('smartCharging.sharedCharger.power', 'Conservative charging power (W)')}
          value={draft.power} onChange={(event) => setDraft({ ...draft, power: event.target.value })} />
        <Select label={t('smartCharging.sharedCharger.plugged', 'Currently plugged into this charger?')} required
          placeholder={t('smartCharging.sharedCharger.selectOccupancy', 'Choose current plug occupancy')}
          value={draft.plugged} onChange={(event) => setDraft({ ...draft, plugged: event.target.value })}
          options={[
            { value: 'yes', label: t('smartCharging.sharedCharger.pluggedYes', 'Already plugged in') },
            { value: 'no', label: t('smartCharging.sharedCharger.pluggedNo', 'Not plugged in') },
          ]} />
        {reminderOffered && <Toggle label={t('smartCharging.sharedCharger.acceptReminder', 'Show me one private in-app reminder if a swap is due')}
          checked={draft.acceptReminder} onChange={(acceptReminder) => setDraft({ ...draft, acceptReminder })} />}
      </fieldset>
      {invalid && <ErrorText role="alert">
        {t('smartCharging.sharedCharger.invalidConfirmation', 'Enter a valid future departure after availability, a nonnegative energy estimate, positive charging power, and current plug occupancy.')}
      </ErrorText>}
      <Button type="submit" disabled={disabled}>{t('smartCharging.sharedCharger.confirm', 'Confirm my vehicle for this revision')}</Button>
    </form>
  )
}
