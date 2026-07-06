// Cost forecast narration.
// The Narrate button POSTs to /api/v1/ai/charging/costs/forecast/narrate
// via useAiStream. Keep the visual affordance and SSE wiring together so
// the on-mode wiring test proves the button opens a stream against the
// registered backend route.
//
// AICostForecastNarration is the visible AI surface for the
// Cost Analysis page. It is rendered conditionally via
// withAiFeature('cost-forecast-narration', …) so:
//
//   - When ai_mode='off' it does not render at all (ADR-015 §I5 + §I6).
//   - When ai_mode is 'local'/'cloud' AND the cost-forecast-narration
//     toggle is on, it renders an opt-in section with a Narrate
//     button that POSTs to /api/v1/ai/charging/costs/forecast/narrate.
//     The SSE response stream accumulates into the shared
//     AiOutputPanel.
//
// The component does NOT replace the deterministic cost-forecast
// chart, the charger-type breakdown, the savings calculator, the
// monthly cost table, the time-of-use analysis, the lifetime
// summary, the environmental impact card, or any other content
// rendered by CostAnalysisPage. That baseline content remains the
// canonical view visible to every user; this AI section is opt-in
// read-only narration layered alongside.
//
// Render contract (P11/P12 — Wired-or-absent, No-placeholder-buttons):
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
//     deterministic cost forecast chart; it adds an opt-in
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

// Stable no-op event sink. This narrator only renders the accumulated
// `delta.text` that useAiStream already exposes as `stream.text`, so it
// has no need for per-event callbacks. Hoisting the handler to module
// scope keeps its identity stable across renders so useAiStream's
// onEvent-tracking effect does not re-subscribe on every render.
const noopEvent = () => {}

interface InnerSectionProps {
  /**
   * vehicleId surfaced by the parent CostAnalysisPage. Optional
   * because the active-vehicle context may be unresolved at first
   * paint; when absent we still render the section (the gate has
   * already passed) but the Narrate button stays disabled because
   * the backend call needs a vehicle in scope.
   */
  vehicleId?: string | number
  /**
   * Months horizon to narrate. Optional; the backend defaults to 6
   * when omitted, matching the canonical
   * /api/v1/analytics/cost-forecast?months= default. Surfaced as a
   * prop so the parent page can keep AI + chart in sync if the user
   * later picks a different horizon.
   */
  months?: number
}

/**
 * InnerSection is the always-rendered body of the AI cost-forecast
 * narration card. The surrounding {@link withAiFeature} HOC handles
 * the visibility gate; this component only describes the surface's
 * appearance.
 *
 * Visual contract:
 *   - One GlassPanel sized to sit above the cost-forecast chart on
 *     CostAnalysisPage.
 *   - Cyan AI badge in the header (matches the chatbot brand
 *     colour).
 *   - Narrate button is disabled while a stream is open OR when no
 *     vehicleId is available from the active-vehicle context.
 *   - Title attribute carries the long-form explanation so a user
 *     hovering for a tooltip understands the privacy contract — only
 *     the vehicle name may be narrated; the dollar amounts are the
 *     same the chart shows. The narrator never changes the
 *     deterministic forecast — it only explains it.
 */
function InnerSection({ vehicleId, months }: InnerSectionProps) {
  const { t } = useTranslation()
  const numericVehicleId =
    typeof vehicleId === 'number' ? vehicleId : Number(vehicleId)
  // The handler-side parser validates vehicle_id > 0; we mirror
  // that here to keep the button disabled when the parent has not
  // yet resolved the active vehicle. The hook is called
  // unconditionally with the current body so the dependency graph
  // stays stable regardless of vehicleId resolution.
  const body = useMemo(() => {
    const out: { vehicle_id: number; months?: number } = {
      vehicle_id: Number.isFinite(numericVehicleId) ? numericVehicleId : 0,
    }
    if (typeof months === 'number' && Number.isFinite(months) && months > 0) {
      out.months = months
    }
    return out
  }, [numericVehicleId, months])
  const stream = useAiStream({
    url: '/ai/charging/costs/forecast/narrate',
    body,
    onEvent: noopEvent,
  })
  const haveInputs = Number.isFinite(numericVehicleId) && numericVehicleId > 0

  return (
    <AIFeatureCard
      title={t(
        'costAnalysis.aiNarrative.title',
        'Narrate the charging-cost forecast',
      )}
      description={t(
        'costAnalysis.aiNarrative.description',
        'Ask Helix to explain the deterministic charging-cost forecast \u2014 the historical trend, the projected cost / cost_low / cost_high band, the home-vs-supercharger split, and the deterministic insight. The dollar amounts are the same the chart below shows; the narrator only explains them and is honest that the band is an APPROXIMATE prediction interval, not a strict 95% confidence interval.',
      )}
      buttonLabel={t('costAnalysis.aiNarrative.generateButton', 'Narrate forecast')}
      badgeLabel={t('costAnalysis.aiNarrative.badge', 'Helix')}
      canStart={haveInputs}
      stream={stream}
    />
  )
}
InnerSection.displayName = 'AICostForecastNarrationInner'

/**
 * AICostForecastNarration renders the LLM cost-forecast narration
 * section only when the cost-forecast-narration feature is enabled.
 * The wrapping div from {@link withAiFeature} carries
 * `data-testid="ai-feature-cost-forecast-narration-root"`, which the
 * off-mode invariant test asserts against.
 */
export const AICostForecastNarration = withAiFeature(
  'cost-forecast-narration',
  InnerSection,
)
AICostForecastNarration.displayName = 'AICostForecastNarration'
