import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, ErrorText, Input, PanelTitle, Select, Text } from '@/components/ui'
import type { SmartCommuteRoutine, SmartCommuteRoutineInput } from '@/types/smartCommute'
import { formatCommuteClock, parseCommuteClock, useCommuteWeekdays } from '@/lib/smartCommuteDisplay'

interface Props {
  vehicleId: number
  timeZone: string
  routine: SmartCommuteRoutine | null
  disabled: boolean
  onSave: (routine: SmartCommuteRoutineInput) => Promise<boolean>
  onCancel: () => void
}

export function SmartCommuteRoutineForm({ vehicleId, timeZone, routine, disabled, onSave, onCancel }: Props) {
  const { t } = useTranslation()
  const weekdays = useCommuteWeekdays()
  const [draft, setDraft] = useState({
    name: routine?.name ?? '',
    weekday: String(routine?.weekday ?? 1),
    departure: formatCommuteClock(routine?.departure_s ?? 8 * 3600),
    timeZone: routine?.time_zone ?? timeZone,
    originLatitude: routine ? String(routine.origin.latitude) : '',
    originLongitude: routine ? String(routine.origin.longitude) : '',
    destinationLatitude: routine ? String(routine.destination.latitude) : '',
    destinationLongitude: routine ? String(routine.destination.longitude) : '',
  })
  const [invalid, setInvalid] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const departure = parseCommuteClock(draft.departure)
    const coordinates = [
      draft.originLatitude, draft.originLongitude, draft.destinationLatitude, draft.destinationLongitude,
    ]
    if (departure == null || !draft.name.trim() || !draft.timeZone.trim() ||
      coordinates.some((value) => value.trim() === '' || !Number.isFinite(Number(value)))) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    const saved = await onSave({
      vehicle_id: vehicleId,
      name: draft.name.trim(),
      weekday: Number(draft.weekday),
      departure_s: departure,
      time_zone: draft.timeZone.trim(),
      origin: { latitude: Number(draft.originLatitude), longitude: Number(draft.originLongitude) },
      destination: {
        latitude: Number(draft.destinationLatitude),
        longitude: Number(draft.destinationLongitude),
      },
    })
    if (saved) onCancel()
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4">
      <PanelTitle>{routine
        ? t('smartCommute.editRoutine', 'Review and save routine')
        : t('smartCommute.manualRoutine', 'Add a routine manually')}</PanelTitle>
      <Text as="p" variant="bodySm">
        {t('smartCommute.formPrivacy', 'These coordinates stay on this server. Saving a routine does not send a notification or command.')}
      </Text>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label={t('smartCommute.name', 'Routine name')} required maxLength={120}
          value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        <Select label={t('smartCommute.weekday', 'Local weekday')} value={draft.weekday}
          options={weekdays.map((label, value) => ({ label, value: String(value) }))}
          onChange={(event) => setDraft({ ...draft, weekday: event.target.value })} />
        <Input type="time" step={1} required label={t('smartCommute.departure', 'Local departure time')}
          value={draft.departure} onChange={(event) => setDraft({ ...draft, departure: event.target.value })} />
        <Input label={t('smartCommute.timeZone', 'IANA time zone')} required maxLength={128}
          value={draft.timeZone} onChange={(event) => setDraft({ ...draft, timeZone: event.target.value })}
          hint={t('smartCommute.timeZoneHint', 'For example, America/Los_Angeles.')} />
        <Input type="number" step="any" min={-90} max={90} required
          label={t('smartCommute.originLatitude', 'Origin latitude')}
          value={draft.originLatitude} onChange={(event) => setDraft({ ...draft, originLatitude: event.target.value })} />
        <Input type="number" step="any" min={-180} max={180} required
          label={t('smartCommute.originLongitude', 'Origin longitude')}
          value={draft.originLongitude} onChange={(event) => setDraft({ ...draft, originLongitude: event.target.value })} />
        <Input type="number" step="any" min={-90} max={90} required
          label={t('smartCommute.destinationLatitude', 'Destination latitude')}
          value={draft.destinationLatitude} onChange={(event) => setDraft({ ...draft, destinationLatitude: event.target.value })} />
        <Input type="number" step="any" min={-180} max={180} required
          label={t('smartCommute.destinationLongitude', 'Destination longitude')}
          value={draft.destinationLongitude} onChange={(event) => setDraft({ ...draft, destinationLongitude: event.target.value })} />
      </div>
      {invalid && <ErrorText role="alert">{t('smartCommute.invalidForm', 'Enter a name, valid local time, time zone and coordinates.')}</ErrorText>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="min-h-11" disabled={disabled}>
          {t('smartCommute.saveRoutine', 'Save routine')}
        </Button>
        <Button type="button" variant="secondary" className="min-h-11" onClick={onCancel} disabled={disabled}>
          {t('common.cancel', 'Cancel')}
        </Button>
      </div>
    </form>
  )
}
