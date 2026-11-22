import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SharedTrip, SharedTripDraft } from '@/api/hooks/useSharedTripPlanning'
import { Button, ErrorText, Input, Select, Text } from '@/components/ui'
import { useDateFormat } from '@/hooks/useDateFormat'
import { toZonedDatetimeStr, zonedWallTimeToUtc } from '@/lib/dateConvert'
import type { Vehicle } from '@/types/vehicle'

interface Props {
  trip: SharedTrip | null
  vehicles: Vehicle[]
  disabled: boolean
  pending: boolean
  onSave: (draft: SharedTripDraft) => Promise<void>
}

const maxVehicles = 16
const nomination = (key: number) => ({ key, vehicleId: '', subject: '' })

export function SharedTripPlanForm({ trip, vehicles, disabled, pending, onSave }: Props) {
  const { t } = useTranslation()
  const { tz } = useDateFormat('user')
  const originalWall = trip ? toZonedDatetimeStr(new Date(trip.departure_at), tz) : ''
  const [wall, setWall] = useState(originalWall)
  const [nominations, setNominations] = useState(() => [nomination(0), nomination(1)])
  const [invalid, setInvalid] = useState(false)
  const updateNomination = (key: number, patch: { vehicleId?: string; subject?: string }) => {
    setNominations((entries) => entries.map((entry) => entry.key === key ? { ...entry, ...patch } : entry))
  }
  const selectedIds = new Set(nominations.map((entry) => entry.vehicleId).filter(Boolean))

  return (
    <form className="space-y-3" onSubmit={(event) => {
      event.preventDefault()
      if (disabled) return
      const departure = trip && wall === originalWall ? new Date(trip.departure_at) : zonedWallTimeToUtc(wall, tz)
      if (!departure || !Number.isFinite(departure.getTime()) || departure.getTime() <= Date.now() ||
          toZonedDatetimeStr(departure, tz) !== wall ||
          selectedIds.size !== nominations.length ||
          nominations.some((entry) => !entry.subject || entry.subject !== entry.subject.trim() ||
            !vehicles.some((vehicle) => String(vehicle.id) === entry.vehicleId))) {
        setInvalid(true)
        return
      }
      setInvalid(false)
      void onSave({
        departure_at: departure.toISOString(),
        nominations: nominations.map((entry) => ({ vehicle_id: Number(entry.vehicleId), subject: entry.subject })),
      })
    }}>
      <Text as="p" variant="bodySm">
        {trip
          ? t('smartCharging.sharedTrip.replaceRoster', 'Revising replaces every invitation. Enter the complete roster again; all participants must reconfirm.')
          : t('smartCharging.sharedTrip.nominate', 'Nominate an exact browser sign-in identity for each vehicle. An invitation does not let you confirm for someone else.')}
      </Text>
      <Input type="datetime-local" value={wall} required disabled={disabled}
        label={t('smartCharging.sharedTrip.departureInput', 'Shared departure ({{timezone}})', { timezone: tz })}
        onChange={(event) => setWall(event.target.value)} />
      {nominations.map((entry, index) => (
        <fieldset key={entry.key} className="space-y-2" disabled={disabled}>
          <Text as="legend" variant="bodySm">
            {t('smartCharging.sharedTrip.nominationNumber', 'Nomination {{number}}', { number: index + 1 })}
          </Text>
          <div className="grid gap-2 sm:grid-cols-2">
            <Select value={entry.vehicleId} required
              label={t('smartCharging.sharedTrip.nominatedVehicle', 'Nominated vehicle')}
              placeholder={t('smartCharging.sharedTrip.chooseNominationVehicle', 'Choose an active vehicle')}
              onChange={(event) => updateNomination(entry.key, { vehicleId: event.target.value })}
              options={vehicles.map((vehicle) => ({
                value: String(vehicle.id),
                label: t('smartCharging.sharedTrip.vehicleChoice', '{{name}} (ID {{id}})', { name: vehicle.display_name, id: vehicle.id }),
                disabled: String(vehicle.id) !== entry.vehicleId && selectedIds.has(String(vehicle.id)),
              }))} />
            <Input required maxLength={256} value={entry.subject} autoComplete="off" spellCheck={false}
              label={t('smartCharging.sharedTrip.participantSubject', 'Exact participant sign-in identity')}
              onChange={(event) => updateNomination(entry.key, { subject: event.target.value })} />
          </div>
          {nominations.length > 2 && (
            <Button type="button" size="sm" variant="secondary"
              onClick={() => setNominations((entries) => entries.filter((item) => item.key !== entry.key))}>
              {t('smartCharging.sharedTrip.removeNomination', 'Remove nomination')}
            </Button>
          )}
        </fieldset>
      ))}
      {invalid && <ErrorText role="alert">
        {t('smartCharging.sharedTrip.invalidPlan', 'Enter a future departure, distinct active vehicles, and exact sign-in identities without extra spaces.')}
      </ErrorText>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="secondary"
          disabled={disabled || nominations.length >= Math.min(maxVehicles, vehicles.length)}
          onClick={() => setNominations((entries) => [...entries, nomination(Math.max(...entries.map((entry) => entry.key)) + 1)])}>
          {t('smartCharging.sharedTrip.addNomination', 'Add nomination')}
        </Button>
        <Button type="submit" size="sm" disabled={disabled} loading={pending}>
          {t('smartCharging.sharedTrip.saveTrip', 'Save trip and invitations')}
        </Button>
      </div>
    </form>
  )
}
