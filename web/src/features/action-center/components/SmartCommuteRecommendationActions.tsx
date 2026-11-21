import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSmartCommute, useSmartCommuteChange } from '@/api/hooks/useSmartCommute'
import type { PersonalScope } from '@/api/hooks/usePersonalIdentity'
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback'
import { Button, ErrorText, Text } from '@/components/ui'
import { SmartCommuteRoutineForm } from '@/features/smart-commute/components/SmartCommuteRoutineForm'
import { useDataState } from '@/hooks/useDataState'
import type { ActionCenterRecommendation } from '@/types/actionCenter'
import type { SmartCommuteRoutineInput } from '@/types/smartCommute'

interface Props {
  recommendation: ActionCenterRecommendation
  personalScope?: PersonalScope
  disabled: boolean
}

export function SmartCommuteRecommendationActions({ recommendation, personalScope, disabled }: Props) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const scope = personalScope ?? null
  const vehicleId = recommendation.vehicle?.id ?? null
  const routineId = recommendation.evidence.find((item) => item.kind === 'recurring_drive')?.recurring_drive?.routine_id
  const validRoutine = routineId != null && Number.isSafeInteger(routineId) && routineId > 0
  const query = useSmartCommute(scope, vehicleId, validRoutine)
  const state = useDataState(query)
  const change = useSmartCommuteChange(scope, vehicleId)
  const routine = (state.data?.routines ?? []).find((item) => item.id === routineId)
  const settings = state.data?.settings
  const available = !disabled && state.status === 'ok' && !query.isFetching && !change.isPending &&
    routine?.status === 'suggested' && settings?.enabled && settings.local_analysis_enabled && !settings.paused

  const save = async (input: SmartCommuteRoutineInput) => {
    if (!available || routineId == null) return false
    try {
      await change.mutateAsync({ kind: 'confirm', id: routineId, routine: input })
      return true
    } catch {
      return false
    }
  }
  const decline = async () => {
    if (!available || routineId == null) return
    try {
      await change.mutateAsync({ kind: 'decline', id: routineId })
    } catch {
      // The visible error below keeps the decision available for retry.
    }
  }
  const snooze = async () => {
    if (!available || routineId == null) return
    try {
      await change.mutateAsync({ kind: 'snooze', id: routineId, durationS: 24 * 60 * 60 })
    } catch {
      // The visible error below keeps the decision available for retry.
    }
  }

  if (!scope || vehicleId == null || !validRoutine) return null
  return (
    <div className="mt-4 space-y-3">
      {state.fatalError ? (
        <QueryError error={state.fatalError} onRetry={() => void query.refetch()} />
      ) : !state.hasData ? (
        <Skeleton lines={1} />
      ) : (
        <>
          <StaleRefreshWarning state={state} label={t('smartCommute.title', 'Smart Commute')} />
          {routine?.status !== 'suggested' && (
            <Text as="p" variant="bodySm">
              {t('smartCommute.suggestionUnavailable', 'This suggestion is no longer available. Refresh the action center.')}
            </Text>
          )}
          {change.error && <ErrorText role="alert">{t('smartCommute.changeFailed', 'The change was not saved. Refresh and try again.')}</ErrorText>}
          <div className="flex flex-wrap gap-2">
            {recommendation.safe_actions.includes('smart_commute_use') && (
              <Button type="button" variant="secondary" className="min-h-11" disabled={!available}
                onClick={() => setEditing(true)}>
                {t('smartCommute.useRoutine', 'Use routine')}
              </Button>
            )}
            {recommendation.safe_actions.includes('smart_commute_edit') && (
              <Button type="button" variant="ghost" className="min-h-11" disabled={!available}
                onClick={() => setEditing(true)}>
                {t('smartCommute.edit', 'Edit')}
              </Button>
            )}
            {recommendation.safe_actions.includes('smart_commute_decline') && (
              <Button type="button" variant="ghost" className="min-h-11" disabled={!available}
                onClick={() => void decline()}>
                {t('smartCommute.notMine', 'Not mine')}
              </Button>
            )}
            {recommendation.safe_actions.includes('smart_commute_snooze') && (
              <Button type="button" variant="ghost" className="min-h-11" disabled={!available}
                onClick={() => void snooze()}>
                {t('smartCommute.snooze', 'Snooze for 24 hours')}
              </Button>
            )}
          </div>
          {editing && routine && (
            <SmartCommuteRoutineForm vehicleId={vehicleId} timeZone={routine.time_zone} routine={routine}
              disabled={!available} onSave={save} onCancel={() => setEditing(false)} />
          )}
        </>
      )}
    </div>
  )
}
