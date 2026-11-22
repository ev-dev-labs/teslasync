import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { SharedChargerAuthorizationInput, SharedChargerOwnedPlan } from '@/api/hooks/useSharedChargerPlanning'
import { Button, ErrorText, Input, PanelTitle, Select, Text } from '@/components/ui'
import { useDateFormat } from '@/hooks/useDateFormat'
import { toZonedDatetimeStr } from '@/lib/dateConvert'
import { sharedChargerWallTime, type SharedChargerPlaceChoice, type SharedChargerVehicleChoice } from './sharedChargerPlanningUtils'

interface Props {
  plan: SharedChargerOwnedPlan | null
  places: readonly SharedChargerPlaceChoice[]
  vehicles: readonly SharedChargerVehicleChoice[]
  disabled: boolean
  onSave: (input: SharedChargerAuthorizationInput) => void
  onCancel: () => void
}

function validSubject(subject: string) {
  return subject !== '' && subject === subject.trim() && new TextEncoder().encode(subject).length <= 256
}

export function SharedChargerAuthorizationForm({ plan, places, vehicles, disabled, onSave, onCancel }: Props) {
  const { t } = useTranslation()
  const { tz } = useDateFormat('user')
  const initialExpiry = plan == null ? '' : toZonedDatetimeStr(new Date(plan.expires_at), tz)
  const [draft, setDraft] = useState({
    place: plan == null ? '' : String(plan.place_id),
    expires: initialExpiry,
    firstVehicle: '', firstSubject: '', secondVehicle: '', secondSubject: '', reminder: '',
  })
  const [invalid, setInvalid] = useState(false)
  const vehicleOptions = vehicles.map((vehicle) => ({ value: String(vehicle.id), label: vehicle.display_name }))

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (disabled) return
    const expires = plan && draft.expires === initialExpiry
      ? new Date(plan.expires_at) : sharedChargerWallTime(draft.expires, tz)
    const place = places.find((item) => String(item.id) === draft.place)
    const firstVehicle = vehicles.find((item) => String(item.id) === draft.firstVehicle)
    const secondVehicle = vehicles.find((item) => String(item.id) === draft.secondVehicle)
    if (!expires || !Number.isFinite(expires.getTime()) || expires.getTime() <= Date.now() || !place?.updated_at ||
      !firstVehicle || !secondVehicle || firstVehicle.id === secondVehicle.id ||
      !validSubject(draft.firstSubject) || !validSubject(draft.secondSubject)) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    onSave({
      place_id: place.id, place_updated_at: place.updated_at, expires_at: expires.toISOString(),
      participants: [
        { vehicle_id: firstVehicle.id, subject: draft.firstSubject },
        { vehicle_id: secondVehicle.id, subject: draft.secondSubject },
      ],
      reminder_vehicle_id: draft.reminder === 'first' ? firstVehicle.id : draft.reminder === 'second' ? secondVehicle.id : 0,
    })
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <PanelTitle>{plan
        ? t('smartCharging.sharedCharger.reviseTitle', 'Authorize a new revision')
        : t('smartCharging.sharedCharger.createTitle', 'Authorize a shared charger plan')}</PanelTitle>
      <Text as="p" variant="bodySm">
        {t('smartCharging.sharedCharger.operatorEvidence', 'Choose the reviewed place that represents this one shared charger and enter each vehicle’s exact verified sign-in subject. Each participant must confirm separately, even if both vehicles use the same sign-in.')}
      </Text>
      {plan && <Text as="p" variant="bodySm">
        {t('smartCharging.sharedCharger.reviseEvidence', 'A new revision clears both confirmations. Enter both permissions again; prior participants and their inputs are not shown here.')}
      </Text>}
      <Text as="p" variant="bodySm">
        {t('smartCharging.sharedCharger.zoneHint', 'Times use {{zone}}. Repeated daylight-saving times use the first occurrence; skipped times must be changed.', { zone: tz })}
      </Text>
      <fieldset disabled={disabled} className="grid gap-3 sm:grid-cols-2">
        <Select label={t('smartCharging.sharedCharger.place', 'Reviewed charging place')} required
          placeholder={t('smartCharging.sharedCharger.pickPlace', 'Choose a charging place')} value={draft.place}
          options={places.map((place) => ({ value: String(place.id), label: place.name }))}
          onChange={(event) => setDraft({ ...draft, place: event.target.value })} />
        <Input type="datetime-local" required label={t('smartCharging.sharedCharger.expiresAt', 'Plan expires at')}
          value={draft.expires} onChange={(event) => setDraft({ ...draft, expires: event.target.value })} />
        <Select label={t('smartCharging.sharedCharger.firstVehicleGrant', 'Vehicle A')} required options={vehicleOptions}
          placeholder={t('smartCharging.sharedCharger.pickVehicle', 'Choose a vehicle')}
          value={draft.firstVehicle} onChange={(event) => setDraft({ ...draft, firstVehicle: event.target.value })} />
        <Input required label={t('smartCharging.sharedCharger.firstSubject', 'Vehicle A sign-in subject')}
          autoComplete="off" spellCheck={false} value={draft.firstSubject}
          onChange={(event) => setDraft({ ...draft, firstSubject: event.target.value })} />
        <Select label={t('smartCharging.sharedCharger.secondVehicleGrant', 'Vehicle B')} required options={vehicleOptions}
          placeholder={t('smartCharging.sharedCharger.pickVehicle', 'Choose a vehicle')}
          value={draft.secondVehicle} onChange={(event) => setDraft({ ...draft, secondVehicle: event.target.value })} />
        <Input required label={t('smartCharging.sharedCharger.secondSubject', 'Vehicle B sign-in subject')}
          autoComplete="off" spellCheck={false} value={draft.secondSubject}
          onChange={(event) => setDraft({ ...draft, secondSubject: event.target.value })} />
        <Select label={t('smartCharging.sharedCharger.reminderOffer', 'Offer one private swap reminder')}
          placeholder={t('smartCharging.sharedCharger.noReminder', 'No reminder')} value={draft.reminder}
          options={[
            { value: 'first', label: t('smartCharging.sharedCharger.firstVehicleGrant', 'Vehicle A') },
            { value: 'second', label: t('smartCharging.sharedCharger.secondVehicleGrant', 'Vehicle B') },
          ]}
          onChange={(event) => setDraft({ ...draft, reminder: event.target.value })} />
      </fieldset>
      {invalid && <ErrorText role="alert">
        {t('smartCharging.sharedCharger.invalidAuthorization', 'Choose a reviewed place, two different vehicles, exact sign-in subjects, and a future expiry.')}
      </ErrorText>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={disabled}>{t('smartCharging.sharedCharger.authorize', 'Authorize plan')}</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>{t('smartCharging.sharedCharger.cancel', 'Cancel')}</Button>
      </div>
    </form>
  )
}
