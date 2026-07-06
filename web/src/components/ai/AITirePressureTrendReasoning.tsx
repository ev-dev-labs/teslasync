// Tire-pressure trend reasoning.
// The Narrate button POSTs to /api/v1/ai/tire-pressure/trends/explain
// via the canonical useAiStream hook. The on-mode wiring test proves
// the button opens an SSE stream against the registered backend route.
//
// AITirePressureTrendReasoning is the visible AI surface for the
// Tire Pressure vehicle-systems page. It is rendered conditionally
// via withAiFeature('tire-pressure-trend-reasoning', …) so:
//
//   - When ai_mode='off' it does not render at all (ADR-015 §I5 + §I6).
//   - When ai_mode is 'local'/'cloud' AND the
//     tire-pressure-trend-reasoning toggle is on, it renders an
//     opt-in section with a Narrate button that POSTs to
//     /api/v1/ai/tire-pressure/trends/explain. The SSE response
//     stream accumulates into the shared AiOutputPanel.
//
// The component does NOT replace the deterministic four-corner
// radial gauges, the warning banner, the summary metric cards,
// the pressure history chart, or the history table rendered by
// TirePressurePage. That baseline content remains the canonical
// view visible to every user; this AI section is opt-in read-only
// narration layered alongside.
//
// Render contract:
//   - useAiStream is called unconditionally at the top of the body
//     (Hooks-rules safe).
//   - The Narrate button's disabled prop is a COMPUTED expression
//     (`!canGenerate`), never a literal `disabled` or
//     `disabled={true}`.
//   - Double-submit protection: stream.start() is a no-op while
//     state === 'streaming' (the hook coalesces; the button is
//     also visually disabled to mirror the state machine).
//   - The streamed text accumulates into AiOutputPanel which
//     renders the SSE delta stream as-it-arrives.
//
// ADR-015 alignment:
//   - I3 baseline intact: this component never replaces the
//     deterministic tire-pressure gauges, warning banner, summary
//     cards, history chart, or history table; it adds an opt-in
//     narrative section alongside.
//   - I5 hidden UI:       the withAiFeature HOC returns null when
//     the feature is not enabled, so the section is entirely
//     absent from the DOM in off mode.
//   - I6 404 routes:      the backend route is guard-wrapped and
//     returns 404 in off mode; useAiStream surfaces that as
//     state='error' for the user, but the component is never
//     rendered in off mode at all because of I5.

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { useAiStream } from '@/hooks/useAiStream'

// This feature renders its narrative purely through useAiStream's
// built-in delta-text accumulator (surfaced by AiOutputPanel), so it
// has no per-event work to do. A module-level no-op keeps the onEvent
// callback identity stable across renders instead of allocating a
// fresh closure in the render path (which would re-run useAiStream's
// onEvent-ref effect on every render).
const noop = (): void => {}

interface InnerSectionProps {
  /**
   * vehicleId surfaced by the parent TirePressurePage. Optional
   * because the active-vehicle context may be unresolved at
   * first paint; when absent we still render the section (the
   * gate has already passed) but the Narrate button stays
   * disabled because the backend call needs a vehicle in
   * scope.
   */
  vehicleId?: string | number
}

/**
 * InnerSection is the always-rendered body of the AI
 * tire-pressure trend reasoning card. The surrounding
 * {@link withAiFeature} HOC handles the visibility gate; this
 * component only describes the surface's appearance.
 *
 * Visual contract:
 *   - One GlassPanel sized to sit above the four-corner radial
 *     gauges on TirePressurePage.
 *   - Cyan AI badge in the header (matches the chatbot brand
 *     colour).
 *   - Narrate button is disabled while a stream is open OR when
 *     no vehicleId is available from the active-vehicle
 *     context. When it is disabled for want of a vehicle, an
 *     empty-state hint tells the user how to enable it rather
 *     than leaving them to guess why the button is inert.
 *   - Title attribute carries the long-form explanation so a
 *     user hovering for a tooltip understands the privacy
 *     contract — only the vehicle name may be narrated; the
 *     per-corner pressures + thresholds are the same the gauges
 *     show. The narrator never changes the deterministic
 *     thresholds — it only explains them.
 */
function InnerSection({ vehicleId }: InnerSectionProps) {
  const { t } = useTranslation()
  const numericVehicleId =
    typeof vehicleId === 'number' ? vehicleId : Number(vehicleId)
  // The handler-side parser validates vehicle_id > 0; we
  // mirror that here to keep the button disabled when the
  // parent has not yet resolved the active vehicle. The hook
  // is called unconditionally with the current body so the
  // dependency graph stays stable regardless of vehicleId
  // resolution.
  const body = useMemo(() => {
    const out: { vehicle_id: number } = {
      vehicle_id: Number.isFinite(numericVehicleId) ? numericVehicleId : 0,
    }
    return out
  }, [numericVehicleId])
  const stream = useAiStream({
    url: '/ai/tire-pressure/trends/explain',
    body,
    onEvent: noop,
  })
  const haveInputs = Number.isFinite(numericVehicleId) && numericVehicleId > 0
  return (
    <AIFeatureCard
      title={t(
        'tirePressure.aiTrendReasoning.title',
        'Narrate the 30-day tire-pressure trend',
      )}
      description={t(
        'tirePressure.aiTrendReasoning.description',
        'Ask Helix to explain the recent 30-day trend in this vehicle\u2019s four corner tire pressures \u2014 which tires are trending up, down, or stable, the most likely deterministic driver of any deviation (cold-weather correlation, all-tires-trending suggesting weather rather than puncture, single-corner slow-leak signature), and any actionable threshold crossing. The per-corner pressures and thresholds are the same the gauges below show; the narrator only explains them and is honest that the slope is a descriptive linear extrapolation, not a forecast.',
      )}
      buttonLabel={t('tirePressure.aiTrendReasoning.generateButton', 'Narrate trend')}
      badgeLabel={t('tirePressure.aiTrendReasoning.badge', 'Helix')}
      emptyHint={
        haveInputs
          ? undefined
          : t(
              'tirePressure.aiTrendReasoning.noVehicleHint',
              'Pick a vehicle above to enable Helix.',
            )
      }
      canStart={haveInputs}
      stream={stream}
    />
  )
}
InnerSection.displayName = 'AITirePressureTrendReasoningInner'

/**
 * AITirePressureTrendReasoning renders the LLM tire-pressure
 * trend reasoning section only when the
 * tire-pressure-trend-reasoning feature is enabled. The
 * wrapping div from {@link withAiFeature} carries
 * `data-testid="ai-feature-tire-pressure-trend-reasoning-root"`,
 * which the off-mode invariant test asserts against.
 */
export const AITirePressureTrendReasoning = withAiFeature(
  'tire-pressure-trend-reasoning',
  InnerSection,
)
AITirePressureTrendReasoning.displayName = 'AITirePressureTrendReasoning'
