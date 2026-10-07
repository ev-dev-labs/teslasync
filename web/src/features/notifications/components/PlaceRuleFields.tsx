import { useTranslation } from 'react-i18next'
import { useGeofencesFull } from '@/api/hooks/useLocations'
import { EmptyState, QueryError } from '@/components/feedback'
import { Select } from '@/components/ui'
import { PLACE_TRANSITIONS } from '../schemas/alertRule'

type Transition = typeof PLACE_TRANSITIONS[number]

interface Props {
  placeId: string
  transition: string
  onChange: (placeId: string, transition: Transition) => void
}

export function PlaceRuleFields({ placeId, transition, onChange }: Props) {
  const { t } = useTranslation()
  const places = useGeofencesFull()
  const options = (places.data ?? []).filter(place => place.enabled).map(place => ({
    value: String(place.id),
    label: place.name,
  }))
  if (placeId && !options.some(option => option.value === placeId)) {
    options.unshift({ value: placeId, label: t('notifications.alertStudio.place.unavailable', 'Place #{{id}} (unavailable)', { id: placeId }) })
  }

  return (
    <div className="mb-4 space-y-3">
      {places.isError && <QueryError error={places.error} onRetry={() => void places.refetch()} />}
      {!places.isLoading && !places.isError && options.length === 0 && (
        <EmptyState
          title={t('notifications.alertStudio.place.emptyTitle', 'No places configured')}
          message={t('notifications.alertStudio.place.empty', 'Add a place before creating an arrival or departure rule.')}
          actionTo={{ label: t('notifications.alertStudio.place.add', 'Manage places'), to: '/geofences' }}
        />
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          id="alert-place"
          label={t('notifications.alertStudio.place.label', 'Place')}
          value={placeId}
          placeholder={t('notifications.alertStudio.place.choose', 'Choose a place')}
          options={options}
          disabled={places.isLoading || places.isError || options.length === 0}
          onChange={event => onChange(event.target.value, transition as Transition)}
        />
        <Select
          id="alert-place-transition"
          label={t('notifications.alertStudio.place.transition', 'When')}
          value={transition}
          options={PLACE_TRANSITIONS.map(value => ({
            value,
            label: value === 'enter'
              ? t('notifications.alertStudio.place.enter', 'Arrives')
              : t('notifications.alertStudio.place.exit', 'Departs'),
          }))}
          onChange={event => onChange(placeId, event.target.value as Transition)}
        />
      </div>
    </div>
  )
}
