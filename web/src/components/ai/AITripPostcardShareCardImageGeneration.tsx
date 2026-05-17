// Phase-50 / 0060 — GEN1 trip postcard and share-card image generation.
// Phase-50 / W1 inline wiring (per slice prompt 0060) — wired the
// "Generate share card" button to
// POST /api/v1/ai/share-cards/trip-image/draft via the canonical
// useAiStream hook. The slice methodology forbids shipping the
// visual affordance without end-to-end SSE wiring; this component
// lands both in one commit so the on-mode wiring test
// (TestTripPostcardShareCardImageGenerationAIOnWiredCallsRoute) can
// prove the button actually opens an SSE stream against the
// registered backend route.
//
// AITripPostcardShareCardImageGeneration is the visible AI surface
// for the SharingTripsPage (/sharing/trips). It is rendered
// conditionally via withAiFeature('trip-postcard-share-card-image-generation', …) so:
//
//   - When ai_mode='off' it does not render at all (ADR-015 §I5 + §I6).
//   - When ai_mode is 'local'/'cloud' AND the
//     trip-postcard-share-card-image-generation toggle is on, it
//     renders an opt-in section with a "Generate share card" button
//     that POSTs to /api/v1/ai/share-cards/trip-image/draft. The
//     SSE response stream accumulates into the shared
//     AiOutputPanel inside AIFeatureCard.
//
// The component does NOT replace the deterministic static
// share-card surface served at /s/:token (the canonical SharedDrivePage)
// or the per-drive "Share" button workflow. Those baseline
// surfaces remain the canonical way to share trips with anyone;
// this AI section is opt-in propose-only image-prompt drafting
// layered alongside.
//
// Render contract (P11/P12 — Wired-or-absent, No-placeholder-buttons):
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
//   - The per-feature verb "Generate share card" is passed via
//     `buttonLabel`. The card composes the accessible name as
//     "Ask Helix · Generate share card".
//   - User-visible i18n keys say "Helix", not "AI" (per the HX
//     addendum).
//
// ADR-015 alignment:
//   - I3 baseline intact: this component never replaces the
//     deterministic /s/:token static share-card surface; it adds
//     an opt-in propose-only draft section alongside.
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
   * tripId surfaced by the parent SharingTripsPage (the user's
   * currently selected trip from the recent-trips list).
   * Optional because the page may render before the user has
   * picked a trip; when absent we still render the section (the
   * gate has already passed) but the action button stays disabled
   * because the backend call needs a trip in scope.
   */
  tripId?: number

  /**
   * Optional free-form style hint the user can pass to Helix
   * (e.g. "vintage", "minimal"). The handler caps this at 80
   * characters and rejects control chars + lat/long-looking
   * substrings. Defaults to undefined; the strategy then asks the
   * model to derive a stylistic stance from the trip's own
   * context.
   */
  styleHint?: string
}

/**
 * InnerSection is the always-rendered body of the AI
 * trip-postcard-share-card-image-generation card. The surrounding
 * {@link withAiFeature} HOC handles the visibility gate; this
 * component only describes the surface's appearance.
 *
 * Visual contract:
 *   - One AIFeatureCard sized to sit beneath the deterministic
 *     recent-trips list on SharingTripsPage.
 *   - Helix brand badge in the header.
 *   - "Generate share card" button is disabled while a stream is
 *     open OR when no tripId is available from the parent page.
 *   - Description carries the long-form explanation so a user
 *     reading the panel hint understands the privacy contract +
 *     the propose-only guarantee: Helix drafts an image prompt
 *     and a preview spec, but the user has to click the existing
 *     baseline "Share" button to actually publish a share card.
 */
function InnerSection({ tripId, styleHint }: InnerSectionProps) {
  const { t } = useTranslation()
  // The handler-side parser validates trip_id > 0; we mirror that
  // here to keep the button disabled when the parent has not yet
  // resolved a trip selection. The hook is called unconditionally
  // with the current body so the dependency graph stays stable
  // regardless of tripId resolution.
  const numericTripId =
    typeof tripId === 'number' && Number.isFinite(tripId) ? tripId : 0
  const body = useMemo(() => {
    const payload: { trip_id: number; style_hint?: string } = {
      trip_id: numericTripId,
    }
    if (typeof styleHint === 'string' && styleHint.trim() !== '') {
      payload.style_hint = styleHint.trim()
    }
    return payload
  }, [numericTripId, styleHint])
  const stream = useAiStream({
    url: '/ai/share-cards/trip-image/draft',
    body,
    onEvent: () => {},
  })
  const haveInputs = numericTripId > 0
  return (
    <AIFeatureCard
      title={t(
        'sharing.aiTripPostcard.title',
        'Draft a Helix share-card image',
      )}
      description={t(
        'sharing.aiTripPostcard.description',
        'Ask Helix to draft a propose-only image prompt and preview spec for the selected trip\u2019s share card. Helix only sees the redacted trip context (distance, duration, drive count, vehicle name) \u2014 never raw coordinates or street addresses. The draft is never published automatically; review it here, then use the existing Share button on the trip to publish a static share card.',
      )}
      buttonLabel={t(
        'sharing.aiTripPostcard.button',
        'Generate share card',
      )}
      badgeLabel={t('sharing.aiTripPostcard.badge', 'Helix')}
      emptyHint={
        haveInputs
          ? undefined
          : t(
              'sharing.aiTripPostcard.noTripHint',
              'Pick a trip from the list above to enable Helix.',
            )
      }
      canStart={haveInputs}
      stream={stream}
    />
  )
}
InnerSection.displayName = 'AITripPostcardShareCardImageGenerationInner'

/**
 * AITripPostcardShareCardImageGeneration renders the LLM
 * share-card-image-prompt drafting section only when the
 * trip-postcard-share-card-image-generation feature is enabled.
 * The wrapping div from {@link withAiFeature} carries
 * `data-testid="ai-feature-trip-postcard-share-card-image-generation-root"`,
 * which the off-mode invariant test asserts against.
 */
export const AITripPostcardShareCardImageGeneration = withAiFeature(
  'trip-postcard-share-card-image-generation',
  InnerSection,
)
AITripPostcardShareCardImageGeneration.displayName =
  'AITripPostcardShareCardImageGeneration'
