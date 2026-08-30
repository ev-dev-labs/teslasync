// Optional Helix narrative for the Battery Health page.
// Contract:
//   - Hidden entirely when ai_mode='off' or the feature toggle is disabled.
//   - POSTs to /api/v1/ai/battery/health/narrate and streams into AiOutputPanel.
//   - Never replaces deterministic health charts, metrics, insights, or recommendations.
//   - useAiStream stays unconditional; the Narrate button derives disabled state from `!canGenerate`.
//   - Double-submit protection lives in useAiStream while state === 'streaming'.

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { useAiStream } from '@/hooks/useAiStream'

// Stable no-op event sink. This narrator only renders the accumulated
// `delta.text` that useAiStream already exposes as `stream.text`, so it
// has no need for per-event callbacks. Hoisting the handler to module
// scope keeps its identity stable across renders so useAiStream's
// onEvent-tracking effect does not re-subscribe on every render.
const noopEvent = () => {}

interface InnerSectionProps {
  /**
   * vehicleId surfaced by the parent BatteryHealthPage. Optional
   * because the active-vehicle context may be unresolved at first
   * paint; when absent we still render the section (the gate has
   * already passed) but the Narrate button stays disabled because
   * the backend call needs a vehicle in scope.
   */
  vehicleId?: string | number
}

/**
 * InnerSection is the always-rendered body of the AI battery-health
 * forecast narrator card. The surrounding {@link withAiFeature} HOC
 * handles the visibility gate; this component only describes the
 * surface's appearance.
 * Visual contract:
 *   - One GlassPanel sized to sit above the battery hero metric
 *     cards on BatteryHealthPage.
 *   - Cyan AI badge in the header (matches the chatbot brand
 *     colour).
 *   - Narrate button is disabled while a stream is open OR when no
 *     vehicleId is available from the active-vehicle context.
 *   - Title attribute carries the long-form explanation so a user
 *     hovering for a tooltip understands the privacy contract —
 *     only the vehicle name may be narrated; lat/long, street
 *     addresses, place names, and charging-location identifiers
 *     remain tagged by the per-feature redaction policy. The
 *     narrator never changes the deterministic forecast — it only
 *     explains the drivers.
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
  const body = useMemo(
    () => ({
      vehicle_id: Number.isFinite(numericVehicleId) ? numericVehicleId : 0,
    }),
    [numericVehicleId],
  )
  const stream = useAiStream({
    url: '/ai/battery/health/narrate',
    body,
    onEvent: noopEvent,
    // AI-01: vehicle scope is part of stream identity — switching the
    // active vehicle aborts any in-flight narration and clears the
    // previous vehicle's narrative before the new scope streams in.
    scopeKey: Number.isFinite(numericVehicleId) && numericVehicleId > 0 ? numericVehicleId : null,
  })
  const haveInputs = Number.isFinite(numericVehicleId) && numericVehicleId > 0

  return (
    <AIFeatureCard
      title={t('battery.aiNarrative.title', 'Explain the battery health forecast')}
      description={t(
        'battery.aiNarrative.description',
        'Ask Helix to explain which charging habits and risk factors drive your deterministic battery-health forecast. The narrator never changes the forecast \u2014 it grounds every sentence in the same numbers the chart below renders.',
      )}
      buttonLabel={t('battery.aiNarrative.generateButton', 'Narrate forecast')}
      badgeLabel={t('battery.aiNarrative.badge', 'Helix')}
      canStart={haveInputs}
      stream={stream}
    />
  )
}
InnerSection.displayName = 'AIBatteryHealthForecastNarrativeInner'

/**
 * AIBatteryHealthForecastNarrative renders the LLM battery-health
 * forecast narrator section only when the
 * battery-health-forecast-narrative feature is enabled. The wrapping
 * div from {@link withAiFeature} carries
 * `data-testid="ai-feature-battery-health-forecast-narrative-root"`,
 * which the off-mode invariant test asserts against.
 */
export const AIBatteryHealthForecastNarrative = withAiFeature(
  'battery-health-forecast-narrative',
  InnerSection,
)
AIBatteryHealthForecastNarrative.displayName = 'AIBatteryHealthForecastNarrative'
