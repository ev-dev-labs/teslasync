import { useId, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useJourneys } from '@/api/hooks/useJourney'
import type { Geofence } from '@/api/types'
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback'
import { Button, Checkbox, ErrorText, Input, Select, Text } from '@/components/ui'
import { useDataState } from '@/hooks/useDataState'
import { useSettings } from '@/hooks/useSettings'
import { formatForUnit, parseForUnit } from '@/lib/unitInput'
import { convertDurationFromSI } from '@/lib/unitConversion'
import type { SmartChargingPlan } from '@/types/smartCharging'
import type { TripReviewSetup } from '@/types/smartTripReview'

interface Props {
  plan: SmartChargingPlan
  places: Geofence[]
  setup: TripReviewSetup | null
  disabled: boolean
  onSave: (setup: TripReviewSetup) => void
  onCancel: () => void
}

export function TripReviewSetupForm({ plan, places, setup, disabled, onSave, onCancel }: Props) {
  const { t } = useTranslation()
  const { settings } = useSettings()
  const id = useId()
  const query = useJourneys(plan.vehicle_id, 'planned')
  const journeysState = useDataState(query)
  const journeys = (query.data ?? []).filter((item) => item.vehicle_id === plan.vehicle_id && item.status === 'planned')
  const options = places.filter((place) => place.id !== plan.charging_place_id)
  const origin = places.find((place) => place.id === plan.charging_place_id)
  const [journeyId, setJourneyId] = useState(setup ? String(setup.journey_id) : '')
  const [destinationId, setDestinationId] = useState(setup ? String(setup.destination_id) : '')
  const [stopId, setStopId] = useState(setup?.stop_place_id == null ? '' : String(setup.stop_place_id))
  const [arrival, setArrival] = useState(() => formatForUnit(setup?.planned_arrival_pct, 'percent', settings))
  const [duration, setDuration] = useState(() => formatForUnit(
    setup ? convertDurationFromSI(setup.planned_stop_s, 'min') : null, 'number', settings,
  ))
  const [consent, setConsent] = useState(false)
  const [invalid, setInvalid] = useState(false)
  const blocked = disabled || journeysState.status !== 'ok' || query.isFetching || !journeys.length

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (blocked || !consent) return
    const journey = journeys.find((item) => item.id === Number(journeyId))
    const destination = options.find((place) => place.id === Number(destinationId))
    const stop = options.find((place) => place.id === Number(stopId) && place.is_charging_location)
    const arrivalPct = parseForUnit(arrival, 'percent', settings)
    const durationMinutes = parseForUnit(duration, 'number', settings)
    const stopS = stop && durationMinutes != null ? Math.round(durationMinutes / convertDurationFromSI(1, 'min')) : 0
    if (!journey || !destination || !origin || !plan.version || arrivalPct == null || arrivalPct < 0 || arrivalPct > 100 ||
      (stopId !== '' && (!stop || stop.id === destination.id || stopS < 1 || stopS > 21_600))) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    onSave({
      journey_id: journey.id, plan_version: plan.version, origin_updated_at: origin.updated_at,
      destination_id: destination.id, destination_updated_at: destination.updated_at,
      stop_place_id: stop?.id ?? null, stop_place_updated_at: stop?.updated_at ?? null,
      planned_arrival_pct: arrivalPct, planned_stop_s: stopS,
    })
  }
  return (
    <form className="space-y-3" aria-labelledby={id} onSubmit={submit}>
      <Text id={id} as="p" variant="body" weight="semibold">
        {t('smartCharging.tripReview.setup', 'Save the outbound baseline before the journey starts')}
      </Text>
      <Text as="p" variant="bodySm">
        {t('smartCharging.tripReview.origin', 'This plan starts at {{place}}. Only the planned journey you select will be reviewed.', { place: origin?.name ?? '' })}
      </Text>
      <StaleRefreshWarning state={journeysState} label={t('smartCharging.tripReview.journey', 'Planned journey')} />
      {journeysState.fatalError ? <QueryError error={journeysState.fatalError} onRetry={() => void query.refetch()} />
        : !journeysState.hasData ? <Skeleton lines={2} />
        : !journeys.length ? <Link to={`/journeys?vehicle_id=${plan.vehicle_id}`}
            className="inline-flex min-h-11 items-center text-theme-accent underline underline-offset-2">
            {t('smartCharging.tripReview.addJourney', 'Create a planned journey for this vehicle first')}
          </Link>
        : <div className="grid gap-3 md:grid-cols-2">
            <Select label={t('smartCharging.tripReview.journey', 'Planned journey')} value={journeyId}
              placeholder={t('smartCharging.tripReview.chooseJourney', 'Choose a journey')}
              options={journeys.map((item) => ({ value: String(item.id), label: item.name }))}
              onChange={(event) => setJourneyId(event.target.value)} disabled={blocked} required />
            <Select label={t('smartCharging.stopComparison.destination', 'Reviewed destination')} value={destinationId}
              placeholder={t('smartCharging.stopComparison.selectPlace', 'Choose a place')}
              options={options.map((place) => ({ value: String(place.id), label: place.name }))}
              onChange={(event) => setDestinationId(event.target.value)} disabled={blocked} required />
            <Input label={t('smartCharging.tripReview.arrival', 'Planned arrival charge (%)')} inputMode="decimal"
              value={arrival} onChange={(event) => setArrival(event.target.value)} disabled={blocked} required />
            <Select label={t('smartCharging.tripReview.stop', 'Planned charging stop')} value={stopId}
              options={[
                { value: '', label: t('smartCharging.tripReview.direct', 'No charging stop') },
                ...options.filter((place) => place.is_charging_location && String(place.id) !== destinationId)
                  .map((place) => ({ value: String(place.id), label: place.name })),
              ]} onChange={(event) => setStopId(event.target.value)} disabled={blocked} />
            {stopId && <Input label={t('smartCharging.tripReview.stopBudget', 'Planned time stopped (min)')} inputMode="decimal"
              value={duration} onChange={(event) => setDuration(event.target.value)} disabled={blocked} required />}
          </div>}
      <Checkbox label={t('smartCharging.tripReview.consent', 'Review the recorded drives and charging for this linked journey only. No data will be sent to a provider.')}
        checked={consent} onChange={setConsent} disabled={blocked} />
      {invalid && <ErrorText role="alert">
        {t('smartCharging.tripReview.invalid', 'Choose a planned journey and distinct reviewed places. Enter a charge from 0 to 100% and, if stopping, a positive stop time up to six hours.')}
      </ErrorText>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="min-h-11" disabled={blocked || !consent}>
          {t('smartCharging.tripReview.saveBaseline', 'Save trip baseline')}
        </Button>
        <Button type="button" className="min-h-11" variant="secondary" onClick={onCancel}>
          {t('common.cancel', 'Cancel')}
        </Button>
      </div>
    </form>
  )
}
