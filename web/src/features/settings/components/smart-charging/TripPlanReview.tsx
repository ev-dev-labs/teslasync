import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isApiError } from '@/api/client'
import type { PersonalScope } from '@/api/hooks/usePersonalIdentity'
import { useTripPlanReview, useTripPlanReviewChange } from '@/api/hooks/useTripPlanReview'
import type { Geofence } from '@/api/types'
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback'
import { Button, ConfirmDialog, ErrorText, Text } from '@/components/ui'
import { useDataState } from '@/hooks/useDataState'
import { useDateFormat } from '@/hooks/useDateFormat'
import { useNumberFormatting } from '@/hooks/useNumberFormatting'
import { convertDurationFromSI } from '@/lib/unitConversion'
import type { SmartChargingPlan } from '@/types/smartCharging'
import type { TripReviewAdjustment } from '@/types/smartTripReview'
import { matchesReviewedPlaceRevision } from './reviewedPlaceRevision'
import { TripReviewSetupForm } from './TripReviewSetupForm'
import { usePrivateTripClock } from './usePrivateTripClock'

interface Props {
  scope: PersonalScope
  plan: SmartChargingPlan
  places: Geofence[]
  disabled: boolean
  placesUnavailable: boolean
}

export function TripPlanReview({ scope, plan, places, disabled, placesUnavailable }: Props) {
  const { t } = useTranslation()
  const { formatDateTime } = useDateFormat('user')
  const { fmtNumber } = useNumberFormatting()
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const form = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [removeOpen, setRemoveOpen] = useState(false)
  const query = useTripPlanReview(scope, plan.id, plan.vehicle_id, plan.version, open)
  const state = useDataState(query)
  const change = useTripPlanReviewChange(scope, plan.id, plan.vehicle_id)
  const data = query.data
  const departure = Date.parse(plan.departure_at)
  const snooze = plan.snoozed_until ? Date.parse(plan.snoozed_until) : 0
  const expiry = data?.review ? Date.parse(data.review.expires_at) : NaN
  const similar = data?.similar_adjustment
  const similarExpiry = similar ? Date.parse(similar.expires_at) : NaN
  const now = usePrivateTripClock({ open, departure, expiry, snoozedUntil: snooze, nextCheck: similarExpiry })
  const canEdit = plan.enabled && plan.charging_place_id != null && departure > now && snooze <= now
  const saved = data?.setup
  const setup = saved && saved.plan_version === plan.version &&
    matchesReviewedPlaceRevision(places, plan.charging_place_id, saved.origin_updated_at) &&
    matchesReviewedPlaceRevision(places, saved.destination_id, saved.destination_updated_at) &&
    (saved.stop_place_id == null || matchesReviewedPlaceRevision(places, saved.stop_place_id, saved.stop_place_updated_at)) ? saved : null
  const denied = isApiError(query.error) &&
    ([401, 403, 404].includes(query.error.status) || query.error.code === 'IDENTITY_CHANGED')
  const busy = query.isFetching || change.isPending || disabled
  const unavailable = busy || placesUnavailable || state.status !== 'ok'
  const review = setup && expiry > now && !unavailable ? data?.review : null
  const adjustmentKey = data?.adjustment_key
  const label = t('smartCharging.tripReview.title', 'Review planned vs. actual trip')
  const minutes = (seconds: number) => fmtNumber(convertDurationFromSI(seconds, 'min'))
  const adjustmentText = (adjustment: TripReviewAdjustment) => t('smartCharging.tripReview.adjustment', 'Planning allowance: {{stop}} min more stopped time and {{arrival}} percentage points more arrival-charge buffer.', {
    stop: minutes(adjustment.extra_stop_s), arrival: fmtNumber(adjustment.extra_arrival_pct),
  })

  useEffect(() => {
    if (editing) form.current?.focus()
  }, [editing])
  const closeForm = () => {
    setEditing(false)
    trigger.current?.focus()
  }
  const remove = () => change.mutate({ kind: 'remove' }, {
    onSuccess: () => { setRemoveOpen(false); closeForm() },
    onError: () => setRemoveOpen(false),
  })

  if (scope.mode !== 'forward_auth') return null
  return (
    <div className="space-y-3">
      <Button ref={trigger} type="button" className="min-h-11" variant="secondary" aria-expanded={open} aria-controls={id}
        onClick={() => { setOpen(!open); setEditing(false) }}>
        {label}
      </Button>
      {open && <section id={id} aria-label={label} className="space-y-3">
        {denied || state.fatalError ? <QueryError error={state.fatalError ?? query.error} onRetry={() => void query.refetch()} />
          : !data ? <Skeleton lines={2} /> : <>
            <StaleRefreshWarning state={state} label={label} />
            {!setup && <Text as="p" variant="bodySm">
              {data.has_setup ? t('smartCharging.tripReview.stale', 'The plan or reviewed places changed. This baseline will no longer be compared.')
                : t('smartCharging.tripReview.off', 'Off. Save a private baseline before departure to compare it with one confirmed completed journey.')}
            </Text>}
            {!review && setup && !unavailable && <Text as="p" variant="bodySm" role="status">
              {canEdit ? t('smartCharging.tripReview.waiting', 'Baseline saved. Start and complete the linked journey in Trips, then return to review the recorded results.')
                : t('smartCharging.tripReview.noMatch', 'No current comparison. The journey is not complete, evidence is missing or does not match the baseline, or the review expired.')}
            </Text>}
            {review && <div className="space-y-1">
              <Text as="p" variant="bodySm">
                {t('smartCharging.tripReview.arrived', 'Arrived {{when}} with {{observed}}% charge; the saved plan expected {{planned}}%.', {
                  when: formatDateTime(review.arrived_at), observed: fmtNumber(review.observed_arrival_pct), planned: fmtNumber(review.planned_arrival_pct),
                })}
              </Text>
              {review.planned_stop_s > 0 && <Text as="p" variant="bodySm">
                {t('smartCharging.tripReview.stopActual', 'Planned stop: {{planned}} min. Recorded stop: {{observed}} min, including {{charge}} min in a charging session. The rest is not a measured wait.', {
                  planned: minutes(review.planned_stop_s), observed: minutes(review.observed_stop_s), charge: minutes(review.observed_charge_s),
                })}
              </Text>}
              <Text as="p" variant="bodySm">
                {t('smartCharging.tripReview.expires', 'This review uses the matched completed journey and expires {{when}}.', { when: formatDateTime(review.expires_at) })}
              </Text>
            </div>}
            {review && data.adjustment && <Text as="p" variant="bodySm" role="status">
              {t('smartCharging.tripReview.savedAdjustment', 'Saved for the next similar trip.')} {adjustmentText(data.adjustment)}
            </Text>}
            {canEdit && setup && !unavailable && similar && similarExpiry > now && <Text as="p" variant="bodySm">
              {t('smartCharging.tripReview.similar', 'A previous trip to the same places has a saved adjustment. You can use it when updating this plan; nothing has changed automatically.')} {adjustmentText(similar)}
            </Text>}
            {editing && canEdit ? <div ref={form} tabIndex={-1}>
              <TripReviewSetupForm plan={plan} places={places} setup={setup} disabled={unavailable}
                onSave={(value) => change.mutate({ kind: 'save', setup: value }, { onSuccess: closeForm })} onCancel={closeForm} />
            </div> : <div className="flex flex-wrap gap-2">
              {canEdit && !review && <Button type="button" className="min-h-11" variant="secondary" disabled={unavailable}
                onClick={() => setEditing(true)}>
                {setup ? t('smartCharging.tripReview.edit', 'Edit trip baseline') : t('smartCharging.tripReview.reviewSetup', 'Set up trip review')}
              </Button>}
              {review && adjustmentKey && <Button type="button" className="min-h-11" disabled={unavailable}
                onClick={() => change.mutate({ kind: 'adjustment', key: adjustmentKey }, { onSuccess: () => trigger.current?.focus() })}>
                {t('smartCharging.tripReview.saveAdjustment', 'Save adjustment for a similar trip')}
              </Button>}
              {data.has_setup && <Button type="button" className="min-h-11" variant="ghost" disabled={busy}
                onClick={() => setRemoveOpen(true)}>
                {t('smartCharging.tripReview.remove', 'Remove trip review')}
              </Button>}
            </div>}
            {change.error && <ErrorText role="alert">
              {t('smartCharging.tripReview.failure', 'Could not change the review. Refresh and verify that the plan, locations and journey still match.')}
            </ErrorText>}
          </>}
      </section>}
      <ConfirmDialog open={removeOpen} loading={change.isPending} onConfirm={remove} onCancel={() => setRemoveOpen(false)}
        title={t('smartCharging.tripReview.removeTitle', 'Remove this private review?')}
        message={t('smartCharging.tripReview.removeMessage', 'The baseline and any saved adjustment will be removed. Your trips, drives and charging records are not affected.')}
        confirmLabel={t('smartCharging.tripReview.remove', 'Remove trip review')}
        cancelLabel={t('common.cancel', 'Cancel')} />
    </div>
  )
}
