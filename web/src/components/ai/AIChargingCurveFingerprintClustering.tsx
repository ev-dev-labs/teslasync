// Charging-curve fingerprint clustering AI surface.
// The Explain button POSTs to /api/v1/ai/charging/curves/clusters/explain
// through useAiStream, and the wiring test verifies that it opens an
// SSE stream against the registered backend route.
//
// AIChargingCurveFingerprintClustering is the visible AI surface for
// the Charging Curves page. It is rendered conditionally via
// withAiFeature('charging-curve-fingerprint-clustering', …) so:
//
//   - When ai_mode='off' it does not render at all (ADR-015 §I5 + §I6).
//   - When ai_mode is 'local'/'cloud' AND the
//     charging-curve-fingerprint-clustering toggle is on, it renders
//     an opt-in section with an Explain button that POSTs to
//     /api/v1/ai/charging/curves/clusters/explain. The SSE response
//     stream accumulates into the shared AiOutputPanel.
//
// The component does NOT replace the deterministic charging curve
// charts, per-session labels, distribution panel, or any other
// content rendered by ChargingCurvePage. That baseline content
// remains the canonical view visible to every user; this AI section
// is opt-in read-only narration layered alongside.
//
// Render contract:
//   - useAiStream is called unconditionally at the top of the body
//     (Hooks-rules safe).
//   - The Explain button's disabled prop is a COMPUTED expression
//     (`!canGenerate`), never a literal `disabled` or `disabled={true}`.
//   - Double-submit protection: stream.start() is a no-op while
//     state === 'streaming' (the hook coalesces; the button is also
//     visually disabled to mirror the state machine).
//   - The streamed text accumulates into AiOutputPanel which renders
//     the SSE delta stream as-it-arrives.
//
// ADR-015 alignment:
//   - I3 baseline intact: this component never replaces the
//     deterministic charging curves; it adds an opt-in narrative
//     section alongside.
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
   * vehicleId surfaced by the parent ChargingCurvePage. Optional
   * because the active-vehicle context may be unresolved at first
   * paint; when absent we still render the section (the gate has
   * already passed) but the Explain button stays disabled because
   * the backend call needs a vehicle in scope.
   */
  vehicleId?: string | number
}

/**
 * InnerSection is the always-rendered body of the AI charging-curve
 * fingerprint cluster narrator card. The surrounding {@link withAiFeature}
 * HOC handles the visibility gate; this component only describes the
 * surface's appearance.
 *
 * Visual contract:
 *   - One GlassPanel sized to sit above the charging curve charts on
 *     ChargingCurvePage.
 *   - Cyan AI badge in the header (matches the chatbot brand colour).
 *   - Explain button is disabled while a stream is open OR when no
 *     vehicleId is available from the active-vehicle context.
 *   - Title attribute carries the long-form explanation so a user
 *     hovering for a tooltip understands the privacy contract — only
 *     the vehicle name may be narrated; lat/long, street addresses,
 *     place names, and charging-location identifiers remain tagged by
 *     the per-feature redaction policy. The narrator never changes the
 *     deterministic cluster bucketing — it only names and explains
 *     each cluster.
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
    url: '/ai/charging/curves/clusters/explain',
    body,
    onEvent: () => {},
    // AI-01: vehicle scope is part of stream identity — switching the
    // active vehicle aborts any in-flight explanation and clears the
    // previous vehicle's cluster narration before the new scope streams in.
    scopeKey: Number.isFinite(numericVehicleId) && numericVehicleId > 0 ? numericVehicleId : null,
  })
  const haveInputs = Number.isFinite(numericVehicleId) && numericVehicleId > 0
    return (
    <AIFeatureCard
      title={t(
                  'charging.aiClustering.title',
                  'Explain the charging-curve cluster fingerprints',
                )}
      description={t(
                'charging.aiClustering.description',
                'Ask Helix to name and explain each deterministic charging-curve cluster fingerprint. The narrator never changes the cluster bucketing \u2014 it grounds every sentence in the same per-cluster numbers the curves below render.',
              )}
      buttonLabel={t('charging.aiClustering.generateButton', 'Explain clusters')}
      badgeLabel={t('charging.aiClustering.badge', 'Helix')}
      emptyHint={t(
                'charging.aiClustering.emptyHint',
                'Select a vehicle to explain its charging-curve clusters.',
              )}
      canStart={haveInputs}
      stream={stream}
    />
  )
}
InnerSection.displayName = 'AIChargingCurveFingerprintClusteringInner'

/**
 * AIChargingCurveFingerprintClustering renders the LLM charging-curve
 * fingerprint cluster narrator section only when the
 * charging-curve-fingerprint-clustering feature is enabled. The
 * wrapping div from {@link withAiFeature} carries
 * `data-testid="ai-feature-charging-curve-fingerprint-clustering-root"`,
 * which the off-mode invariant test asserts against.
 */
export const AIChargingCurveFingerprintClustering = withAiFeature(
  'charging-curve-fingerprint-clustering',
  InnerSection,
)
AIChargingCurveFingerprintClustering.displayName =
  'AIChargingCurveFingerprintClustering'
