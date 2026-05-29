// Trip planner LLM agent.
// The Draft button streams from POST /api/v1/ai/trips/plan/draft.

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { useAiStream } from '@/hooks/useAiStream'

interface TripLocationLike {
  lat: number
  lng: number
  name?: string
}

interface InnerSectionProps {
  vehicleId?: string | number
  origin?: TripLocationLike | null
  destination?: TripLocationLike | null
  currentSoc?: number
  minArrivalSoc?: number
  chargeLimitSoc?: number
  speedFactor?: number
}

function InnerSection({
  vehicleId,
  origin,
  destination,
  currentSoc,
  minArrivalSoc,
  chargeLimitSoc,
  speedFactor,
}: InnerSectionProps) {
  const { t } = useTranslation()
  const numericVehicleId =
    typeof vehicleId === 'number' ? vehicleId : Number(vehicleId)
  const body = useMemo(
    () => ({
      vehicle_id: numericVehicleId || 0,
      origin: origin
        ? {
            lat: origin.lat,
            lng: origin.lng,
            name: origin.name ?? '',
          }
        : { lat: 0, lng: 0, name: '' },
      destination: destination
        ? {
            lat: destination.lat,
            lng: destination.lng,
            name: destination.name ?? '',
          }
        : { lat: 0, lng: 0, name: '' },
      current_soc: currentSoc ?? 80,
      charge_limit_soc: chargeLimitSoc ?? 90,
      min_arrival_soc: minArrivalSoc ?? 20,
      speed_factor: speedFactor ?? 1.0,
    }),
    [
      numericVehicleId,
      origin,
      destination,
      currentSoc,
      chargeLimitSoc,
      minArrivalSoc,
      speedFactor,
    ],
  )
  const stream = useAiStream({
    url: '/ai/trips/plan/draft',
    body,
    onEvent: () => {},
  })
  const haveInputs =
    !!vehicleId && origin != null && destination != null
    return (
    <AIFeatureCard
      title={t('tripPlanner.aiAgent.title', 'Draft a plan with Helix')}
      description={t(
                'tripPlanner.aiAgent.description',
                'Ask Helix to draft a trip plan grounded in your past charging history along the corridor. The plan is never saved automatically \u2014 review the proposed plan and click Plan in the form below to save it.',
              )}
      buttonLabel={t('tripPlanner.aiAgent.generateButton', 'Draft a plan')}
      badgeLabel={t('tripPlanner.aiAgent.badge', 'Helix')}
      canStart={haveInputs}
      stream={stream}
    />
  )
}
InnerSection.displayName = 'AITripPlannerLLMAgentInner'

export const AITripPlannerLLMAgent = withAiFeature(
  'trip-planner-llm-agent',
  InnerSection,
)
AITripPlannerLLMAgent.displayName = 'AITripPlannerLLMAgent'
