import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import type { Geofence } from '@/api/types'
import type { PersonalScope } from '@/api/hooks/usePersonalIdentity'
import { useSmartChargingLatestStarts, type SmartChargingChange } from '@/api/hooks/useSmartCharging'
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback'
import { Button, ConfirmDialog, ErrorText, Input, PanelTitle, Text } from '@/components/ui'
import { useDataState } from '@/hooks/useDataState'
import { useDateFormat } from '@/hooks/useDateFormat'
import { useNumberFormatting } from '@/hooks/useNumberFormatting'
import { useUnits } from '@/hooks/useUnits'
import { currencyFractionDigits, formatCurrencyValue } from '@/lib/currencyFormat'
import { toZonedDatetimeStr } from '@/lib/dateConvert'
import { useTripProjectionDisplay } from '@/lib/smartChargingDisplay'
import type { SmartChargingLatestStart, SmartChargingPlan, SmartChargingPlanInput } from '@/types/smartCharging'
import { SmartChargingPlanForm } from './SmartChargingPlanForm'
import { TripStopComparison } from './TripStopComparison'
import { TripPlanReview } from './TripPlanReview'
import { TripMaintenance } from './TripMaintenance'

interface Props {
  scope: PersonalScope
  vehicleId: number
  plans: SmartChargingPlan[]
  places: Geofence[]
  reviewedPlaces: Geofence[]
  disabled: boolean
  formDisabled: boolean
  onChange: (change: SmartChargingChange) => Promise<boolean>
}

type EarlierCheck = { checkAt: string; version: number; previous: string; expiresAt: string }
type PlanEditor = 'new' | { planId: number; version: number; previous: string; reminder?: EarlierCheck }

function earlierCheckAt(plan: SmartChargingPlan, estimate: SmartChargingLatestStart, now: number) {
  if (!plan.enabled || plan.version == null || plan.version !== estimate.plan_version ||
    plan.vehicle_id !== estimate.vehicle_id || estimate.status !== 'estimate' ||
    (plan.snoozed_until && Date.parse(plan.snoozed_until) > now) ||
    !estimate.expires_at || !(Date.parse(estimate.expires_at) > now)) return null

  const checkAt = Date.parse(estimate.earlier_check_at ?? '')
  if (!estimate.earlier_check_at || !(now < checkAt && checkAt < Date.parse(plan.notify_at))) return null
  return { checkAt: estimate.earlier_check_at, version: plan.version, previous: plan.notify_at, expiresAt: estimate.expires_at }
}

function planInput(plan: SmartChargingPlan): SmartChargingPlanInput {
  return {
    vehicle_id: plan.vehicle_id, charging_place_id: plan.charging_place_id, enabled: plan.enabled,
    notify_at: plan.notify_at, departure_at: plan.departure_at, trip_use_low_pct: plan.trip_use_low_pct,
    trip_use_high_pct: plan.trip_use_high_pct, reserve_pct: plan.reserve_pct,
    compare_site_rates: plan.compare_site_rates ?? false,
    departure_overlap_push: plan.departure_overlap_push ?? false,
    ...(plan.early_stop_watch ? { early_stop_watch: true } : {}),
    ...(plan.scheduled_start ? { scheduled_start: plan.scheduled_start } : {}),
    ...(plan.service_appointment ? { service_appointment: plan.service_appointment } : {}),
    ...(plan.software_install ? { software_install: plan.software_install } : {}),
    ...(plan.trip_legs ? { trip_legs: plan.trip_legs } : {}),
  }
}

export function SmartChargingPlans({ scope, vehicleId, plans, places, reviewedPlaces, disabled, formDisabled, onChange }: Props) {
  const { t } = useTranslation()
  const { formatDateTime, tz } = useDateFormat('user')
  const { fmtNumber } = useNumberFormatting()
  const { formatEnergy, formatPower, unitPrefs } = useUnits()
  const displayProjection = useTripProjectionDisplay()
  const locale = unitPrefs.locale ?? 'en-US'
  const [editing, setEditing] = useState<PlanEditor | null>(null)
  const [deleting, setDeleting] = useState<number | null>(null)
  const [clock, setClock] = useState(Date.now)
  const formRef = useRef<HTMLDivElement>(null)
  const reminderTrigger = useRef<{ element: HTMLButtonElement; planId: number } | null>(null)
  const editButtons = useRef(new Map<number, HTMLButtonElement>())
  const activePlans = plans.some((plan) => plan.enabled)
  const latestStartsQuery = useSmartChargingLatestStarts(scope, vehicleId, activePlans)
  const latestStartsState = useDataState(latestStartsQuery)
  const latestStarts = latestStartsQuery.data ?? []
  useEffect(() => {
    if (editing != null) formRef.current?.focus()
    else if (reminderTrigger.current) {
      const { element, planId } = reminderTrigger.current
      const target = element.isConnected ? element : editButtons.current.get(planId)
      target?.focus()
      reminderTrigger.current = null
    }
  }, [editing])
  useEffect(() => {
    const now = Date.now()
    const pending = (latestStartsQuery.data ?? [])
      .map((estimate) => estimate.expires_at == null ? NaN : Date.parse(estimate.expires_at))
      .concat(editing && editing !== 'new' && editing.reminder
        ? [Date.parse(editing.reminder.expiresAt), Date.parse(editing.reminder.checkAt)] : [])
      .filter((expiry) => Number.isFinite(expiry) && expiry > now)
    if (pending.length === 0) return
    const timer = window.setTimeout(() => setClock(Date.now()), Math.min(...pending) - now + 1)
    return () => window.clearTimeout(timer)
  }, [latestStartsQuery.data, clock, editing])
  const selected = editing == null || editing === 'new' ? null : plans.find((plan) => plan.id === editing.planId) ?? null
  const reminder = editing && editing !== 'new' ? editing.reminder : undefined
  const reminderChanged = reminder != null && (selected?.version !== reminder.version ||
    selected?.notify_at !== reminder.previous || Date.parse(reminder.expiresAt) <= Math.max(clock, Date.now()) ||
    Date.parse(reminder.checkAt) <= Math.max(clock, Date.now()))
  const saveEarlier = async () => {
    if (!selected || !reminder || disabled || formDisabled || reminderChanged ||
      Date.now() >= Math.min(Date.parse(reminder.checkAt), Date.parse(reminder.expiresAt))) return
    if (await onChange({ kind: 'earlierCheck', id: selected.id, ...reminder })) setEditing(null)
  }
  const edit = (plan: SmartChargingPlan) => {
    if (plan.version != null) setEditing({ planId: plan.id, version: plan.version, previous: plan.notify_at })
  }
  const save = (plan: SmartChargingPlanInput) => {
    if (editing === 'new') return onChange({ kind: 'create', plan })
    if (!editing || !selected) return Promise.resolve(false)
    return onChange({ kind: 'update', id: selected.id, plan, version: editing.version, previous: editing.previous })
  }

  return (
    <section id="trip-stops" className="space-y-4" aria-label={t('smartCharging.plans', 'Your charging plans')}>
      <PanelTitle>{t('smartCharging.plans', 'Your charging plans')}</PanelTitle>
      {activePlans && (
        <section className="space-y-3" aria-label={t('smartCharging.latestStartTitle', 'Latest safe start estimates')}>
          <PanelTitle>{t('smartCharging.latestStartTitle', 'Latest safe start estimates')}</PanelTitle>
          <StaleRefreshWarning state={latestStartsState} label={t('smartCharging.latestStartTitle', 'Latest safe start estimates')} />
          {latestStartsState.fatalError ? (
            <QueryError error={latestStartsState.fatalError} onRetry={() => void latestStartsQuery.refetch()} />
          ) : !latestStartsState.hasData ? (
            latestStartsQuery.fetchStatus === 'paused' ? (
              <Text as="p" variant="bodySm">
                {t('smartCharging.latestStartPaused', 'Latest-start refresh is paused while offline. Reconnect to check live charging power.')}
              </Text>
            ) : <Skeleton lines={2} />
          ) : latestStarts.length === 0 ? (
            <Text as="p" variant="bodySm">
              {t('smartCharging.latestStartEmpty', 'Estimates appear for enabled, unsnoozed plans when fresh battery and charging signals are available.')}
            </Text>
          ) : (
            <div className="space-y-3">
              {latestStarts.map((estimate) => {
                const plan = plans.find((item) => item.id === estimate.plan_id)
                if (!plan) return null
                const now = Math.max(clock, Date.now())
                const expiry = estimate.expires_at == null ? NaN : Date.parse(estimate.expires_at)
                const expired = Number.isFinite(expiry) && expiry <= now
                const snoozed = plan.snoozed_until != null && Date.parse(plan.snoozed_until) > now
                const planMatches = plan.version == null || estimate.plan_version == null || plan.version === estimate.plan_version
                const proposedReminder = latestStartsState.status === 'ok' ? earlierCheckAt(plan, estimate, now) : null
                const comparison = planMatches && !expired && Number.isFinite(expiry) && plan.enabled && !snoozed &&
                  plan.compare_site_rates && estimate.status === 'estimate' ? estimate.cost_comparison : undefined
                const projection = planMatches && !expired && Number.isFinite(expiry) && plan.enabled && !snoozed &&
                  estimate.trip_projection ? displayProjection(estimate.trip_projection, plan.reserve_pct) : undefined
                const formatCost = (value: string) => comparison
                  ? formatCurrencyValue(Number(value), comparison.currency, locale,
                    currencyFractionDigits(comparison.currency, locale), { useGrouping: true }) || '—'
                  : '—'
                let content = t('smartCharging.latestStartUnavailable', 'A current estimate is unavailable. Fresh battery and pack-capacity data are required.')
                if (!planMatches) {
                  content = t('smartCharging.latestStartPlanChanged', 'This plan changed. Refresh its estimate before relying on it.')
                } else if (expired) {
                  content = t('smartCharging.latestStartExpired', 'This estimate expired because its live evidence is no longer fresh. Refresh to check again.')
                } else if (estimate.status === 'sufficient') {
                  content = estimate.trip_projection?.destination_charge_pct != null &&
                    estimate.trip_projection.destination_charge_pct > 0
                    ? t('smartCharging.latestStartSufficientWithDestination', 'No extra charge is estimated before departure if the planned destination charging happens. Check that the plan is still feasible.')
                    : t('smartCharging.latestStartSufficient', 'Your current battery meets the trip-use and reserve estimate you entered; no charge is estimated as necessary.')
                } else if (estimate.status === 'unachievable') {
                  content = plan.trip_legs
                    ? t('smartCharging.latestStartLegsUnachievable', 'The higher leg estimates and reserve cannot be met by charging only at the selected place. Review a stop or planned destination charging.')
                    : t('smartCharging.latestStartUnachievable', 'The upper trip-use estimate plus your reserve exceeds 100% battery, so this trip target cannot be reached by charging alone.')
                } else if (estimate.status === 'unavailable' && estimate.reason === 'not_charging') {
                  content = t('smartCharging.latestStartNotCharging', 'No positive charging power is currently measured. A connected plug alone is not enough to estimate a safe start.')
                } else if (estimate.status === 'unavailable' && estimate.reason === 'unknown_location') {
                  content = t('smartCharging.latestStartUnknownLocation', 'A fresh parked location is required to confirm charging power at the selected place.')
                } else if (estimate.status === 'unavailable' && estimate.reason === 'outside_site') {
                  content = t('smartCharging.latestStartOutsideSite', 'The vehicle is not confirmed at the selected charging place, so power measured elsewhere cannot be used.')
                } else if (
                  (estimate.status === 'estimate' || estimate.status === 'overdue') &&
                  estimate.earliest_safe_start_at && estimate.latest_safe_start_at && estimate.observed_at
                ) {
                  content = estimate.status === 'overdue'
                    ? t('smartCharging.latestStartOverdue', 'At the measured {{power}}, the estimated start for your higher trip-use value has passed. Check the vehicle; no schedule was changed.', {
                        power: formatPower(estimate.charging_power_w),
                      })
                    : t('smartCharging.latestStartEstimate', 'Using the nominal pack-energy estimate and measured {{power}} at the selected place, start by {{earliest}} for your higher trip-use value or {{latest}} for your lower value (observed {{observed}}). Estimates include a 25% time buffer; actual charging power can change.', {
                        power: formatPower(estimate.charging_power_w),
                        earliest: formatDateTime(estimate.earliest_safe_start_at),
                        latest: formatDateTime(estimate.latest_safe_start_at),
                        observed: formatDateTime(estimate.observed_at),
                      })
                }
                return (
                  <article key={estimate.plan_id} className="space-y-1 border-t border-[var(--border-subtle)] pt-3">
                    <Text as="p" variant="bodySm" weight="semibold">
                      {t('smartCharging.planHeading', 'Departure {{when}}', { when: formatDateTime(plan.departure_at) })}
                    </Text>
                    <Text as="p" variant="bodySm">{content}</Text>
                    {proposedReminder && (
                      <Button type="button" variant="secondary" className="min-h-11"
                        disabled={disabled || formDisabled || latestStartsState.isRefreshing || editing != null}
                        onClick={(event) => {
                          const current = earlierCheckAt(plan, estimate, Date.now())
                          if (!current) return
                          reminderTrigger.current = { element: event.currentTarget, planId: plan.id }
                          setEditing({ planId: plan.id, version: current.version, previous: current.previous, reminder: current })
                        }}>
                        {t('smartCharging.reviewEarlierReminder', 'Review an earlier reminder time')}
                      </Button>
                    )}
                    {projection && (
                      <div className="space-y-1">
                        <Text as="p" variant="bodySm">{projection.summary}</Text>
                        {projection.assumptions.map((assumption) => (
                          <Text as="p" variant="bodySm" key={assumption}>{assumption}</Text>
                        ))}
                        <div className="flex flex-wrap gap-3">
                          <Button type="button" variant="secondary" className="min-h-11"
                            disabled={disabled || formDisabled || plan.version == null} onClick={() => edit(plan)}>
                            {t('smartCharging.recordDestinationCharge', 'Record or update destination charging')}
                          </Button>
                          <Link to={`/trip-planner?vehicle_id=${vehicleId}`} className="text-theme-accent underline underline-offset-2">
                            {t('smartCharging.reviewStop', 'Review a charging stop in Trip Planner')}
                          </Link>
                        </div>
                      </div>
                    )}
                    {comparison && (
                      <div className="space-y-1">
                        <Text as="p" variant="bodySm" weight="semibold">
                          {t('smartCharging.rateComparisonTitle', 'Compare configured charging prices')}
                        </Text>
                        <Text as="p" variant="bodySm">
                          {t('smartCharging.rateComparisonEstimate', 'For the higher trip-use estimate ({{energy}}), charging now is about {{now}}; starting at {{start}} is about {{later}}, saving {{saving}} ({{currency}}).', {
                            energy: formatEnergy(comparison.required_energy_wh),
                            now: formatCost(comparison.cost_now_decimal), start: formatDateTime(comparison.lower_rate_start_at),
                            later: formatCost(comparison.cost_later_decimal), saving: formatCost(comparison.saving_decimal),
                            currency: comparison.currency,
                          })}
                        </Text>
                        <Text as="p" variant="bodySm">
                          {t('smartCharging.rateComparisonLimits', 'Based on the place’s dated prices and the current measured power, with a 25% time buffer. Power can change; taxes, fixed fees and charging losses are excluded. Savings must be at least 10% and one currency unit. No schedule is changed.')}
                        </Text>
                        <Link to="/geofences" className="text-theme-accent underline underline-offset-2">
                          {t('smartCharging.reviewPlacePrices', 'Review charging place prices')}
                        </Link>
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
          )}
        </section>
      )}
      {plans.length === 0 && (
        <Text as="p" variant="bodySm">
          {t('smartCharging.noPlans', 'No trip plan is saved. Add one when you want readiness checks.')}
        </Text>
      )}
      {plans.map((plan) => {
        const expired = new Date(plan.departure_at).getTime() <= Date.now() + 30 * 60_000
        const snoozed = plan.snoozed_until != null && new Date(plan.snoozed_until).getTime() > Date.now()
        const place = places.find((item) => item.id === plan.charging_place_id)
        const status = expired
          ? t('smartCharging.states.expired', 'Expired')
          : !plan.enabled
            ? t('smartCharging.states.paused', 'Paused')
            : snoozed
              ? t('smartCharging.states.snoozed', 'Snoozed')
              : t('smartCharging.states.active', 'Active')
        return (
          <article key={plan.id} className="space-y-2 border-t border-[var(--border-subtle)] pt-4">
            <Text as="p" variant="body" weight="semibold">
              {t('smartCharging.planHeading', 'Departure {{when}}', { when: formatDateTime(plan.departure_at) })}
            </Text>
            <Text as="p" variant="bodySm">
              {t('smartCharging.planStatus', 'Status: {{status}}; check from {{when}}.', {
                status, when: formatDateTime(plan.notify_at),
              })}
            </Text>
            {plan.scheduled_start && (
              <Text as="p" variant="bodySm">
                {t('smartCharging.planScheduledStart', 'Intended charging start: {{when}} (entered by you).', {
                  when: formatDateTime(plan.scheduled_start.at),
                })}
              </Text>
            )}
            {plan.scheduled_start?.power_ceiling_w != null && (
              <Text as="p" variant="bodySm">
                {t('smartCharging.planPowerCeiling', 'Maximum site power: {{power}} (entered by you).', {
                  power: formatPower(plan.scheduled_start.power_ceiling_w),
                })}
              </Text>
            )}
            {plan.service_appointment && (
              <Text as="p" variant="bodySm">
                {t('smartCharging.planServiceWindow', 'Service appointment: {{start}} to {{end}} (entered by you).', {
                  start: formatDateTime(plan.service_appointment.starts_at), end: formatDateTime(plan.service_appointment.ends_at),
                })}
              </Text>
            )}
            {plan.software_install && (
              <Text as="p" variant="bodySm">
                {t('smartCharging.planInstallWindow', 'Software install: {{start}} to {{end}} (entered by you).', {
                  start: formatDateTime(plan.software_install.starts_at), end: formatDateTime(plan.software_install.ends_at),
                })}
              </Text>
            )}
            <Text as="p" variant="bodySm">
              {plan.trip_legs
                ? t('smartCharging.planLegEstimates', 'Outbound use: {{outLow}}-{{outHigh}}%; return use: {{returnLow}}-{{returnHigh}}%; reserve: {{reserve}}%.', {
                    outLow: fmtNumber(plan.trip_legs.outbound_use_low_pct), outHigh: fmtNumber(plan.trip_legs.outbound_use_high_pct),
                    returnLow: fmtNumber(plan.trip_legs.return_use_low_pct), returnHigh: fmtNumber(plan.trip_legs.return_use_high_pct),
                    reserve: fmtNumber(plan.reserve_pct),
                  })
                : t('smartCharging.planEstimate', 'Trip use: {{low}}-{{high}}%; return reserve: {{reserve}}%.', {
                    low: fmtNumber(plan.trip_use_low_pct), high: fmtNumber(plan.trip_use_high_pct),
                    reserve: fmtNumber(plan.reserve_pct),
                  })}
            </Text>
            {plan.trip_legs && (
              <Text as="p" variant="bodySm">
                {plan.trip_legs.destination_charge_pct == null
                  ? t('smartCharging.noDestinationChargePlan', 'No destination charging is planned.')
                  : t('smartCharging.destinationChargePlan', 'Planned destination charge: {{charge}}% added; not confirmed.', {
                      charge: fmtNumber(plan.trip_legs.destination_charge_pct),
                    })}
              </Text>
            )}
            <Text as="p" variant="bodySm">
              {place
                ? t('smartCharging.planPlace', 'Charging place: {{place}}', { place: place.name })
                : t('smartCharging.placeUnavailable', 'The selected charging place is unavailable or needs review.')}
            </Text>
            {snoozed && (
              <Text as="p" variant="bodySm">
                {t('smartCharging.snoozedUntil', 'Snoozed until {{until}}.', {
                  until: formatDateTime(plan.snoozed_until),
                })}
              </Text>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" className="min-h-11" disabled={disabled || formDisabled || plan.version == null}
                ref={(element) => { if (element) editButtons.current.set(plan.id, element); else editButtons.current.delete(plan.id) }}
                onClick={() => edit(plan)}>
                {t('smartCharging.edit', 'Edit')}
              </Button>
              <Button type="button" variant="secondary" className="min-h-11"
                disabled={disabled || plan.version == null || (!plan.enabled && (expired || !place || formDisabled))}
                onClick={() => {
                  if (plan.version != null) void onChange({
                    kind: 'update', id: plan.id, version: plan.version, previous: plan.notify_at,
                    plan: { ...planInput(plan), enabled: !plan.enabled },
                  })
                }}>
                {plan.enabled ? t('smartCharging.pause', 'Pause') : t('smartCharging.resume', 'Resume')}
              </Button>
              {plan.enabled && !expired && (
                <Button type="button" variant="ghost" className="min-h-11" disabled={disabled}
                  onClick={() => void onChange({ kind: 'snooze', id: plan.id, durationS: snoozed ? 0 : 3600 })}>
                  {snoozed ? t('smartCharging.showNow', 'Check now') : t('smartCharging.snooze', 'Snooze for 1 hour')}
                </Button>
              )}
              <Button type="button" variant="ghost" className="min-h-11" disabled={disabled}
                onClick={() => setDeleting(plan.id)}>
                {t('smartCharging.delete', 'Delete plan')}
              </Button>
            </div>
            <TripStopComparison scope={scope} plan={plan} places={reviewedPlaces} disabled={disabled} placesUnavailable={formDisabled} />
            <TripPlanReview scope={scope} plan={plan} places={reviewedPlaces} disabled={disabled} placesUnavailable={formDisabled} />
            <TripMaintenance scope={scope} plan={plan} disabled={disabled} />
          </article>
        )
      })}
      {editing == null || (editing !== 'new' && !selected) ? (
        <Button type="button" variant="secondary" className="min-h-11" disabled={disabled || formDisabled || places.length === 0}
          onClick={() => setEditing('new')}>
          {t('smartCharging.addPlan', 'Add a trip plan')}
        </Button>
      ) : (
        <div ref={formRef} tabIndex={-1}>
          {reminder ? <div className="space-y-3">
            <PanelTitle>{t('smartCharging.reviewEarlierReminder', 'Review an earlier reminder time')}</PanelTitle>
            <Input type="datetime-local" readOnly label={t('smartCharging.notifyAt', 'Check from')}
              value={toZonedDatetimeStr(new Date(reminder.checkAt), tz)}
              hint={tz === 'UTC' ? tz : t('smartCharging.earlierReminderTimeZone', '{{zone}} ({{instant}} UTC)', {
                zone: tz, instant: formatDateTime(reminder.checkAt, { tz: 'UTC' }),
              })} />
            <Text as="p" variant="bodySm">
              {t('smartCharging.earlierReminderScope', 'Only this plan’s check time will change. A push still needs a verified charging device and a timely issue. Nothing changes on the vehicle.')}
            </Text>
            {reminderChanged && <ErrorText role="alert">
              {t('smartCharging.earlierReminderChanged', 'This preview expired or the plan changed. Close it and refresh the estimate.')}
            </ErrorText>}
            <div className="flex flex-wrap gap-2">
              <Button type="button" className="min-h-11" disabled={disabled || formDisabled || reminderChanged}
                onClick={() => void saveEarlier()}>{t('smartCharging.saveEarlierReminder', 'Save earlier check')}</Button>
              <Button type="button" variant="ghost" className="min-h-11" onClick={() => setEditing(null)}>
                {t('common.cancel', 'Cancel')}
              </Button>
            </div>
          </div> : <SmartChargingPlanForm key={editing === 'new' ? editing : editing.planId} vehicleId={vehicleId} personal={scope.mode === 'forward_auth'}
            plan={selected} places={places} disabled={disabled || formDisabled} onSave={save} onCancel={() => setEditing(null)} />}
        </div>
      )}
      <ConfirmDialog open={deleting != null} variant="danger" confirmDisabled={disabled}
        title={t('smartCharging.deleteTitle', 'Delete this plan?')}
        message={t('smartCharging.deleteDescription', 'This removes the plan and its pending decision. It does not delete driving or charging records.')}
        confirmLabel={t('smartCharging.delete', 'Delete plan')}
        cancelLabel={t('common.cancel', 'Cancel')}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting != null) void onChange({ kind: 'delete', id: deleting }).then((saved) => {
            if (saved) setDeleting(null)
          })
        }} />
    </section>
  )
}
