// Per-session charging diagnosis wired to POST /ai/charging/{sessionID}/diagnose.
// Uses AIFeatureCard for consistent AI feature behavior and styling.

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { useAiStream } from '@/hooks/useAiStream'

interface InnerSectionProps {
  /**
   * Charging session id from the detail route (`useParams` → string).
   * Optional until the route resolves; the Generate button stays
   * disabled unless it is a positive integer id (see
   * {@link normalizeSessionId}).
   */
  sessionId?: string
}

// The stream's onEvent argument is required, but this feature renders
// its narrative purely through useAiStream's built-in delta-text
// accumulator (surfaced by AiOutputPanel), so it has no per-event work
// to do. A module-level no-op keeps the callback identity stable across
// renders instead of allocating a fresh closure in the render path.
const noop = (): void => {}

/**
 * normalizeSessionId mirrors the backend contract in
 * internal/api/aichargdiag/handler.go (`parseChargingDiagnosisURL`),
 * which accepts ONLY a positive integer sessionID and returns HTTP 400
 * for empty, whitespace, non-numeric, zero, or negative values.
 *
 * Validating the same shape at the display boundary keeps the Generate
 * button from firing a request the handler would immediately reject —
 * the same guard the sibling AIFeedbackQueueTriage applies to its
 * numeric feedback id. Returns the canonical id string when valid, or
 * `null` (button disabled) otherwise.
 */
function normalizeSessionId(sessionId: string | undefined): string | null {
  if (sessionId == null) return null
  const trimmed = sessionId.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const n = Number(trimmed)
  if (!Number.isSafeInteger(n) || n <= 0) return null
  return String(n)
}

function InnerSection({ sessionId }: InnerSectionProps) {
  const { t } = useTranslation()
  const validSessionId = useMemo(() => normalizeSessionId(sessionId), [sessionId])
  const url = useMemo(
    () =>
      validSessionId
        ? `/ai/charging/${encodeURIComponent(validSessionId)}/diagnose`
        : '/ai/charging/0/diagnose',
    [validSessionId],
  )
  const body = useMemo(() => ({}), [])
  const stream = useAiStream({ url, body, onEvent: noop })
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
      emptyHint={t(
        'charging.detail.aiDiagnosis.emptyHint',
        'Waiting for a charging session…',
      )}
      canStart={validSessionId !== null}
      stream={stream}
    />
  )
}
InnerSection.displayName = 'AIChargingDiagnosisInner'

export const AIChargingDiagnosis = withAiFeature('charging-diagnosis', InnerSection)
AIChargingDiagnosis.displayName = 'AIChargingDiagnosis'
