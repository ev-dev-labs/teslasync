import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SharedTrip, SharedTripChange } from '@/api/hooks/useSharedTripPlanning'
import { useVehicles } from '@/api/hooks/useVehicles'
import { QueryError, Skeleton } from '@/components/feedback'
import { Button, ConfirmDialog, Subhead, Text } from '@/components/ui'
import { useDateFormat } from '@/hooks/useDateFormat'
import { SharedTripPlanForm } from './SharedTripPlanForm'

interface Props {
  trips: SharedTrip[]
  disabled: boolean
  pending: boolean
  onChange: (input: SharedTripChange) => Promise<boolean>
}

type Editor = { kind: 'create' } | { kind: 'revise'; trip: SharedTrip }

export function SharedTripManagement({ trips, disabled, pending, onChange }: Props) {
  const { t } = useTranslation()
  const { formatDateTime } = useDateFormat()
  const [editor, setEditor] = useState<Editor | null>(null)
  const [cancelling, setCancelling] = useState<SharedTrip | null>(null)
  const currentEditor = editor?.kind === 'revise'
    && !trips.some((trip) => trip.id === editor.trip.id && trip.revision === editor.trip.revision)
    ? null : editor
  const currentCancellation = cancelling && trips.some((trip) => trip.id === cancelling.id && trip.revision === cancelling.revision)
    ? cancelling : null
  const vehicles = useVehicles(currentEditor != null)
  const activeVehicles = (vehicles.data ?? []).filter((vehicle) => Number.isSafeInteger(vehicle.id) && vehicle.id > 0)

  return (
    <section className="space-y-3">
      <Subhead>{t('smartCharging.sharedTrip.manageTitle', 'Trips you organize')}</Subhead>
      {trips.length === 0 ? (
        <Text as="p" variant="bodySm">{t('smartCharging.sharedTrip.noOwned', 'You have no upcoming shared trips.')}</Text>
      ) : (
        <ul className="space-y-3">
          {trips.map((trip) => (
            <li className="flex flex-wrap items-center gap-2" key={trip.id}>
              <Text variant="bodySm">
                {t('smartCharging.sharedTrip.ownedDeparture', 'Trip {{id}} · {{departure}}', {
                  id: trip.id, departure: formatDateTime(trip.departure_at),
                })}
              </Text>
              <Button size="sm" variant="secondary" disabled={disabled} onClick={() => setEditor({ kind: 'revise', trip })}>
                {t('smartCharging.sharedTrip.revise', 'Revise trip')}
              </Button>
              <Button size="sm" variant="secondary" disabled={disabled} onClick={() => setCancelling(trip)}>
                {t('smartCharging.sharedTrip.cancelTrip', 'Cancel trip')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {!currentEditor ? (
        <Button size="sm" disabled={disabled} onClick={() => setEditor({ kind: 'create' })}>
          {t('smartCharging.sharedTrip.create', 'Create shared trip')}
        </Button>
      ) : vehicles.isError ? (
        <QueryError error={vehicles.error} onRetry={() => void vehicles.refetch()} />
      ) : !vehicles.data ? (
        <Skeleton lines={3} />
      ) : activeVehicles.length < 2 ? (
        <Text as="p" variant="bodySm">
          {t('smartCharging.sharedTrip.needVehicles', 'At least two active vehicles are needed to create or revise a shared trip.')}
        </Text>
      ) : (
        <SharedTripPlanForm key={currentEditor.kind === 'create' ? 'create' : `${currentEditor.trip.id}:${currentEditor.trip.revision}`}
          trip={currentEditor.kind === 'revise' ? currentEditor.trip : null} vehicles={activeVehicles}
          disabled={disabled || vehicles.isFetching} pending={pending}
          onSave={async (draft) => {
            const input: SharedTripChange = currentEditor.kind === 'create'
              ? { kind: 'create', draft } : { kind: 'revise', trip: currentEditor.trip, draft }
            if (await onChange(input)) setEditor(null)
          }} />
      )}
      {currentEditor && (
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => setEditor(null)}>
          {t('smartCharging.sharedTrip.closeEditor', 'Close editor')}
        </Button>
      )}
      <ConfirmDialog open={currentCancellation != null}
        title={t('smartCharging.sharedTrip.cancelTrip', 'Cancel trip')}
        message={t('smartCharging.sharedTrip.cancelDescription', 'Cancel this shared departure and all invitations? Participants will lose access to the comparison.')}
        confirmLabel={t('smartCharging.sharedTrip.cancelTrip', 'Cancel trip')}
        cancelLabel={t('smartCharging.sharedTrip.keepTrip', 'Keep trip')}
        confirmDisabled={disabled} loading={pending} onCancel={() => setCancelling(null)}
        onConfirm={() => {
          if (currentCancellation) {
            void onChange({ kind: 'cancel', trip: currentCancellation }).then((success) => {
              if (success) setCancelling(null)
            })
          }
        }} />
    </section>
  )
}
