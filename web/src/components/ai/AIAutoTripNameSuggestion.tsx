// Auto trip-name suggestions.
// The Suggest button posts an empty body to /api/v1/ai/trips/{tripID}/name/draft.

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { useAiStream } from '@/hooks/useAiStream'

// The draft name is surfaced entirely through `stream.text` (rendered
// by AIFeatureCard's AiOutputPanel); there is no per-frame side effect
// to run. A module-level no-op keeps the onEvent identity stable so the
// stream parser is not re-subscribed on every re-render.
const NO_OP = (): void => {
  /* no per-frame side effect — the accumulated text is read from stream.text */
}

// normalizeTripId collapses every "no real trip" input — `undefined`,
// empty/whitespace-only, and the "0" placeholder — to an empty string,
// and trims surrounding whitespace off an otherwise valid id. Callers
// treat a non-empty result as "safe to fire a draft-name request for".
// Gating both the request URL and the button's enabled state on this
// single predicate keeps them from ever drifting apart (a request to
// /ai/trips/0/… can only fail deterministically).
export function normalizeTripId(tripId: string | undefined): string {
  const trimmed = tripId?.trim() ?? ''
  return trimmed === '0' ? '' : trimmed
}

interface InnerSectionProps {
  tripId?: string
}

function InnerSection({ tripId }: InnerSectionProps) {
  const { t } = useTranslation()
  // useParams() may hand us `undefined`, and a stray link can produce
  // "0" or a whitespace-only segment — none of which map to a persisted
  // trip. Normalise once and gate BOTH the request URL and the button's
  // enabled state on the same value.
  const canonicalTripId = normalizeTripId(tripId)
  const hasTrip = canonicalTripId.length > 0
  const url = useMemo(
    () =>
      hasTrip
        ? `/ai/trips/${encodeURIComponent(canonicalTripId)}/name/draft`
        : '/ai/trips/0/name/draft',
    [hasTrip, canonicalTripId],
  )
  const body = useMemo(() => ({}), [])
  const stream = useAiStream({ url, body, onEvent: NO_OP })
  return (
    <AIFeatureCard
      title={t('trips.detail.aiSuggestName.title', 'Suggest a trip name')}
      description={t(
        'trips.detail.aiSuggestName.description',
        'Get a short, propose-only name suggestion grounded in this trip\u2019s route context (start and end places, drive count, distance, time window). The suggestion is never saved automatically \u2014 review the proposed name in the panel and click Save to apply it.',
      )}
      buttonLabel={t('trips.detail.aiSuggestName.generateButton', 'Suggest a name')}
      badgeLabel={t('trips.detail.aiSuggestName.badge', 'Helix')}
      canStart={hasTrip}
      stream={stream}
    />
  )
}
InnerSection.displayName = 'AIAutoTripNameSuggestionInner'

export const AIAutoTripNameSuggestion = withAiFeature('auto-trip-naming', InnerSection)
AIAutoTripNameSuggestion.displayName = 'AIAutoTripNameSuggestion'
