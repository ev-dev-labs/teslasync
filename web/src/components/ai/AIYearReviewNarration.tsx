// Year-in-review narration wired to POST /ai/analytics/year-in-review/narrate.

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
  // Default to the previous calendar year; most reviews happen after year end.
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
