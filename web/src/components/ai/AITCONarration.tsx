// TCO narration surface. Wires the "Explain ownership cost" button to
// POST /api/v1/ai/analytics/tco/narrate via the canonical
// useAiStream hook. Do not ship the visual affordance without
// end-to-end SSE wiring; the on-mode wiring test
// (TestTCONarrationAIOnWiredCallsRoute) can prove the button
// actually opens an SSE stream against the registered backend
// route.
//
// AITCONarration is the visible AI surface for the
// TrueCostPage (/tco and the alias /analytics/tco). It is rendered
// conditionally via withAiFeature('tco-narration', …) so:
//
//   - When ai_mode='off' it does not render at all (ADR-015 §I5 + §I6).
//   - When ai_mode is 'local'/'cloud' AND the tco-narration toggle
//     is on, it renders an opt-in section with an "Explain
//     ownership cost" button that POSTs to
//     /api/v1/ai/analytics/tco/narrate. The SSE response stream
//     accumulates into the shared AiOutputPanel inside
//     AIFeatureCard.
//
// The component does NOT replace the deterministic TCO charts
// (hero stat cards, cumulative-savings area chart, cost-per-km
// bar chart, monthly EV-vs-gas bar chart, savings-breakdown
// summary). Those baseline panels remain the canonical view for
// every user; this AI section is opt-in read-only narration
// layered alongside.
//
// Render contract: wired-or-absent, with no placeholder buttons.
//   - useAiStream is called unconditionally at the top of the body
//     (Hooks-rules safe).
//   - The button's disabled prop is a COMPUTED expression
//     (`!haveInputs || stream.state === 'streaming'` via the
//     `canStart` prop on AIFeatureCard), never a literal
//     `disabled` or `disabled={true}`.
//   - Double-submit protection: stream.start() is a no-op while
//     state === 'streaming' (the hook coalesces; the button is
//     also visually disabled to mirror the state machine).
//   - The streamed text accumulates into AiOutputPanel which
//     renders the SSE delta stream as-it-arrives.
//
// HX (Helix UX) contract:
//   - The surface renders through the shared AIFeatureCard
//     scaffold — NOT a bespoke GlassPanel + Button + AiOutputPanel
//     composition.
//   - The per-feature verb "Explain ownership cost" is passed
//     via `buttonLabel`. The card composes the accessible name
//     as "Ask Helix · Explain ownership cost".
//   - User-visible i18n keys say "Helix", not "AI" (per the HX
//     addendum).
//
// ADR-015 alignment:
//   - I3 baseline intact: this component never replaces the
//     deterministic TCO charts; it adds an opt-in narrative
//     section alongside.
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
   * vehicleId surfaced by the parent TrueCostPage. Optional
   * because the active-vehicle context may be unresolved at first
   * paint; when absent we still render the section (the gate has
   * already passed) but the action button stays disabled because
   * the backend call needs a vehicle in scope.
   *
   * Typed as `number | undefined` to match
   * `useSelectedVehicle().vehicleId` (which is `number | null`)
   * once the page has narrowed away the null.
   */
  vehicleId?: number
}

/**
 * InnerSection is the always-rendered body of the AI tco-narration
 * card. The surrounding {@link withAiFeature} HOC handles the
 * visibility gate; this component only describes the surface's
 * appearance.
 *
 * Visual contract:
 *   - One AIFeatureCard sized to sit above the TCO hero stat cards
 *     on TrueCostPage.
 *   - Helix brand badge in the header (matches the chatbot brand
 *     colour).
 *   - "Explain ownership cost" button is disabled while a stream
 *     is open OR when no vehicleId is available from the
 *     active-vehicle context.
 *   - Description carries the long-form explanation so a user
 *     reading the panel hint understands the privacy contract +
 *     the four limiting assumptions inherited from the
 *     deterministic helper. The narrator never changes the
 *     deterministic figures — it only explains them.
 */
function InnerSection({ vehicleId }: InnerSectionProps) {
  const { t } = useTranslation()
  // The handler-side parser validates vehicle_id > 0; we mirror
  // that here to keep the button disabled when the parent has not
  // yet resolved the active vehicle. The hook is called
  // unconditionally with the current body so the dependency graph
  // stays stable regardless of vehicleId resolution.
  const numericVehicleId =
    typeof vehicleId === 'number' && Number.isFinite(vehicleId) ? vehicleId : 0
  const body = useMemo(
    () => ({ vehicle_id: numericVehicleId }),
    [numericVehicleId],
  )
  const stream = useAiStream({
    url: '/ai/analytics/tco/narrate',
    body,
    onEvent: noop,
  })
  const haveInputs = numericVehicleId > 0
  return (
    <AIFeatureCard
      title={t(
        'tco.aiNarration.title',
        'Explain my total cost of ownership',
      )}
      description={t(
        'tco.aiNarration.description',
        'Ask Helix to walk through the deterministic operating-cost figures shown below — the EV charging spend, the equivalent gas cost, the cumulative savings, and the cost-per-kilometre comparison. The narrator quotes the same numbers the chart shows and is honest about the four limiting assumptions: operating cost only (no depreciation, resale, insurance, registration, or financing); a flat $50/month maintenance heuristic; equivalent gas cost estimated from charged energy not real-world distance; and gas-price / efficiency / electricity-rate defaults from your editable Settings.',
      )}
      buttonLabel={t(
        'tco.aiNarration.button',
        'Explain ownership cost',
      )}
      badgeLabel={t('tco.aiNarration.badge', 'Helix')}
      emptyHint={
        haveInputs
          ? undefined
          : t(
              'tco.aiNarration.noVehicleHint',
              'Pick a vehicle above to enable Helix.',
            )
      }
      canStart={haveInputs}
      stream={stream}
    />
  )
}
InnerSection.displayName = 'AITCONarrationInner'

/**
 * AITCONarration renders the LLM TCO narration section only when
 * the tco-narration feature is enabled. The wrapping div from
 * {@link withAiFeature} carries
 * `data-testid="ai-feature-tco-narration-root"`, which the off-mode
 * invariant test asserts against.
 */
export const AITCONarration = withAiFeature('tco-narration', InnerSection)
AITCONarration.displayName = 'AITCONarration'
