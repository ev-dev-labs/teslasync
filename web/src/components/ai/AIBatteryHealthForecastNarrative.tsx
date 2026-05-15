// Phase-50 / 0027 — C2 Battery health forecast narrative.
// Phase-50 / W1 inline wiring (per slice prompt 0027) — wired the
// Narrate button to POST /api/v1/ai/battery/health/narrate via the
// canonical useAiStream hook. The previous slice landed the visual
// affordance only; this commit ships the end-to-end SSE wiring so
// the on-mode wiring test (TestBatteryHealthForecastNarrativeAIOnWiredCallsRoute)
// can prove the button actually opens an SSE stream against the
// registered backend route.
//
// AIBatteryHealthForecastNarrative is the visible AI surface for
// the Battery Health page. It is rendered conditionally via
// withAiFeature('battery-health-forecast-narrative', …) so:
//
//   - When ai_mode='off' it does not render at all (ADR-015 §I5 + §I6).
//   - When ai_mode is 'local'/'cloud' AND the
//     battery-health-forecast-narrative toggle is on, it renders an
//     opt-in section with a Narrate button that POSTs to
//     /api/v1/ai/battery/health/narrate. The SSE response stream
//     accumulates into the shared AiOutputPanel.
//
// The component does NOT replace the deterministic Capacity Trend
// & Prediction chart, hero metric cards, range trend chart, charge
// level distribution, insights panel, or recommendations panel
// rendered by BatteryHealthPage. That baseline content remains the
// canonical view visible to every user; this AI section is opt-in
// read-only narration layered alongside.
//
// Render contract (P11/P12 — Wired-or-absent, No-placeholder-buttons):
//   - useAiStream is called unconditionally at the top of the body
//     (Hooks-rules safe).
//   - The Narrate button's disabled prop is a COMPUTED expression
//     (`!canGenerate`), never a literal `disabled` or `disabled={true}`.
//   - Double-submit protection: stream.start() is a no-op while
//     state === 'streaming' (the hook coalesces; the button is also
//     visually disabled to mirror the state machine).
//   - The streamed text accumulates into AiOutputPanel which renders
//     the SSE delta stream as-it-arrives.
//
// ADR-015 alignment:
//   - I3 baseline intact: this component never replaces the
//     deterministic chart / hero cards / insights panel; it adds an
//     opt-in narrative section alongside.
//   - I5 hidden UI:       the withAiFeature HOC returns null when
//     the feature is not enabled, so the section is entirely absent
//     from the DOM in off mode.
//   - I6 404 routes:      the backend route is guard-wrapped and
//     returns 404 in off mode; useAiStream surfaces that as
//     state='error' for the user, but the component is never
//     rendered in off mode at all because of I5.

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { useAiStream } from '@/hooks/useAiStream'

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
 *
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
    onEvent: () => {},
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
