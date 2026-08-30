// Predictive maintenance.
// The "Predict maintenance" button POSTs to /api/v1/ai/maintenance/predict
// via useAiStream. Keep the visual affordance and SSE wiring together so
// the on-mode wiring test proves the button opens a stream against the
// registered backend route.
//
// AIPredictiveMaintenance is the visible AI surface for the
// MaintenancePage. It is rendered conditionally via
// withAiFeature('predictive-maintenance', …) so:
//
//   - When ai_mode='off' it does not render at all (ADR-015 §I5 + §I6).
//   - When ai_mode is 'local'/'cloud' AND the predictive-maintenance
//     toggle is on, it renders an opt-in section beneath the
//     summary metric cards inside the MaintenancePage. The button
//     POSTs `{vehicle_id}` to /api/v1/ai/maintenance/predict and
//     the SSE response stream accumulates into the shared
//     AiOutputPanel.
//
// The component does NOT replace the deterministic maintenance
// reminders, threshold-driven status badges, or upcoming items
// list. Those remain the canonical baseline: even when the AI
// narrator renders the envelope, the operator continues to use the
// deterministic /api/v1/maintenance surface above for actionable
// reminders. ADR-015 §I3 baseline intact.
//
// Render contract (P11/P12 — Wired-or-absent, No-placeholder-buttons):
//   - useAiStream is called unconditionally at the top of the body
//     (Hooks-rules safe).
//   - The "Predict maintenance" button's disabled prop is a COMPUTED
//     expression (`!canStart`), never a literal `disabled` or
//     `disabled={true}`.
//   - Double-submit protection: stream.start() is a no-op while
//     state === 'streaming' (the hook coalesces; the button is
//     also visually disabled to mirror the state machine).
//   - The streamed text accumulates into AiOutputPanel which
//     renders the SSE delta stream as-it-arrives.
//
// ADR-015 alignment:
//   - I3 baseline intact: this component never replaces the
//     deterministic maintenance reminders; it adds an opt-in
//     narrative section alongside.
//   - I5 hidden UI:       the withAiFeature HOC returns null when
//     the feature is not enabled, so the section is entirely
//     absent from the DOM in off mode.
//   - I6 404 routes:      the backend route is guard-wrapped and
//     returns 404 in off mode; useAiStream surfaces that as
//     state='error' for the user, but the component is never
//     rendered in off mode at all because of I5.
//   - I8 propose-only:    the AI surface NEVER mutates maintenance
//     items, service records, signal-pipeline entry points, or
//     reminder thresholds. The advisor is read-only narration over
//     the deterministic maintenance envelope.

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { useAiStream } from '@/hooks/useAiStream'

// Stable no-op SSE event handler. This surface accumulates the delta
// stream through useAiStream's built-in `text` accumulator and has no
// per-event side effect of its own, so a module-level constant keeps
// the callback identity stable across renders — an inline `() => {}`
// would allocate a fresh function every render and needlessly re-run
// the hook's onEvent ref-sync effect.
const noopStreamEvent = (): void => {}

interface InnerSectionProps {
  /**
   * vehicleId is the in-scope vehicle the prediction covers.
   * When the parent omits it OR the value is non-positive,
   * the "Predict maintenance" button stays disabled.
   * The parent MaintenancePage derives this from the page's
   * active vehicle selector (selectedVehicleId from useVehicleStore).
   */
  vehicleId?: number
}

/**
 * InnerSection is the always-rendered body of the AI predictive
 * maintenance card. The surrounding {@link withAiFeature} HOC
 * handles the visibility gate; this component only describes the
 * surface's appearance.
 *
 * Visual contract:
 *   - One AIFeatureCard sized to sit beneath the summary metric
 *     cards inside the MaintenancePage.
 *   - Cyan Helix badge in the header (matches the Helix brand
 *     colour).
 *   - A single "Predict maintenance" button that submits a POST
 *     to the registered backend route. The body carries the
 *     in-scope vehicle_id so the LLM cannot widen it.
 *   - "Predict maintenance" button is disabled while a stream is
 *     open OR when the parent has not yet supplied a valid
 *     vehicle.
 *   - Description carries the long-form privacy contract — the
 *     LLM never sees VINs, lat/long, place names, IPs, emails,
 *     phone numbers, MAC addresses, or IDs in plaintext; every
 *     PII class except the operator-chosen car name is
 *     round-tripped through PolicyDigest before the message
 *     reaches the provider.
 */
function InnerSection({ vehicleId }: InnerSectionProps) {
  const { t } = useTranslation()

  const haveScope =
    typeof vehicleId === 'number' &&
    Number.isFinite(vehicleId) &&
    vehicleId > 0

  // The backend reads vehicle_id from the body. useMemo keeps the
  // body reference stable so useAiStream's dependency-tracked
  // re-render path doesn't churn between renders that did not
  // change the scope. When the scope is unset we ship a
  // placeholder body that the button is disabled from posting.
  const body = useMemo(() => {
    if (!haveScope) {
      return { vehicle_id: 0 }
    }
    return {
      vehicle_id: vehicleId as number,
    }
  }, [haveScope, vehicleId])

  // The hook is called unconditionally so Hooks-rules pass even
  // when the parent has not yet supplied a scope. The URL is
  // the registered backend endpoint (the request() client that
  // useAiStream wraps prepends /api/v1).
  const stream = useAiStream({
    url: '/ai/maintenance/predict',
    body,
    onEvent: noopStreamEvent,
    // AI-01: vehicle scope is part of stream identity — switching
    // vehicles aborts an in-flight prediction and clears the
    // previous vehicle's narrative before the new scope streams in.
    scopeKey: haveScope ? vehicleId : null,
  })

  return (
    <AIFeatureCard
      title={t('maintenance.aiPredictive.title', 'Helix maintenance advisor')}
      description={t(
        'maintenance.aiPredictive.description',
        'Get a 3-6 sentence factual narrative of upcoming maintenance risks. The advisor reads only the deterministic maintenance envelope (per-vehicle scheduled items, recent service records, current mileage when available) — VINs, coordinates, place names, IPs, and personal identifiers are redacted before the message reaches the provider. The narrative is informational; the reminders, status badges, and upcoming items list above remain the canonical raw view.',
      )}
      buttonLabel={t('maintenance.aiPredictive.button', 'Predict maintenance')}
      badgeLabel={t('maintenance.aiPredictive.badge', 'Helix')}
      emptyHint={
        haveScope
          ? undefined
          : t(
              'maintenance.aiPredictive.emptyHint',
              'Select a vehicle first.',
            )
      }
      canStart={haveScope}
      stream={stream}
    />
  )
}
InnerSection.displayName = 'AIPredictiveMaintenanceInner'

/**
 * AIPredictiveMaintenance renders the LLM maintenance-advisor
 * section only when the predictive-maintenance feature is enabled.
 * The wrapping div from {@link withAiFeature} carries
 * `data-testid="ai-feature-predictive-maintenance-root"`, which the
 * off-mode invariant test asserts against.
 */
export const AIPredictiveMaintenance = withAiFeature(
  'predictive-maintenance',
  InnerSection,
)
AIPredictiveMaintenance.displayName = 'AIPredictiveMaintenance'
