import { useTranslation } from 'react-i18next'
import type { PersonalScope } from '@/api/hooks/usePersonalIdentity'
import { useSmartCharging, useSmartChargingChange } from '@/api/hooks/useSmartCharging'
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback'
import { Button, ErrorText, Text } from '@/components/ui'
import { useDataState } from '@/hooks/useDataState'
import type { ActionCenterRecommendation } from '@/types/actionCenter'

interface Props {
  recommendation: ActionCenterRecommendation
  personalScope?: PersonalScope
  disabled: boolean
}

export function SmartChargingRecommendationActions({ recommendation, personalScope, disabled }: Props) {
  const { t } = useTranslation()
  const scope = personalScope ?? null
  const vehicleId = recommendation.vehicle?.id ?? null
  const planId = recommendation.evidence.find((item) =>
    item.kind === 'charging_readiness' || item.kind === 'charging_feasibility')?.charging_readiness?.plan_id
    ?? recommendation.evidence.find((item) => item.kind === 'departure_overlap')?.departure_overlap?.plan_id
  const validPlan = planId != null && Number.isSafeInteger(planId) && planId > 0
  const query = useSmartCharging(scope, vehicleId, validPlan)
  const state = useDataState(query)
  const change = useSmartChargingChange(scope, vehicleId)
  const plan = (state.data ?? []).find((item) => item.id === planId)
  const activeAt = (now: number) => plan?.enabled &&
    new Date(plan.departure_at).getTime() > now + 30 * 60_000 &&
    new Date(recommendation.expires_at).getTime() > now &&
    (plan.snoozed_until == null || new Date(plan.snoozed_until).getTime() <= now)
  const available = !disabled && state.status === 'ok' && !query.isFetching && !change.isPending &&
    activeAt(Date.now())
  const snooze = async () => {
    if (!available || !activeAt(Date.now()) || planId == null) return
    try {
      await change.mutateAsync({ kind: 'snooze', id: planId, durationS: 3600 })
    } catch {
      // The visible error keeps the action available for retry.
    }
  }

  if (!scope || vehicleId == null || !validPlan) return null
  return (
    <div className="mt-4 space-y-3">
      {state.fatalError ? (
        <QueryError error={state.fatalError} onRetry={() => void query.refetch()} />
      ) : !state.hasData ? (
        <Skeleton lines={1} />
      ) : (
        <>
          <StaleRefreshWarning state={state} label={t('smartCharging.title', 'Charging readiness')} />
          {!activeAt(Date.now()) && (
            <Text as="p" variant="bodySm">
              {t('smartCharging.decisionUnavailable', 'This decision is no longer actionable. Refresh the action center.')}
            </Text>
          )}
          {change.error && <ErrorText role="alert">{t('smartCharging.changeFailed', 'The change was not saved. Refresh and try again.')}</ErrorText>}
          {recommendation.safe_actions.includes('smart_charging_snooze') && (
            <Button type="button" variant="secondary" className="min-h-11" disabled={!available}
              onClick={() => void snooze()}>
              {t('smartCharging.snooze', 'Snooze for 1 hour')}
            </Button>
          )}
        </>
      )}
    </div>
  )
}
