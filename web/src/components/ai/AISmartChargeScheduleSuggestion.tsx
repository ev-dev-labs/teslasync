// Smart-charge schedule suggestion.
// Draft button posts to /api/v1/ai/charging/schedule/draft.

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { useAiStream } from '@/hooks/useAiStream'

interface InnerSectionProps {
  vehicleId?: string | number
  targetSoc?: number
  currentSoc?: number
  departBy?: string
  ratePlanId?: string
  maxAmps?: number
  batteryCapacityKwh?: number
  chargerVoltage?: number
  preferOffPeak?: boolean
}

function InnerSection({
  vehicleId,
  targetSoc,
  currentSoc,
  departBy,
  ratePlanId,
  maxAmps,
  batteryCapacityKwh,
  chargerVoltage,
  preferOffPeak,
}: InnerSectionProps) {
  const { t } = useTranslation()
  const numericVehicleId =
    typeof vehicleId === 'number' ? vehicleId : Number(vehicleId)
  const body = useMemo(() => {
    // depart_by must be ISO; the SmartChargePage feeds a datetime-local
    // string which we normalize the same way the deterministic Optimize
    // call does.
    const departIso = (() => {
      if (!departBy) return new Date().toISOString()
      const d = new Date(departBy)
      return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
    })()
    return {
      vehicle_id: numericVehicleId || 0,
      target_soc: targetSoc ?? 80,
      depart_by: departIso,
      rate_plan_id: ratePlanId ?? '',
      max_amps: maxAmps ?? 32,
      battery_capacity_kwh: batteryCapacityKwh ?? 75,
      charger_voltage: chargerVoltage ?? 240,
      prefer_off_peak: preferOffPeak ?? true,
      current_soc: currentSoc ?? 20,
    }
  }, [
    numericVehicleId,
    targetSoc,
    departBy,
    ratePlanId,
    maxAmps,
    batteryCapacityKwh,
    chargerVoltage,
    preferOffPeak,
    currentSoc,
  ])
  const stream = useAiStream({
    url: '/ai/charging/schedule/draft',
    body,
    onEvent: () => {},
  })
  const haveInputs = !!vehicleId && !!ratePlanId
    return (
    <AIFeatureCard
      title={t('chargePlanner.aiAgent.title', 'Draft a schedule with Helix')}
      description={t(
                'chargePlanner.aiAgent.description',
                'Ask Helix to propose a time-of-use-optimized charge schedule grounded in your selected rate plan and target departure. The schedule is never saved automatically \u2014 review the proposed window and click Schedule below to apply it.',
              )}
      buttonLabel={t('chargePlanner.aiAgent.generateButton', 'Draft a schedule')}
      badgeLabel={t('chargePlanner.aiAgent.badge', 'Helix')}
      canStart={haveInputs}
      stream={stream}
    />
  )
}
InnerSection.displayName = 'AISmartChargeScheduleSuggestionInner'

export const AISmartChargeScheduleSuggestion = withAiFeature(
  'smart-charge-schedule-suggestion',
  InnerSection,
)
AISmartChargeScheduleSuggestion.displayName = 'AISmartChargeScheduleSuggestion'
