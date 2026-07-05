// Vampire-drain explanation.
// The Narrate button posts to /api/v1/ai/charging/vampire-drain/explain
// via useAiStream, so the visible AI affordance and SSE wiring stay in sync.
//
// AIVampireDrainExplanation is the visible AI surface for the
// VampireDrainPage. It is rendered conditionally via
// withAiFeature('vampire-drain-explanation', …) so:
//
//   - When ai_mode='off' it does not render at all (ADR-015 §I5 + §I6).
//   - When ai_mode is 'local'/'cloud' AND the
//     vampire-drain-explanation toggle is on, it renders an opt-in
//     section with a Narrate button that POSTs to
//     /api/v1/ai/charging/vampire-drain/explain. The SSE response
//     stream accumulates into the shared AiOutputPanel.
//
// The component does NOT replace the deterministic vampire-drain
// stats card, the per-event timeline, the typical-vs-worst cards,
// or any other content rendered by VampireDrainPage. That baseline
// content remains the canonical view visible to every user; this AI
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
//     deterministic vampire-drain stats; it adds an opt-in
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
   * vehicleId surfaced by the parent VampireDrainPage. Optional
   * because the active-vehicle context may be unresolved at first
   * paint; when absent we still render the section (the gate has
   * already passed) but the Narrate button stays disabled because
   * the backend call needs a vehicle in scope.
   */
  vehicleId?: string | number
  /**
   * Lookback days horizon to narrate. Optional; the backend
   * defaults to 30 when omitted, matching the canonical
   * /api/v1/vampire-drain default. Surfaced as a prop so the
   * parent page can keep AI + chart in sync if the user later
   * picks a different window.
   */
  lookbackDays?: number
}

/**
 * InnerSection is the always-rendered body of the AI vampire-drain
 * explanation card. The surrounding {@link withAiFeature} HOC
 * handles the visibility gate; this component only describes the
 * surface's appearance.
 *
 * Visual contract:
 *   - One GlassPanel sized to sit above the deterministic
 *     vampire-drain stats card on VampireDrainPage.
 *   - Cyan AI badge in the header (matches the chatbot brand
 *     colour).
 *   - Narrate button is disabled while a stream is open OR when no
 *     vehicleId is available from the active-vehicle context.
 *   - Title attribute carries the long-form explanation so a user
 *     hovering for a tooltip understands the privacy contract — only
 *     the vehicle name may be narrated; the percentages and
 *     timestamps are the same the page below shows. The narrator
 *     never changes the deterministic stats — it only explains them
 *     and surfaces the inference's correlational nature honestly.
 */
function InnerSection({ vehicleId, lookbackDays }: InnerSectionProps) {
  const { t } = useTranslation()
  const numericVehicleId =
    typeof vehicleId === 'number' ? vehicleId : Number(vehicleId)
  // The handler-side parser validates vehicle_id > 0; we mirror
  // that here to keep the button disabled when the parent has not
  // yet resolved the active vehicle. The hook is called
  // unconditionally with the current body so the dependency graph
  // stays stable regardless of vehicleId resolution.
  const body = useMemo(() => {
    const out: { vehicle_id: number; lookback_days?: number } = {
      vehicle_id: Number.isFinite(numericVehicleId) ? numericVehicleId : 0,
    }
    if (
      typeof lookbackDays === 'number' &&
      Number.isFinite(lookbackDays) &&
      lookbackDays > 0
    ) {
      out.lookback_days = lookbackDays
    }
    return out
  }, [numericVehicleId, lookbackDays])
  const stream = useAiStream({
    url: '/ai/charging/vampire-drain/explain',
    body,
    onEvent: noop,
  })
  const haveInputs = Number.isFinite(numericVehicleId) && numericVehicleId > 0
  return (
    <AIFeatureCard
      title={t(
        'vampireDrain.aiNarrative.title',
        'Explain the recent vampire drain',
      )}
      description={t(
        'vampireDrain.aiNarrative.description',
        'Ask Helix to explain the deterministic vampire-drain signal \u2014 the recent average / worst idle-drain rate, the most-correlated per-event driver (Sentry, climate, long park), and whether the recent rate is in line with the typical fleet. The numbers are the same the cards below show; the narrator only explains them and surfaces the inference\u2019s correlational nature honestly.',
      )}
      buttonLabel={t('vampireDrain.aiNarrative.generateButton', 'Narrate drain')}
      badgeLabel={t('vampireDrain.aiNarrative.badge', 'Helix')}
      emptyHint={
        haveInputs
          ? undefined
          : t(
              'vampireDrain.aiNarrative.noVehicleHint',
              'Pick a vehicle above to enable Helix.',
            )
      }
      canStart={haveInputs}
      stream={stream}
    />
  )
}
InnerSection.displayName = 'AIVampireDrainExplanationInner'

/**
 * AIVampireDrainExplanation renders the LLM vampire-drain
 * narration section only when the vampire-drain-explanation
 * feature is enabled. The wrapping div from {@link withAiFeature}
 * carries `data-testid="ai-feature-vampire-drain-explanation-root"`,
 * which the off-mode invariant test asserts against.
 */
export const AIVampireDrainExplanation = withAiFeature(
  'vampire-drain-explanation',
  InnerSection,
)
AIVampireDrainExplanation.displayName = 'AIVampireDrainExplanation'
