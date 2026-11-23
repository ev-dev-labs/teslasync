import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isApiError } from '@/api/client'
import type { PersonalScope } from '@/api/hooks/usePersonalIdentity'
import {
  sharedChargerPageLimit, useSharedChargerChange, useSharedChargerPlanning,
  type SharedChargerChange, type SharedChargerOwnedPlan, type SharedChargerRef, type SharedChargerScope,
} from '@/api/hooks/useSharedChargerPlanning'
import { QueryError, Skeleton } from '@/components/feedback'
import { Button, ConfirmDialog, ErrorText, GlassPanel, PanelTitle, Select, Text } from '@/components/ui'
import { useDateFormat } from '@/hooks/useDateFormat'
import { SharedChargerAuthorizationForm } from './SharedChargerAuthorizationForm'
import { SharedChargerConfirmationForm } from './SharedChargerConfirmationForm'
import { SharedChargerPlanCard } from './SharedChargerPlanCard'
import type { SharedChargerPlaceChoice, SharedChargerVehicleChoice } from './sharedChargerPlanningUtils'

interface PlanningChoices {
  vehicles: readonly SharedChargerVehicleChoice[]
  places: readonly SharedChargerPlaceChoice[]
  disabled: boolean
  choicesUnavailable: boolean
}

interface Props extends PlanningChoices {
  active: boolean
  scope: PersonalScope | null
}

const planKey = (plan: SharedChargerRef) => `${plan.id}:${plan.revision}`
type DeleteChange = Extract<SharedChargerChange, { kind: 'revoke' | 'withdraw' }>

export function SharedChargerPlanning({ active, scope, ...choices }: Props) {
  const { t } = useTranslation()
  if (!active) return null
  return (
    <GlassPanel padding="lg" className="space-y-4">
      <PanelTitle>{t('smartCharging.sharedCharger.title', 'Share one charger')}</PanelTitle>
      <Text as="p" variant="bodySm">
        {t('smartCharging.sharedCharger.advisory', 'Coordinate two vehicles at one reviewed charger. This is advice only: it never starts, stops, or reschedules charging.')}
      </Text>
      {scope?.mode === 'forward_auth'
        ? <ScopedPlanning key={scope.subject} scope={scope} {...choices} />
        : <Text as="p" variant="bodySm">
          {t('smartCharging.sharedCharger.signInRequired', 'A verified browser sign-in is required for private charger planning.')}
        </Text>}
    </GlassPanel>
  )
}

function ScopedPlanning({ scope, vehicles, places, disabled, choicesUnavailable }: PlanningChoices & { scope: SharedChargerScope }) {
  const { t } = useTranslation()
  const { formatDateTime } = useDateFormat()
  const [offset, setOffset] = useState(0)
  const list = useSharedChargerPlanning(scope, offset)
  const change = useSharedChargerChange(scope)
  const [editor, setEditor] = useState<SharedChargerOwnedPlan | 'create' | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<DeleteChange | null>(null)
  const page = list.data
  const invitations = page?.invitations ?? []
  const owned = page?.owned ?? []
  const plans = [...new Map(invitations.map((invite) => [planKey(invite), invite])).values()]
  const activePlan = plans.find((plan) => planKey(plan) === chosen) ?? plans[0]
  const activeInvites = activePlan ? invitations.filter((invite) => planKey(invite) === planKey(activePlan)) : []
  const canWrite = !disabled && !list.isError && !change.isPending
  const canAuthorize = canWrite && !choicesUnavailable && places.length > 0 && vehicles.length >= 2
  const showEditor = page?.can_manage && editor != null &&
    (editor === 'create' || owned.some((plan) => planKey(plan) === planKey(editor)))
  const changeCode = isApiError(change.error) ? change.error.code : null
  const vehicleName = (id: number) => vehicles.find((entry) => entry.id === id)?.display_name ??
    t('smartCharging.sharedCharger.vehicleReference', 'Vehicle #{{id}}', { id })
  const placeName = (id: number) => places.find((entry) => entry.id === id)?.name ??
    t('smartCharging.sharedCharger.placeReference', 'Charging place #{{id}}', { id })
  const labelPlan = (plan: SharedChargerOwnedPlan) => t('smartCharging.sharedCharger.planReference', '{{place}} · Plan #{{id}}, revision {{revision}}', {
    place: placeName(plan.place_id), id: plan.id, revision: plan.revision,
  })

  const selectPage = (next: number) => {
    setOffset(next)
    setEditor(null)
    setChosen(null)
    change.reset()
  }
  const mutate = (action: SharedChargerChange, after?: () => void) => {
    if (canWrite) change.mutate(action, { onSuccess: after })
  }

  if (list.isError) return <QueryError error={list.error} onRetry={() => void list.refetch()} />
  if (!page) return <Skeleton lines={3} />
  return (
    <div className="space-y-5">
      {change.error && <ErrorText role="alert">
        {changeCode === 'SHARED_CHARGER_ACTIVE_PLAN'
          ? t('smartCharging.sharedCharger.activeConflict', 'This reviewed charger already has an active plan. Use that plan or wait for it to end.')
          : changeCode === 'SWAP_ALREADY_PUBLISHED'
            ? t('smartCharging.sharedCharger.swapPublished', 'This plan cannot be revised because its one swap reminder was already published.')
            : t('smartCharging.sharedCharger.changeFailed', 'The change was not saved. Refresh the plans and check your sign-in, permissions, and the current revision.')}
      </ErrorText>}
      {page.can_manage && (
        <section className="space-y-3">
          <PanelTitle>{t('smartCharging.sharedCharger.ownedTitle', 'Plans you authorized')}</PanelTitle>
          <Button type="button" disabled={!canAuthorize} onClick={() => { change.reset(); setEditor('create') }}>
            {t('smartCharging.sharedCharger.createAction', 'New shared charger plan')}
          </Button>
          {choicesUnavailable || places.length === 0 || vehicles.length < 2 ? (
            <Text as="p" variant="bodySm">
              {t('smartCharging.sharedCharger.choicesRequired', 'Authorizing a plan requires current data for two active vehicles and a reviewed place marked as a charging location.')}
            </Text>
          ) : null}
          {owned.length === 0 ? (
            <Text as="p" variant="bodySm">{t('smartCharging.sharedCharger.noOwned', 'No active plans you authorized on this page.')}</Text>
          ) : owned.map((plan) => (
            <div key={planKey(plan)} className="space-y-2">
              <Text as="p" variant="bodySm">{labelPlan(plan)}</Text>
              <Text as="p" variant="bodySm">
                {t('smartCharging.sharedCharger.planExpiry', 'Plan expires {{time}}.', { time: formatDateTime(plan.expires_at) })}
              </Text>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" disabled={!canAuthorize}
                  onClick={() => { change.reset(); setEditor(plan) }}>
                  {t('smartCharging.sharedCharger.reviseAction', 'Revise plan')}
                </Button>
                <Button type="button" variant="ghost" disabled={!canWrite} onClick={() => setConfirmation({ kind: 'revoke', ref: plan })}>
                  {t('smartCharging.sharedCharger.revoke', 'Revoke plan')}
                </Button>
              </div>
            </div>
          ))}
          {showEditor && <SharedChargerAuthorizationForm key={editor === 'create' ? editor : planKey(editor)}
            plan={editor === 'create' ? null : editor} places={places} vehicles={vehicles} disabled={!canAuthorize}
            onCancel={() => { change.reset(); setEditor(null) }}
            onSave={(input) => mutate(editor === 'create' ? { kind: 'create', input } : { kind: 'revise', ref: editor, input },
              () => setEditor(null))} />}
        </section>
      )}
      <section className="space-y-3">
        <PanelTitle>{t('smartCharging.sharedCharger.invitationsTitle', 'Your private invitations')}</PanelTitle>
        {!activePlan ? (
          <Text as="p" variant="bodySm">{t('smartCharging.sharedCharger.noInvitations', 'No active invitations on this page for your signed-in account.')}</Text>
        ) : (
          <>
            <Select label={t('smartCharging.sharedCharger.selectPlan', 'Invitation plan')} value={planKey(activePlan)}
              options={plans.map((plan) => ({ value: planKey(plan), label: labelPlan(plan) }))}
              disabled={change.isPending} onChange={(event) => { change.reset(); setChosen(event.target.value) }} />
            <Text as="p" variant="bodySm">
              {t('smartCharging.sharedCharger.planExpiry', 'Plan expires {{time}}.', { time: formatDateTime(activePlan.expires_at) })}
            </Text>
            {activeInvites.map((invite) => (
              <GlassPanel key={`${planKey(invite)}:${invite.vehicle_id}`} padding="md" className="space-y-3">
                <PanelTitle>{vehicleName(invite.vehicle_id)}</PanelTitle>
                {invite.confirmed ? (
                  <Text as="p" variant="bodySm">{t('smartCharging.sharedCharger.confirmed', 'You confirmed this vehicle for the current plan revision.')}</Text>
                ) : <SharedChargerConfirmationForm reminderOffered={invite.reminder_offered}
                  disabled={!canWrite || Date.parse(invite.expires_at) <= Date.now()}
                  onConfirm={(input) => mutate({ kind: 'confirm', ref: invite, vehicleId: invite.vehicle_id, input })} />}
                <Button type="button" variant="ghost" disabled={!canWrite}
                  onClick={() => setConfirmation({ kind: 'withdraw', ref: invite, vehicleId: invite.vehicle_id })}>
                  {t('smartCharging.sharedCharger.withdraw', 'Withdraw from plan')}
                </Button>
              </GlassPanel>
            ))}
            <SharedChargerPlanCard key={planKey(activePlan)} scope={scope} plan={activePlan}
              confirmed={activeInvites.some((invite) => invite.confirmed)} vehicleName={vehicleName} />
          </>
        )}
      </section>
      {(offset > 0 || owned.length === sharedChargerPageLimit || invitations.length === sharedChargerPageLimit) && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" disabled={offset === 0 || change.isPending}
            onClick={() => selectPage(offset - sharedChargerPageLimit)}>
            {t('smartCharging.sharedCharger.previousPage', 'Previous plans')}
          </Button>
          <Button type="button" variant="secondary" onClick={() => selectPage(offset + sharedChargerPageLimit)}
            disabled={offset + sharedChargerPageLimit > 10000 || change.isPending ||
              (owned.length < sharedChargerPageLimit && invitations.length < sharedChargerPageLimit)}>
            {t('smartCharging.sharedCharger.nextPage', 'More plans')}
          </Button>
        </div>
      )}
      <ConfirmDialog open={confirmation != null}
        title={confirmation?.kind === 'withdraw'
          ? t('smartCharging.sharedCharger.withdraw', 'Withdraw from plan')
          : t('smartCharging.sharedCharger.revoke', 'Revoke plan')}
        message={t('smartCharging.sharedCharger.revokeImpact', 'This ends the plan for both participants, removes the shared advice, and cancels any future swap reminder. It does not change either vehicle.')}
        confirmLabel={t('smartCharging.sharedCharger.endPlan', 'End shared plan')}
        cancelLabel={t('smartCharging.sharedCharger.cancel', 'Cancel')}
        confirmDisabled={!canWrite} loading={change.isPending} variant="warning"
        onCancel={() => setConfirmation(null)}
        onConfirm={() => { if (confirmation) mutate(confirmation, () => setConfirmation(null)) }} />
    </div>
  )
}
