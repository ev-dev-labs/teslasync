// Phase-50 / 0024 — D4 Auto trip naming.
// Phase-50 / W1 (slice 0065) — wired the Suggest button to
// POST /api/v1/ai/trips/{tripID}/name/draft (empty body).

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { useAiStream } from '@/hooks/useAiStream'

interface InnerSectionProps {
  tripId?: string
}

function InnerSection({ tripId }: InnerSectionProps) {
  const { t } = useTranslation()
  const url = useMemo(
    () =>
      tripId
        ? `/ai/trips/${encodeURIComponent(tripId)}/name/draft`
        : '/ai/trips/0/name/draft',
    [tripId],
  )
  const body = useMemo(() => ({}), [])
  const stream = useAiStream({ url, body, onEvent: () => {} })
    return (
    <AIFeatureCard
      title={t('trips.detail.aiSuggestName.title', 'Suggest a trip name')}
      description={t(
                'trips.detail.aiSuggestName.description',
                'Get a short, propose-only name suggestion grounded in this trip\u2019s route context (start and end places, drive count, distance, time window). The suggestion is never saved automatically \u2014 review the proposed name in the panel and click Save to apply it.',
              )}
      buttonLabel={t('trips.detail.aiSuggestName.generateButton', 'Suggest a name')}
      badgeLabel={t('trips.detail.aiSuggestName.badge', 'Helix')}
      canStart={!!tripId}
      stream={stream}
    />
  )
}
InnerSection.displayName = 'AIAutoTripNameSuggestionInner'

export const AIAutoTripNameSuggestion = withAiFeature('auto-trip-naming', InnerSection)
AIAutoTripNameSuggestion.displayName = 'AIAutoTripNameSuggestion'
