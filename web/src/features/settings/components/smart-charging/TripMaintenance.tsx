import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isApiError } from '@/api/client'
import type { PersonalScope } from '@/api/hooks/usePersonalIdentity'
import { useTripMaintenance, useTripMaintenanceChange } from '@/api/hooks/useTripMaintenance'
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback'
import { Button, ConfirmDialog, ErrorText, Text } from '@/components/ui'
import { useDataState } from '@/hooks/useDataState'
import { useDateFormat } from '@/hooks/useDateFormat'
import { useUnits } from '@/hooks/useUnits'
import { formatTripMaintenance } from '@/lib/tripMaintenanceDisplay'
import type { SmartChargingPlan } from '@/types/smartCharging'
import { TripMaintenanceForm } from './TripMaintenanceForm'
import { usePrivateTripClock } from './usePrivateTripClock'

interface Props {
  scope: PersonalScope
  plan: SmartChargingPlan
  disabled: boolean
}

export function TripMaintenance({ scope, plan, disabled }: Props) {
  const { t } = useTranslation()
  const { formatDateTime } = useDateFormat('user')
  const { formatDistance } = useUnits()
  const title = t('smartCharging.tripMaintenance.title', 'Maintenance before this trip')
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const form = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [removeOpen, setRemoveOpen] = useState(false)
  const query = useTripMaintenance(scope, plan.id, plan.vehicle_id, plan.version, open)
  const state = useDataState(query)
  const change = useTripMaintenanceChange(scope, plan.id, plan.vehicle_id)
  const data = state.data
  const departure = Date.parse(plan.departure_at)
  const expiry = data?.projection ? Date.parse(data.projection.expires_at) : NaN
  const snoozedUntil = plan.snoozed_until ? Date.parse(plan.snoozed_until) : 0
  const now = usePrivateTripClock({ open, departure, expiry, snoozedUntil })
  const denied = isApiError(query.error) &&
    ([401, 403, 404].includes(query.error.status) || query.error.code === 'IDENTITY_CHANGED')
  const enabled = plan.enabled && departure > now && snoozedUntil <= now
  const busy = disabled || query.isFetching || change.isPending || state.status !== 'ok'
  const projection = enabled && data?.projection && !data.needs_review && expiry > now &&
    data.setup?.plan_version === plan.version ? data.projection : null
  const display = projection ? formatTripMaintenance(projection, t, formatDateTime, formatDistance) : null

  useEffect(() => {
    if (editing) form.current?.focus()
  }, [editing])
  const closeForm = () => {
    setEditing(false)
    trigger.current?.focus()
  }

  if (scope.mode !== 'forward_auth') return null
  return (
    <div className="space-y-3">
      <Button ref={trigger} type="button" className="min-h-11" variant="secondary" wrapLabel aria-expanded={open} aria-controls={id}
        onClick={() => { setOpen(!open); setEditing(false); change.reset() }}>
        {title}
      </Button>
      {open && <section id={id} aria-label={title} className="space-y-3">
        {denied || state.fatalError ? <QueryError error={state.fatalError ?? query.error} onRetry={() => void query.refetch()} />
          : !data ? query.fetchStatus === 'paused'
            ? <Text as="p" variant="bodySm">{t('smartCharging.tripMaintenance.offline', 'Reconnect to review the saved interval.')}</Text>
            : <Skeleton lines={2} />
          : <>
            <StaleRefreshWarning state={state} label={title} />
            {display ? <>
              <Text as="p" variant="bodySm" weight="semibold">{display.summary}</Text>
              <Text as="p" variant="bodySm">{display.basis}</Text>
              <Text as="p" variant="bodySm">{display.limitation}</Text>
            </> : <Text as="p" variant="bodySm" role="status">
              {!data.setup ? t('smartCharging.tripMaintenance.off', 'Off. Record a completed service, its documented interval, and this plan’s estimated total distance.')
                : data.needs_review ? t('smartCharging.tripMaintenance.stale', 'The plan changed. Review the interval and trip distance again before another check.')
                : !enabled ? t('smartCharging.tripMaintenance.paused', 'Checks are paused for this plan or the departure time has passed.')
                : t('smartCharging.tripMaintenance.waiting', 'No current interval crossing. It takes a recent odometer reading and a departure within 14 days with time to act.')}
            </Text>}
            {editing && plan.version && enabled ? <div ref={form} tabIndex={-1}>
              <TripMaintenanceForm version={plan.version} setup={data.setup} disabled={busy} onCancel={closeForm}
                onSave={(setup) => change.mutate(setup, { onSuccess: closeForm })} />
            </div> : <div className="flex flex-wrap gap-2">
              {enabled && plan.version && <Button type="button" variant="secondary" className="min-h-11" wrapLabel disabled={busy}
                onClick={() => { change.reset(); setEditing(true) }}>
                {data.setup ? t('smartCharging.tripMaintenance.edit', 'Review or edit the interval')
                  : t('smartCharging.tripMaintenance.enable', 'Set up maintenance check')}
              </Button>}
              {data.setup && <Button type="button" variant="ghost" className="min-h-11" wrapLabel aria-disabled={busy}
                onClick={(event) => {
                  if (busy) return
                  event.currentTarget.focus()
                  change.reset()
                  setRemoveOpen(true)
                }}>
                {t('smartCharging.tripMaintenance.remove', 'Turn off maintenance check')}
              </Button>}
            </div>}
            {change.isError && <ErrorText role="alert">
              {t('smartCharging.tripMaintenance.failure', 'Could not change the check. Refresh and verify that the vehicle and trip still match.')}
            </ErrorText>}
          </>}
        <ConfirmDialog open={removeOpen && !denied} onCancel={() => setRemoveOpen(false)} confirmDisabled={busy}
          title={t('smartCharging.tripMaintenance.removeTitle', 'Remove this private maintenance check?')}
          message={t('smartCharging.tripMaintenance.removeMessage', 'The interval and trip-distance assumptions entered here will be removed. Your charging plan and drives are not affected.')}
          confirmLabel={t('smartCharging.tripMaintenance.remove', 'Turn off maintenance check')}
          cancelLabel={t('common.cancel', 'Cancel')}
          onConfirm={() => {
            if (busy) return
            setRemoveOpen(false)
            change.mutate(null, { onSuccess: closeForm })
          }} />
      </section>}
    </div>
  )
}
