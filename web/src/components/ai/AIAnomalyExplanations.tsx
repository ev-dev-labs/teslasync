// Anomaly explanation narration.
// The Generate button streams from POST /api/v1/ai/anomalies/explain.

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { useAiStream } from '@/hooks/useAiStream'

interface InnerSectionProps {
  vehicleId?: number
}

function InnerSection({ vehicleId }: InnerSectionProps) {
  const { t } = useTranslation()
  // Independent narration window: 30 days, not the detector's 7-day
  // window or the learned baseline's 14-day training window.
  const body = useMemo(
    () => ({ vehicle_id: vehicleId ?? 0, days: 30 }),
    [vehicleId],
  )
  const stream = useAiStream({
    url: '/ai/anomalies/explain',
    body,
    onEvent: () => {},
    // AI-01: vehicle scope is part of stream identity — switching the
    // active vehicle aborts any in-flight explanation and clears the
    // previous vehicle's narration before the new scope streams in.
    scopeKey: vehicleId ?? null,
  })
  // The handler-side parser (internal/api/aianomaly/handler.go) rejects
  // vehicle_id <= 0 with a 400 before the LLM is ever invoked, so we
  // mirror that > 0 contract here. An unresolved active vehicle
  // (undefined) OR a placeholder 0/negative id keeps the button
  // disabled instead of firing a request that is guaranteed to fail.
  const haveInputs = vehicleId != null && vehicleId > 0
  return (
    <AIFeatureCard
      title={t('anomaly.aiExplanation.title', 'Helix explanation')}
      description={t(
        'anomaly.aiExplanation.description',
        'Get a plain-language explanation of the anomalies the detector has already identified above.',
      )}
      buttonLabel={t('anomaly.aiExplanation.generateButton', 'Generate explanation')}
      badgeLabel={t('anomaly.aiExplanation.badge', 'Helix')}
      emptyHint={
        haveInputs
          ? undefined
          : t(
              'anomaly.aiExplanation.emptyHint',
              'Select a vehicle above to explain its anomalies.',
            )
      }
      canStart={haveInputs}
      stream={stream}
    />
  )
}
InnerSection.displayName = 'AIAnomalyExplanationsInner'

export const AIAnomalyExplanations = withAiFeature(
  'anomaly-explanations',
  InnerSection,
)
AIAnomalyExplanations.displayName = 'AIAnomalyExplanations'
