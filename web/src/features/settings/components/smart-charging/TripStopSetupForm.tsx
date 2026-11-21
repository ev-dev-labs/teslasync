import { useId, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import type { Geofence } from '@/api/types'
import { Button, Checkbox, ErrorText, Input, Select, Text, Textarea } from '@/components/ui'
import { useSettings } from '@/hooks/useSettings'
import { formatForUnit, parseForUnit } from '@/lib/unitInput'
import { convertDistanceFromSI } from '@/lib/unitConversion'
import type { SmartChargingPlan } from '@/types/smartCharging'
import type { TripStopSetup } from '@/types/smartTripStops'
import { parseTripStopWaits } from './tripStopWaits'

interface Props {
  plan: SmartChargingPlan
  places: Geofence[]
  setup: TripStopSetup | null
  disabled: boolean
  onSave: (setup: TripStopSetup) => Promise<void>
  onCancel: () => void
}

interface StopFields { placeId: string; zone: string; waits: string }

export function TripStopSetupForm({ plan, places, setup, disabled, onSave, onCancel }: Props) {
  const { t } = useTranslation()
  const id = useId()
  const { settings } = useSettings()
  const inputSettings = { ...settings, decimal_precision: 4 }
  const distanceUnit = settings.unit_of_length === 'mi' ? 'mi' : 'km'
  const [destinationId, setDestinationId] = useState(setup ? String(setup.destination_place_id) : '')
  const [capacity, setCapacity] = useState(() => formatForUnit(setup?.capacity_wh, 'number', inputSettings))
  const [start, setStart] = useState(() => formatForUnit(setup?.start_pct, 'percent', inputSettings))
  const [limit, setLimit] = useState(() => formatForUnit(setup?.limit_pct, 'percent', inputSettings))
  const [consumption, setConsumption] = useState(() => formatForUnit(
    setup ? setup.high_usage_wh_per_m / convertDistanceFromSI(1, 'km') : null, 'efficiency', inputSettings,
  ))
  const [stops, setStops] = useState<StopFields[]>(() => setup ? setup.stops.map((stop) => ({
    placeId: String(stop.place_id),
    zone: stop.time_zone,
    waits: stop.waits.map((wait) => `${wait.arrived_at},${Number((wait.wait_s / 60).toFixed(6))}`).join('\n'),
  })) : Array.from({ length: 2 }, () => ({ placeId: '', zone: '', waits: '' })))
  const [consent, setConsent] = useState(false)
  const [compatible, setCompatible] = useState(false)
  const [invalid, setInvalid] = useState(false)
  const origin = places.find((place) => place.id === plan.charging_place_id)
  const options = places.filter((place) => place.id !== origin?.id)
  const candidates = options.filter((place) => place.is_charging_location && place.radius > 0 && place.radius <= 250)
  const patchStop = (index: number, changes: Partial<StopFields>) =>
    setStops((previous) => previous.map((stop, i) => i === index ? { ...stop, ...changes } : stop))

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (disabled || !consent || !compatible) return
    const destination = options.find((place) => place.id === Number(destinationId))
    const capacityWh = parseForUnit(capacity, 'number', settings)
    const startPct = parseForUnit(start, 'percent', settings)
    const limitPct = parseForUnit(limit, 'percent', settings)
    const usage = parseForUnit(consumption, 'efficiency', settings)
    const parsedStops = stops.flatMap((stop) => {
      const place = candidates.find((candidate) => candidate.id === Number(stop.placeId))
      const waits = parseTripStopWaits(stop.waits)
      return place && waits && stop.zone.trim() ? [{
        place_id: place.id, place_updated_at: place.updated_at, time_zone: stop.zone.trim(), waits,
      }] : []
    })
    if (!origin || !plan.version || !destination || capacityWh == null || capacityWh < 1_000 || capacityWh > 500_000 ||
      startPct == null || startPct <= plan.reserve_pct || startPct < 1 || startPct > 100 ||
      limitPct == null || limitPct <= plan.reserve_pct || limitPct < 1 || limitPct > 100 ||
      usage == null || usage <= 0 || parsedStops.length !== stops.length ||
      new Set([destination.id, ...parsedStops.map((stop) => stop.place_id)]).size !== parsedStops.length + 1) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    void onSave({
      plan_version: plan.version, origin_updated_at: origin.updated_at, destination_place_id: destination.id,
      destination_updated_at: destination.updated_at, capacity_wh: capacityWh, start_pct: startPct,
      limit_pct: limitPct, high_usage_wh_per_m: usage * convertDistanceFromSI(1, 'km'), stops: parsedStops,
    })
  }

  return (
    <form className="space-y-4" onSubmit={submit} aria-labelledby={id}>
      <Text id={id} as="p" variant="body" weight="semibold">
        {t('smartCharging.stopComparison.setup', 'Review the outbound trip and charging stops')}
      </Text>
      <Text as="p" variant="bodySm">
        {t('smartCharging.stopComparison.origin', 'The charging place on this plan is the departure point: {{place}}.', { place: origin?.name ?? '' })}
      </Text>
      <Link to="/geofences" className="inline-flex min-h-11 items-center text-theme-accent underline underline-offset-2">
        {t('smartCharging.stopComparison.reviewPlaces', 'Add or review places')}
      </Link>
      <div className="grid gap-3 md:grid-cols-2">
        <Select label={t('smartCharging.stopComparison.destination', 'Reviewed destination')} value={destinationId}
          placeholder={t('smartCharging.stopComparison.selectPlace', 'Choose a place')}
          options={options.map((place) => ({ value: String(place.id), label: place.name }))}
          onChange={(event) => setDestinationId(event.target.value)} disabled={disabled} required />
        <Input label={t('smartCharging.stopComparison.capacity', 'Estimated usable battery capacity (Wh)')}
          inputMode="decimal" value={capacity} onChange={(event) => setCapacity(event.target.value)} disabled={disabled} required />
        <Input label={t('smartCharging.stopComparison.start', 'Assumed departure charge (%)')}
          inputMode="decimal" value={start} onChange={(event) => setStart(event.target.value)} disabled={disabled} required />
        <Input label={t('smartCharging.stopComparison.limit', 'Maximum charge at a stop (%)')}
          inputMode="decimal" value={limit} onChange={(event) => setLimit(event.target.value)} disabled={disabled} required />
        <Input label={t('smartCharging.stopComparison.consumption', 'High-side driving consumption (Wh/{{distance}})', { distance: distanceUnit })}
          inputMode="decimal" value={consumption} onChange={(event) => setConsumption(event.target.value)} disabled={disabled} required />
      </div>
      {stops.map((stop, index) => (
        <fieldset key={`${id}-${index}`} className="min-w-0 space-y-3 border-t border-[var(--border-subtle)] pt-3">
          <Text as="legend" variant="bodySm" weight="semibold">
            {t('smartCharging.stopComparison.station', 'Charging stop {{number}}', { number: index + 1 })}
          </Text>
          <div className="grid gap-3 md:grid-cols-2">
            <Select label={t('smartCharging.stopComparison.stationPlace', 'Reviewed charging place')} value={stop.placeId}
              placeholder={t('smartCharging.stopComparison.selectPlace', 'Choose a place')}
              options={candidates.map((place) => ({ value: String(place.id), label: place.name }))}
              onChange={(event) => patchStop(index, { placeId: event.target.value })} disabled={disabled} required />
            <Input label={t('smartCharging.stopComparison.zone', 'Station time zone (e.g. America/Los_Angeles)')}
              value={stop.zone} onChange={(event) => patchStop(index, { zone: event.target.value })} disabled={disabled} required />
          </div>
          <Textarea label={t('smartCharging.stopComparison.waits', 'Recorded queue waits')}
            hint={t('smartCharging.stopComparison.waitHint', 'Enter one arrival timestamp and actual wait in minutes per line, separated by a comma. Include the UTC offset or Z. Example: 2026-03-10T08:45:00-07:00,7. Use 0 only for an observed absence of a queue.')}
            value={stop.waits} onChange={(event) => patchStop(index, { waits: event.target.value })}
            disabled={disabled} rows={4} maxLength={4096} />
        </fieldset>
      ))}
      <div className="space-y-3">
        <Checkbox label={t('smartCharging.stopComparison.compatible', 'I verified that these stops have a connector this vehicle can use.')}
          checked={compatible} onChange={setCompatible} disabled={disabled} />
        <Checkbox label={t('smartCharging.stopComparison.consent', 'Allow HERE Routing to receive the coordinates of the departure, destination and reviewed stops only when I request a comparison.')}
          checked={consent} onChange={setConsent} disabled={disabled} />
      </div>
      {invalid && <ErrorText role="alert">
        {t('smartCharging.stopComparison.invalid', 'Check the plan and locations, charge percentages above your reserve, and the wait format. Use a different place for each stop and for the destination.')}
      </ErrorText>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="min-h-11" disabled={disabled || !compatible || !consent}>
          {t('smartCharging.stopComparison.save', 'Save comparison setup')}
        </Button>
        <Button type="button" className="min-h-11" variant="secondary" disabled={disabled} onClick={onCancel}>
          {t('common.cancel', 'Cancel')}
        </Button>
      </div>
    </form>
  )
}
