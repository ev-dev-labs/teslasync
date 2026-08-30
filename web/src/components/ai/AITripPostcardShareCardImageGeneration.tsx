// Trip postcard/share-card image prompt drafter for /sharing/trips.
// The Generate share card button POSTs to
// /api/v1/ai/share-cards/trip-image/draft through useAiStream and
// streams output into the shared AIFeatureCard panel. This does not
// replace the /s/:token share-card surface or the per-drive Share flow;
// Helix drafts a prompt/preview only, and the existing Share workflow
// remains the publishing path. withAiFeature removes this section when
// the feature is off. The action's disabled state is computed from the
// selected trip and stream state, never from a hardcoded disabled prop.

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
 *     "Share" button to actually publish a share card.
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
    // AI-01: trip + style-hint scope is part of stream identity —
    // changing either aborts an in-flight draft and clears the
    // previous scope's postcard prompt before the new scope streams
    // in.
    scopeKey: numericTripId > 0 ? `${numericTripId}:${styleHint ?? ''}` : null,
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
