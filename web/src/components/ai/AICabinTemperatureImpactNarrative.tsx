// AI narration surface for the Temperature Impact analytics page.
// It is absent when AI mode or the feature toggle is off. When enabled,
// the Narrate button streams POST /api/v1/ai/climate/temperature-impact/narrate
// through useAiStream into the shared AiOutputPanel.
//
// This read-only section never replaces the deterministic temperature charts,
// monthly trend, recent-drives table, or other baseline page content.
//
// Render contract:
//   - useAiStream is called unconditionally so hook order stays stable.
//   - The Narrate button uses computed disabled state; never a literal disabled.
//   - stream.start() is a no-op while already streaming to prevent duplicates.

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { useAiStream } from '@/hooks/useAiStream'

interface InnerSectionProps {
  /**
   * vehicleId surfaced by the parent TemperatureImpactPage. Optional
   * because the active-vehicle context may be unresolved at first
   * paint; when absent we still render the section (the gate has
   * already passed) but the Narrate button stays disabled because
   * the backend call needs a vehicle in scope.
   */
  vehicleId?: string | number
}

/**
 * Body of the gated cabin temperature narration card. The title
 * explains that narration is read-only and uses the same aggregates
 * already shown by the deterministic charts. The button stays disabled
 * while streaming or until a vehicle is selected.
 */
function InnerSection({ vehicleId }: InnerSectionProps) {
  const { t } = useTranslation()
  const numericVehicleId =
    typeof vehicleId === 'number' ? vehicleId : Number(vehicleId)
  // The handler-side parser validates vehicle_id > 0; we mirror
  // that here to keep the button disabled when the parent has not
  // yet resolved the active vehicle. The hook is called
  // unconditionally with the current body so the dependency graph
  // stays stable regardless of vehicleId resolution.
  const body = useMemo(() => {
    const out: { vehicle_id: number } = {
      vehicle_id: Number.isFinite(numericVehicleId) ? numericVehicleId : 0,
    }
    return out
  }, [numericVehicleId])
  const stream = useAiStream({
    url: '/ai/climate/temperature-impact/narrate',
    body,
    onEvent: () => {},
  })
  const haveInputs = Number.isFinite(numericVehicleId) && numericVehicleId > 0
    return (
    <AIFeatureCard
      title={t(
                  'tempImpact.aiNarrative.title',
                  'Narrate the cabin-temperature impact',
                )}
      description={t(
                'tempImpact.aiNarrative.description',
                'Ask Helix to explain how outside ambient temperature affects this vehicle\u2019s efficiency \u2014 which temperature bucket runs most efficiently, how cold-weather months compare with mild-weather months, and what the seasonal pattern in the chart implies. The bucket and monthly numbers are the same the chart below shows; the narrator only explains them and is honest that these are descriptive aggregates of recent drives, not a forecast.',
              )}
      buttonLabel={t('tempImpact.aiNarrative.generateButton', 'Narrate impact')}
      badgeLabel={t('tempImpact.aiNarrative.badge', 'Helix')}
      canStart={haveInputs}
      stream={stream}
    />
  )
}
InnerSection.displayName = 'AICabinTemperatureImpactNarrativeInner'

/**
 * AICabinTemperatureImpactNarrative renders the LLM cabin
 * temperature impact narration section only when the
 * cabin-temperature-impact-narrative feature is enabled. The
 * wrapping div from {@link withAiFeature} carries
 * `data-testid="ai-feature-cabin-temperature-impact-narrative-root"`,
 * which the off-mode invariant test asserts against.
 */
export const AICabinTemperatureImpactNarrative = withAiFeature(
  'cabin-temperature-impact-narrative',
  InnerSection,
)
AICabinTemperatureImpactNarrative.displayName = 'AICabinTemperatureImpactNarrative'
