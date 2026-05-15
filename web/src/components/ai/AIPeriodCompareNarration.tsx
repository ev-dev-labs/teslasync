// Phase-50 / 0040 — X1 Period compare narration.
// Phase-50 / W1 inline wiring (per slice prompt 0040) — wired the
// Narrate button to POST /api/v1/ai/analytics/period-compare/narrate
// via the canonical useAiStream hook. The slice methodology forbids
// shipping the visual affordance without end-to-end SSE wiring; this
// component lands both in one commit so the on-mode wiring test
// (TestPeriodCompareNarrationAIOnWiredCallsRoute) can prove the
// button actually opens an SSE stream against the registered
// backend route.
//
// AIPeriodCompareNarration is the visible AI surface for the
// Period Compare page. It is rendered conditionally via
// withAiFeature('period-compare-narration', …) so:
//
//   - When ai_mode='off' it does not render at all (ADR-015 §I5 + §I6).
//   - When ai_mode is 'local'/'cloud' AND the period-compare-narration
//     toggle is on, it renders an opt-in section with a Narrate
//     button that POSTs to /api/v1/ai/analytics/period-compare/narrate.
//     The SSE response stream accumulates into the shared
//     AiOutputPanel.
//
// The component does NOT replace the deterministic period-compare
// chart, the side-by-side BarChart, the comparison DataTable, the
// six MetricCards, the deterministic insights panel, or any other
// content rendered by PeriodComparePage. That baseline content
// remains the canonical view visible to every user; this AI
// section is opt-in read-only narration layered alongside.
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
//     deterministic period-compare chart; it adds an opt-in
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

interface InnerSectionProps {
  /**
   * vehicleId surfaced by the parent PeriodComparePage. Optional
   * because the active-vehicle context may be unresolved at first
   * paint; when absent we still render the section (the gate has
   * already passed) but the Narrate button stays disabled because
   * the backend call needs a vehicle in scope.
   */
  vehicleId?: string | number
  /**
   * Trailing-day window for Period A. Optional; the backend
   * defaults to 30 when omitted, matching the SPA selector
   * default. Surfaced as a prop so the parent page can keep AI +
   * chart in sync if the user picks a different window. The SPA
   * selector accepts 0 = "all time"; the backend treats days <= 0
   * as "no date filter" so the component passes 0 through as-is.
   */
  daysA?: number
  /**
   * Trailing-day window for Period B. Optional; the backend
   * defaults to 90 when omitted, matching the SPA selector
   * default.
   */
  daysB?: number
}

/**
 * InnerSection is the always-rendered body of the AI period-compare
 * narration card. The surrounding {@link withAiFeature} HOC handles
 * the visibility gate; this component only describes the surface's
 * appearance.
 *
 * Visual contract:
 *   - One GlassPanel sized to sit above the per-period MetricCards
 *     on PeriodComparePage.
 *   - Cyan AI badge in the header (matches the chatbot brand
 *     colour).
 *   - Narrate button is disabled while a stream is open OR when no
 *     vehicleId is available from the active-vehicle context.
 *   - Title attribute carries the long-form explanation so a user
 *     hovering for a tooltip understands the privacy contract — only
 *     the vehicle name may be narrated; the aggregate analytics are
 *     the same the chart shows. The narrator never changes the
 *     deterministic deltas — it only explains them.
 */
function InnerSection({ vehicleId, daysA, daysB }: InnerSectionProps) {
  const { t } = useTranslation()
  const numericVehicleId =
    typeof vehicleId === 'number' ? vehicleId : Number(vehicleId)
  // The handler-side parser validates vehicle_id > 0; we mirror
  // that here to keep the button disabled when the parent has not
  // yet resolved the active vehicle. The hook is called
  // unconditionally with the current body so the dependency graph
  // stays stable regardless of vehicleId resolution.
  const body = useMemo(() => {
    const out: { vehicle_id: number; days_a?: number; days_b?: number } = {
      vehicle_id: Number.isFinite(numericVehicleId) ? numericVehicleId : 0,
    }
    // 0 is a valid value (means "all time") — only omit when the
    // caller did not supply the prop at all.
    if (typeof daysA === 'number' && Number.isFinite(daysA) && daysA >= 0) {
      out.days_a = daysA
    }
    if (typeof daysB === 'number' && Number.isFinite(daysB) && daysB >= 0) {
      out.days_b = daysB
    }
    return out
  }, [numericVehicleId, daysA, daysB])
  const stream = useAiStream({
    url: '/ai/analytics/period-compare/narrate',
    body,
    onEvent: () => {},
  })
  const haveInputs = Number.isFinite(numericVehicleId) && numericVehicleId > 0
    return (
    <AIFeatureCard
      title={t(
                  'compare.aiNarrative.title',
                  'Narrate the period comparison',
                )}
      description={t(
                'compare.aiNarrative.description',
                'Ask Helix to explain the deterministic period-over-period analytics \u2014 which one or two metrics moved most between Period A and Period B, with directional phrasing keyed to the percent_change sign. The numbers are the same the chart and table below show; the narrator only explains them and is honest about zero-baseline windows and best-effort cost figures.',
              )}
      buttonLabel={t('compare.aiNarrative.generateButton', 'Narrate comparison')}
      badgeLabel={t('compare.aiNarrative.badge', 'Helix')}
      canStart={haveInputs}
      stream={stream}
    />
  )
}
InnerSection.displayName = 'AIPeriodCompareNarrationInner'

/**
 * AIPeriodCompareNarration renders the LLM period-compare narration
 * section only when the period-compare-narration feature is enabled.
 * The wrapping div from {@link withAiFeature} carries
 * `data-testid="ai-feature-period-compare-narration-root"`, which the
 * off-mode invariant test asserts against.
 */
export const AIPeriodCompareNarration = withAiFeature(
  'period-compare-narration',
  InnerSection,
)
AIPeriodCompareNarration.displayName = 'AIPeriodCompareNarration'
