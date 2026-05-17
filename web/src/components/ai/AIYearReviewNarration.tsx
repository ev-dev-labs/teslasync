// Phase-50 / 0013 — U3 Year-in-review narration.
// Phase-50 / W1 (slice 0065) — wired the Generate button to
// POST /api/v1/ai/analytics/year-in-review/narrate.

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { useAiStream } from '@/hooks/useAiStream'

interface InnerSectionProps {
  vehicleId?: number
}

function InnerSection({ vehicleId }: InnerSectionProps) {
  const { t } = useTranslation()
  // Default to the previous calendar year — the year-in-review page is
  // typically reviewed in January for the year that just ended. If the
  // user is browsing it during the active year, they can re-fire the
  // request after picking a year filter in a future iteration.
  const defaultYear = new Date().getFullYear() - 1
  const body = useMemo(
    () => ({ vehicle_id: vehicleId ?? 0, year: defaultYear }),
    [vehicleId, defaultYear],
  )
  const stream = useAiStream({
    url: '/ai/analytics/year-in-review/narrate',
    body,
    onEvent: () => {},
  })
    return (
    <AIFeatureCard
      title={t('yearReview.aiNarration.title', 'Helix narration')}
      description={t(
                'yearReview.aiNarration.description',
                'Get a short, Helix-written recap of your year from the slide data above.',
              )}
      buttonLabel={t('yearReview.aiNarration.generateButton', 'Generate narration')}
      badgeLabel={t('yearReview.aiNarration.badge', 'Helix')}
      canStart={vehicleId != null}
      stream={stream}
    />
  )
}
InnerSection.displayName = 'AIYearReviewNarrationInner'

export const AIYearReviewNarration = withAiFeature('yir-narration', InnerSection)
AIYearReviewNarration.displayName = 'AIYearReviewNarration'
