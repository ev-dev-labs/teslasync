// Speed-profile insights.
// Wires the Generate button to
// POST /api/v1/ai/drives/{driveID}/speed-profile/insights.

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { useAiStream } from '@/hooks/useAiStream'

interface InnerSectionProps {
  driveId?: string
}

function InnerSection({ driveId }: InnerSectionProps) {
  const { t } = useTranslation()
  const url = useMemo(
    () =>
      driveId
        ? `/ai/drives/${encodeURIComponent(driveId)}/speed-profile/insights`
        : '/ai/drives/0/speed-profile/insights',
    [driveId],
  )
  const body = useMemo(() => ({}), [])
  const stream = useAiStream({ url, body, onEvent: () => {} })
    return (
    <AIFeatureCard
      title={t('driveDetail.aiSpeedProfile.title', 'Speed-profile insights')}
      description={t(
                'driveDetail.aiSpeedProfile.description',
                'Get a short plain-language interpretation of this drive’s speed regime distribution — city / suburban / highway buckets, outliers, and how the speed envelope compares to a typical drive — generated from the same per-drive aggregates shown in the chart.',
              )}
      buttonLabel={t('driveDetail.aiSpeedProfile.generateButton', 'Generate insights')}
      badgeLabel={t('driveDetail.aiSpeedProfile.badge', 'Helix')}
      canStart={!!driveId}
      stream={stream}
    />
  )
}
InnerSection.displayName = 'AISpeedProfileInsightsInner'

export const AISpeedProfileInsights = withAiFeature('speed-profile-insights', InnerSection)
AISpeedProfileInsights.displayName = 'AISpeedProfileInsights'
