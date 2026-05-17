// Phase-50 / 0019 — N5 Per-charging-session diagnosis.
// Phase-50 / W1 (slice 0065) — wired the Generate button to
// POST /api/v1/ai/charging/{sessionID}/diagnose (empty body).
// Phase-50 / refactor — switched to AIFeatureCard scaffold for
// visual + behavioural consistency across all AI features.

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { useAiStream } from '@/hooks/useAiStream'

interface InnerSectionProps {
  /**
   * sessionId surfaced by the parent ChargingDetailPage. Optional
   * because the charging detail route's `useParams<{id}>()` returns
   * `string | undefined`; when absent we still render the section
   * (the gate has already passed) but the Generate button stays
   * disabled.
   */
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
