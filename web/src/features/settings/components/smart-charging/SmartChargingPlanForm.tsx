import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import type { Geofence } from '@/api/types'
import { Button, ErrorText, Input, PanelTitle, Select, Text, Toggle } from '@/components/ui'
import { useDateFormat } from '@/hooks/useDateFormat'
import { toZonedDatetimeStr, zonedWallTimeToUtc } from '@/lib/dateConvert'
import type { SmartChargingPlan, SmartChargingPlanInput } from '@/types/smartCharging'

interface Props {
  vehicleId: number
  plan: SmartChargingPlan | null
  places: Geofence[]
  disabled: boolean
  onSave: (plan: SmartChargingPlanInput) => Promise<boolean>
  onCancel: () => void
}

export function SmartChargingPlanForm({ vehicleId, plan, places, disabled, onSave, onCancel }: Props) {
  const { t } = useTranslation()
  const { tz } = useDateFormat('user')
  const initialNotify = plan ? toZonedDatetimeStr(new Date(plan.notify_at), tz) : ''
  const initialDeparture = plan ? toZonedDatetimeStr(new Date(plan.departure_at), tz) : ''
  const initialStart = plan?.scheduled_start ? toZonedDatetimeStr(new Date(plan.scheduled_start.at), tz) : ''
  const [draft, setDraft] = useState({
    place: plan?.charging_place_id == null ? '' : String(plan.charging_place_id),
    notify: initialNotify,
    departure: initialDeparture,
    scheduledStart: initialStart,
    low: plan ? String(plan.trip_use_low_pct) : '',
    high: plan ? String(plan.trip_use_high_pct) : '',
    reserve: plan ? String(plan.reserve_pct) : '',
    separateLegs: plan?.trip_legs != null,
    outboundLow: plan?.trip_legs ? String(plan.trip_legs.outbound_use_low_pct) : '',
    outboundHigh: plan?.trip_legs ? String(plan.trip_legs.outbound_use_high_pct) : '',
    returnLow: plan?.trip_legs ? String(plan.trip_legs.return_use_low_pct) : '',
    returnHigh: plan?.trip_legs ? String(plan.trip_legs.return_use_high_pct) : '',
    destinationCharge: plan?.trip_legs?.destination_charge_pct == null
      ? '' : String(plan.trip_legs.destination_charge_pct),
    enabled: plan?.enabled ?? false,
    compareSiteRates: plan?.compare_site_rates ?? false,
  })
  const [invalid, setInvalid] = useState(false)

  const resolveTime = (wall: string, initialWall: string, original?: string) => {
    const instant = original && wall === initialWall ? new Date(original) : zonedWallTimeToUtc(wall, tz)
    if (!instant || !Number.isFinite(instant.getTime()) || toZonedDatetimeStr(instant, tz) !== wall) return null
    return instant
  }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const notify = resolveTime(draft.notify, initialNotify, plan?.notify_at)
    const departure = resolveTime(draft.departure, initialDeparture, plan?.departure_at)
    const scheduledStart = draft.scheduledStart
      ? resolveTime(draft.scheduledStart, initialStart, plan?.scheduled_start?.at) : null
    const numbers = draft.separateLegs
      ? [draft.outboundLow, draft.outboundHigh, draft.returnLow, draft.returnHigh, draft.reserve]
      : [draft.low, draft.high, draft.reserve]
    const [outboundLow, outboundHigh, returnLow, returnHigh] =
      [draft.outboundLow, draft.outboundHigh, draft.returnLow, draft.returnHigh].map(Number)
    const low = draft.separateLegs ? Math.min(100, outboundLow + returnLow) : Number(draft.low)
    const high = draft.separateLegs ? Math.min(100, outboundHigh + returnHigh) : Number(draft.high)
    const reserve = Number(draft.reserve)
    const destinationCharge = draft.destinationCharge.trim() ? Number(draft.destinationCharge) : null
    const place = Number(draft.place)
    const now = Date.now()
    const latest = new Date(now)
    latest.setUTCFullYear(latest.getUTCFullYear() + 1)
    if (!notify || !departure || notify.getTime() >= departure.getTime() - 30 * 60_000 ||
      departure.getTime() <= now + 30 * 60_000 || departure.getTime() > latest.getTime() ||
      (draft.scheduledStart && (!scheduledStart || scheduledStart < notify ||
        scheduledStart.getTime() > departure.getTime() + 24 * 60 * 60_000)) ||
      numbers.some((value) => !value.trim() || !Number.isFinite(Number(value))) ||
      low < 0 || high < low || high > 100 || reserve < 0 || reserve > 100 ||
      (draft.separateLegs && (outboundLow < 0 || outboundHigh < outboundLow || outboundHigh > 100 ||
        returnLow < 0 || returnHigh < returnLow || returnHigh > 100 ||
        (destinationCharge != null && (!Number.isFinite(destinationCharge) || destinationCharge < 0 || destinationCharge > 100)))) ||
      !places.some((item) => item.id === place)) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    const saved = await onSave({
      vehicle_id: vehicleId, charging_place_id: place, enabled: draft.enabled,
      notify_at: notify.toISOString(), departure_at: departure.toISOString(),
      ...(scheduledStart ? { scheduled_start: draft.scheduledStart === initialStart && plan?.scheduled_start
        ? plan.scheduled_start : { at: scheduledStart.toISOString(), time_zone: tz } } : {}),
      trip_use_low_pct: low, trip_use_high_pct: high, reserve_pct: reserve,
      compare_site_rates: draft.compareSiteRates,
      ...(draft.separateLegs ? { trip_legs: {
        outbound_use_low_pct: outboundLow, outbound_use_high_pct: outboundHigh,
        return_use_low_pct: returnLow, return_use_high_pct: returnHigh,
        destination_charge_pct: destinationCharge,
      } } : {}),
    })
    if (saved) onCancel()
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4">
      <PanelTitle>{plan
        ? t('smartCharging.editPlan', 'Edit charging plan')
        : t('smartCharging.newPlan', 'Plan a trip')}</PanelTitle>
      <Text as="p" variant="bodySm">
        {t('smartCharging.formPrivacy', 'Your estimate and chosen charging place stay on this server. Enabling this plan does not start charging or send a vehicle command.')}
      </Text>
      <Text as="p" variant="bodySm">
        {t('smartCharging.timeZoneHint', 'Times use {{zone}}. A repeated daylight-saving time uses its first occurrence; skipped times must be changed.', { zone: tz })}
      </Text>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label={t('smartCharging.place', 'Known charging place')} required
          placeholder={t('smartCharging.selectPlace', 'Select a charging place')}
          value={draft.place} options={places.map((place) => ({ value: String(place.id), label: place.name }))}
          onChange={(event) => setDraft({ ...draft, place: event.target.value, compareSiteRates: false })} />
        <Input type="datetime-local" required label={t('smartCharging.notifyAt', 'Check from')}
          value={draft.notify} onChange={(event) => setDraft({ ...draft, notify: event.target.value })} />
        <Input type="datetime-local" required label={t('smartCharging.departureAt', 'Planned departure')}
          value={draft.departure} onChange={(event) => setDraft({ ...draft, departure: event.target.value })} />
        <Input type="number" min={0} max={100} step="any" required
          label={t('smartCharging.reserve', 'Desired return reserve (%)')}
          value={draft.reserve} onChange={(event) => setDraft({ ...draft, reserve: event.target.value })} />
        <Input type="datetime-local" label={t('smartCharging.scheduledStart', 'Intended charging start (optional)')}
          hint={t('smartCharging.scheduledStartHint', 'Enter the date and time you expect charging to start, between “Check from” and one day after departure. This does not set a vehicle schedule.')}
          value={draft.scheduledStart} onChange={(event) => setDraft({ ...draft, scheduledStart: event.target.value })} />
      </div>
      <div className="space-y-3">
        <Toggle label={t('smartCharging.separateLegs', 'Estimate outbound and return separately')}
          checked={draft.separateLegs} disabled={disabled}
          onChange={(separateLegs) => setDraft({ ...draft, separateLegs })} />
        {draft.separateLegs ? (
          <>
            <Text as="p" variant="bodySm">
              {t('smartCharging.legEstimateHint', 'Enter a low and high battery-use estimate for each leg. These are your estimates, not measured route predictions.')}
            </Text>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input type="number" min={0} max={100} step="any" required
                label={t('smartCharging.outboundLow', 'Outbound use, low (%)')}
                value={draft.outboundLow} onChange={(event) => setDraft({ ...draft, outboundLow: event.target.value })} />
              <Input type="number" min={0} max={100} step="any" required
                label={t('smartCharging.outboundHigh', 'Outbound use, high (%)')}
                value={draft.outboundHigh} onChange={(event) => setDraft({ ...draft, outboundHigh: event.target.value })} />
              <Input type="number" min={0} max={100} step="any" required
                label={t('smartCharging.returnLow', 'Return use, low (%)')}
                value={draft.returnLow} onChange={(event) => setDraft({ ...draft, returnLow: event.target.value })} />
              <Input type="number" min={0} max={100} step="any" required
                label={t('smartCharging.returnHigh', 'Return use, high (%)')}
                value={draft.returnHigh} onChange={(event) => setDraft({ ...draft, returnHigh: event.target.value })} />
              <Input type="number" min={0} max={100} step="any"
                label={t('smartCharging.destinationCharge', 'Planned charge added at destination (%)')}
                hint={t('smartCharging.destinationChargeHint', 'Optional. This is a plan, not a confirmed or guaranteed charge. Leave blank to assume no destination charging.')}
                value={draft.destinationCharge} onChange={(event) => setDraft({ ...draft, destinationCharge: event.target.value })} />
            </div>
          </>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Input type="number" min={0} max={100} step="any" required
              label={t('smartCharging.tripLow', 'Estimated round-trip use, low (%)')}
              value={draft.low} onChange={(event) => setDraft({ ...draft, low: event.target.value })} />
            <Input type="number" min={0} max={100} step="any" required
              label={t('smartCharging.tripHigh', 'Estimated round-trip use, high (%)')}
              value={draft.high} onChange={(event) => setDraft({ ...draft, high: event.target.value })} />
          </div>
        )}
      </div>
      <Toggle label={t('smartCharging.enablePlan', 'Enable readiness checks for this plan')}
        checked={draft.enabled} disabled={disabled}
        onChange={(enabled) => setDraft({ ...draft, enabled })} />
      <div className="space-y-2">
        <Toggle label={t('smartCharging.compareSiteRates', 'Compare costs using verified place prices')}
          checked={draft.compareSiteRates} disabled={disabled || !draft.place}
          onChange={(compareSiteRates) => setDraft({ ...draft, compareSiteRates })} />
        <Text as="p" variant="bodySm">
          {t('smartCharging.compareSiteRatesConsent', 'Enable only after checking that this place’s dated price windows and currency apply to your future charging. Historical prices are not recurring tariffs.')}
        </Text>
        <Link to="/geofences" className="text-theme-accent underline underline-offset-2">
          {t('smartCharging.reviewPlacePrices', 'Review charging place prices')}
        </Link>
      </div>
      {invalid && (
        <ErrorText role="alert">
          {t('smartCharging.invalidPlan', 'Choose an active charging place, valid percentages and times at least 30 minutes apart. Departure must be within the next year. Skipped daylight-saving times are not valid.')}
        </ErrorText>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="min-h-11" disabled={disabled}>
          {t('smartCharging.savePlan', 'Save plan')}
        </Button>
        <Button type="button" variant="secondary" className="min-h-11" disabled={disabled} onClick={onCancel}>
          {t('common.cancel', 'Cancel')}
        </Button>
      </div>
    </form>
  )
}
