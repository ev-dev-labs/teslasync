// Per-session charging diagnosis wired to POST /ai/charging/{sessionID}/diagnose.
// Uses AIFeatureCard for consistent AI feature behavior and styling.

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { useAiStream } from '@/hooks/useAiStream'

interface InnerSectionProps {
  /** Optional until the charging detail route resolves; disables Generate when absent. */
  sessionId?: string
}

function InnerSection({ sessionId }: InnerSectionProps) {
  const { t } = useTranslation()
  const url = useMemo(
    () =>
      sessionId
        ? `/ai/charging/${encodeURIComponent(sessionId)}/diagnose`
        : '/ai/charging/0/diagnose',
    [sessionId],
  )
  const body = useMemo(() => ({}), [])
  const stream = useAiStream({ url, body, onEvent: () => {} })
  return (
    <AIFeatureCard
      title={t('charging.detail.aiDiagnosis.title', 'Charging diagnosis')}
      description={t(
        'charging.detail.aiDiagnosis.description',
        'Get a 2-4 paragraph plain-language explanation of any flags raised on this charging session — trickle, expensive, low-power, or interrupted — generated from the same deterministic aggregation metrics shown above.',
      )}
      buttonLabel={t(
        'charging.detail.aiDiagnosis.generateButton',
        'Generate diagnosis',
      )}
      badgeLabel={t('charging.detail.aiDiagnosis.badge', 'Helix')}
      canStart={!!sessionId}
      stream={stream}
    />
  )
}
InnerSection.displayName = 'AIChargingDiagnosisInner'

export const AIChargingDiagnosis = withAiFeature('charging-diagnosis', InnerSection)
AIChargingDiagnosis.displayName = 'AIChargingDiagnosis'
