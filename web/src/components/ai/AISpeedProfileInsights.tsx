// Speed-profile insights.
//
// AISpeedProfileInsights is the opt-in Helix surface rendered on the
// drive detail page. It is gated by
// withAiFeature('speed-profile-insights', …) so it renders nothing
// under ai_mode='off' or when the per-feature toggle is off (ADR-015).
// When enabled it renders the shared AIFeatureCard with a Generate
// button wired to the SSE endpoint at
// POST /api/v1/ai/drives/{driveID}/speed-profile/insights (empty body).
//
// The card layers a short LLM interpretation alongside — never in place
// of — the deterministic SpeedHistogramChart and summary metrics the
// drive detail page already renders for every user.

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { useAiStream } from '@/hooks/useAiStream'

/**
 * normalizeDriveId collapses every "no real drive" input to an empty
 * string and trims surrounding whitespace off an otherwise valid id.
 *
 * The drive-detail route's `useParams<{id}>()` yields
 * `string | undefined`, and a URL like `/drives/0` surfaces the `'0'`
 * sentinel for a placeholder / unsaved drive. Both the request URL and
 * the Generate button's enabled state derive from this single predicate
 * so an insights stream can never fire against a non-drive — otherwise a
 * click would POST `/api/v1/ai/drives/0/speed-profile/insights`, or (for
 * a whitespace-only id) a path padded with encoded spaces.
 *
 * Exported for direct unit testing; the encoding happens at the URL
 * boundary in {@link InnerSection}.
 */
export function normalizeDriveId(driveId: string | undefined): string {
  const trimmed = (driveId ?? '').trim()
  if (trimmed === '' || trimmed === '0') return ''
  return trimmed
}

interface InnerSectionProps {
  /**
   * driveID surfaced by the parent DriveDetailPage. Optional because the
   * drive-detail route's `useParams<{id}>()` returns `string | undefined`;
   * when absent (or a `'0'` / whitespace-only placeholder) we still render
   * the section (the gate has already passed) but the Generate button
   * stays disabled.
   */
  driveId?: string
}

/**
 * Stable no-op event handler. The insights narrative is accumulated by
 * useAiStream's built-in `text` field, so this feature needs no per-event
 * handling. A module-level reference keeps useAiStream's onEvent effect
 * from re-subscribing on every render (a fresh inline `() => {}` would).
 */
const noop = (): void => {}

function InnerSection({ driveId }: InnerSectionProps) {
  const { t } = useTranslation()
  const normalizedId = useMemo(() => normalizeDriveId(driveId), [driveId])
  const url = useMemo(
    () =>
      normalizedId
        ? `/ai/drives/${encodeURIComponent(normalizedId)}/speed-profile/insights`
        : '/ai/drives/0/speed-profile/insights',
    [normalizedId],
  )
  const body = useMemo(() => ({}), [])
  const stream = useAiStream({ url, body, onEvent: noop })
  return (
    <AIFeatureCard
      title={t('driveDetail.aiSpeedProfile.title', 'Speed-profile insights')}
      description={t(
        'driveDetail.aiSpeedProfile.description',
        'Get a short plain-language interpretation of this drive’s speed regime distribution — city / suburban / highway buckets, outliers, and how the speed envelope compares to a typical drive — generated from the same per-drive aggregates shown in the chart.',
      )}
      buttonLabel={t('driveDetail.aiSpeedProfile.generateButton', 'Generate insights')}
      badgeLabel={t('driveDetail.aiSpeedProfile.badge', 'Helix')}
      canStart={normalizedId !== ''}
      stream={stream}
    />
  )
}
InnerSection.displayName = 'AISpeedProfileInsightsInner'

export const AISpeedProfileInsights = withAiFeature('speed-profile-insights', InnerSection)
AISpeedProfileInsights.displayName = 'AISpeedProfileInsights'
