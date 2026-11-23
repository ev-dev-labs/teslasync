import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isApiError } from '@/api/client'
import type { Geofence } from '@/api/types'
import type { PersonalScope } from '@/api/hooks/usePersonalIdentity'
import { useTripChargingStops, useTripStopChange } from '@/api/hooks/useTripChargingStops'
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback'
import { Button, ConfirmDialog, ErrorText, Text } from '@/components/ui'
import { useDataState } from '@/hooks/useDataState'
import { useDateFormat } from '@/hooks/useDateFormat'
import type { SmartChargingPlan } from '@/types/smartCharging'
import type { TripStopSetup } from '@/types/smartTripStops'
import { matchesReviewedPlaceRevision } from './reviewedPlaceRevision'
import { TripStopComparisonResults } from './TripStopComparisonResults'
import { TripStopSetupForm } from './TripStopSetupForm'
import { usePrivateTripClock } from './usePrivateTripClock'

interface Props {
  scope: PersonalScope
  plan: SmartChargingPlan
  places: Geofence[]
  disabled: boolean
  placesUnavailable: boolean
}

export function TripStopComparison({ scope, plan, places, disabled, placesUnavailable }: Props) {
  const { t } = useTranslation()
  const { formatDateTime } = useDateFormat()
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const formPanel = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirmRemoval, setConfirmRemoval] = useState(false)
  const [checked, setChecked] = useState(false)
  const query = useTripChargingStops(scope, plan.vehicle_id, plan.id, plan.version, open)
  const state = useDataState(query)
  const change = useTripStopChange(scope, plan.vehicle_id, plan.id)
  const settings = query.data
  const result = settings?.result
  const expiry = result ? Date.parse(result.expires_at) : NaN
  const nextCheck = settings?.next_check_at ? Date.parse(settings.next_check_at) : NaN
  const departure = Date.parse(plan.departure_at)
  const snoozedUntil = plan.snoozed_until == null ? 0 : Date.parse(plan.snoozed_until)
  const now = usePrivateTripClock({ open, expiry, nextCheck, departure, snoozedUntil })
  const configurable = plan.enabled && plan.charging_place_id != null && departure > now && snoozedUntil <= now
  const saved = settings?.setup
  const setup = saved && saved.plan_version === plan.version &&
    matchesReviewedPlaceRevision(places, plan.charging_place_id, saved.origin_updated_at) &&
    matchesReviewedPlaceRevision(places, saved.destination_place_id, saved.destination_updated_at) &&
    saved.stops.every((stop) => matchesReviewedPlaceRevision(places, stop.place_id, stop.place_updated_at)) ? saved : null
  const unavailable = !settings?.available || disabled || query.isFetching || state.status !== 'ok' || change.isPending
  const denied = isApiError(query.error) &&
    ([401, 403, 404].includes(query.error.status) || query.error.code === 'IDENTITY_CHANGED')
  const label = t('smartCharging.stopComparison.title', 'Compare reviewed charging stops')

  useEffect(() => {
    if (editing) formPanel.current?.focus()
  }, [editing])

  const save = async (value: TripStopSetup) => {
    try {
      await change.mutateAsync({ kind: 'save', setup: value })
      setEditing(false)
      setChecked(false)
      trigger.current?.focus()
    } catch { /* The mutation error is rendered within the panel. */ }
  }
  const compare = () => {
    setChecked(false)
    change.mutate({ kind: 'compare' }, { onSuccess: () => setChecked(true) })
  }
  const remove = () => change.mutate({ kind: 'revoke' }, {
    onSuccess: () => {
      setConfirmRemoval(false)
      setEditing(false)
      setChecked(false)
      trigger.current?.focus()
    },
    onError: () => setConfirmRemoval(false),
  })

  return (
    <div className="space-y-3">
      <Button ref={trigger} type="button" className="min-h-11" variant="secondary" aria-expanded={open}
        aria-controls={id} onClick={() => setOpen(!open)}>
        {label}
      </Button>
      {open && <section id={id} aria-label={label} className="space-y-3">
        {scope.mode === 'open' ? (
          <Text as="p" variant="bodySm">
            {t('smartCharging.stopComparison.identity', 'Stop comparisons are private and require a verified sign-in.')}
          </Text>
        ) : denied || state.fatalError ? (
          <QueryError error={state.fatalError ?? query.error} onRetry={() => void query.refetch()} />
        ) : !settings ? <Skeleton lines={2} /> : (
          <>
            <StaleRefreshWarning state={state} label={label} />
            {!settings.available && <Text as="p" variant="bodySm">
              {t('smartCharging.stopComparison.unavailable', 'Ask your operator to configure licensed HERE Routing. No new checks can run while it is disconnected.')}
            </Text>}
            {settings.available && !configurable && <Text as="p" variant="bodySm">
              {t('smartCharging.stopComparison.paused', 'Resume a future trip plan before requesting a comparison.')}
            </Text>}
            {settings.available && configurable && (
              <>
                {!setup && <Text as="p" variant="bodySm">
                  {settings.has_setup
                    ? t('smartCharging.stopComparison.changed', 'The plan or a place changed. Review the current details before allowing a new check.')
                    : t('smartCharging.stopComparison.off', 'Off. Review the outbound trip and allow HERE Routing before comparing anything. No push or vehicle operation is available here.')}
                </Text>}
                {editing ? <div ref={formPanel} tabIndex={-1}>
                  <TripStopSetupForm plan={plan} places={places} setup={setup} disabled={unavailable || placesUnavailable}
                    onSave={save} onCancel={() => { setEditing(false); trigger.current?.focus() }} />
                </div> : (
                  <>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" className="min-h-11" variant="secondary" disabled={unavailable || placesUnavailable}
                        onClick={() => setEditing(true)}>
                        {t('smartCharging.stopComparison.review', 'Review setup')}
                      </Button>
                      {setup && <Button type="button" className="min-h-11" disabled={unavailable || placesUnavailable || nextCheck > now}
                        onClick={compare} loading={change.isPending && change.variables?.kind === 'compare'}>
                        {t('smartCharging.stopComparison.check', 'Check routes with HERE')}
                      </Button>}
                    </div>
                    {setup && nextCheck > now && <Text as="p" variant="bodySm">
                      {t('smartCharging.stopComparison.cooldown', 'Next check available at {{when}}.', { when: formatDateTime(settings.next_check_at!) })}
                    </Text>}
                    {setup && result && expiry > now && !unavailable && !placesUnavailable ? (
                      <TripStopComparisonResults result={result} capacityWh={setup.capacity_wh} />
                    ) : setup && (checked || (result != null && expiry <= now)) && <Text as="p" variant="bodySm" role="status">
                      {t('smartCharging.stopComparison.noComparison', 'No current comparison. The direct route may meet your reserve, or fewer than two reachable stops have enough evidence: eight similar wait days and three compatible measured charging sessions for the needed charge range.')}
                    </Text>}
                  </>
                )}
              </>
            )}
            {settings.has_setup && <Button type="button" variant="ghost" className="min-h-11"
              disabled={disabled || query.isFetching || change.isPending} onClick={() => setConfirmRemoval(true)}>
              {t('smartCharging.stopComparison.remove', 'Disconnect and remove comparison setup')}
            </Button>}
            {change.error && <ErrorText role="alert">
              {t('smartCharging.stopComparison.failure', 'Comparison or setup could not be completed. Review the plan, places and routing connection before trying again.')}
            </ErrorText>}
          </>
        )}
      </section>}
      <ConfirmDialog open={confirmRemoval} loading={change.isPending} onConfirm={remove} onCancel={() => setConfirmRemoval(false)}
        title={t('smartCharging.stopComparison.removeTitle', 'Remove this comparison setup?')}
        message={t('smartCharging.stopComparison.removeDescription', 'This revokes HERE Routing access for this plan and removes its queue observations and comparison. It does not delete driving or charging records.')}
        confirmLabel={t('smartCharging.stopComparison.remove', 'Disconnect and remove comparison setup')}
        cancelLabel={t('common.cancel', 'Cancel')} />
    </div>
  )
}
